import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { CONFIG } from './config';
import { handleConnection, getOnlineCount } from './ws/handler';
import { initMatchmaking, shutdownMatchmaking } from './game/matchmaking';
import { createFight } from './ws/fight-room';
import { getCharacterById, getCharacterByWallet, restoreCharacterFromDb, updateCharacter } from './data/characters';
import { getLeaderboard } from './data/leaderboard';
import { getShopCatalog } from './data/items';
import { getSupabase } from './data/supabase';
import { getFight } from './ws/fight-room';
import { applyXp } from './game/combat';
import { findCharacterObjectId, updateCharacterOnChain } from './utils/sui-settle';
import { getConnectedClients, adoptWagerIntoLobby } from './ws/handler';
import type { QueueEntry, WagerLobbyEntry } from './types';

// === Express App ===

const app = express();
app.use(cors());
app.use(express.json());

// --- Health Check ---
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    onlinePlayers: getOnlineCount(),
    timestamp: Date.now(),
  });
});

// --- Leaderboard ---
app.get('/api/leaderboard', (_req, res) => {
  const entries = getLeaderboard(100);
  res.json({ entries });
});

// --- Shop Catalog ---
app.get('/api/shop', (_req, res) => {
  const items = getShopCatalog();
  res.json({ items });
});

// --- Character Data ---
app.get('/api/character/:walletAddress', (req, res) => {
  const { walletAddress } = req.params;
  const character = getCharacterByWallet(walletAddress);
  if (!character) {
    res.status(404).json({ error: 'Character not found' });
    return;
  }
  res.json({
    character: {
      id: character.id,
      name: character.name,
      level: character.level,
      xp: character.xp,
      xpToNextLevel: character.xpToNextLevel,
      walletAddress: character.walletAddress,
      stats: character.stats,
      equipment: character.equipment,
      gold: character.gold,
      wins: character.wins,
      losses: character.losses,
      rating: character.rating,
    },
  });
});

// --- Admin: grant XP (testnet-only) ---
// POST /api/admin/grant-xp  { wallet: "0x...", xp: 500 }
// Bumps XP both server-side (applyXp handles level-up + stat points) and
// on-chain (update_after_fight with won=false — note this increments the
// character's loss counter by 1 per call). Rejected on mainnet.
app.post('/api/admin/grant-xp', async (req, res) => {
  if (CONFIG.SUI_NETWORK === 'mainnet') {
    res.status(403).json({ error: 'Admin endpoint disabled on mainnet' });
    return;
  }

  const wallet = String(req.body?.wallet ?? '').trim();
  const xp = Math.floor(Number(req.body?.xp ?? 0));
  if (!wallet.startsWith('0x') || !Number.isFinite(xp) || xp <= 0 || xp > 10_000_000) {
    res.status(400).json({ error: 'Body must be { wallet: "0x...", xp: <positive int> }' });
    return;
  }

  let character = getCharacterByWallet(wallet);
  if (!character) {
    character = (await restoreCharacterFromDb(wallet)) ?? undefined;
  }
  if (!character) {
    res.status(404).json({ error: 'Character not found for wallet' });
    return;
  }

  const beforeLevel = character.level;
  const beforeXp = character.xp;
  const result = applyXp(character, xp);
  updateCharacter(character);

  let onchain: { digest?: string; error?: string } = {};
  try {
    const objId = await findCharacterObjectId(wallet);
    if (objId) {
      const { digest } = await updateCharacterOnChain(objId, false, xp, character.rating);
      onchain.digest = digest;
      // Tell the active WS client to re-fetch its on-chain character
      for (const [, c] of getConnectedClients()) {
        if (c.walletAddress === wallet && c.socket.readyState === c.socket.OPEN) {
          c.socket.send(JSON.stringify({ type: 'character_updated_onchain' }));
        }
      }
    } else {
      onchain.error = 'No on-chain Character NFT for this wallet (server-only grant applied)';
    }
  } catch (err: any) {
    onchain.error = err?.message || String(err);
  }

  console.log(`[Admin] Granted ${xp} XP to ${wallet.slice(0, 10)} (${beforeLevel}→${character.level}, xp ${beforeXp}→${character.xp})`);
  res.json({
    wallet,
    xpGranted: xp,
    before: { level: beforeLevel, xp: beforeXp },
    after: {
      level: character.level,
      xp: character.xp,
      unallocatedPoints: character.unallocatedPoints,
      leveledUp: result.leveledUp,
    },
    onchain,
  });
});

