/**
 * WebSocket handlers for the Tavern social hub (Bucket 3).
 *
 * Wired into the main `ws/handler.ts` router via dispatchTavernMessage.
 * Each handler:
 *   1. Validates input shape (defensive — the wire is untyped at the
 *      router boundary).
 *   2. Calls into the relevant service (`presence`, `fight-requests`,
 *      `dm-channels`, `player-profile`).
 *   3. Emits the WS responses + cross-client broadcasts.
 *
 * The handlers don't own broadcast targeting — `sendToWallet` and
 * `broadcastTo` are passed in via `TavernCtx` so we can reuse the
 * existing connectedClients map without import cycles.
 */

import type WebSocket from 'ws';
import {
  upsertPresence,
  removePresence,
  heartbeat,
  flushPresenceToSupabase,
  getOnlinePlayers,
  type PresenceRoom,
  type PresenceStatus,
  type OnlinePlayerWire,
} from '../data/presence';
import {
  createRequest,
  transitionRequest,
  getPendingForTarget,
  getPendingFromSender,
  type FightRequest,
} from '../data/fight-requests';
import {
  registerChannel,
  bumpUnread,
  clearUnread,
  getChannelById,
  getChannelForPair,
  getOrCreateSyntheticChannel,
  listChannelsForWallet,
  getTotalUnreadForWallet,
} from '../data/dm-channels';
import {
  insertMessage,
  getHistory,
  rowToWire as dmMessageToWire,
  type DmMessageWire,
} from '../data/dm-messages';
import { getPlayerProfile } from '../data/player-profile';
import type { ConnectedClient } from '../types';

const VALID_ROOMS: ReadonlySet<PresenceRoom> = new Set([
  'tavern',
  'character',
  'arena',
  'marketplace',
  'hall_of_fame',
  'fight',
]);

export interface TavernCtx {
  /** Send a message to a specific wallet's connected client (no-op if
   *  not connected). Returns true iff the wallet had an open socket. */
  sendToWallet: (wallet: string, msg: Record<string, unknown>) => boolean;
  /** Broadcast to every authenticated client. */
  broadcastAll: (msg: Record<string, unknown>) => void;
  /** Lookup the connected ConnectedClient for a wallet (or undefined). */
  getClient: (wallet: string) => ConnectedClient | undefined;
}

function send(client: ConnectedClient, msg: Record<string, unknown>): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(msg));
  }
}

function sendError(client: ConnectedClient, message: string): void {
  send(client, { type: 'error', message });
}

// ─── presence ─────────────────────────────────────────────────────────

/**
 * Centralised broadcast helper for every entry point that mutates
 * presence (announce / enter_room / heartbeat / fight start+end).
 *
 * Wire choice:
 *   • `inserted` OR `dataChanged` → `player_joined` with the full
 *     row. The frontend reducer's `ADD_ONLINE_PLAYER` filters by
 *     wallet then appends, so a re-broadcast cleanly REPLACES any
 *     stale stub that another client was holding (e.g. when the
 *     row was first created before `handleRestoreCharacter` had
 *     hydrated the canonical character).
 *   • Else `statusChanged` OR `roomChanged` → lighter
 *     `player_status_changed` (no identity payload, just the new
 *     status fields).
 *   • Else nothing — heartbeat that found the row exactly the same
 *     as it was should be silent on the wire.
 *
 * 2026-05-08 fix: pre-fix `handleEnterRoom` only ever emitted
 * `player_status_changed`, which the frontend's `UPDATE_PLAYER_STATUS`
 * reducer no-ops for entries that don't already exist. So a player
 * whose `announcePlayerOnline` had been skipped (auth raced ahead of
 * character hydration) NEVER landed in any peer's onlinePlayers list
 * via the broadcast path — Mr_Boss only saw Sx through the
 * `get_online_players` snapshot, which carried the stub fallback
 * values that were locked in at first upsert.
 */
