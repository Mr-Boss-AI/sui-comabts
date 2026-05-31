import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { verifyAuthSignature } from '../utils/sui-verify';
import type WebSocket from 'ws';
import type {
  ClientMessage,
  ConnectedClient,
  EquipmentSlots,
  FightType,
  ServerMessage,
  TurnAction,
  WagerLobbyEntry,
  Zone,
} from '../types';
import {
  createCharacter,
  restoreCharacterFromChain,
  getCharacterByWallet,
  restoreCharacterFromDb,
  setOnChainObjectId,
  equipItem,
  unequipItem,
  addToInventory,
  getFightHistory,
  updateCharacter,
  deleteCharacter,
} from '../data/characters';
import { getLeaderboard } from '../data/leaderboard';
import { getMatchmaking } from '../game/matchmaking';
import { dbInsertWagerInFlight, dbDeleteWagerInFlight } from '../data/db';
import {
  submitTurnAction,
  addSpectator,
  removeSpectator,
  getActiveFights,
  getFight,
  setClientsRef,
  setPresenceFightBroadcaster,
  handlePlayerDisconnect,
  handlePlayerReconnect,
} from './fight-room';
import { getRecentOutcome } from '../data/recent-outcomes';
import {
  registerChatClient,
  unregisterChatClient,
  handleChatMessage,
  broadcastSystemMessage,
  getChatClients,
} from './chat';
import { CONFIG, GAME_CONSTANTS } from '../config';
import { getWagerStatus, getWagerAcceptedAt, adminCancelWagerOnChain, findCharacterObjectId, findAllCharacterIdsForWallet, shouldRejectDuplicateMint, waitForWagerTxFinality } from '../utils/sui-settle';
import { decideAcceptOutcome, resolveChallengerWallet } from './wager-accept-gate';
import { evaluateServerBusy } from './busy-state';
import { fetchEquippedFromDOFs, applyDOFEquipment } from '../utils/sui-read';
import { sanitizeEquipment, sanitizeCharacter } from '../utils/wire-sanitize';
import { getMarketplaceListings, listingToWire } from '../data/marketplace';
import {
  createFight,
} from './fight-room';
import {
  dispatchTavernMessage,
  announcePlayerOnline,
  announcePlayerOffline,
  handleGetOnlinePlayers as tavernGetOnlinePlayers,
  broadcastFightStatusChange,
  type TavernCtx,
} from './tavern-handlers';
import type { FightRequest } from '../data/fight-requests';

// === Connected Clients Registry ===

const connectedClients = new Map<string, ConnectedClient>();

// Share with fight-room module
setClientsRef(connectedClients);

// Wire Bucket 3 presence: fight-room broadcasts in_fight ↔ online via
// this callback whenever a fight starts or ends. Kept lazy because
// `tavernCtx` is declared later in the file; the closure captures it
// by reference so the call lands on the live ctx at fire time.
setPresenceFightBroadcaster((wallet, fightId) => {
  broadcastFightStatusChange(tavernCtx, wallet, fightId);
});

function send(client: ConnectedClient, msg: ServerMessage): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(msg));
  }
}

// === Tavern context ===
//
// Single shared context for `tavern-handlers.ts`. Keeping it as a module
// constant lets every handler dispatch reuse the same closures without
// allocating per-message.
const tavernCtx: TavernCtx = {
  sendToWallet(wallet: string, msg: Record<string, unknown>): boolean {
    const lower = wallet.toLowerCase();
    for (const [, c] of connectedClients) {
      if (c.walletAddress?.toLowerCase() === lower && c.socket.readyState === c.socket.OPEN) {
        c.socket.send(JSON.stringify(msg));
        return true;
      }
    }
    return false;
  },
  broadcastAll(msg: Record<string, unknown>): void {
    for (const [, c] of connectedClients) {
      if (c.authenticated && c.socket.readyState === c.socket.OPEN) {
        c.socket.send(JSON.stringify(msg));
      }
    }
  },
  getClient(wallet: string): ConnectedClient | undefined {
    const lower = wallet.toLowerCase();
    for (const [, c] of connectedClients) {
      if (c.walletAddress?.toLowerCase() === lower) return c;
    }
    return undefined;
  },
};

/**
 * Hook called by `tavern-handlers` when a fight request transitions to
 * `accepted`. Drives the post-accept side effects: friendly fights start
 * immediately; wager challenges open the wager-create flow on the
 * challenger's side via a `wager_challenge_ready` push.
 */
async function onAcceptFightRequest(req: FightRequest, accepter: ConnectedClient): Promise<void> {
  if (!accepter.walletAddress) return;
  const challengerClient = tavernCtx.getClient(req.fromWallet);
  if (req.requestType === 'friendly') {
    const charA = getCharacterByWallet(req.fromWallet);
    const charB = getCharacterByWallet(accepter.walletAddress);
    if (!charA || !charB) {
      sendError(accepter, 'Cannot start fight — character missing.');
      return;
    }
    if (challengerClient?.currentFightId || accepter.currentFightId) {
      sendError(accepter, 'Either player is already in a fight.');
      return;
    }
    try {
      await createFight(charA, charB, 'friendly');
    } catch (err: any) {
      sendError(accepter, `Could not start fight: ${err?.message ?? err}`);
    }
    return;
  }
  if (req.requestType === 'wager') {
    // Wager fights require the CHALLENGER to sign create_wager and lock
    // the SUI escrow. We push the directive back to the challenger; the
    // accepter waits for the challenger's wager to land in the lobby and
    // then signs accept_wager. This mirrors the existing wager flow but
    // with the lobby filtered to the explicit pair.
    if (challengerClient) {
      tavernCtx.sendToWallet(req.fromWallet, {
        type: 'wager_challenge_ready',
        request: {
          id: req.id,
          toWallet: req.toWallet,
          toName: req.toName,
          stakeMist: req.stakeMist ?? null,
        },
      });
    }
    tavernCtx.sendToWallet(req.toWallet, {
      type: 'wager_challenge_waiting',
      request: {
        id: req.id,
        fromWallet: req.fromWallet,
        fromName: req.fromName,
        stakeMist: req.stakeMist ?? null,
      },
    });
  }
}

function isValidFightType(v: unknown): v is FightType {
  return v === 'friendly' || v === 'ranked' || v === 'wager' || v === 'item_stake';
}

function sendError(client: ConnectedClient, message: string): void {
  send(client, { type: 'error', message });
}

// === Connection Handling ===

export function handleConnection(socket: WebSocket): void {
  const clientId = uuidv4();
  const client: ConnectedClient = {
    id: clientId,
    socket,
    lastChatTime: 0,
    authenticated: false,
  };

  connectedClients.set(clientId, client);
  console.log(`[WS] Client connected: ${clientId} (total: ${connectedClients.size})`);

  socket.on('message', (raw: Buffer | string) => {
    try {
      const data = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as ClientMessage;
      handleMessage(client, data);
    } catch (err) {
      sendError(client, 'Invalid message format');
    }
  });

  socket.on('close', () => {
    handleDisconnect(client);
  });

  socket.on('error', (err) => {
    console.error(`[WS] Client error ${clientId}:`, err.message);
  });
}

function handleDisconnect(client: ConnectedClient): void {
  // If this client was already removed (replaced by a newer session), skip teardown
  if (!connectedClients.has(client.id)) return;

  console.log(`[WS] Client disconnected: ${client.id} (wallet: ${client.walletAddress || 'none'})`);

  // Guest + authenticated spectator cleanup (Bug 2 fix, 2026-05-18).
  // Pre-fix this branch ran only inside the `if (client.walletAddress)`
  // block, so a guest spectator that lost connectivity stayed in the
  // fight's spectator set forever — fight-room would keep fanning
  // broadcasts at a dead socket. Hoisted out so it covers both flavours.
  if (client.spectatingFightId) {
    try {
      removeSpectator(client.spectatingFightId, spectatorKeyForClient(client));
    } catch { /* fight may have already ended */ }
    client.spectatingFightId = undefined;
  }

  if (client.walletAddress) {
    // Remove from matchmaking queue (friendly/ranked only now)
    try {
      getMatchmaking().removeFromQueue(client.walletAddress);
    } catch { /* matchmaking may not be initialized */ }

    // Cancel any open wager lobby entry
    for (const [id, entry] of wagerLobby) {
      if (entry.creatorWallet === client.walletAddress) {
        wagerLobby.delete(id);
        broadcastAll({ type: 'wager_lobby_removed', wagerMatchId: id });
        adminCancelWagerOnChain(id).catch((err) => {
          console.error('[Wager Lobby] On-chain cancel after disconnect failed:', err.message);
        });
        break;
      }
    }

    // Handle active fight disconnect (forfeit — settles wager on-chain via fight-room)
    handlePlayerDisconnect(client.walletAddress);

    // Remove from chat
    unregisterChatClient(client.walletAddress);

    // Bucket 3 presence — drop the row + broadcast `player_left`.
    announcePlayerOffline(tavernCtx, client.walletAddress);

    // Notify others
    broadcastSystemMessage(`${client.walletAddress.slice(0, 8)}... has left.`);
  }

  connectedClients.delete(client.id);
}

// === Message Router ===

// Testnet-only inbound WS logging. Surfaces messages the server is
// actually receiving so silent drops (WS reconnect race, malformed
// payload) show up immediately. Disable on testnet with DEBUG_WS=0.
const DEBUG_WS = process.env.DEBUG_WS !== '0' && CONFIG.SUI_NETWORK !== 'mainnet';

// === Auth handshake helpers ===

// In-flight challenges keyed by client.id. Each entry expires after
// CONFIG.AUTH_CHALLENGE_TTL_MS — older challenges are reaped during
// the periodic cleanup tick or rejected on use.
interface PendingChallenge {
  walletAddress: string;
  message: string;
  expiresAt: number;
}
const pendingChallenges = new Map<string, PendingChallenge>();

