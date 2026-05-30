/**
 * DM channel registry — Sui Stack Messaging channel ids ↔ wallet pairs.
 *
 * The Sui Stack Messaging SDK creates an on-chain shared object per
 * channel; the channel object holds the encrypted member caps and the
 * actual messages live in events emitted by `send_message` (with
 * attachments stored on Walrus). We never see plaintext on the server.
 *
 * What we DO need server-side:
 *   1. Lookup: given (walletA, walletB), is there already a channel?
 *      The pair is unordered — `(A,B)` and `(B,A)` map to the same row.
 *   2. Notification fan-out: when wallet A sends a message into channel
 *      C, the server bumps wallet B's unread counter and pushes a
 *      `dm_unread_changed` over their WS so the badge lights up even
 *      if the panel is closed.
 *   3. Member-cap caching: each side's member cap object id is needed
 *      for sending; surfacing them via the lookup avoids a round-trip
 *      per send.
 *
 * The pair is canonicalised at insert/lookup time: `participant_a` is
 * always the lexicographically smaller lowercase address. The DB has a
 * CHECK enforcing the invariant.
 */

import { createHash } from 'crypto';
import { getSupabase } from './supabase';

export interface DmChannelRow {
  channelId: string;
  participantA: string; // canonical: lower(min(a, b))
  participantB: string; // canonical: lower(max(a, b))
  memberCapA?: string;
  memberCapB?: string;
  encryptedKeyB64?: string;
  createdBy: string;
  createdAt: number;
  lastMessageAt?: number;
}

export interface UnreadRow {
  channelId: string;
  recipient: string;
  unreadCount: number;
  updatedAt: number;
}

// ─── canonical pair ordering ──────────────────────────────────────────

export function canonicalPair(a: string, b: string): { a: string; b: string } {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return { a: lowerA, b: lowerB };
  return { a: lowerB, b: lowerA };
}

/** Pure helper — returns true iff the pair is in canonical order. */
export function isCanonicalPair(a: string, b: string): boolean {
  return a.toLowerCase() < b.toLowerCase()
    && a.toLowerCase() === a
    && b.toLowerCase() === b;
}

/**
 * Deterministic synthetic channel id for a plaintext-mode wallet
 * pair (Hotfix #6, 2026-05-06). Looks like a real on-chain channel
 * id (`0x` + 64 hex chars, 66 total) so the existing `registerChannel`
 * validator accepts it without special-casing the plaintext path.
 *
 * Implementation: sha256 over the canonical (lower(min), lower(max))
 * pair string. Idempotent — same pair always hashes to the same id,
 * so two clients sending DMs to each other land on the same row
 * without needing to coordinate beforehand.
 *
 * Future-proofing: when the encrypted Sui Stack Messaging SDK
 * reaches beta and we flip the transport flag back, fresh channels
 * get a real Sui object id; existing plaintext synthetic ids stay
 * valid forever (the sha256 collision space and the on-chain object
 * id space don't overlap in practice — Sui object ids are derived
 * from tx digests, not hashes of user-controlled strings).
 */
export function syntheticChannelIdForPair(walletA: string, walletB: string): string {
  const pair = canonicalPair(walletA, walletB);
  const hash = createHash('sha256').update(`${pair.a}|${pair.b}`).digest('hex');
  return `0x${hash}`;
}

// ─── in-memory store ──────────────────────────────────────────────────

const channelsById = new Map<string, DmChannelRow>();
const channelByPair = new Map<string, string>(); // "a|b" -> channelId
const unreadByChannelRecipient = new Map<string, UnreadRow>(); // "channelId|recipient" -> row

function pairKey(a: string, b: string): string {
  const c = canonicalPair(a, b);
  return `${c.a}|${c.b}`;
}

function unreadKey(channelId: string, recipient: string): string {
  return `${channelId}|${recipient.toLowerCase()}`;
}

// ─── store API ────────────────────────────────────────────────────────

export interface RegisterChannelInput {
  channelId: string;
  walletA: string;
  walletB: string;
  memberCapA?: string;
  memberCapB?: string;
  encryptedKeyB64?: string;
  createdBy: string;
}

export interface RegisterChannelResult {
  row?: DmChannelRow;
  error?: 'already_registered' | 'self_pair' | 'invalid_input';
}

