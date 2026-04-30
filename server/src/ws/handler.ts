import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
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
import { dbInsertWagerInFlight } from '../data/db';
import {
  submitTurnAction,
  addSpectator,
  getActiveFights,
  getFight,
  setClientsRef,
  handlePlayerDisconnect,
} from './fight-room';
import {
  registerChatClient,
  unregisterChatClient,
  handleChatMessage,
  broadcastSystemMessage,
  getChatClients,
} from './chat';
import { CONFIG, GAME_CONSTANTS } from '../config';
import { getWagerStatus, adminCancelWagerOnChain, findCharacterObjectId, findAllCharacterIdsForWallet, shouldRejectDuplicateMint } from '../utils/sui-settle';
import { fetchEquippedFromDOFs, applyDOFEquipment } from '../utils/sui-read';
import { getMarketplaceListings, listingToWire } from '../data/marketplace';
import {
  createFight,
} from './fight-room';

// === Connected Clients Registry ===

const connectedClients = new Map<string, ConnectedClient>();

// Share with fight-room module
setClientsRef(connectedClients);

function send(client: ConnectedClient, msg: ServerMessage): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(msg));
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

function handleMessage(client: ConnectedClient, msg: ClientMessage): void {
  // Pre-auth message types the router accepts before client.authenticated.
  // The legacy bare `auth { walletAddress }` no longer authenticates — it now
  // returns an instructive error that points the client at auth_request.
  const preAuthTypes = new Set([
    'auth_request',
    'auth_signature',
    'auth_token',
    'auth', // legacy; rejected with guidance
  ]);
  if (!preAuthTypes.has(msg.type) && !client.authenticated) {
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
      handleGetOnlinePlayers(client);
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
      handleWagerAccepted(client, msg);
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
    case 'challenge_player':
    case 'accept_challenge':
    case 'decline_challenge':
      break;
    default:
      sendError(client, `Unknown message type: ${msg.type}`);
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
    await verifyPersonalMessageSignature(messageBytes, signature, {
      address: challenge.walletAddress,
    });
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
    if (charObjectId) {
      const dof = await fetchEquippedFromDOFs(charObjectId);
      if (dof) {
        const populated = (Object.entries(dof) as Array<[string, unknown]>)
          .filter(([, v]) => v !== null)
          .map(([k]) => k);
        const changed = applyDOFEquipment(character.equipment, dof);
        console.log(
          `[Auth] DOF ${walletAddress.slice(0, 10)}: chain has ${populated.length} equipped` +
          `${populated.length ? ` (${populated.join(', ')})` : ''}` +
          `, ${changed.length} slot(s) synced`,
        );
      } else {
        console.log(`[Auth] DOF ${walletAddress.slice(0, 10)}: read failed — keeping server state`);
      }
    } else {
      console.log(`[Auth] DOF ${walletAddress.slice(0, 10)}: no on-chain character found`);
    }
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

  send(client, {
    type: 'auth_ok',
    walletAddress,
    token,
    tokenExpiresAt: Date.now() + CONFIG.JWT_TTL_SECONDS * 1000,
    hasCharacter: !!character,
    character: character ? sanitizeCharacter(character) : null,
  });

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

function handleRestoreCharacter(client: ConnectedClient, msg: ClientMessage): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }

  // If server already has the character in memory, just return it
  const existing = getCharacterByWallet(client.walletAddress);
  if (existing) {
    client.characterId = existing.id;
    send(client, { type: 'character_created', character: sanitizeCharacter(existing) });
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
    level, xp, unallocatedPoints, wins, losses, rating,
    onChainObjectId,
  );

  if (!result.character) {
    sendError(client, result.error || 'Failed to restore character');
    return;
  }

  client.characterId = result.character.id;
  send(client, { type: 'character_created', character: sanitizeCharacter(result.character) });
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

  if (client.currentFightId) {
    sendError(client, 'Already in a fight');
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
    if (!wagerMatchId) {
      sendError(client, 'On-chain wager escrow required. Sign the create_wager transaction first.');
      return;
    }

    // Check if player already has a wager in the lobby
    for (const entry of wagerLobby.values()) {
      if (entry.creatorWallet === client.walletAddress) {
        sendError(client, 'You already have an open wager. Cancel it first.');
        return;
      }
    }

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

function handleGetOnlinePlayers(client: ConnectedClient): void {
  const players: Array<{ walletAddress: string; name: string; level: number; rating: number; status: string; fightId?: string }> = [];

  for (const [, c] of connectedClients) {
    if (c.authenticated && c.walletAddress) {
      const character = getCharacterByWallet(c.walletAddress);
      let status = 'online';
      let fightId: string | undefined;
      if (c.currentFightId) {
        status = 'fighting';
        fightId = c.currentFightId;
      }
      players.push({
        walletAddress: c.walletAddress,
        name: character?.name || 'Unknown',
        level: character?.level || 1,
        rating: character?.rating || 1000,
        status,
        fightId,
      });
    }
  }

  send(client, {
    type: 'online_players',
    players,
  });
}

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

function handleSpectateFight(client: ConnectedClient, msg: ClientMessage): void {
  const fightId = msg.fightId as string;

  if (!fightId) {
    // List active fights
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

  const result = addSpectator(fightId, client.walletAddress!);
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
  if (!wagerMatchId) {
    sendError(client, 'Missing wagerMatchId');
    return;
  }

  if (processingWagerAccepts.has(wagerMatchId)) {
    sendError(client, 'This wager is already being accepted. Try again in a moment.');
    return;
  }
  processingWagerAccepts.add(wagerMatchId);
  try {
    const entry = wagerLobby.get(wagerMatchId);
    if (!entry) {
      sendError(client, 'Wager not found in lobby (may have been cancelled or accepted by someone else)');
      return;
    }

    if (client.walletAddress === entry.creatorWallet) {
      sendError(client, 'You cannot accept your own wager');
      return;
    }

    // Prevent accepting while in a fight
    if (client.currentFightId) {
      sendError(client, 'Cannot accept a wager while in a fight');
      return;
    }

    // Prevent accepting if player has an active open wager in the lobby
    for (const lobbyEntry of wagerLobby.values()) {
      if (lobbyEntry.creatorWallet === client.walletAddress) {
        sendError(client, 'You have an open wager. Cancel it first before accepting another.');
        return;
      }
    }

    // Verify on-chain that the wager is now ACTIVE (status=1)
    const status = await getWagerStatus(wagerMatchId);
    if (status !== 1) {
      sendError(client, `Wager not active on-chain (status: ${status}). Did the accept_wager transaction succeed?`);
      return;
    }

    // Persist a recovery row BEFORE we drop the wager from the in-memory
    // lobby. If the server crashes between this point and `settle_wager`
    // landing, the boot sweeper will see the row, confirm chain status =
    // ACTIVE, and call `admin_cancel_wager` for a 50/50 refund. Fire-and-
    // forget — a Supabase write blip should not block the fight; the
    // chain's 10-min `cancel_expired_wager` is the fallback safety net.
    dbInsertWagerInFlight({
      wager_match_id: wagerMatchId,
      player_a: entry.creatorWallet,
      player_b: client.walletAddress!,
      accepted_at_ms: Date.now(),
    }).catch((err) => {
      console.error('[Wager] dbInsertWagerInFlight failed:', err?.message || err);
    });

    // Remove from lobby
    wagerLobby.delete(wagerMatchId);
    broadcastAll({ type: 'wager_lobby_removed', wagerMatchId });

    // Get characters and start the fight
    const charA = getCharacterByWallet(entry.creatorWallet);
    const charB = getCharacterByWallet(client.walletAddress!);

    if (!charA || !charB) {
      sendError(client, 'Character not found');
      return;
    }

    if (!client.characterId) {
      sendError(client, 'Create a character first');
      return;
    }

    console.log(`[Wager Lobby] ${charB.name} accepted ${charA.name}'s wager for ${entry.wagerAmount} SUI`);

    const fight = await createFight(charA, charB, 'wager', entry.wagerAmount);
    fight.wagerMatchId = wagerMatchId;

    // Auto-cancel any remaining open wagers for either player (safety net for race conditions)
    for (const [id, lobbyEntry] of wagerLobby) {
      if (lobbyEntry.creatorWallet === entry.creatorWallet || lobbyEntry.creatorWallet === client.walletAddress) {
        wagerLobby.delete(id);
        broadcastAll({ type: 'wager_lobby_removed', wagerMatchId: id });
        adminCancelWagerOnChain(id).catch((err) => {
          console.error('[Wager Lobby] Auto-cancel on fight start failed:', err.message);
        });
      }
    }
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

/**
 * Translate a server-shape Item into the shape the frontend expects.
 *
 * The two layers use different keys for stat bonuses:
 *   server  →  { armor, hp, defense, damage, critBonus, strength, ... }
 *   frontend → { armorBonus, hpBonus, defenseBonus, attackBonus, critChanceBonus, ... }
 *
 * Before Phase 0.5 this divergence was invisible because the frontend read
 * on-chain items from its own wallet fetch (already in frontend shape) and
 * ignored `character.equipment`. Now that the server hydrates DOFs into
 * `character.equipment`, we have to emit the frontend shape on the wire.
 */
function sanitizeItem(item: any): unknown {
  if (!item) return null;
  const s = item.statBonuses || {};
  return {
    id: item.id,
    name: item.name,
    imageUrl: item.imageUrl ?? undefined,
    itemType: item.itemType,
    rarity: item.rarity,
    classReq: item.classReq ?? 0,
    levelReq: item.levelReq,
    minDamage: item.minDamage ?? 0,
    maxDamage: item.maxDamage ?? 0,
    statBonuses: {
      strengthBonus: s.strength || 0,
      dexterityBonus: s.dexterity || 0,
      intuitionBonus: s.intuition || 0,
      enduranceBonus: s.endurance || 0,
      hpBonus: s.hp || 0,
      armorBonus: s.armor || 0,
      defenseBonus: s.defense || 0,
      attackBonus: s.damage || 0,
      critChanceBonus: s.critBonus || 0,
      // TODO(loadout-cleanup): server StatBonuses type is missing these 4
      // fields. On-chain items have them but they're dropped here. Unify
      // server/frontend stat shape as part of mainnet prep. Tracked in
      // MAINNET_PREP.md.
      critMultiplierBonus: 0,
      evasionBonus: 0,
      antiCritBonus: 0,
      antiEvasionBonus: 0,
    },
  };
}

function sanitizeEquipment(equipment: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [slot, item] of Object.entries(equipment)) {
    out[slot] = sanitizeItem(item);
  }
  return out;
}

function sanitizeCharacter(character: any): Record<string, any> {
  const unallocatedPoints = character.unallocatedPoints || 0;
  if (unallocatedPoints > 0) {
    console.log(`[Character] Sending ${character.name} with ${unallocatedPoints} unallocated points`);
  }
  return {
    id: character.id,
    name: character.name,
    level: character.level,
    xp: character.xp,
    walletAddress: character.walletAddress,
    stats: {
      strength: character.stats.strength,
      dexterity: character.stats.dexterity,
      intuition: character.stats.intuition,
      endurance: character.stats.endurance,
    },
    unallocatedPoints,
    equipment: sanitizeEquipment(character.equipment),
    wins: character.wins,
    losses: character.losses,
    rating: character.rating,
  };
}

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