setInterval(() => {
  const now = Date.now();
  for (const [clientId, entry] of pendingChallenges) {
    if (entry.expiresAt < now) pendingChallenges.delete(clientId);
  }
}, 60_000).unref();

function buildChallengeMessage(walletAddress: string): string {
  // Multi-line message renders cleanly in wallet popups (Slush, Suiet, etc.).
  // Nonce makes each challenge unique so a captured signature can't be replayed.
  // ISO timestamp helps the user see why they're signing.
  const nonce = randomBytes(16).toString('hex');
  const issued = new Date().toISOString();
  return `SUI Combats v5 login\nWallet: ${walletAddress}\nNonce: ${nonce}\nIssued: ${issued}`;
}

function issueJwt(walletAddress: string): string {
  return jwt.sign({ walletAddress }, CONFIG.JWT_SECRET, {
    expiresIn: CONFIG.JWT_TTL_SECONDS,
  });
}

function verifyJwtToken(token: string): { walletAddress: string } | null {
  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET) as { walletAddress?: unknown };
    if (typeof decoded.walletAddress !== 'string') return null;
    return { walletAddress: decoded.walletAddress };
  } catch {
    return null;
  }
}

function isValidWalletAddress(addr: unknown): addr is string {
  return typeof addr === 'string' && addr.startsWith('0x') && addr.length >= 3;
}

/**
 * Read the on-chain DOFs for `character.onChainObjectId` and merge the
 * equipped items into `character.equipment`. Used by both
 * `acceptAuthenticatedSession` and `handleRestoreCharacter` so that any
 * code path that creates a server-side character record ends up with the
 * SAME chain-truthful equipment state — closes the BUG C/D race where
 * `handleRestoreCharacter` was responding with `character_created`
 * carrying empty equipment, which made the frontend render "naked" stats
 * for ~1 s before the next on-chain refresh ticked.
 *
 * No-op (with logging) if the character has no pinned NFT id or the RPC
 * read fails. Fail-open is fine: the next reconnect / refresh will retry.
 */
async function hydrateDOFsForCharacter(
  walletAddress: string,
  character: import('../types').Character,
  reasonTag: string,
): Promise<void> {
  const charObjectId = character.onChainObjectId;
  if (!charObjectId) {
    console.log(`[${reasonTag}] DOF ${walletAddress.slice(0, 10)}: no on-chain character id`);
    return;
  }
  const dof = await fetchEquippedFromDOFs(charObjectId);
  if (!dof) {
    console.log(`[${reasonTag}] DOF ${walletAddress.slice(0, 10)}: read failed — keeping current state`);
    return;
  }
  const populated = (Object.entries(dof) as Array<[string, unknown]>)
    .filter(([, v]) => v !== null)
    .map(([k]) => k);
  const changed = applyDOFEquipment(character.equipment, dof);
  console.log(
    `[${reasonTag}] DOF ${walletAddress.slice(0, 10)}: chain has ${populated.length} equipped` +
    `${populated.length ? ` (${populated.join(', ')})` : ''}` +
    `, ${changed.length} slot(s) synced`,
  );
}

// PRE_AUTH_TYPES lives in its own module (`./pre-auth-types`) so the QA
// gauntlet can import the canonical set without dragging in `config.ts`,
// which requires a fully-populated `.env` and would otherwise force the
// gauntlet to run with real testnet credentials configured. Re-exported
// here for backwards compatibility with any external import.
export { PRE_AUTH_TYPES } from './pre-auth-types';
import { PRE_AUTH_TYPES as PRE_AUTH_TYPES_LOCAL } from './pre-auth-types';

function handleMessage(client: ConnectedClient, msg: ClientMessage): void {
  if (!PRE_AUTH_TYPES_LOCAL.has(msg.type) && !client.authenticated) {
    sendError(client, 'Not authenticated. Send auth_request first.');
    return;
  }

  if (DEBUG_WS) {
    const extras: string[] = [];
    if (msg.wagerMatchId) extras.push(`wager=${String(msg.wagerMatchId).slice(0, 12)}`);
    if (msg.fightType) extras.push(`fightType=${msg.fightType}`);
    if (msg.slot) extras.push(`slot=${msg.slot}`);
    const tag = extras.length ? ` [${extras.join(', ')}]` : '';
    console.log(`[WS in] ${client.walletAddress?.slice(0, 10) ?? '??'} ${msg.type}${tag}`);
  }

  switch (msg.type) {
    case 'auth_request':
      handleAuthRequest(client, msg);
      break;
    case 'auth_signature':
      handleAuthSignature(client, msg);
      break;
    case 'auth_token':
      handleAuthToken(client, msg);
      break;
    case 'auth':
      sendError(
        client,
        'Bare auth is no longer supported. Send `auth_request` to begin a signed handshake or `auth_token` to resume an existing 24h session.',
      );
      break;
    case 'create_character':
      handleCreateCharacter(client, msg);
      break;
    case 'restore_character':
      handleRestoreCharacter(client, msg);
      break;
    case 'delete_character':
      handleDeleteCharacter(client);
      break;
    case 'get_character':
      handleGetCharacter(client, msg);
      break;
    case 'queue_fight':
      handleQueueFight(client, msg);
      break;
    case 'cancel_queue':
      handleCancelQueue(client);
      break;
    case 'fight_action':
      handleFightAction(client, msg);
      break;
    case 'chat_message':
      handleChat(client, msg);
      break;
    case 'get_online_players':
      tavernGetOnlinePlayers(client);
      break;
    case 'equip_item':
      handleEquipItem(client, msg);
      break;
    case 'unequip_item':
      handleUnequipItem(client, msg);
      break;
    case 'get_inventory':
      handleGetInventory(client);
      break;
    case 'get_leaderboard':
      handleGetLeaderboard(client);
      break;
    case 'get_fight_history':
      handleGetFightHistory(client);
      break;
    case 'spectate_fight':
      handleSpectateFight(client, msg);
      break;
    case 'wager_accepted':
      // Async handler — pre-fix the router fire-and-forgot, so any
      // unhandled rejection inside handleWagerAccepted got swallowed
      // by Node's default `unhandledRejection` behaviour. Now we
      // .catch() at the call site so the breadcrumb lands in the
      // server log even when the inner try/catch is bypassed by
      // an unexpected code path.
      //
      // v5.2 — this still terminates the wager-accept flow (wager is
      // now ACTIVE; the server starts the fight). The CALLER is now
      // the creator (after they signed approve_challenger), not the
      // challenger as in v5.1; the gate's self-check was relaxed to
      // accommodate (see wager-accept-gate.ts STATUS_ACTIVE branch).
      handleWagerAccepted(client, msg).catch((err: any) => {
        console.error(
          '[router:wager_accepted] unhandled async rejection:',
          err?.stack || err?.message || err,
        );
      });
      break;
    case 'wager_request_accepted':
    case 'wager_declined':
    case 'wager_withdrawn':
    case 'wager_challenge_expired':
    case 'wager_reclaimed':
      // v5.2 — handshake transitions for the new approval state
      // machine. All share the same shape (digest + chain re-probe +
      // lobby broadcast); the dispatcher routes through a single
      // generic handler with the message type as a hint for the chain
      // status it should expect to read.
      handleWagerHandshake(client, msg).catch((err: any) => {
        console.error(
          `[router:${msg.type}] unhandled async rejection:`,
          err?.stack || err?.message || err,
        );
      });
      break;
    case 'get_wager_lobby':
      handleGetWagerLobby(client);
      break;
    case 'cancel_wager_lobby':
      handleCancelWagerLobby(client, msg);
      break;
    case 'get_marketplace':
      handleGetMarketplace(client);
      break;
    // list_item / delist_item / buy_listing now happen wallet-side (PTBs against
    // marketplace.move). The server's listing index updates reactively from
    // chain events — there's nothing for the WS handler to do besides observe.
    case 'list_item':
    case 'delist_item':
    case 'buy_listing':
      break;
    case 'allocate_points':
      handleAllocatePoints(client, msg);
      break;
    case 'stop_spectating':
      handleStopSpectating(client);
      break;
    case 'challenge_player':
    case 'accept_challenge':
    case 'decline_challenge':
      break;
    default: {
      // Tavern surface (Bucket 3). Returns true if the message was a
      // tavern message and was handled; otherwise we fall through to the
      // unknown-type error below.
      const handled = dispatchTavernMessage(tavernCtx, client, msg as never, {
        onAcceptFightRequest: (req, c) => {
          void onAcceptFightRequest(req, c);
        },
      });
      if (!handled) {
        sendError(client, `Unknown message type: ${msg.type}`);
      }
    }
  }
}

// === Auth (signed-challenge → 24h JWT session) ===

/**
 * Step 1: client requests a sign-in challenge for `walletAddress`.
 * Server emits `auth_challenge` containing a unique multi-line message.
 * The same client.id can only hold one outstanding challenge at a time;
 * a fresh request replaces any previous one.
 */
function handleAuthRequest(client: ConnectedClient, msg: ClientMessage): void {
  const walletAddress = msg.walletAddress;
  if (!isValidWalletAddress(walletAddress)) {
    sendError(client, 'auth_request requires a walletAddress (0x…).');
    return;
  }
  const message = buildChallengeMessage(walletAddress);
  const expiresAt = Date.now() + CONFIG.AUTH_CHALLENGE_TTL_MS;
  pendingChallenges.set(client.id, { walletAddress, message, expiresAt });
  send(client, {
    type: 'auth_challenge',
    message,
    expiresAt,
  } as ServerMessage);
}

/**
 * Step 2: client returns the signed challenge.
 * Server verifies signature against the challenge message and the claimed
 * wallet, then issues a 24h JWT.
 */