export function registerChannel(input: RegisterChannelInput): RegisterChannelResult {
  if (!input.channelId.startsWith('0x') || input.channelId.length < 42) {
    return { error: 'invalid_input' };
  }
  if (input.walletA.toLowerCase() === input.walletB.toLowerCase()) {
    return { error: 'self_pair' };
  }
  const c = canonicalPair(input.walletA, input.walletB);
  const key = `${c.a}|${c.b}`;
  const existingId = channelByPair.get(key);
  if (existingId && existingId !== input.channelId) {
    // A different channel already represents this pair — return it
    // (caller probably raced a peer's `register_dm_channel`).
    const existing = channelsById.get(existingId);
    if (existing) return { row: existing, error: 'already_registered' };
  }

  const now = Date.now();
  const row: DmChannelRow = {
    channelId: input.channelId,
    participantA: c.a,
    participantB: c.b,
    memberCapA: input.memberCapA,
    memberCapB: input.memberCapB,
    encryptedKeyB64: input.encryptedKeyB64,
    createdBy: input.createdBy.toLowerCase(),
    createdAt: now,
    lastMessageAt: undefined,
  };
  channelsById.set(row.channelId, row);
  channelByPair.set(key, row.channelId);
  void persistChannel(row);
  return { row };
}

export function getChannelById(channelId: string): DmChannelRow | null {
  return channelsById.get(channelId) ?? null;
}

/**
 * Lazy synthetic-channel registration for plaintext DMs (Hotfix #6).
 * Returns the existing row if one exists for the canonical pair,
 * otherwise creates one with a deterministic synthetic id and the
 * given creator wallet. Intended for the plaintext WS handler's
 * "first send" path — no separate `register_dm_channel` round-trip
 * needed from the client.
 *
 * When the encrypted SDK comes back online and the transport flag
 * flips, this helper is bypassed entirely (the SDK path goes
 * through `registerChannel` with a real on-chain id) — which is why
 * the synthetic id format is deliberately compatible with the same
 * `0x`-prefixed validation.
 */
export interface GetOrCreateSyntheticResult {
  row: DmChannelRow;
  fresh: boolean;
}
export function getOrCreateSyntheticChannel(
  walletA: string,
  walletB: string,
  createdBy: string,
): GetOrCreateSyntheticResult {
  const existing = getChannelForPair(walletA, walletB);
  if (existing) {
    return { row: existing, fresh: false };
  }
  const channelId = syntheticChannelIdForPair(walletA, walletB);
  const result = registerChannel({
    channelId,
    walletA,
    walletB,
    createdBy,
  });
  if (!result.row) {
    // registerChannel only fails on self_pair / invalid_input — both
    // are programmer errors at this layer (the WS handler validated
    // already). Surface the error so we don't return a phantom row.
    throw new Error(
      `getOrCreateSyntheticChannel: registerChannel rejected (${result.error})`,
    );
  }
  return { row: result.row, fresh: true };
}

export function getChannelForPair(a: string, b: string): DmChannelRow | null {
  const id = channelByPair.get(pairKey(a, b));
  if (!id) return null;
  return channelsById.get(id) ?? null;
}

export function listChannelsForWallet(wallet: string): DmChannelRow[] {
  const lower = wallet.toLowerCase();
  const out: DmChannelRow[] = [];
  for (const row of channelsById.values()) {
    if (row.participantA === lower || row.participantB === lower) out.push(row);
  }
  return out.sort((a, b) =>
    (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt),
  );
}

export interface BumpUnreadResult {
  unreadCount: number;
  channel: DmChannelRow;
}

/**
 * Bump the recipient's unread counter for a channel and stamp the
 * channel's `lastMessageAt`. Caller passes the channel id (already
 * registered) and the recipient wallet (the OTHER participant).
 */
export function bumpUnread(channelId: string, recipient: string): BumpUnreadResult | null {
  const channel = channelsById.get(channelId);
  if (!channel) return null;
  const lower = recipient.toLowerCase();
  if (lower !== channel.participantA && lower !== channel.participantB) return null;
  const key = unreadKey(channelId, lower);
  const now = Date.now();
  const existing = unreadByChannelRecipient.get(key);
  const next: UnreadRow = {
    channelId,
    recipient: lower,
    unreadCount: (existing?.unreadCount ?? 0) + 1,
    updatedAt: now,
  };
  unreadByChannelRecipient.set(key, next);
  channel.lastMessageAt = now;
  channelsById.set(channelId, channel);
  void persistUnread(next);
  void persistChannel(channel); // updates last_message_at
  return { unreadCount: next.unreadCount, channel };
}

