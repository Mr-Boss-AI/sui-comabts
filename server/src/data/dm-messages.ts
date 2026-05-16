/**
 * DM message body store — the plaintext side of the Tavern DM transport.
 *
 * Hotfix #6 (2026-05-06): the Sui Stack Messaging SDK is alpha and
 * hangs before the wallet popup on `executeCreateChannelTransaction`.
 * Until it reaches beta we're shipping DMs as plain WebSocket +
 * Supabase persistence — the same shape global Tavern chat uses.
 *
 * Responsibilities split:
 *   • `dm-channels.ts` — per-pair channel metadata + unread counters.
 *     Reused unchanged. Plaintext channels get a synthetic
 *     `channelId = '0x' + sha256(canonical_pair).hex` so the existing
 *     registry/pip/toast pipelines work without conditionals.
 *   • `dm-messages.ts` (this file) — the message bodies. In-memory map
 *     keyed by channelId for fast "recent N" reads, durable in
 *     Supabase via fire-and-forget upserts.
 *
 * Wire shape on the WS layer is `DmMessageWire` — id, sender, body,
 * createdAt. The DmPanel maps each message into a `LocalMessage`
 * directly so the existing rendering JSX is unchanged.
 *
 * Boot-time `rehydrateRecentFromDb()` pulls the last N messages per
 * channel back into memory on server start so a quick reconnect
 * after restart doesn't show empty histories. N is intentionally
 * small (50 per channel) — older history is paginated via
 * `getHistory({ beforeId })`.
 */

import { getSupabase } from './supabase';
import { syntheticChannelIdForPair } from './dm-channels';

// Re-export so dm-messages.ts callers don't have to know which module
// owns the helper. Convenient for the WS handler that needs both
// "compute the id" and "insert a message".
export { syntheticChannelIdForPair };

export interface DmMessageRow {
  id: string;            // postgres BIGSERIAL → string for BigInt-safety
  channelId: string;
  senderWallet: string;  // canonical lowercase
  recipientWallet: string;
  body: string;
  createdAtMs: number;
}

export interface DmMessageWire {
  id: string;
  channelId: string;
  senderWallet: string;
  recipientWallet: string;
  body: string;
  createdAtMs: number;
}

// ─── in-memory store ──────────────────────────────────────────────────
//
// Keyed by channelId. Each channel keeps an array sorted ASCENDING by
// createdAtMs (oldest first) so "append on send" is O(1) push, and
// "give me the most recent N" is a slice from the end.
//
// We cap each channel's in-memory tail at 200 messages — any deeper
// history page is fetched from Supabase by `getHistory({ beforeId })`.
// 200 is plenty for the panel's open-and-scroll-back UX without
// blowing memory on long-lived servers.

const IN_MEMORY_TAIL = 200;
const messagesByChannel = new Map<string, DmMessageRow[]>();
let nextLocalId = 1;

function nextId(): string {
  // Local sequence used when Supabase isn't configured (in-memory
  // mode). With Supabase, `insert ... returning id` overwrites this
  // with the real BIGSERIAL value.
  return String(nextLocalId++);
}

// ─── public API ───────────────────────────────────────────────────────

export interface InsertMessageInput {
  channelId: string;
  senderWallet: string;
  recipientWallet: string;
  body: string;
}

export interface InsertMessageResult {
  row?: DmMessageRow;
  error?: 'invalid_input' | 'self_send' | 'persist_failed';
}

/**
 * Insert a new message. Validates the body (1..2000 chars) and that
 * sender ≠ recipient. Persists fire-and-forget; the in-memory copy
 * is returned synchronously so the WS handler can echo immediately
 * — Supabase write failures don't block the live transport.
 *
 * The caller is responsible for ensuring the channel row exists
 * (it's a foreign key constraint in the DB). Use
 * `getOrCreateSyntheticChannel` from the WS handler to lazily
 * create on first send.
 */
export async function insertMessage(input: InsertMessageInput): Promise<InsertMessageResult> {
  const body = input.body.trim();
  if (body.length === 0 || body.length > 2000) {
    return { error: 'invalid_input' };
  }
  const sender = input.senderWallet.toLowerCase();
  const recipient = input.recipientWallet.toLowerCase();
  if (sender === recipient) {
    return { error: 'self_send' };
  }
  if (!input.channelId.startsWith('0x') || input.channelId.length < 42) {
    return { error: 'invalid_input' };
  }
  const now = Date.now();
  // Try Supabase first — if configured, it's the source of truth for
  // the BIGSERIAL id. On miss/failure we fall back to a local sequence
  // so the in-memory mode stays usable for tests and dev.
  const sb = getSupabase();
  let id = nextId();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('dm_messages')
        .insert({
          channel_id: input.channelId,
          sender_wallet: sender,
          recipient_wallet: recipient,
          body,
          created_at: new Date(now).toISOString(),
        })
        .select('id')
        .single();
      if (error) {
        console.error('[DmMessages] insert failed:', error.message);
        return { error: 'persist_failed' };
      }
      if (data && (data as { id: number | string }).id !== undefined) {
        id = String((data as { id: number | string }).id);
      }
    } catch (err: any) {
      console.error('[DmMessages] insert threw:', err?.message ?? err);
      return { error: 'persist_failed' };
    }
  }
  const row: DmMessageRow = {
    id,
    channelId: input.channelId,
    senderWallet: sender,
    recipientWallet: recipient,
    body,
    createdAtMs: now,
  };
  appendInMemory(row);
  return { row };
}