function broadcastPresenceUpdate(
  ctx: TavernCtx,
  result: ReturnType<typeof upsertPresence>,
): void {
  if (result.inserted || result.dataChanged) {
    ctx.broadcastAll({
      type: 'player_joined',
      player: toWirePlayer(result.row),
    });
    return;
  }
  if (result.statusChanged || result.roomChanged) {
    ctx.broadcastAll({
      type: 'player_status_changed',
      walletAddress: result.row.walletAddress,
      status: result.row.status,
      currentRoom: result.row.currentRoom,
      fightId: result.row.fightId,
    });
  }
}

/** Called once on auth_ok / character resolved. Inserts the presence
 *  row + broadcasts player_joined. */
export function announcePlayerOnline(
  ctx: TavernCtx,
  client: ConnectedClient,
  initialRoom: PresenceRoom = 'tavern',
): void {
  if (!client.walletAddress) return;
  const result = upsertPresence({
    walletAddress: client.walletAddress,
    room: initialRoom,
    fightId: client.currentFightId ?? null,
  });
  void flushPresenceToSupabase(client.walletAddress, true);
  broadcastPresenceUpdate(ctx, result);
}

export function announcePlayerOffline(ctx: TavernCtx, walletAddress: string): void {
  const removed = removePresence(walletAddress);
  if (removed) {
    ctx.broadcastAll({ type: 'player_left', walletAddress });
  }
}

export function handleEnterRoom(
  ctx: TavernCtx,
  client: ConnectedClient,
  msg: { room?: unknown },
): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const room = String(msg.room ?? '');
  if (!VALID_ROOMS.has(room as PresenceRoom)) {
    sendError(client, `Invalid room: ${room}`);
    return;
  }
  const result = upsertPresence({
    walletAddress: client.walletAddress,
    room: room as PresenceRoom,
    fightId: client.currentFightId ?? null,
  });
  void flushPresenceToSupabase(client.walletAddress);
  broadcastPresenceUpdate(ctx, result);
  send(client, { type: 'room_entered', room });
}

export function handlePresenceHeartbeat(
  ctx: TavernCtx,
  client: ConnectedClient,
): void {
  if (!client.walletAddress) return;
  const result = heartbeat(client.walletAddress);
  if (!result) return;
  void flushPresenceToSupabase(client.walletAddress);
  broadcastPresenceUpdate(ctx, result);
}

export function handleGetOnlinePlayers(client: ConnectedClient): void {
  const players = getOnlinePlayers();
  send(client, { type: 'online_players', players });
}

export function broadcastFightStatusChange(
  ctx: TavernCtx,
  walletAddress: string,
  fightId: string | null,
): void {
  // Fight start sets currentRoom='fight' so the sidebar dims them
  // even when an `enter_room` hasn't been sent yet. Fight end falls
  // BACK to 'tavern' (the default landing) — the client's next
  // `enter_room` after navigation overrides this with whatever
  // surface they actually go to. Without the fall-back the status
  // would stick at `in_fight` (stale fight room).
  const result = upsertPresence({
    walletAddress,
    fightId: fightId ?? null,
    room: fightId ? 'fight' : 'tavern',
  });
  void flushPresenceToSupabase(walletAddress, true);
  broadcastPresenceUpdate(ctx, result);
}

function toWirePlayer(row: ReturnType<typeof upsertPresence>['row']): OnlinePlayerWire {
  return {
    walletAddress: row.walletAddress,
    name: row.characterName,
    level: row.level,
    rating: row.rating,
    status: row.status,
    currentRoom: row.currentRoom,
    fightId: row.fightId,
  };
}

// ─── player profile ──────────────────────────────────────────────────