/** Reset the recipient's unread counter to 0 (panel opened). */
export function clearUnread(channelId: string, recipient: string): void {
  const lower = recipient.toLowerCase();
  const key = unreadKey(channelId, lower);
  const now = Date.now();
  const next: UnreadRow = {
    channelId,
    recipient: lower,
    unreadCount: 0,
    updatedAt: now,
  };
  unreadByChannelRecipient.set(key, next);
  void persistUnread(next);
}

/** Get the recipient's current unread count (0 if no row exists). */
export function getUnread(channelId: string, recipient: string): number {
  const key = unreadKey(channelId, recipient.toLowerCase());
  return unreadByChannelRecipient.get(key)?.unreadCount ?? 0;
}

/** Sum of unread counts across every channel for this wallet. */
export function getTotalUnreadForWallet(wallet: string): number {
  const lower = wallet.toLowerCase();
  let total = 0;
  for (const [, row] of unreadByChannelRecipient) {
    if (row.recipient === lower) total += row.unreadCount;
  }
  return total;
}

// ─── durability layer ─────────────────────────────────────────────────

async function persistChannel(row: DmChannelRow): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from('dm_channels')
    .upsert(
      {
        channel_id: row.channelId,
        participant_a: row.participantA,
        participant_b: row.participantB,
        member_cap_a: row.memberCapA ?? null,
        member_cap_b: row.memberCapB ?? null,
        encrypted_key_b64: row.encryptedKeyB64 ?? null,
        created_by: row.createdBy,
        created_at: new Date(row.createdAt).toISOString(),
        last_message_at: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
      },
      { onConflict: 'channel_id' },
    );
  if (error) {
    console.error('[DmChannels] Supabase upsert failed:', error.message);
  }
}

async function persistUnread(row: UnreadRow): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from('dm_channel_unread')
    .upsert(
      {
        channel_id: row.channelId,
        recipient: row.recipient,
        unread_count: row.unreadCount,
        updated_at: new Date(row.updatedAt).toISOString(),
      },
      { onConflict: 'channel_id,recipient' },
    );
  if (error) {
    console.error('[DmChannels] Unread upsert failed:', error.message);
  }
}

/** Boot-time rehydrate of channels + unread counters. */
export async function rehydrateFromDb(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: channels, error: chanErr } = await sb.from('dm_channels').select('*');
  if (chanErr) {
    console.error('[DmChannels] Rehydrate failed:', chanErr.message);
    return;
  }
  for (const row of (channels as Record<string, unknown>[]) ?? []) {
    const r: DmChannelRow = {
      channelId: String(row.channel_id),
      participantA: String(row.participant_a),
      participantB: String(row.participant_b),
      memberCapA: row.member_cap_a ? String(row.member_cap_a) : undefined,
      memberCapB: row.member_cap_b ? String(row.member_cap_b) : undefined,
      encryptedKeyB64: row.encrypted_key_b64 ? String(row.encrypted_key_b64) : undefined,
      createdBy: String(row.created_by),
      createdAt: new Date(String(row.created_at)).getTime(),
      lastMessageAt: row.last_message_at
        ? new Date(String(row.last_message_at)).getTime()
        : undefined,
    };
    channelsById.set(r.channelId, r);
    channelByPair.set(`${r.participantA}|${r.participantB}`, r.channelId);
  }
  const { data: unread, error: unreadErr } = await sb.from('dm_channel_unread').select('*');
  if (unreadErr) {
    console.error('[DmChannels] Unread rehydrate failed:', unreadErr.message);
    return;
  }
  for (const row of (unread as Record<string, unknown>[]) ?? []) {
    const channelId = String(row.channel_id);
    const recipient = String(row.recipient);
    unreadByChannelRecipient.set(unreadKey(channelId, recipient), {
      channelId,
      recipient: recipient.toLowerCase(),
      unreadCount: Number(row.unread_count) || 0,
      updatedAt: new Date(String(row.updated_at)).getTime(),
    });
  }
}

// ─── test surface ─────────────────────────────────────────────────────

export function _testReset(): void {
  channelsById.clear();
  channelByPair.clear();
  unreadByChannelRecipient.clear();
}

export function _testSnapshot(): { channels: DmChannelRow[]; unread: UnreadRow[] } {
  return {
    channels: Array.from(channelsById.values()),
    unread: Array.from(unreadByChannelRecipient.values()),
  };
}