function appendInMemory(row: DmMessageRow): void {
  let arr = messagesByChannel.get(row.channelId);
  if (!arr) {
    arr = [];
    messagesByChannel.set(row.channelId, arr);
  }
  arr.push(row);
  // Trim ancient messages from the tail to keep memory bounded.
  // Older history stays in Supabase and is paginated on demand.
  if (arr.length > IN_MEMORY_TAIL) {
    arr.splice(0, arr.length - IN_MEMORY_TAIL);
  }
}

export interface HistoryParams {
  channelId: string;
  /** Default 50, cap 200 (one in-memory page). */
  limit?: number;
  /** Cursor: id to paginate before (exclusive). When omitted, returns
   *  the most recent page. */
  beforeId?: string;
}

/**
 * Fetch a chronological page of history (oldest first within the
 * page). Reads from in-memory when possible, falls back to Supabase
 * for older pages.
 */
export async function getHistory(params: HistoryParams): Promise<DmMessageRow[]> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const memArr = messagesByChannel.get(params.channelId) ?? [];

  // No cursor: return the tail of the in-memory list (latest page),
  // backfilling from Supabase if the in-memory list is shorter than
  // the requested page.
  if (!params.beforeId) {
    if (memArr.length >= limit) {
      return memArr.slice(memArr.length - limit);
    }
    // In-memory has less than `limit` — backfill from DB.
    const sb = getSupabase();
    if (!sb) return [...memArr]; // best effort
    try {
      const { data, error } = await sb
        .from('dm_messages')
        .select('*')
        .eq('channel_id', params.channelId)
        .order('id', { ascending: false })
        .limit(limit);
      if (error) {
        console.error('[DmMessages] history fetch failed:', error.message);
        return [...memArr];
      }
      const rows = (data ?? []).map(rowFromDb).reverse();
      // Re-prime the in-memory cache.
      messagesByChannel.set(params.channelId, rows.slice(-IN_MEMORY_TAIL));
      return rows;
    } catch (err: any) {
      console.error('[DmMessages] history fetch threw:', err?.message ?? err);
      return [...memArr];
    }
  }

  // Cursor path: older page. Always go to Supabase — by definition
  // we want messages that pre-date what's in memory.
  const sb = getSupabase();
  if (!sb) {
    // No DB in test mode — return whatever's older than `beforeId`
    // from memory.
    return memArr.filter((m) => Number(m.id) < Number(params.beforeId)).slice(-limit);
  }
  try {
    const { data, error } = await sb
      .from('dm_messages')
      .select('*')
      .eq('channel_id', params.channelId)
      .lt('id', params.beforeId)
      .order('id', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[DmMessages] history page fetch failed:', error.message);
      return [];
    }
    return (data ?? []).map(rowFromDb).reverse();
  } catch (err: any) {
    console.error('[DmMessages] history page fetch threw:', err?.message ?? err);
    return [];
  }
}

function rowFromDb(raw: Record<string, unknown>): DmMessageRow {
  return {
    id: String(raw.id),
    channelId: String(raw.channel_id),
    senderWallet: String(raw.sender_wallet),
    recipientWallet: String(raw.recipient_wallet),
    body: String(raw.body),
    createdAtMs: new Date(String(raw.created_at)).getTime(),
  };
}

/** Boot-time rehydrate: pulls the last IN_MEMORY_TAIL messages per
 *  channel back into memory so a quick reconnect after restart
 *  doesn't show empty histories. */
export async function rehydrateRecentFromDb(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from('dm_messages')
      .select('*')
      .order('id', { ascending: true });
    if (error) {
      console.error('[DmMessages] rehydrate failed:', error.message);
      return;
    }
    const grouped = new Map<string, DmMessageRow[]>();
    for (const raw of (data ?? []) as Record<string, unknown>[]) {
      const row = rowFromDb(raw);
      let arr = grouped.get(row.channelId);
      if (!arr) {
        arr = [];
        grouped.set(row.channelId, arr);
      }
      arr.push(row);
    }
    for (const [chan, arr] of grouped) {
      messagesByChannel.set(chan, arr.slice(-IN_MEMORY_TAIL));
    }
  } catch (err: any) {
    console.error('[DmMessages] rehydrate threw:', err?.message ?? err);
  }
}

/** Wire shape — strip private fields, leave the IDs + body. */
export function rowToWire(row: DmMessageRow): DmMessageWire {
  return {
    id: row.id,
    channelId: row.channelId,
    senderWallet: row.senderWallet,
    recipientWallet: row.recipientWallet,
    body: row.body,
    createdAtMs: row.createdAtMs,
  };
}

// ─── test surface ─────────────────────────────────────────────────────

export function _testReset(): void {
  messagesByChannel.clear();
  nextLocalId = 1;
}

export function _testSnapshot(): { byChannel: Record<string, DmMessageRow[]> } {
  const out: Record<string, DmMessageRow[]> = {};
  for (const [chan, arr] of messagesByChannel) {
    out[chan] = [...arr];
  }
  return { byChannel: out };
}