async function handleAuthSignature(client: ConnectedClient, msg: ClientMessage): Promise<void> {
  const challenge = pendingChallenges.get(client.id);
  if (!challenge) {
    sendError(client, 'No pending challenge. Send auth_request first.');
    return;
  }
  if (Date.now() > challenge.expiresAt) {
    pendingChallenges.delete(client.id);
    sendError(client, 'Challenge expired. Request a new auth_request.');
    return;
  }

  const signature = msg.signature;
  if (typeof signature !== 'string' || signature.length === 0) {
    sendError(client, 'auth_signature requires a base64 signature string.');
    return;
  }

  try {
    const messageBytes = new TextEncoder().encode(challenge.message);
    await verifyAuthSignature(messageBytes, signature, challenge.walletAddress);
  } catch (err: any) {
    sendError(client, `Signature verification failed: ${err?.message || 'invalid'}`);
    return;
  }

  const token = issueJwt(challenge.walletAddress);
  pendingChallenges.delete(client.id);
  await acceptAuthenticatedSession(client, challenge.walletAddress, token);
}

/**
 * Step 2 (alt): client resumes an existing 24h session by presenting a JWT.
 * No fresh signature needed.
 */
async function handleAuthToken(client: ConnectedClient, msg: ClientMessage): Promise<void> {
  const walletAddress = msg.walletAddress;
  const token = msg.token;
  if (!isValidWalletAddress(walletAddress)) {
    sendError(client, 'auth_token requires a walletAddress.');
    return;
  }
  if (typeof token !== 'string' || token.length === 0) {
    sendError(client, 'auth_token requires a JWT string.');
    return;
  }
  const decoded = verifyJwtToken(token);
  if (!decoded || decoded.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    send(client, {
      type: 'auth_required',
      reason: 'Invalid or expired token. Send auth_request to sign a fresh challenge.',
    } as ServerMessage);
    return;
  }
  // Token is valid — re-issue (extends 24h window starting now) so a long-lived
  // session that's still actively connecting auto-renews.
  const fresh = issueJwt(walletAddress);
  await acceptAuthenticatedSession(client, walletAddress, fresh);
}

/**
 * Common path once the client has proven control of `walletAddress` (either
 * by signing a fresh challenge or by presenting a still-valid JWT).
 * Replaces any prior session for the same wallet, hydrates the character,
 * and emits `auth_ok` with the (re-)issued token.
 */
async function acceptAuthenticatedSession(
  client: ConnectedClient,
  walletAddress: string,
  token: string,
): Promise<void> {
  // Replace any existing session for the same wallet.
  for (const [, existing] of connectedClients) {
    if (existing.walletAddress === walletAddress && existing.id !== client.id) {
      connectedClients.delete(existing.id);
      existing.socket.close(4001, 'replaced');
      break;
    }
  }

  client.walletAddress = walletAddress;
  client.authenticated = true;

  // Check for existing character: in-memory first, then Supabase
  let character = getCharacterByWallet(walletAddress);
  if (!character) {
    character = await restoreCharacterFromDb(walletAddress) ?? undefined;
  }
  if (character) {
    client.characterId = character.id;

    // Resolve the chain Character NFT id ONCE and pin it on the server-side
    // record. Prefer the previously-pinned id (Supabase-backed) over a fresh
    // event scan — for wallets with multiple Characters the scan returns
    // "newest" which may not be the one this session is using.
    let charObjectId = character.onChainObjectId;
    if (!charObjectId) {
      charObjectId = (await findCharacterObjectId(walletAddress)) ?? undefined;
      if (charObjectId) {
        setOnChainObjectId(walletAddress, charObjectId);
      }
    }

    // Hydrate equipment from on-chain DOFs so server state matches the
    // player's "last saved" loadout before any fight resolution uses it.
    // Chain DOFs are authoritative for on-chain items; off-chain NPC items
    // are preserved in slots the chain doesn't touch.
    await hydrateDOFsForCharacter(walletAddress, character, 'Auth');
    // NOTE: verifyEquipmentOwnership used to run here as a ghost-item sweep.
    // Removed because its mental model ("equipped items live in the wallet")
    // is wrong under Phase 0.5 — equipped items are dynamic object fields on
    // the Character NFT, so `suix_getOwnedObjects` on the wallet correctly
    // does not list them. Keeping the sweep would clobber every DOF slot we
    // just hydrated. Chain-empty slots that still hold a stale on-chain ID
    // are already cleared by applyDOFEquipment above.
  }

  // Register for chat
  registerChatClient(client);

  // Bucket 3 presence — announce the player online + push initial room
  // (Tavern is the default landing). Subsequent `enter_room` messages
  // update the room without re-broadcasting `player_joined`.
  if (character) {
    announcePlayerOnline(tavernCtx, client, 'tavern');
  }

  send(client, {
    type: 'auth_ok',
    walletAddress,
    token,
    tokenExpiresAt: Date.now() + CONFIG.JWT_TTL_SECONDS * 1000,
    hasCharacter: !!character,
    character: character ? sanitizeCharacter(character) : null,
  });

  // Block C1 (2026-04-30) — if this wallet had a pending forfeit because of
  // an earlier socket drop, cancel it now and push the current fight state
  // back to the rejoining client. Idempotent for wallets that aren't
  // mid-fight: the helper returns early when no timer is pending.
  handlePlayerReconnect(walletAddress);

  // Bug 3 (live test 2026-05-03) — if the previous session ended while
  // this wallet was offline (forfeit fired during disconnect, or tab
  // closed right before settlement), the original `fight_end` vanished
  // into the closed socket. Replay it as `recent_fight_settled` so the
  // returning player sees Victory/Defeat once. Frontend uses
  // localStorage to dedupe — re-replays after subsequent reconnects
  // are skipped client-side because the ack is already recorded.
  const recent = getRecentOutcome(walletAddress);
  if (recent) {
    send(client, {
      type: 'recent_fight_settled',
      fight: recent.fight,
      loot: recent.loot,
    });
  }

  // The "joined" broadcast was previously gated on isReconnect (a flag set in
  // the legacy handleAuth). In the new flow the same wallet may auth via
  // either signature or token without that flag, so we always broadcast — the
  // chat dedupe in handleDisconnect already prevents thrashing on rapid
  // reconnects (it skips teardown for sessions that have already been
  // replaced).
  broadcastSystemMessage(`${walletAddress.slice(0, 8)}... has joined.`);
}

// === Create Character ===

async function handleCreateCharacter(client: ConnectedClient, msg: ClientMessage): Promise<void> {
  const name = msg.name as string;
  const strength = Number(msg.strength) || 0;
  const dexterity = Number(msg.dexterity) || 0;
  const intuition = Number(msg.intuition) || 0;
  const endurance = Number(msg.endurance) || 0;

  if (!name) {
    sendError(client, 'Missing name or stats');
    return;
  }

  // Layer 2 of the duplicate-mint fix (STATUS_v5.md 2026-04-30). A
  // create_character WS message arriving for a wallet that already holds one
  // or more on-chain Characters is a UI-bypass — the frontend's auth-phase
  // state machine should have routed the user through `restore_character`
  // instead. We reject before recording a duplicate server-side.
  //
  // Threshold: > 1. The just-minted CharacterCreated event for THIS create
  // attempt is on chain by the time the WS message arrives (the frontend
  // awaits signAndExecuteTransaction before sending), so length === 1 is the
  // legitimate first mint. length > 1 means a pre-existing Character was
  // already on chain when the user clicked Create — exactly the auth-flicker
  // scenario that shipped the "mee" dupe to mr_boss's wallet on 2026-04-30.
  //
  // Fail-open on RPC error (helper returns []): layer 1 (frontend state
  // machine) is the primary defense, so we don't want a transient RPC blip
  // to block legitimate first-time mints.
  const onChainIds = await findAllCharacterIdsForWallet(client.walletAddress!);
  const decision = shouldRejectDuplicateMint(onChainIds);
  if (decision.reject) {
    console.warn(
      `[CreateCharacter] Rejecting duplicate mint for ${client.walletAddress!.slice(0, 10)} ` +
      `— chain has ${decision.count} Character(s): ` +
      `${onChainIds.map((id) => id.slice(0, 12) + '…').join(', ')}`,
    );
    sendError(
      client,
      `Wallet already has a Character on chain (${decision.original!.slice(0, 14)}…). ` +
      `This looks like a duplicate mint. Refresh the page — your existing ` +
      `character will load.`,
    );
    return;
  }

  const result = createCharacter(client.walletAddress!, name, {
    strength,
    dexterity,
    intuition,
    endurance,
  });

  if (!result.character) {
    sendError(client, result.error || 'Failed to create character');
    return;
  }

  client.characterId = result.character.id;

  // Pin the freshly-minted on-chain id NOW so subsequent admin calls
  // (update_after_fight, set_fight_lock, DOF reads) target this NFT instead
  // of running the descending event scan on every call. If onChainIds.length
  // is 1 here, that single id is the just-minted Character.
  if (onChainIds.length === 1) {
    setOnChainObjectId(client.walletAddress!, onChainIds[0]);
    result.character.onChainObjectId = onChainIds[0];
  }

  send(client, {
    type: 'character_created',
    character: sanitizeCharacter(result.character),
  });
}

// === Restore Character from Chain ===

