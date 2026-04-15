import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { CONFIG } from './config';
import { handleConnection, getOnlineCount } from './ws/handler';
import { initMatchmaking, shutdownMatchmaking } from './game/matchmaking';
import { createFight } from './ws/fight-room';
import { getCharacterById, getCharacterByWallet } from './data/characters';
import { getLeaderboard } from './data/leaderboard';
import { getShopCatalog } from './data/items';
import { getSupabase } from './data/supabase';
import { getFight } from './ws/fight-room';
import type { QueueEntry } from './types';

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

  createFight(charA, charB, entryA.fightType, entryA.wagerAmount);
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