export async function handleGetPlayerProfile(
  client: ConnectedClient,
  msg: { walletAddress?: unknown },
): Promise<void> {
  const wallet = String(msg.walletAddress ?? '').trim();
  if (!wallet.startsWith('0x') || wallet.length < 3) {
    sendError(client, 'get_player_profile requires walletAddress');
    return;
  }
  try {
    const profile = await getPlayerProfile(wallet);
    if (!profile) {
      send(client, { type: 'player_profile_not_found', walletAddress: wallet });
      return;
    }
    send(client, { type: 'player_profile', profile });
  } catch (err: any) {
    sendError(client, `Profile lookup failed: ${err?.message ?? err}`);
  }
}

// ─── fight requests ──────────────────────────────────────────────────

const FRIENDLY_REQUEST_TYPE = 'friendly';
const WAGER_REQUEST_TYPE = 'wager';

function fightRequestToWire(req: FightRequest): Record<string, unknown> {
  return {
    id: req.id,
    requestType: req.requestType,
    fromWallet: req.fromWallet,
    fromName: req.fromName,
    toWallet: req.toWallet,
    toName: req.toName,
    stakeMist: req.stakeMist ?? null,
    message: req.message ?? null,
    status: req.status,
    expiresAt: req.expiresAt,
    resolvedAt: req.resolvedAt ?? null,
    createdAt: req.createdAt,
  };
}

export function handleSendFightRequest(
  ctx: TavernCtx,
  client: ConnectedClient,
  msg: {
    toWallet?: unknown;
    requestType?: unknown;
    stakeMist?: unknown;
    message?: unknown;
  },
): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const requestType = String(msg.requestType ?? '');
  if (requestType !== FRIENDLY_REQUEST_TYPE && requestType !== WAGER_REQUEST_TYPE) {
    sendError(client, 'requestType must be "friendly" or "wager"');
    return;
  }
  const toWallet = String(msg.toWallet ?? '').trim();
  if (!toWallet.startsWith('0x')) {
    sendError(client, 'toWallet missing or invalid');
    return;
  }
  const stakeMist = msg.stakeMist === undefined || msg.stakeMist === null
    ? undefined
    : String(msg.stakeMist);
  const message = msg.message === undefined || msg.message === null
    ? undefined
    : String(msg.message);
  const result = createRequest({
    requestType,
    fromWallet: client.walletAddress,
    toWallet,
    stakeMist,
    message,
  });
  if (result.error) {
    sendError(client, `Could not send challenge: ${result.error}`);
    return;
  }
  const req = result.request!;
  // Echo to sender so their UI can confirm.
  send(client, { type: 'fight_request_sent', request: fightRequestToWire(req) });
  // Push to target (if online).
  ctx.sendToWallet(toWallet, {
    type: 'fight_request_received',
    request: fightRequestToWire(req),
  });
}

export function handleResolveFightRequest(
  ctx: TavernCtx,
  client: ConnectedClient,
  msg: { requestId?: unknown },
  action: 'accept' | 'decline' | 'cancel',
  /** Optional callback for the accept path — the main handler uses this
   *  to start a fight (friendly) or open the wager-create UI (wager). */
  onAccept?: (req: FightRequest, client: ConnectedClient) => void,
): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const requestId = String(msg.requestId ?? '');
  if (!requestId) {
    sendError(client, 'requestId required');
    return;
  }
  const result = transitionRequest(requestId, action, client.walletAddress);
  if (result.error) {
    sendError(client, `Could not ${action} challenge: ${result.error}`);
    return;
  }
  const req = result.request!;
  const wire = fightRequestToWire(req);
  // Notify both sides.
  ctx.sendToWallet(req.fromWallet, { type: 'fight_request_resolved', request: wire, action });
  ctx.sendToWallet(req.toWallet, { type: 'fight_request_resolved', request: wire, action });
  if (action === 'accept' && onAccept) {
    onAccept(req, client);
  }
}

export function handleGetPendingFightRequests(
  client: ConnectedClient,
): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const incoming = getPendingForTarget(client.walletAddress).map(fightRequestToWire);
  const outgoing = getPendingFromSender(client.walletAddress).map(fightRequestToWire);
  send(client, {
    type: 'fight_request_pending_list',
    incoming,
    outgoing,
  });
}