async function handleRestoreCharacter(client: ConnectedClient, msg: ClientMessage): Promise<void> {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }

  // If server already has the character in memory, just return it. We still
  // run DOF hydration in case the in-memory record was created before the
  // chain id was pinned (legacy path) — that's a no-op when DOFs already
  // match the in-memory equipment.
  const existing = getCharacterByWallet(client.walletAddress);
  if (existing) {
    client.characterId = existing.id;
    await hydrateDOFsForCharacter(client.walletAddress, existing, 'RestoreCached');
    send(client, { type: 'character_created', character: sanitizeCharacter(existing) });
    // 2026-05-08 — re-announce in case the original auth happened before
    // the character was loaded (skipped the `if (character)` gate at the
    // auth call site). The presence helper is idempotent; if the row is
    // already correct from an earlier announce, no broadcast goes out.
    announcePlayerOnline(tavernCtx, client, 'tavern');
    return;
  }

  const name = String(msg.name || '');
  const strength = Number(msg.strength) || 5;
  const dexterity = Number(msg.dexterity) || 5;
  const intuition = Number(msg.intuition) || 5;
  const endurance = Number(msg.endurance) || 5;
  const level = Number(msg.level) || 1;
  const xp = Number(msg.xp) || 0;
  const unallocatedPoints = Number(msg.unallocatedPoints) || 0;
  const wins = Number(msg.wins) || 0;
  const losses = Number(msg.losses) || 0;
  const draws = Number(msg.draws) || 0;
  const rating = Number(msg.rating) || 1000;
  // Frontend's `fetchCharacterNFT` already resolved the canonical chain id —
  // pin it now so every later admin call (update_after_fight, set_fight_lock,
  // DOF reads) targets THIS NFT instead of "whichever CharacterCreated event
  // happens to be newest" (the legacy `findCharacterObjectId(wallet)` answer).
  const onChainObjectId = typeof msg.objectId === 'string' && msg.objectId.startsWith('0x')
    ? (msg.objectId as string)
    : undefined;

  const result = restoreCharacterFromChain(
    client.walletAddress,
    name,
    { strength, dexterity, intuition, endurance },
    level, xp, unallocatedPoints, wins, losses, draws, rating,
    onChainObjectId,
  );

  if (!result.character) {
    sendError(client, result.error || 'Failed to restore character');
    return;
  }

  client.characterId = result.character.id;

  // BUG C/D fix (2026-05-02): hydrate equipment DOFs BEFORE responding so
  // the frontend's character_created arrives with full equipment in one
  // shot. Pre-fix this path responded with empty equipment; the frontend
  // rendered "naked" stats for ~1 s until the next on-chain refresh ticked.
  await hydrateDOFsForCharacter(client.walletAddress, result.character, 'Restore');

  send(client, { type: 'character_created', character: sanitizeCharacter(result.character) });

  // 2026-05-08 — fresh-restore path. The auth that came before this almost
  // certainly skipped `announcePlayerOnline` because `getCharacterByWallet`
  // was undefined at the time (in-memory empty after server restart, no
  // Supabase row to fall back on). Now that the character is loaded into
  // the canonical store, fire the announce so peers get a correct
  // `player_joined` instead of waiting for the next ~20s heartbeat to
  // graduate the presence row from its stub fallback.
  announcePlayerOnline(tavernCtx, client, 'tavern');
}

// === Delete Character ===

function handleDeleteCharacter(client: ConnectedClient): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }

  if (client.currentFightId) {
    sendError(client, 'Cannot delete character while in a fight');
    return;
  }

  const deleted = deleteCharacter(client.walletAddress);
  if (!deleted) {
    sendError(client, 'No character to delete');
    return;
  }

  client.characterId = undefined;
  send(client, { type: 'character_deleted' });
  console.log(`[Character] Deleted character for ${client.walletAddress.slice(0, 10)}... — ready for re-creation`);
}

// === Get Character ===

function handleGetCharacter(client: ConnectedClient, msg: ClientMessage): void {
  const walletAddress = (msg.walletAddress as string) || client.walletAddress;
  if (!walletAddress) {
    sendError(client, 'No wallet address');
    return;
  }

  const character = getCharacterByWallet(walletAddress);
  if (!character) {
    sendError(client, 'Character not found');
    return;
  }

  send(client, {
    type: 'character_data',
    character: sanitizeCharacter(character),
  });
}

// === Queue Fight ===

function handleQueueFight(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.characterId) {
    sendError(client, 'Create a character first');
    return;
  }

  // Cross-mode busy gate (Fix 1, 2026-05-04). Mirrors the frontend
  // `computeBusyState` predicate so the WS rejection always agrees with
  // the disabled-button rendering. Catches: already-in-fight, has open
  // wager in lobby, or already in matchmaking queue. Surfaced as a
  // single `sendError` toast — no chain tx fires (no SUI locked, no
  // gas spent).
  let ownWagerId: string | null = null;
  for (const entry of wagerLobby.values()) {
    if (entry.creatorWallet === client.walletAddress) {
      ownWagerId = entry.wagerMatchId;
      break;
    }
  }
  const busy = evaluateServerBusy({
    hasFight: !!client.currentFightId,
    ownWagerId,
    inMatchmakingQueue: getMatchmaking().isInQueue(client.walletAddress!),
  });
  if (busy.busy) {
    sendError(client, busy.reason);
    return;
  }

  const character = getCharacterByWallet(client.walletAddress!);
  if (!character) {
    sendError(client, 'Character not found');
    return;
  }

  // NOTE: we intentionally ignore msg.onChainEquipment. Equipment for combat
  // is read directly from on-chain DOFs inside createFight (see fight-room.ts
  // — D3-strict per LOADOUT_DESIGN.md). Trusting a client-supplied payload
  // would let a dishonest client fight with gear they never committed.

  const rawFightType: unknown = msg.fightType ?? 'ranked';
  if (!isValidFightType(rawFightType)) {
    sendError(client, 'Invalid fight type');
    return;
  }
  const fightType: FightType = rawFightType;

  // Wager fights go through the lobby, not the matchmaking queue
  if (fightType === 'wager') {
    const wagerAmount = Number(msg.wagerAmount) || 0;
    const wagerMatchId = msg.wagerMatchId as string | undefined;

    if (!wagerAmount || wagerAmount < 0.1) {
      sendError(client, 'Minimum wager is 0.1 SUI');
      return;
    }
    // v5.1 mainnet-blocker — hard cap on wager stake. Bounds blast radius
    // of a single bug or admin-key compromise. Compare in MIST (BigInt) to
    // avoid float-point drift on large values.
    const wagerMist = BigInt(Math.round(wagerAmount * 1_000_000_000));
    if (wagerMist > CONFIG.MAX_WAGER_SUI_MIST) {
      const capSui = Number(CONFIG.MAX_WAGER_SUI_MIST) / 1_000_000_000;
      sendError(client, `Wager exceeds maximum of ${capSui} SUI per match`);
      console.warn(
        `[Wager] Rejected over-cap create: caller=${client.walletAddress?.slice(0, 10)} ` +
        `wagerAmount=${wagerAmount} SUI cap=${capSui} SUI`,
      );
      return;
    }
    if (!wagerMatchId) {
      sendError(client, 'On-chain wager escrow required. Sign the create_wager transaction first.');
      return;
    }

    // Own-wager / fight / queue cross-mode check is handled by the
    // `evaluateServerBusy` gate at the top of `handleQueueFight` (Fix 1,
    // 2026-05-04). No redundant per-branch loop needed.

    const entry: WagerLobbyEntry = {
      wagerMatchId,
      creatorWallet: client.walletAddress!,
      creatorCharacterId: client.characterId,
      creatorName: character.name,
      creatorLevel: character.level,
      creatorRating: character.rating,
      creatorStats: { ...character.stats },
      wagerAmount,
      createdAt: Date.now(),
    };

    wagerLobby.set(wagerMatchId, entry);
    broadcastAll({ type: 'wager_lobby_added', entry });
    console.log(`[Wager Lobby] ${character.name} created wager for ${wagerAmount} SUI (${wagerMatchId})`);
    return;
  }

  // Non-wager: use matchmaking queue
  const mm = getMatchmaking();
  const added = mm.addToQueue({
    walletAddress: client.walletAddress!,
    characterId: client.characterId,
    fightType,
    rating: character.rating,
    joinedAt: Date.now(),
  });

  if (!added) {
    sendError(client, 'Already in queue');
    return;
  }

  send(client, {
    type: 'queue_joined',
    fightType,
  });
}

// === Cancel Queue ===

function handleCancelQueue(client: ConnectedClient): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }

  const mm = getMatchmaking();
  const removed = mm.removeFromQueue(client.walletAddress);

  // If the player had an on-chain wager in the queue, cancel it to refund
  if (removed?.wagerMatchId) {
    adminCancelWagerOnChain(removed.wagerMatchId).catch((err) => {
      console.error('[Wager] On-chain cancel after queue leave failed:', err.message);
    });
  }

  send(client, {
    type: 'queue_left',
  });
}

// === Fight Action ===

function handleFightAction(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.currentFightId || !client.characterId) {
    sendError(client, 'Not in a fight');
    return;
  }

  const attackZones = msg.attackZones as Zone[] | undefined;
  const blockZones = msg.blockZones as Zone[] | undefined;

  if (!attackZones || !blockZones) {
    sendError(client, 'Missing attackZones or blockZones');
    return;
  }

  const action: TurnAction = { attackZones, blockZones };

  // Diagnostic — pair this with the frontend's `[fight_action send]`
  // console log. If they disagree, the WS transport or the client state
  // at send time was off. If they agree but the damage log shows
  // different zones, the resolver or display is wrong.
  console.log(
    `[Fight] action ${client.walletAddress?.slice(0, 10)} ` +
    `atk=${JSON.stringify(attackZones)} blk=${JSON.stringify(blockZones)}`,
  );

  const result = submitTurnAction(client.currentFightId, client.characterId, action);

  if (!result.success) {
    sendError(client, result.error || 'Failed to submit action');
  }
}

// === Chat ===

function handleChat(client: ConnectedClient, msg: ClientMessage): void {
  const content = msg.content as string;
  const target = msg.target as string | undefined;

  const result = handleChatMessage(client, content, target);
  if (!result.success) {
    sendError(client, result.error || 'Failed to send message');
  }
}