// --- Admin: adopt orphaned wager into lobby (testnet-only) ---
// POST /api/admin/adopt-wager  { wagerMatchId: "0x..." }
//
// Recovers a WagerMatch that was created on-chain but never made it into
// the in-memory lobby (e.g. WS reconnect race, or server restart after the
// create_wager tx landed). Fetches the WagerMatch from chain, verifies
// status=WAITING, resolves the creator's character, inserts the lobby
// entry, and broadcasts to all connected clients. Rejected on mainnet.
app.post('/api/admin/adopt-wager', async (req, res) => {
  if (CONFIG.SUI_NETWORK === 'mainnet') {
    res.status(403).json({ error: 'Admin endpoint disabled on mainnet' });
    return;
  }

  const wagerMatchId = String(req.body?.wagerMatchId ?? '').trim();
  if (!wagerMatchId.startsWith('0x') || wagerMatchId.length < 42) {
    res.status(400).json({ error: 'Body must be { wagerMatchId: "0x..." }' });
    return;
  }

  // Fetch WagerMatch from chain
  const rpcUrl = CONFIG.SUI_NETWORK === 'mainnet'
    ? 'https://fullnode.mainnet.sui.io:443'
    : 'https://fullnode.testnet.sui.io:443';

  let fields: Record<string, any> | undefined;
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'sui_getObject',
        params: [wagerMatchId, { showContent: true, showType: true }],
      }),
    });
    const json = await resp.json() as any;
    fields = json?.result?.data?.content?.fields;
    const objType = json?.result?.data?.type as string | undefined;
    if (!fields || !objType?.includes('::arena::WagerMatch')) {
      res.status(404).json({ error: 'Object not found or not a WagerMatch', type: objType });
      return;
    }
  } catch (err: any) {
    res.status(502).json({ error: `Chain RPC failed: ${err?.message || err}` });
    return;
  }

  const status = Number(fields.status);
  if (status !== 0) {
    res.status(409).json({
      error: 'Wager not in WAITING state',
      status,
      statusLabel: status === 1 ? 'ACTIVE' : status === 2 ? 'SETTLED' : 'UNKNOWN',
    });
    return;
  }

  const creatorWallet = String(fields.player_a);
  const stakeMist = Number(fields.stake_amount);
  const createdAtMs = Number(fields.created_at);
  const wagerAmount = stakeMist / 1_000_000_000;

  // Resolve creator's character so the lobby entry has real data
  const creatorChar = getCharacterByWallet(creatorWallet);
  if (!creatorChar) {
    res.status(409).json({
      error: 'Creator has no active character on server — they must be logged in to adopt',
      creatorWallet,
    });
    return;
  }

  const entry: WagerLobbyEntry = {
    wagerMatchId,
    creatorWallet,
    creatorCharacterId: creatorChar.id,
    creatorName: creatorChar.name,
    creatorLevel: creatorChar.level,
    creatorRating: creatorChar.rating,
    creatorStats: { ...creatorChar.stats },
    wagerAmount,
    // IMPORTANT: use Date.now(), not the chain's original created_at. The
    // lobby's 10-minute sweeper uses this field; using the chain timestamp
    // (potentially already stale by the time we adopt) triggers immediate
    // admin-cancel on the next sweeper tick, refunding the escrow and
    // defeating the recovery. Adopted entries get a fresh lobby clock.
    createdAt: Date.now(),
    // Preserve chain-side timestamp for auditing / future UI ("created 20m ago").
    // The existing WagerLobbyEntry type doesn't declare this yet; leaving it
    // out of the literal keeps the adopted entry shape-compatible today.
  };
  void createdAtMs;

  const adopted = adoptWagerIntoLobby(entry);
  if (!adopted) {
    res.status(409).json({ error: 'Wager already in lobby', entry });
    return;
  }

  res.json({ ok: true, entry });
});

// --- Fight Details ---
app.get('/api/fights/:fightId', (req, res) => {
  const { fightId } = req.params;
  const fight = getFight(fightId);
  if (!fight) {
    res.status(404).json({ error: 'Fight not found' });
    return;
  }

  res.json({
    fight: {
      id: fight.id,
      type: fight.type,
      status: fight.status,
      turn: fight.turn,
      winner: fight.winner || null,
      playerA: {
        characterId: fight.playerA.characterId,
        walletAddress: fight.playerA.walletAddress,
        name: fight.playerA.character.name,
        maxHp: fight.playerA.maxHp,
        finalHp: fight.playerA.currentHp,
      },
      playerB: {
        characterId: fight.playerB.characterId,
        walletAddress: fight.playerB.walletAddress,
        name: fight.playerB.character.name,
        maxHp: fight.playerB.maxHp,
        finalHp: fight.playerB.currentHp,
      },
      turnResults: fight.turnResults,
      startedAt: fight.startedAt,
      finishedAt: fight.finishedAt || null,
      wagerAmount: fight.wagerAmount || null,
    },
  });
});

// === HTTP + WebSocket Server ===

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  handleConnection(socket);
});

// === Initialize Matchmaking ===

function onMatchFound(entryA: QueueEntry, entryB: QueueEntry): void {
  const charA = getCharacterById(entryA.characterId);
  const charB = getCharacterById(entryB.characterId);

  if (!charA || !charB) {
    console.error('[Matchmaking] Could not find characters for match:', entryA.characterId, entryB.characterId);
    return;
  }

  console.log(
    `[Matchmaking] Match found: ${charA.name} (${charA.rating}) vs ${charB.name} (${charB.rating}) [${entryA.fightType}]`
  );

  // Wager fights go through lobby now, not matchmaking — this only handles friendly/ranked
  createFight(charA, charB, entryA.fightType, entryA.wagerAmount).catch((err) => {
    console.error('[Matchmaking] createFight failed:', err?.message || err);
  });
}

initMatchmaking(onMatchFound);

// === Initialize Supabase ===

getSupabase();

// === Start Server ===

server.listen(CONFIG.PORT, () => {
  console.log(`
====================================
  SUI Combats Game Server
====================================
  HTTP:      http://localhost:${CONFIG.PORT}
  WebSocket: ws://localhost:${CONFIG.PORT}
  Network:   ${CONFIG.SUI_NETWORK}
====================================
  Endpoints:
    GET /health
    GET /api/leaderboard
    GET /api/shop
    GET /api/character/:walletAddress
    GET /api/fights/:fightId
    WS  /  (WebSocket)
====================================
  `);
});

// === Graceful Shutdown ===

function gracefulShutdown(signal: string): void {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

  shutdownMatchmaking();

  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });

  wss.close(() => {
    console.log('[Server] WebSocket server closed.');
    server.close(() => {
      console.log('[Server] HTTP server closed.');
      process.exit(0);
    });
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