// ─── DM channels ─────────────────────────────────────────────────────

export function handleRegisterDmChannel(
  ctx: TavernCtx,
  client: ConnectedClient,
  msg: {
    channelId?: unknown;
    walletA?: unknown;
    walletB?: unknown;
    memberCapA?: unknown;
    memberCapB?: unknown;
    encryptedKeyB64?: unknown;
  },
): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const channelId = String(msg.channelId ?? '');
  const walletA = String(msg.walletA ?? '');
  const walletB = String(msg.walletB ?? '');
  if (!channelId.startsWith('0x') || !walletA.startsWith('0x') || !walletB.startsWith('0x')) {
    sendError(client, 'register_dm_channel requires channelId, walletA, walletB (all 0x…)');
    return;
  }
  const callerLower = client.walletAddress.toLowerCase();
  if (callerLower !== walletA.toLowerCase() && callerLower !== walletB.toLowerCase()) {
    sendError(client, 'Caller must be one of the channel participants');
    return;
  }
  const result = registerChannel({
    channelId,
    walletA,
    walletB,
    memberCapA: msg.memberCapA ? String(msg.memberCapA) : undefined,
    memberCapB: msg.memberCapB ? String(msg.memberCapB) : undefined,
    encryptedKeyB64: msg.encryptedKeyB64 ? String(msg.encryptedKeyB64) : undefined,
    createdBy: client.walletAddress,
  });
  if (result.error === 'invalid_input' || result.error === 'self_pair') {
    sendError(client, `Could not register channel: ${result.error}`);
    return;
  }
  const row = result.row!;
  // Echo to caller.
  send(client, { type: 'dm_channel_registered', channel: dmChannelToWire(row) });
  // If the OTHER participant is online, push the channel so their UI can
  // pre-render the conversation.
  const other = row.participantA === callerLower ? row.participantB : row.participantA;
  ctx.sendToWallet(other, { type: 'dm_channel_registered', channel: dmChannelToWire(row) });
}

export function handleNotifyDmSent(
  ctx: TavernCtx,
  client: ConnectedClient,
  msg: { channelId?: unknown; recipient?: unknown },
): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const channelId = String(msg.channelId ?? '');
  const recipient = String(msg.recipient ?? '');
  const channel = getChannelById(channelId);
  if (!channel) {
    sendError(client, 'Unknown channel');
    return;
  }
  const callerLower = client.walletAddress.toLowerCase();
  if (callerLower !== channel.participantA && callerLower !== channel.participantB) {
    sendError(client, 'Caller is not a channel participant');
    return;
  }
  const recipientLower = recipient.toLowerCase();
  if (recipientLower !== channel.participantA && recipientLower !== channel.participantB) {
    sendError(client, 'Recipient is not a channel participant');
    return;
  }
  if (recipientLower === callerLower) {
    // Self-bump is meaningless; ignore silently.
    return;
  }
  const result = bumpUnread(channelId, recipientLower);
  if (!result) return;
  ctx.sendToWallet(recipientLower, {
    type: 'dm_unread_changed',
    channelId,
    unreadCount: result.unreadCount,
    totalUnread: getTotalUnreadForWallet(recipientLower),
    lastMessageAt: result.channel.lastMessageAt,
    // Carry the sender so the recipient's UI can attribute the toast
    // without a second cross-reference round-trip. Always lowercased
    // to match the canonical pair ordering held by the registry.
    senderWallet: callerLower,
  });
}