// === Online Players ===
//
// Presence is now a first-class service (`data/presence.ts`) wired
// through `tavern-handlers.ts`. The legacy iterate-connectedClients
// implementation lived here pre-Bucket-3; the new path uses a
// heartbeat-driven `presence` map with Supabase durability and proper
// room/status tracking. `tavernGetOnlinePlayers` is the wire reply.

// === Equip Item ===

function handleEquipItem(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.characterId) {
    sendError(client, 'No character');
    return;
  }
  if (client.currentFightId) {
    sendError(client, 'Cannot change equipment during a fight');
    return;
  }

  const itemId = msg.itemId as string;
  if (!itemId) {
    sendError(client, 'Missing itemId');
    return;
  }

  // On-chain items must be equipped via wallet-signed tx (equipment::equip_*_v2),
  // not a server-side dispatch. Reject with an actionable message so the client
  // can build the correct tx. Hex object IDs on testnet are 66 chars ("0x" + 64 hex).
  if (itemId.startsWith('0x') && itemId.length >= 42) {
    sendError(
      client,
      'This is an on-chain item. Sign the equip transaction in your wallet instead.',
    );
    return;
  }

  const result = equipItem(client.characterId, itemId);
  if (!result.success) {
    sendError(client, result.error || 'Failed to equip item');
    return;
  }

  const character = getCharacterByWallet(client.walletAddress!);
  send(client, {
    type: 'item_equipped',
    character: character ? sanitizeCharacter(character) : null,
  });
}

// === Unequip Item ===

function handleUnequipItem(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.characterId) {
    sendError(client, 'No character');
    return;
  }
  if (client.currentFightId) {
    sendError(client, 'Cannot change equipment during a fight');
    return;
  }

  const slot = msg.slot as keyof EquipmentSlots;
  if (!slot) {
    sendError(client, 'Missing slot');
    return;
  }

  const validSlots: (keyof EquipmentSlots)[] = [
    'weapon', 'offhand', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'ring1', 'ring2', 'necklace',
  ];
  if (!validSlots.includes(slot)) {
    sendError(client, 'Invalid slot');
    return;
  }

  // Get the item before unequipping so we can return it
  const charBefore = getCharacterByWallet(client.walletAddress!);
  const unequippedItem = charBefore?.equipment[slot] || null;

  // On-chain items are stored as DOFs on the Character NFT. To unequip them
  // we need a wallet-signed tx calling equipment::unequip_*_v2 — the server
  // has no authority. Refuse here and let the client build the tx.
  if (unequippedItem?.id && unequippedItem.id.startsWith('0x') && unequippedItem.id.length >= 42) {
    sendError(
      client,
      'This slot holds an on-chain item. Sign the unequip transaction in your wallet instead.',
    );
    return;
  }

  const result = unequipItem(client.characterId, slot);
  if (!result.success) {
    sendError(client, result.error || 'Failed to unequip item');
    return;
  }

  const character = getCharacterByWallet(client.walletAddress!);
  send(client, {
    type: 'item_unequipped',
    character: character ? sanitizeCharacter(character) : null,
    item: unequippedItem,
  });
}

// === Get Inventory ===

function handleGetInventory(client: ConnectedClient): void {
  const character = getCharacterByWallet(client.walletAddress!);
  if (!character) {
    sendError(client, 'Character not found');
    return;
  }

  send(client, {
    type: 'inventory',
    items: character.inventory,
  });
}

// === Get Leaderboard ===

function handleGetLeaderboard(client: ConnectedClient): void {
  const entries = getLeaderboard(100);
  // Map to frontend expected format
  const mapped = entries.map((e) => ({
    rank: e.rank,
    walletAddress: e.walletAddress,
    name: e.characterName,
    level: e.level,
    rating: e.rating,
    wins: e.wins,
    losses: e.losses,
    draws: e.draws,
    stats: e.stats,
  }));
  send(client, {
    type: 'leaderboard',
    entries: mapped,
  });
}

// === Get Fight History ===

function handleGetFightHistory(client: ConnectedClient): void {
  if (!client.characterId) {
    sendError(client, 'No character');
    return;
  }

  const history = getFightHistory(client.characterId);
  // Map to frontend expected format
  const fights = history.map((h) => ({
    id: h.fightId,
    type: h.type,
    playerA: { name: h.opponentName, walletAddress: h.opponentWallet },
    playerB: { name: getCharacterByWallet(client.walletAddress!)?.name || 'Unknown', walletAddress: client.walletAddress! },
    winner: h.result === 'win' ? client.walletAddress! : h.opponentWallet,
    turns: h.turns,
    timestamp: h.timestamp,
    wagerAmount: undefined as number | undefined,
  }));
  send(client, {
    type: 'fight_history',
    fights,
  });
}

// === Spectate Fight ===

/**
 * Resolve the spectator key for `addSpectator` / `removeSpectator`.
 *
 * Authenticated clients use their wallet address — same as pre-fix
 * behaviour, so existing spectator records stay routable. Guest clients
 * (Bug 2 fix, 2026-05-18 — disconnected users clicking "Watch a Fight"
 * on the landing screen) get a synthetic `guest:<clientId>` key. The
 * key only needs to be unique per connected client and round-trip
 * consistent for the duration of the session; client.id is a uuid
 * minted at WS-accept time and lives in `connectedClients`, so this
 * holds even across reconnects from the same client (each reconnect
 * gets a fresh uuid → fresh spectator entry).
 *
 * Lives next to handleSpectateFight rather than fight-room because
 * fight-room operates on `Set<string>` and shouldn't know about the
 * auth/guest distinction — that's purely a handler-layer concern.
 */
function spectatorKeyForClient(client: ConnectedClient): string {
  return client.walletAddress ?? `guest:${client.id}`;
}

function handleSpectateFight(client: ConnectedClient, msg: ClientMessage): void {
  const fightId = msg.fightId as string;

  if (!fightId) {
    // List active fights — read-only, no spectator registration. Both
    // authenticated and guest clients hit this branch when the
    // SpectatorLanding component first mounts.
    const fights = getActiveFights().map((f) => ({
      fightId: f.id,
      type: f.type,
      playerA: { name: f.playerA.character.name, level: f.playerA.character.level },
      playerB: { name: f.playerB.character.name, level: f.playerB.character.level },
      turn: f.turn,
    }));

    send(client, {
      type: 'spectate_update',
      activeFights: fights,
    });
    return;
  }

  const spectatorKey = spectatorKeyForClient(client);
  const result = addSpectator(fightId, spectatorKey);
  if (!result.success) {
    sendError(client, result.error || 'Cannot spectate this fight');
    return;
  }

  const fight = result.fight!;
  send(client, {
    type: 'spectate_update',
    fight: {
      id: fight.id,
      type: fight.type,
      status: fight.status,
      turn: fight.turn,
      playerA: {
        characterId: fight.playerA.characterId,
        walletAddress: fight.playerA.walletAddress,
        name: fight.playerA.character.name,
        currentHp: fight.playerA.currentHp,
        maxHp: fight.playerA.maxHp,
        level: fight.playerA.character.level,
      },
      playerB: {
        characterId: fight.playerB.characterId,
        walletAddress: fight.playerB.walletAddress,
        name: fight.playerB.character.name,
        currentHp: fight.playerB.currentHp,
        maxHp: fight.playerB.maxHp,
        level: fight.playerB.character.level,
      },
    },
  });
}

/**
 * Pre-fix this case fell through the switch as a no-op, so the
 * fight-room's spectator set kept the wallet (or guest key) until the
 * fight ended — broadcast traffic for that fight continued to fan out
 * to a client that had moved on. With the guest spectator flow shipped
 * (Bug 2 fix, 2026-05-18) a leaked spectator means a guest who clicked
 * "Leave" is still receiving turn updates over the WS, so we now
 * actively unregister.
 *
 * Idempotent: removeSpectator silently ignores unknown keys, so a
 * double-send from the client (or a client that never spectated)
 * doesn't error.
 */
function handleStopSpectating(client: ConnectedClient): void {
  const fightId = client.spectatingFightId;
  if (!fightId) return;
  removeSpectator(fightId, spectatorKeyForClient(client));
  client.spectatingFightId = undefined;
}

// === Wager Lobby ===

const wagerLobby = new Map<string, WagerLobbyEntry>();

// Periodic cleanup of expired lobby entries (10 min)
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of wagerLobby) {
    if (now - entry.createdAt > 10 * 60 * 1000) {
      wagerLobby.delete(id);
      broadcastAll({ type: 'wager_lobby_removed', wagerMatchId: id });
      // On-chain expiry is handled by cancel_expired_wager (anyone can call)
      adminCancelWagerOnChain(id).catch(() => {});
      console.log(`[Wager Lobby] Expired: ${id}`);
    }
  }
}, 30_000);

function getClientByWalletAddress(wallet: string): ConnectedClient | undefined {
  for (const [, c] of connectedClients) {
    if (c.walletAddress === wallet) return c;
  }
  return undefined;
}

function broadcastAll(msg: ServerMessage): void {
  for (const [, c] of connectedClients) {
    if (c.authenticated && c.socket.readyState === c.socket.OPEN) {
      c.socket.send(JSON.stringify(msg));
    }
  }
}

function handleGetWagerLobby(client: ConnectedClient): void {
  const entries = Array.from(wagerLobby.values());
  send(client, { type: 'wager_lobby_list', entries });
}