export function handleClearDmUnread(
  client: ConnectedClient,
  msg: { channelId?: unknown },
): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const channelId = String(msg.channelId ?? '');
  const channel = getChannelById(channelId);
  if (!channel) {
    sendError(client, 'Unknown channel');
    return;
  }
  const lower = client.walletAddress.toLowerCase();
  if (lower !== channel.participantA && lower !== channel.participantB) {
    sendError(client, 'Caller is not a channel participant');
    return;
  }
  clearUnread(channelId, lower);
  send(client, {
    type: 'dm_unread_changed',
    channelId,
    unreadCount: 0,
    totalUnread: getTotalUnreadForWallet(lower),
    lastMessageAt: channel.lastMessageAt,
  });
}

export function handleGetDmChannels(client: ConnectedClient): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const lower = client.walletAddress.toLowerCase();
  const channels = listChannelsForWallet(lower).map(dmChannelToWire);
  const totalUnread = getTotalUnreadForWallet(lower);
  send(client, { type: 'dm_channels_list', channels, totalUnread });
}

export function handleLookupDmChannel(
  client: ConnectedClient,
  msg: { peerWallet?: unknown },
): void {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const peer = String(msg.peerWallet ?? '');
  if (!peer.startsWith('0x')) {
    sendError(client, 'peerWallet required');
    return;
  }
  const channel = getChannelForPair(client.walletAddress, peer);
  send(client, {
    type: 'dm_channel_lookup',
    peerWallet: peer.toLowerCase(),
    channel: channel ? dmChannelToWire(channel) : null,
  });
}

// ─── DM messages (plaintext transport) ────────────────────────────────
//
// Hotfix #6 (2026-05-06): the Sui Stack Messaging SDK is alpha and
// hangs on `executeCreateChannelTransaction`. We're shipping DMs as
// plain WS + Supabase persistence and deferring the encrypted SDK
// until it reaches beta. The frontend has a feature flag
// (NEXT_PUBLIC_DM_TRANSPORT) so flipping back is a one-env-var change
// once the SDK is stable.
//
// Wire flow on send:
//   client → dm_send { clientId, peerWallet, body }
//   server validates → lazily registers synthetic channel (sha256 of
//     canonical pair) → persists row → bumps recipient unread
//   server → sender:    dm_message_sent     { clientId, message: {...} }
//                       dm_channel_registered (only on first send)
//   server → recipient: dm_message_received { message: {...} }
//                       dm_channel_registered (only on first send)
//                       dm_unread_changed   { ..., senderWallet }
//
// Wire flow on history:
//   client → dm_history { peerWallet, limit?, beforeId? }
//   server → caller:    dm_history { peerWallet, channelId, messages: [...], hasMore }

const DM_HISTORY_LIMIT_DEFAULT = 50;
const DM_HISTORY_LIMIT_MAX = 200;

export async function handleDmSend(
  ctx: TavernCtx,
  client: ConnectedClient,
  msg: { clientId?: unknown; peerWallet?: unknown; body?: unknown },
): Promise<void> {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const clientId = typeof msg.clientId === 'string' ? msg.clientId : '';
  const peerWallet = String(msg.peerWallet ?? '').trim();
  const rawBody = String(msg.body ?? '');
  if (!clientId) {
    sendError(client, 'dm_send requires clientId');
    return;
  }
  if (!peerWallet.startsWith('0x') || peerWallet.length < 3) {
    sendError(client, 'dm_send requires peerWallet (0x…)');
    return;
  }
  const body = rawBody.trim();
  if (body.length === 0) {
    sendError(client, 'dm_send body is empty');
    return;
  }
  if (body.length > 2000) {
    sendError(client, 'dm_send body exceeds 2000-char cap');
    return;
  }
  if (peerWallet.toLowerCase() === client.walletAddress.toLowerCase()) {
    sendError(client, 'Cannot DM yourself');
    return;
  }

  // Lazy synthetic-channel registration. First send between two
  // wallets creates the row; subsequent sends find it. The on-chain
  // SDK path uses `registerChannel` with a real id; this helper
  // only fires for the plaintext transport.
  let chanCreate: ReturnType<typeof getOrCreateSyntheticChannel>;
  try {
    chanCreate = getOrCreateSyntheticChannel(
      client.walletAddress,
      peerWallet,
      client.walletAddress,
    );
  } catch (err: any) {
    sendError(client, `Could not register DM channel: ${err?.message ?? err}`);
    return;
  }
  const channel = chanCreate.row;

  if (chanCreate.fresh) {
    // Both participants need the channel in their `state.dmChannels`
    // before any unread bump or message event lands. Push to both
    // sides on the same tick so the sender's optimistic UI and the
    // recipient's toast/pip surface have the prerequisite state.
    const wire = dmChannelToWire(channel);
    send(client, { type: 'dm_channel_registered', channel: wire });
    const otherLower = channel.participantA === client.walletAddress.toLowerCase()
      ? channel.participantB
      : channel.participantA;
    ctx.sendToWallet(otherLower, { type: 'dm_channel_registered', channel: wire });
  }

  const insertResult = await insertMessage({
    channelId: channel.channelId,
    senderWallet: client.walletAddress,
    recipientWallet: peerWallet,
    body,
  });
  if (insertResult.error) {
    sendError(client, `Could not send message: ${insertResult.error}`);
    return;
  }
  const row = insertResult.row!;
  const wireMsg: DmMessageWire = dmMessageToWire(row);

  // Bump the recipient's unread counter. The dm-channels store
  // returns the new count + lastMessageAt; we use those for the
  // recipient-side `dm_unread_changed` push so the toast surface
  // and sidebar pip update without a separate fetch.
  const bump = bumpUnread(channel.channelId, row.recipientWallet);

  // Echo to sender: drives the panel's optimistic-bubble swap to
  // confirmed (matched by clientId).
  send(client, {
    type: 'dm_message_sent',
    clientId,
    message: wireMsg,
  });

  // Push to recipient (no-op if not connected — they'll see the
  // message on next dm_history fetch when they open the panel).
  ctx.sendToWallet(row.recipientWallet, {
    type: 'dm_message_received',
    message: wireMsg,
  });

  if (bump) {
    ctx.sendToWallet(row.recipientWallet, {
      type: 'dm_unread_changed',
      channelId: channel.channelId,
      unreadCount: bump.unreadCount,
      totalUnread: getTotalUnreadForWallet(row.recipientWallet),
      lastMessageAt: bump.channel.lastMessageAt,
      senderWallet: row.senderWallet,
    });
  }
}

export async function handleDmHistory(
  client: ConnectedClient,
  msg: { peerWallet?: unknown; limit?: unknown; beforeId?: unknown },
): Promise<void> {
  if (!client.walletAddress) {
    sendError(client, 'Not authenticated');
    return;
  }
  const peerWallet = String(msg.peerWallet ?? '').trim();
  if (!peerWallet.startsWith('0x') || peerWallet.length < 3) {
    sendError(client, 'dm_history requires peerWallet (0x…)');
    return;
  }
  const requestedLimit = Number(msg.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), DM_HISTORY_LIMIT_MAX)
    : DM_HISTORY_LIMIT_DEFAULT;
  const beforeId = typeof msg.beforeId === 'string' && /^\d+$/.test(msg.beforeId)
    ? msg.beforeId
    : undefined;

  // Look up the channel without creating one. If no channel exists
  // yet (no DMs ever exchanged), return an empty history — the
  // panel renders the "no messages yet" empty state.
  const channel = getChannelForPair(client.walletAddress, peerWallet);
  if (!channel) {
    send(client, {
      type: 'dm_history',
      peerWallet: peerWallet.toLowerCase(),
      channelId: null,
      messages: [],
      hasMore: false,
    });
    return;
  }

  // Authorisation — the caller must be one of the two participants.
  // Defensive: a misbehaving client could send peerWallet=X for a
  // channel that has nothing to do with them. registerChannel
  // already guards on creation; we re-check on read because the
  // channel id can be looked up without going through the helper.
  const callerLower = client.walletAddress.toLowerCase();
  if (callerLower !== channel.participantA && callerLower !== channel.participantB) {
    sendError(client, 'Caller is not a channel participant');
    return;
  }

  const rows = await getHistory({
    channelId: channel.channelId,
    limit,
    beforeId,
  });
  // hasMore: if the page is full, there might be more. Loose
  // heuristic but fine for the panel — pagination is "load older"
  // on demand, not infinite-scroll.
  const hasMore = rows.length >= limit;
  send(client, {
    type: 'dm_history',
    peerWallet: peerWallet.toLowerCase(),
    channelId: channel.channelId,
    messages: rows.map(dmMessageToWire),
    hasMore,
  });

  // Opening the conversation implicitly clears unread for the
  // caller. Mirrors the panel's behaviour and saves a round-trip.
  clearUnread(channel.channelId, callerLower);
  send(client, {
    type: 'dm_unread_changed',
    channelId: channel.channelId,
    unreadCount: 0,
    totalUnread: getTotalUnreadForWallet(callerLower),
    lastMessageAt: channel.lastMessageAt ?? null,
  });
}