function handleCancelWagerLobby(client: ConnectedClient, msg: ClientMessage): void {
  const wagerMatchId = msg.wagerMatchId as string;
  if (!wagerMatchId) {
    sendError(client, 'Missing wagerMatchId');
    return;
  }

  const entry = wagerLobby.get(wagerMatchId);
  if (!entry) {
    sendError(client, 'Wager not found in lobby');
    return;
  }

  if (entry.creatorWallet !== client.walletAddress) {
    sendError(client, 'You can only cancel your own wager');
    return;
  }

  wagerLobby.delete(wagerMatchId);
  broadcastAll({ type: 'wager_lobby_removed', wagerMatchId });

  // Cancel on-chain to refund
  adminCancelWagerOnChain(wagerMatchId).catch((err) => {
    console.error('[Wager Lobby] On-chain cancel failed:', err.message);
  });

  console.log(`[Wager Lobby] ${entry.creatorName} cancelled wager (${wagerMatchId})`);
}

/**
 * v5.2 — Generic handshake handler for the wager-fairness flow.
 *
 * Five message types share this entrypoint:
 *
 *   wager_request_accepted      → chain expected to be PENDING_APPROVAL (3)
 *   wager_declined              → chain expected to be WAITING        (0)
 *   wager_withdrawn             → chain expected to be WAITING        (0)
 *   wager_challenge_expired     → chain expected to be WAITING        (0)
 *   wager_reclaimed             → chain expected to be SETTLED        (2)
 *
 * Common machinery:
 *   1. Validate wagerMatchId + that the lobby has this entry
 *   2. waitForWagerTxFinality on the supplied digest (same as v5.1's
 *      handleWagerAccepted — closes the chain-finality race)
 *   3. getWagerStatus probe + verify it matches the expected status
 *      for the message type (defence against stale / replayed messages)
 *   4. Update the in-memory lobby entry + broadcast wager_lobby_updated
 *      (or wager_lobby_removed for the reclaim path)
 *
 * NOT handled here:
 *   - Fight-start for approve_challenger: the creator's frontend sends a
 *     separate `wager_accepted` after approve_challenger lands, which
 *     goes through the existing handleWagerAccepted flow (gate updated
 *     to allow caller=creator when status=ACTIVE; v5.1 v5.2 paths share
 *     the same fight-start machinery).
 *   - Profile lookup for pendingChallenger: the simplest path uses the
 *     calling client's wallet (they signed request_accept_wager, so
 *     they ARE the pending_challenger). We pull their character snapshot
 *     from in-memory state — same source the lobby entry was created
 *     from at create_wager time.
 */
async function handleWagerHandshake(
  client: ConnectedClient,
  msg: ClientMessage,
): Promise<void> {
  const wagerMatchId = msg.wagerMatchId as string | undefined;
  const txDigest = (msg as { txDigest?: string }).txDigest;
  const messageType = msg.type as
    | 'wager_request_accepted'
    | 'wager_declined'
    | 'wager_withdrawn'
    | 'wager_challenge_expired'
    | 'wager_reclaimed';

  if (!wagerMatchId) {
    console.warn(`[${messageType}] reject(missing-wagerMatchId)`);
    sendError(client, 'Missing wagerMatchId');
    return;
  }

  if (!client.authenticated) {
    console.warn(`[${messageType}] reject(unauthenticated) wallet=${client.walletAddress}`);
    sendError(client, 'Not authenticated');
    return;
  }

  const entry = wagerLobby.get(wagerMatchId);
  if (!entry && messageType !== 'wager_reclaimed') {
    // Lobby entry might be missing if the server restarted between the
    // client's tx and this message. Reclaim is the exception — that
    // path drops state, so a missing entry is acceptable.
    console.warn(
      `[${messageType}] no lobby entry for wager=${wagerMatchId.slice(0, 14)} ` +
      `— broadcasting removal as best-effort cleanup`,
    );
    broadcastAll({ type: 'wager_lobby_removed', wagerMatchId });
    return;
  }

  // v5.2 — chain-finality wait. Same shape as handleWagerAccepted
  // (closes the 2026-05-27/28 fullnode-lag race). On timeout we still
  // proceed to the status probe; on failure we abort.
  if (txDigest) {
    const txOutcome = await waitForWagerTxFinality(txDigest, 3000);
    if (txOutcome.kind === 'failure') {
      console.warn(
        `[${messageType}] tx-failed-onchain digest=${txDigest.slice(0, 14)} err=${txOutcome.error}`,
      );
      sendError(client, `Your ${messageType.replace('wager_', '')} transaction failed on chain: ${txOutcome.error}`);
      return;
    }
    if (txOutcome.kind === 'timeout') {
      console.warn(
        `[${messageType}] tx-finality timeout digest=${txDigest.slice(0, 14)} ` +
        `wager=${wagerMatchId.slice(0, 14)} — falling through to status probe`,
      );
    }
  }

  // Probe chain status — same RPC the v5.1 handleWagerAccepted uses.
  const chainStatus = await getWagerStatus(wagerMatchId);
  if (chainStatus === null) {
    console.warn(
      `[${messageType}] chain-probe-null wager=${wagerMatchId.slice(0, 14)} ` +
      `— skipping lobby mutation (next sweep tick will resolve)`,
    );
    return;
  }

  // Expected status per message type. A mismatch means the client + chain
  // are out of sync (e.g. another participant raced) — log + ignore so
  // we don't broadcast a misleading state.
  const STATUS_WAITING = 0;
  const STATUS_SETTLED = 2;
  const STATUS_PENDING_APPROVAL = 3;
  const expectedByType: Record<typeof messageType, number> = {
    wager_request_accepted: STATUS_PENDING_APPROVAL,
    wager_declined: STATUS_WAITING,
    wager_withdrawn: STATUS_WAITING,
    wager_challenge_expired: STATUS_WAITING,
    wager_reclaimed: STATUS_SETTLED,
  };
  const expected = expectedByType[messageType];
  if (chainStatus !== expected) {
    console.warn(
      `[${messageType}] status mismatch wager=${wagerMatchId.slice(0, 14)} ` +
      `expected=${expected} chain=${chainStatus} — ignoring (out-of-sync)`,
    );
    return;
  }

  console.log(
    `[${messageType}] chain-confirmed wager=${wagerMatchId.slice(0, 14)} ` +
    `status=${chainStatus} caller=${(client.walletAddress ?? '(unknown)').slice(0, 14)}`,
  );

  // ─── Lobby mutation dispatch ─────────────────────────────────────

  if (messageType === 'wager_reclaimed') {
    // Drop the lobby entry (if any) + any wager_in_flight row + broadcast
    // removal. Same shape as a settle_wager/settle_tie cleanup but
    // initiated by a participant rather than treasury.
    if (entry) wagerLobby.delete(wagerMatchId);
    broadcastAll({ type: 'wager_lobby_removed', wagerMatchId });
    dbDeleteWagerInFlight(wagerMatchId).catch((err) => {
      console.error(`[${messageType}] dbDeleteWagerInFlight failed:`, err?.message || err);
    });
    return;
  }

  if (!entry) {
    // Defensive — handled above for non-reclaim paths.
    return;
  }

  if (messageType === 'wager_request_accepted') {
    // v5.2 — populate pendingChallenger from the caller's in-memory
    // character state. The caller signed request_accept_wager so by
    // construction they ARE the pending challenger; we don't need an
    // extra chain object read to identify them.
    const challengerCharacter = client.walletAddress
      ? getCharacterByWallet(client.walletAddress)
      : undefined;
    if (!challengerCharacter) {
      console.warn(
        `[${messageType}] caller has no in-memory character wager=${wagerMatchId.slice(0, 14)} ` +
        `wallet=${(client.walletAddress ?? '(unknown)').slice(0, 14)} — skipping pending populate`,
      );
      return;
    }
    const updated: WagerLobbyEntry = {
      ...entry,
      status: STATUS_PENDING_APPROVAL,
      pendingChallenger: {
        wallet: client.walletAddress!,
        name: challengerCharacter.name,
        level: challengerCharacter.level,
        rating: challengerCharacter.rating,
        stats: { ...challengerCharacter.stats },
        pendingAt: Date.now(),
      },
    };
    wagerLobby.set(wagerMatchId, updated);
    broadcastAll({ type: 'wager_lobby_updated', entry: updated });
    console.log(
      `[${messageType}] pending populated: ` +
      `creator=${entry.creatorName} challenger=${challengerCharacter.name} ` +
      `(Lv.${challengerCharacter.level})`,
    );
    return;
  }

  // wager_declined / wager_withdrawn / wager_challenge_expired:
  // wager returned to WAITING; clear pending fields. Capture the
  // pre-clear pending wallet BEFORE we drop it from the entry — we
  // still need it for the targeted "you were declined" / "your
  // challenger walked away" toast below.
  const previousPendingWallet = entry.pendingChallenger?.wallet;
  const previousChallengerName = entry.pendingChallenger?.name;
  const cleared: WagerLobbyEntry = {
    ...entry,
    status: STATUS_WAITING,
    pendingChallenger: undefined,
  };
  wagerLobby.set(wagerMatchId, cleared);
  broadcastAll({ type: 'wager_lobby_updated', entry: cleared });
  console.log(
    `[${messageType}] pending cleared: wager=${wagerMatchId.slice(0, 14)} returned to WAITING`,
  );

  // v5.2 (2026-05-31) — targeted toast to the party that DIDN'T sign
  // the transition. The lobby-card already updated via the broadcast
  // above; this is the explicit "your stake was refunded" / "your
  // challenger walked away" UX cue. The signer doesn't need a toast
  // (they just clicked the button and saw the modal close).
  if (messageType === 'wager_declined' && previousPendingWallet) {
    // Creator declined → challenger gets the toast.
    const target = getClientByWalletAddress(previousPendingWallet);
    if (target?.authenticated) {
      send(target, {
        type: 'wager_notification',
        kind: 'declined',
        wagerMatchId,
        message: `Your challenge to ${entry.creatorName} was declined — your stake has been refunded.`,
      });
    }
  } else if (messageType === 'wager_withdrawn' && previousPendingWallet) {
    // Challenger withdrew → creator gets the toast (the candidate they
    // were considering walked away — the slot reopened).
    const target = getClientByWalletAddress(entry.creatorWallet);
    if (target?.authenticated) {
      send(target, {
        type: 'wager_notification',
        kind: 'withdrawn',
        wagerMatchId,
        message: `${previousChallengerName ?? 'Your challenger'} withdrew their challenge — the wager is open again for a new accepter.`,
      });
    }
  } else if (messageType === 'wager_challenge_expired' && previousPendingWallet) {
    // 5-min CHALLENGE_TIMEOUT_MS elapsed → challenger gets the toast
    // (their stake was just refunded). Creator already sees the slot
    // reopen via the lobby_updated broadcast; the challenger needs the
    // explicit "refund landed" cue because they may not be looking at
    // the lobby tab.
    const target = getClientByWalletAddress(previousPendingWallet);
    if (target?.authenticated) {
      send(target, {
        type: 'wager_notification',
        kind: 'challengeExpired',
        wagerMatchId,
        message: `Your challenge to ${entry.creatorName} timed out (5 min) — your stake has been refunded.`,
      });
    }
  }
}