function dmChannelToWire(row: ReturnType<typeof getChannelById>): Record<string, unknown> {
  if (!row) return {};
  return {
    channelId: row.channelId,
    participantA: row.participantA,
    participantB: row.participantB,
    memberCapA: row.memberCapA ?? null,
    memberCapB: row.memberCapB ?? null,
    encryptedKeyB64: row.encryptedKeyB64 ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastMessageAt: row.lastMessageAt ?? null,
  };
}

// ─── router ──────────────────────────────────────────────────────────

/**
 * Single dispatch entry-point invoked from `ws/handler.ts`. Returns true
 * iff the message was a tavern message and was handled (so the main
 * router can bail out and not fall through to its default-case error).
 */
export function dispatchTavernMessage(
  ctx: TavernCtx,
  client: ConnectedClient,
  msg: { type: string; [k: string]: unknown },
  hooks: {
    onAcceptFightRequest: (req: FightRequest, client: ConnectedClient) => void;
  },
): boolean {
  switch (msg.type) {
    case 'enter_room':
      handleEnterRoom(ctx, client, msg as never);
      return true;
    case 'presence_heartbeat':
      handlePresenceHeartbeat(ctx, client);
      return true;
    case 'get_player_profile':
      void handleGetPlayerProfile(client, msg as never);
      return true;
    case 'send_fight_request':
      handleSendFightRequest(ctx, client, msg as never);
      return true;
    case 'accept_fight_request':
      handleResolveFightRequest(ctx, client, msg as never, 'accept', hooks.onAcceptFightRequest);
      return true;
    case 'decline_fight_request':
      handleResolveFightRequest(ctx, client, msg as never, 'decline');
      return true;
    case 'cancel_fight_request':
      handleResolveFightRequest(ctx, client, msg as never, 'cancel');
      return true;
    case 'get_pending_fight_requests':
      handleGetPendingFightRequests(client);
      return true;
    case 'register_dm_channel':
      handleRegisterDmChannel(ctx, client, msg as never);
      return true;
    case 'notify_dm_sent':
      handleNotifyDmSent(ctx, client, msg as never);
      return true;
    case 'clear_dm_unread':
      handleClearDmUnread(client, msg as never);
      return true;
    case 'get_dm_channels':
      handleGetDmChannels(client);
      return true;
    case 'lookup_dm_channel':
      handleLookupDmChannel(client, msg as never);
      return true;
    case 'dm_send':
      // Plaintext transport (Hotfix #6). Async because insertMessage
      // awaits the Supabase upsert (fire-and-forget on error).
      void handleDmSend(ctx, client, msg as never);
      return true;
    case 'dm_history':
      void handleDmHistory(client, msg as never);
      return true;
    default:
      return false;
  }
}