/**
 * Wagers currently mid-acceptance. The handler awaits a chain RPC
 * (`getWagerStatus`) between checking the lobby and deleting from it, so
 * two concurrent `wager_accepted` messages for the SAME wagerMatchId can
 * both pass the existence check and both proceed to `createFight` —
 * spawning two ghost fights for one on-chain wager. Adding the id to this
 * set on entry and removing on exit makes the handler single-flight per
 * wager, which is what we want.
 */
const processingWagerAccepts = new Set<string>();

async function handleWagerAccepted(client: ConnectedClient, msg: ClientMessage): Promise<void> {
  const wagerMatchId = msg.wagerMatchId as string;
  // Diagnostic (2026-05-27). Frontend sends `txDigest` after a successful
  // assertTxSucceeded on the accept_wager sign result (matchmaking-queue.tsx:538).
  // Logging it lets the next finality-race repro be traced from the WS event
  // straight to the on-chain tx — we hit a "status=0 / accept-actually-landed"
  // race on 2026-05-27 where the server's chain probe read pre-finality.
  const txDigest = (msg as { txDigest?: string }).txDigest;
  if (!wagerMatchId) {
    console.warn('[handleWagerAccepted] reject(missing-wagerMatchId)');
    sendError(client, 'Missing wagerMatchId');
    return;
  }
  // Bug 7 (2026-05-19) diagnostic. Every silent sendError gate now
  // emits a server-side breadcrumb so the next repro of "wager
  // accepted on-chain but fight never starts" tells us exactly which
  // gate fired. Pre-fix the 0xce620b9c… incident left no trace at
  // all on the server side: 0.2 SUI locked, two clients staring at
  // stale lobby, no error log, no way to triage from the data we had.
  // The shared `gateExit(...)` helper keeps the call sites short and
  // ensures every exit goes through one breadcrumb path — easy to
  // pin in qa-wager-accept-gate.ts.
  const gateExit = (reason: string, userMessage: string): void => {
    console.warn(
      `[handleWagerAccepted] reject(${reason}) ` +
      `wager=${wagerMatchId.slice(0, 14)} ` +
      `txDigest=${txDigest ?? 'none'} ` +
      `caller=${client.walletAddress?.slice(0, 10) ?? '(none)'} ` +
      `currentFightId=${client.currentFightId ?? 'none'}`,
    );
    sendError(client, userMessage);
  };

  if (processingWagerAccepts.has(wagerMatchId)) {
    gateExit('processing-inflight', 'This wager is already being accepted. Try again in a moment.');
    return;
  }
  processingWagerAccepts.add(wagerMatchId);
  try {
    // Prevent accepting while in a fight (orthogonal to the open-wager
    // gate; checked separately so the 'in a fight' message survives any
    // future reshuffle of the accept-decision predicate).
    if (client.currentFightId) {
      gateExit('caller-in-fight', 'Cannot accept a wager while in a fight');
      return;
    }

    if (!client.walletAddress) {
      gateExit('caller-not-authed', 'Authenticate first');
      return;
    }

    const targetEntry = wagerLobby.get(wagerMatchId);

    // Caller's own open wager (if any) — used by the decision predicate
    // to detect the silent-accept bug path (Fix B, 2026-05-04). Iterate
    // the lobby once and pick the first match; players are limited to one
    // open wager at a time so there should never be more than one.
    let callerOwnWager: { creatorWallet: string; wagerMatchId: string } | undefined;
    for (const lobbyEntry of wagerLobby.values()) {
      if (lobbyEntry.creatorWallet === client.walletAddress) {
        callerOwnWager = {
          creatorWallet: lobbyEntry.creatorWallet,
          wagerMatchId: lobbyEntry.wagerMatchId,
        };
        break;
      }
    }

    // Cross-mode busy state — caller in matchmaking queue is the new
    // Fix 1 (2026-05-04) flavour. The decision predicate handles the
    // autoRollback when the chain accept somehow landed despite the
    // client gate.
    const callerInMatchmakingQueue = getMatchmaking().isInQueue(client.walletAddress);

    // Tx-digest-driven finality (option c2, 2026-05-28). Before probing
    // `arena.move::WagerMatch.status`, wait for the caller's accept_wager
    // tx to finalize on chain. The fullnode used by `getWagerStatus` can
    // lag the tx's actual finalization by hundreds of ms; pre-fix the
    // probe routinely read pre-finality WAITING and rejected legitimate
    // fast-accept clicks (incident: 2026-05-27/28, wagers 0xf3aae8c5468e
    // and 0x0c24213f9f59).
    //
    // Backward-compat: legacy clients that don't send `txDigest` skip
    // this and fall straight through to `getWagerStatus` — same behaviour
    // as before this fix.
    if (txDigest) {
      const txOutcome = await waitForWagerTxFinality(txDigest, 3000);
      if (txOutcome.kind === 'failure') {
        gateExit(
          `tx-failed-onchain:${txDigest.slice(0, 14)}`,
          `Your accept_wager transaction failed on chain: ${txOutcome.error}`,
        );
        return;
      }
      if (txOutcome.kind === 'timeout') {
        console.warn(
          `[handleWagerAccepted] tx-finality timeout digest=${txDigest.slice(0, 14)} ` +
          `wager=${wagerMatchId.slice(0, 14)} — falling through to status probe`,
        );
        // Worst case the probe still reads WAITING and the caller hits
        // the same reject as pre-fix — no regression on the long-tail
        // of genuinely slow fullnodes.
      } else {
        console.log(
          `[handleWagerAccepted] tx-finality confirmed digest=${txDigest.slice(0, 14)} ` +
          `wager=${wagerMatchId.slice(0, 14)} — proceeding to status probe`,
        );
      }
    }

    // Single chain probe — checks `arena.move::WagerMatch.status`.
    // Returns null on RPC failure or missing object; treat both as
    // "can't determine" and reject so we don't accidentally proceed.
    const targetChainStatus = await getWagerStatus(wagerMatchId);
    if (targetChainStatus === null) {
      gateExit(
        'chain-status-null',
        'Could not read wager status from chain. Try again in a moment.',
      );
      return;
    }
    console.log(
      `[handleWagerAccepted] chain probe ok wager=${wagerMatchId.slice(0, 14)} ` +
      `txDigest=${txDigest ?? 'none'} ` +
      `status=${targetChainStatus} targetInLobby=${!!targetEntry} ` +
      `ownWager=${callerOwnWager?.wagerMatchId.slice(0, 14) ?? 'none'} ` +
      `inMmQueue=${callerInMatchmakingQueue}`,
    );

    const outcome = decideAcceptOutcome({
      callerWallet: client.walletAddress,
      targetWagerId: wagerMatchId,
      targetChainStatus,
      callerOwnWagerInLobby: callerOwnWager,
      targetInLobby: targetEntry
        ? { creatorWallet: targetEntry.creatorWallet, wagerMatchId: targetEntry.wagerMatchId }
        : undefined,
      callerInMatchmakingQueue,
    });

    if (outcome.kind === 'reject') {
      gateExit(`outcome-reject:${outcome.reason.slice(0, 60)}`, outcome.reason);
      return;
    }

    if (outcome.kind === 'autoRollback') {
      // The 2026-05-04 silent-accept bug AND its Fix 1 cross-mode
      // extension: caller had a busy state (own wager OR matchmaking
      // queue) AND the chain accept landed despite the client-side
      // gate. Roll back the chain target + any own wager + drop the
      // queue entry so nothing stays stuck.
      //
      // admin_cancel_wager refunds 50/50 for ACTIVE (the target — escrow
      // holds 2× stake) and refund-to-creator for WAITING (the caller's
      // own — escrow holds 1× stake). Fire-and-forget; failures are
      // non-blocking and recoverable via `/api/admin/cancel-wager`.
      console.warn(
        `[Wager] Auto-rollback fired: caller=${client.walletAddress} ` +
        `target=${outcome.targetWagerId} ownWager=${outcome.callerOwnWagerId ?? '(none)'} ` +
        `queueDrop=${outcome.removeFromMatchmakingQueue}`,
      );
      // Drop the target from the lobby (it's ACTIVE now, not browseable).
      if (targetEntry) {
        wagerLobby.delete(outcome.targetWagerId);
        broadcastAll({ type: 'wager_lobby_removed', wagerMatchId: outcome.targetWagerId });
      }
      // Drop the caller's own wager if any.
      if (outcome.callerOwnWagerId && callerOwnWager) {
        wagerLobby.delete(outcome.callerOwnWagerId);
        broadcastAll({ type: 'wager_lobby_removed', wagerMatchId: outcome.callerOwnWagerId });
      }
      // Drop the caller from the matchmaking queue if applicable.
      if (outcome.removeFromMatchmakingQueue) {
        getMatchmaking().removeFromQueue(client.walletAddress);
      }
      adminCancelWagerOnChain(outcome.targetWagerId).catch((err) => {
        console.error('[Wager] Auto-rollback admin_cancel(target) failed:', err?.message || err);
      });
      if (outcome.callerOwnWagerId) {
        adminCancelWagerOnChain(outcome.callerOwnWagerId).catch((err) => {
          console.error('[Wager] Auto-rollback admin_cancel(callerOwn) failed:', err?.message || err);
        });
      }
      sendError(client, outcome.userMessage);
      return;
    }

    // outcome.kind === 'proceed'  — happy path below mirrors the original
    // handler: persist recovery row, drop from lobby, start fight, sweep
    // any remaining stragglers for either player.
    const entry = targetEntry!; // proceed guarantees targetInLobby was defined

    // v5.2 — challenger wallet resolution. In v5.1 the caller IS the
    // challenger (they signed accept_wager). In v5.2 the caller is the
    // CREATOR (they signed approve_challenger) and the challenger comes
    // from the lobby entry's pendingChallenger (server-cached by the
    // earlier wager_request_accepted handshake). Pure helper centralises
    // the dispatch so the gauntlet tests both flows.
    const challengerRes = resolveChallengerWallet({
      callerWallet: client.walletAddress!,
      creatorWallet: entry.creatorWallet,
      pendingChallengerWallet: entry.pendingChallenger?.wallet,
    });
    if (!challengerRes.ok) {
      gateExit(`challenger-resolve-failed:${challengerRes.reason.slice(0, 60)}`, challengerRes.reason);
      return;
    }
    const challengerWallet = challengerRes.wallet;
    console.log(
      `[handleWagerAccepted] challenger resolved via ${challengerRes.flow}: ` +
      `${challengerWallet.slice(0, 14)} (caller=${client.walletAddress!.slice(0, 14)}, ` +
      `creator=${entry.creatorWallet.slice(0, 14)})`,
    );

    dbInsertWagerInFlight({
      wager_match_id: wagerMatchId,
      player_a: entry.creatorWallet,
      player_b: challengerWallet,
      accepted_at_ms: Date.now(),
    }).catch((err) => {
      console.error('[Wager] dbInsertWagerInFlight failed:', err?.message || err);
    });

    // Remove from lobby
    wagerLobby.delete(wagerMatchId);
    broadcastAll({ type: 'wager_lobby_removed', wagerMatchId });

    // Get characters and start the fight. Resolve from the chain
    // participant addresses, NOT the caller — in v5.2 the caller is the
    // creator (=player_a), not the challenger.
    const charA = getCharacterByWallet(entry.creatorWallet);
    const charB = getCharacterByWallet(challengerWallet);

    if (!charA || !charB) {
      gateExit(
        `character-missing(a=${!!charA},b=${!!charB})`,
        'Character not found',
      );
      return;
    }

    if (!client.characterId) {
      gateExit('caller-no-characterId', 'Create a character first');
      return;
    }

    console.log(`[Wager Lobby] ${charB.name} accepted ${charA.name}'s wager for ${entry.wagerAmount} SUI`);

    // v5.2 — mirror chain `WagerMatch.accepted_at` into FightState so the
    // ReclaimStalledWagerBanner can anchor its 30-min timer against the
    // actual chain accept (not the server's "fight started" clock — those
    // skew by seconds due to probe + WS routing latency). A null read just
    // hides the banner gracefully; manual reclaim still works via chain
    // assertion (EWagerNotStalled = 19) which uses the real chain value.
    const acceptedAtMs = await getWagerAcceptedAt(wagerMatchId);
    const fight = await createFight(
      charA,
      charB,
      'wager',
      entry.wagerAmount,
      wagerMatchId,
      acceptedAtMs,
    );

    // Auto-cancel any remaining open wagers for either player (safety net
    // for race conditions). v5.2 — use the resolved challengerWallet rather
    // than client.walletAddress; in the v5.2 approve flow the caller IS
    // the creator, so the old check only swept creator stragglers and
    // missed the challenger's.
    for (const [id, lobbyEntry] of wagerLobby) {
      if (lobbyEntry.creatorWallet === entry.creatorWallet || lobbyEntry.creatorWallet === challengerWallet) {
        wagerLobby.delete(id);
        broadcastAll({ type: 'wager_lobby_removed', wagerMatchId: id });
        adminCancelWagerOnChain(id).catch((err) => {
          console.error('[Wager Lobby] Auto-cancel on fight start failed:', err.message);
        });
      }
    }

    // Cross-mode safety net (Fix 1, 2026-05-04). If either player happens
    // to be in the matchmaking queue when this wager fight starts, drop
    // them. Pre-Fix-1 they could legitimately have been in both states;
    // post-fix the gate at the top of `handleQueueFight` prevents new
    // entries, but legacy state from before the fix lands or any future
    // race could still leave a stale queue entry. Idempotent — `removeFromQueue`
    // returns null if they aren't in the queue.
    const mm = getMatchmaking();
    mm.removeFromQueue(entry.creatorWallet);
    mm.removeFromQueue(client.walletAddress);
    console.log(
      `[handleWagerAccepted] proceed-complete wager=${wagerMatchId.slice(0, 14)} ` +
      `fight=${fight.id.slice(0, 14)}`,
    );
  } catch (err: any) {
    // Bug 7 (2026-05-19) safety net. Pre-fix any exception here was
    // silently absorbed because the WS router (`case 'wager_accepted':
    // handleWagerAccepted(client, msg)`) didn't await OR catch. With
    // 0.2 SUI in escrow this was the wrong default — surface the
    // failure to the user AND log it, then leave it to admin/cancel-
    // wager to refund. The `processingWagerAccepts` cleanup in the
    // finally still runs.
    console.error(
      `[handleWagerAccepted] UNHANDLED wager=${wagerMatchId.slice(0, 14)}:`,
      err?.stack || err?.message || err,
    );
    sendError(
      client,
      'Server hit an unexpected error while finalising your wager. ' +
        'Your stake is on chain — escrow can be refunded via ' +
        '/api/admin/cancel-wager. Please notify the dev with the wager id.',
    );
  } finally {
    processingWagerAccepts.delete(wagerMatchId);
  }
}

// === Allocate Points ===

function handleAllocatePoints(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.characterId) {
    sendError(client, 'No character');
    return;
  }

  const character = getCharacterByWallet(client.walletAddress!);
  if (!character) {
    sendError(client, 'Character not found');
    return;
  }

  const strength = Number(msg.strength) || 0;
  const dexterity = Number(msg.dexterity) || 0;
  const intuition = Number(msg.intuition) || 0;
  const endurance = Number(msg.endurance) || 0;

  const total = strength + dexterity + intuition + endurance;
  if (total === 0) {
    sendError(client, 'No points to allocate');
    return;
  }

  if (total > character.unallocatedPoints) {
    sendError(client, `Not enough points. Have ${character.unallocatedPoints}, trying to spend ${total}`);
    return;
  }

  // Update server-side stats and deduct points
  character.stats.strength += strength;
  character.stats.dexterity += dexterity;
  character.stats.intuition += intuition;
  character.stats.endurance += endurance;
  character.unallocatedPoints -= total;

  updateCharacter(character);

  send(client, {
    type: 'points_allocated',
    character: sanitizeCharacter(character),
  });
}

// === Utilities ===

// sanitizeItem / sanitizeEquipment moved to utils/wire-sanitize.ts so the
// Tavern scout-modal path in data/player-profile.ts can reuse the same
// translator without re-importing handler.ts (which would close a cycle
// via ws/tavern-handlers.ts). The 13-slot guarantee — every wire payload
// carries exactly the v5.1 slot keys — also lives there.

// sanitizeCharacter moved to utils/wire-sanitize.ts (2026-05-30) so
// fight-room.ts can push a fresh `character_data` after post-fight
// chain updates without re-importing handler.ts (would close the cycle
// handler.ts → fight-room.ts → handler.ts). Behaviour 1-for-1 the same.

// === Exports ===

export function getConnectedClients(): Map<string, ConnectedClient> {
  return connectedClients;
}

/**
 * Insert a wager into the in-memory lobby and broadcast to all connected
 * clients. Returns `false` if the wager is already present (idempotent).
 *
 * Used by the testnet-only `/api/admin/adopt-wager` recovery endpoint when
 * a wager exists on-chain but never made it through the WS `queue_fight`
 * flow (e.g. WS reconnect race). Not wired up for normal traffic.
 */
export function adoptWagerIntoLobby(entry: WagerLobbyEntry): boolean {
  if (wagerLobby.has(entry.wagerMatchId)) return false;
  wagerLobby.set(entry.wagerMatchId, entry);
  broadcastAll({ type: 'wager_lobby_added', entry });
  console.log(
    `[Wager Lobby] ADOPTED orphan wager ${entry.wagerMatchId} for ${entry.creatorName} (${entry.wagerAmount} SUI)`,
  );
  return true;
}

export function getOnlineCount(): number {
  let count = 0;
  for (const [, c] of connectedClients) {
    if (c.authenticated) count++;
  }
  return count;
}

/**
 * Push a server message to every authenticated client. Used by the marketplace
 * event index so on-chain list/delist/buy events fan out without the caller
 * having to know how the connected-client map is shaped.
 */
export function broadcastToAuthenticated(msg: ServerMessage): void {
  broadcastAll(msg);
}

// === Marketplace ===

function handleGetMarketplace(client: ConnectedClient): void {
  const listings = getMarketplaceListings().map(listingToWire);
  send(client, { type: 'marketplace_data', listings });
}
