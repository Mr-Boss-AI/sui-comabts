/**
 * Presence service — single source of truth for "who's online, where".
 *
 * Splits the responsibility between two stores so the UI stays snappy
 * while still surviving a server restart:
 *
 *   • In-memory `Map<wallet, PresenceRow>` — the canonical view used by
 *     every WS broadcast and player-list query. Reads are synchronous.
 *
 *   • Supabase `presence` table — durability layer. Every state change
 *     fires a fire-and-forget upsert so a server restart can rehydrate
 *     the in-memory map within `PRESENCE_STALE_MS`. If Supabase isn't
 *     configured (in-memory-only mode), the durability path is a no-op
 *     and the rest of the system keeps working.
 *
 * The service exposes pure derivation helpers (`derivePlayerStatus`,
 * `groupPlayersByLevelBucket`) so the QA gauntlet can pin behaviour
 * without spinning up a real WS client.
 *
 * Wire shape — the value returned by `getOnlinePlayers()` matches
 * `OnlinePlayer` on the frontend so the existing
 * `dispatch({ type: 'SET_ONLINE_PLAYERS', players })` path lights up
 * untouched.
 */

import { getSupabase } from './supabase';
import { getCharacterByWallet } from './characters';

// ─── types ────────────────────────────────────────────────────────────

/** Areas the player can be in. Mirrors the frontend `currentArea` enum
 *  plus an explicit `'fight'` value for the active-combat case (the
 *  frontend doesn't carry a fight area but the server does). */
export type PresenceRoom =
  | 'tavern'
  | 'character'
  | 'arena'
  | 'marketplace'
  | 'hall_of_fame'
  | 'fight';

export type PresenceStatus = 'online' | 'in_fight' | 'in_marketplace' | 'idle';

export interface PresenceRow {
  walletAddress: string;
  characterName: string;
  level: number;
  rating: number;
  currentRoom: PresenceRoom;
  status: PresenceStatus;
  fightId?: string;
  lastSeenAt: number;
}

export interface OnlinePlayerWire {
  walletAddress: string;
  name: string;
  level: number;
  rating: number;
  status: PresenceStatus;
  currentRoom: PresenceRoom;
  fightId?: string;
}

/** Time after which a row with no heartbeat is considered offline.
 *  Twice the client heartbeat cadence (20s) plus a grace window.  */
export const PRESENCE_STALE_MS = 60_000;

/** Minimum delta between heartbeats before we bother touching Supabase.
 *  Prevents the durability layer from being hammered when many tabs are
 *  open or the heartbeat runs faster than expected. */
const PRESENCE_DURABLE_THROTTLE_MS = 5_000;

// ─── in-memory store ──────────────────────────────────────────────────

const presenceByWallet = new Map<string, PresenceRow>();
const lastDurableSyncAt = new Map<string, number>();

// ─── pure helpers (testable without DB / WS) ──────────────────────────

/**
 * Derive a player's status from the active room + current fight.
 *
 * - in_fight if a fightId is set OR the player is in the fight room
 * - in_marketplace if the active room is the marketplace
 * - idle if the heartbeat is older than IDLE_AFTER_MS
 * - online otherwise
 */
const IDLE_AFTER_MS = 30_000;

export function derivePlayerStatus(
  room: PresenceRoom,
  fightId: string | undefined,
  lastSeenAt: number,
  now: number = Date.now(),
): PresenceStatus {
  if (fightId || room === 'fight') return 'in_fight';
  if (room === 'marketplace') return 'in_marketplace';
  if (now - lastSeenAt > IDLE_AFTER_MS) return 'idle';
  return 'online';
}

/**
 * Group online players into level brackets. The brackets match the
 * progression cliffs from `LEVEL_UNLOCKS`:
 *
 *   1-3   — newcomers (training ground only)
 *   4-6   — early game (trading + ranked unlocked)
 *   7-9   — mid game (wagers unlocked, dual-wield/shield choice)
 *   10-14 — high game (epic items)
 *   15-19 — endgame (legendary items)
 *   20    — Hall of Fame eligible
 *
 * Pure function — same input always yields the same buckets. Buckets
 * with zero members are still present in the output; the UI decides
 * whether to render empty headers.
 */
export interface PlayerBucket {
  key: string;
  label: string;
  minLevel: number;
  maxLevel: number;
  players: OnlinePlayerWire[];
}

const BUCKET_DEFS: ReadonlyArray<Omit<PlayerBucket, 'players'>> = [
  { key: 'novice',   label: 'Novice (Lv 1-3)',     minLevel: 1,  maxLevel: 3 },
  { key: 'early',    label: 'Early Game (Lv 4-6)', minLevel: 4,  maxLevel: 6 },
  { key: 'mid',      label: 'Mid Game (Lv 7-9)',   minLevel: 7,  maxLevel: 9 },
  { key: 'high',     label: 'High Game (Lv 10-14)', minLevel: 10, maxLevel: 14 },
  { key: 'endgame',  label: 'Endgame (Lv 15-19)',  minLevel: 15, maxLevel: 19 },
  { key: 'hall',     label: 'Hall of Fame (Lv 20)', minLevel: 20, maxLevel: 999 },
];

export function groupPlayersByLevelBucket(
  players: ReadonlyArray<OnlinePlayerWire>,
): PlayerBucket[] {
  const buckets: PlayerBucket[] = BUCKET_DEFS.map((def) => ({ ...def, players: [] }));
  for (const p of players) {
    const bucket = buckets.find((b) => p.level >= b.minLevel && p.level <= b.maxLevel);
    if (bucket) bucket.players.push(p);
    else buckets[0].players.push(p); // defensive — shouldn't happen with current bounds
  }
  // Stable sort within bucket: rating desc, then name asc.
  for (const bucket of buckets) {
    bucket.players.sort((a, b) => {
      if (a.rating !== b.rating) return b.rating - a.rating;
      return a.name.localeCompare(b.name);
    });
  }
  return buckets;
}

/** Predicate version for use inside hot loops. */
export function bucketKeyForLevel(level: number): string {
  for (const def of BUCKET_DEFS) {
    if (level >= def.minLevel && level <= def.maxLevel) return def.key;
  }
  return BUCKET_DEFS[0].key;
}

// ─── store API ────────────────────────────────────────────────────────

/**
 * Insert or update a presence row. Side-effect-free besides the in-memory
 * map; durable sync is opportunistic via `flushPresenceToSupabase`.
 *
 * Caller is expected to trigger broadcasts (`onPresenceChange`) — this
 * function returns whether the row was newly inserted vs updated so the
 * caller can choose `player_joined` vs `player_status_changed`.
 */
export interface UpsertResult {
  row: PresenceRow;
  inserted: boolean;
  statusChanged: boolean;
  roomChanged: boolean;
  /** True when name / level / rating differ from the prior row. Lets
   *  callers re-broadcast a `player_joined` so peers can replace any
   *  stub data they were holding from an earlier upsert that ran
   *  before the canonical character record was hydrated. */
  dataChanged: boolean;
}

export function upsertPresence(input: {
  walletAddress: string;
  characterName?: string;
  level?: number;
  rating?: number;
  room?: PresenceRoom;
  fightId?: string | null;
  now?: number;
}): UpsertResult {
  const now = input.now ?? Date.now();
  const wallet = input.walletAddress;
  const existing = presenceByWallet.get(wallet);

  // Priority: explicit input > canonical character store (authoritative
  // for name/level/rating) > existing presence row > truncated-wallet
  // stub. Putting the character store BEFORE the existing row means a
  // presence row that started life with stub fallback values (because
  // an enter_room raced ahead of `handleRestoreCharacter`) gets
  // corrected on the next heartbeat once the character store learns
  // the player's real identity. Prior to 2026-05-08 the order was
  // reversed: any stub written into the existing row was permanent
  // because `existing` won the `??` chain — Mr_Boss's view of Sx in
  // the live two-wallet test stayed stuck on `0xd05ae8…/Lv 1/1000`
  // even after Sx's character finished hydrating.
  const character = getCharacterByWallet(wallet);
  const characterName = input.characterName
    ?? character?.name
    ?? existing?.characterName
    ?? wallet.slice(0, 8) + '...';
  const level = input.level
    ?? character?.level
    ?? existing?.level
    ?? 1;
  const rating = input.rating
    ?? character?.rating
    ?? existing?.rating
    ?? 1000;
  const currentRoom = input.room ?? existing?.currentRoom ?? 'tavern';
  // input.fightId === null clears it; undefined preserves the previous value.
  const fightId = input.fightId === null
    ? undefined
    : (input.fightId ?? existing?.fightId);

  const status = derivePlayerStatus(currentRoom, fightId, now, now);
  const next: PresenceRow = {
    walletAddress: wallet,
    characterName,
    level,
    rating,
    currentRoom,
    status,
    fightId,
    lastSeenAt: now,
  };

  presenceByWallet.set(wallet, next);

  return {
    row: next,
    inserted: !existing,
    statusChanged: !existing || existing.status !== next.status,
    roomChanged: !existing || existing.currentRoom !== next.currentRoom,
    dataChanged: !existing
      || existing.characterName !== next.characterName
      || existing.level !== next.level
      || existing.rating !== next.rating,
  };
}

/** Heartbeat tick — refreshes lastSeenAt without changing state. */
export function heartbeat(wallet: string, now: number = Date.now()): UpsertResult | null {
  const existing = presenceByWallet.get(wallet);
  if (!existing) return null;
  return upsertPresence({ walletAddress: wallet, now });
}

/** Remove a wallet's presence (disconnect / logout). */
export function removePresence(wallet: string): PresenceRow | null {
  const existing = presenceByWallet.get(wallet) ?? null;
  presenceByWallet.delete(wallet);
  lastDurableSyncAt.delete(wallet);
  if (existing) {
    void deletePresenceRow(wallet);
  }
  return existing;
}

/** Get a single wallet's presence (or null if offline). */
export function getPresence(wallet: string): PresenceRow | null {
  return presenceByWallet.get(wallet) ?? null;
}

/** Snapshot of every currently-online player, sorted by level desc.  */
export function getOnlinePlayers(): OnlinePlayerWire[] {
  const out: OnlinePlayerWire[] = [];
  for (const row of presenceByWallet.values()) {
    out.push(toWire(row));
  }
  return out.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

/** Snapshot grouped into level buckets — what the sidebar renders. */
export function getOnlinePlayersBucketed(): PlayerBucket[] {
  return groupPlayersByLevelBucket(getOnlinePlayers());
}

export function toWire(row: PresenceRow): OnlinePlayerWire {
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

/** Sweep stale rows. Called from a server tick.  */
export function sweepStalePresence(now: number = Date.now()): string[] {
  const dropped: string[] = [];
  for (const [wallet, row] of presenceByWallet) {
    if (now - row.lastSeenAt > PRESENCE_STALE_MS) {
      dropped.push(wallet);
    }
  }
  for (const wallet of dropped) {
    presenceByWallet.delete(wallet);
    lastDurableSyncAt.delete(wallet);
    void deletePresenceRow(wallet);
  }
  return dropped;
}

// ─── durability layer ─────────────────────────────────────────────────

/**
 * Throttled upsert into Supabase. Skips if we wrote the same row less than
 * `PRESENCE_DURABLE_THROTTLE_MS` ago. Heartbeats happen at ~20s cadence so
 * the throttle is effectively a no-op for clean players; it kicks in only
 * if a buggy client spams updates.
 */
export async function flushPresenceToSupabase(
  wallet: string,
  force: boolean = false,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const row = presenceByWallet.get(wallet);
  if (!row) return;
  const now = Date.now();
  const lastSync = lastDurableSyncAt.get(wallet) ?? 0;
  if (!force && now - lastSync < PRESENCE_DURABLE_THROTTLE_MS) return;
  lastDurableSyncAt.set(wallet, now);

  const { error } = await sb
    .from('presence')
    .upsert(
      {
        wallet_address: row.walletAddress,
        character_name: row.characterName,
        level: row.level,
        rating: row.rating,
        current_room: row.currentRoom,
        status: row.status,
        fight_id: row.fightId ?? null,
        last_seen_at: new Date(row.lastSeenAt).toISOString(),
      },
      { onConflict: 'wallet_address' },
    );
  if (error) {
    console.error('[Presence] Supabase upsert failed:', error.message);
  }
}

async function deletePresenceRow(wallet: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from('presence').delete().eq('wallet_address', wallet);
  if (error) {
    console.error('[Presence] Supabase delete failed:', error.message);
  }
}

/** Boot-time sweep — drop rows older than PRESENCE_STALE_MS so a player
 *  who was online when the server crashed doesn't haunt the player list
 *  forever after a restart. */
export async function sweepStalePresenceInDb(): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const cutoff = new Date(Date.now() - PRESENCE_STALE_MS).toISOString();
  const { error, count } = await sb
    .from('presence')
    .delete({ count: 'exact' })
    .lt('last_seen_at', cutoff);
  if (error) {
    console.error('[Presence] Supabase sweep failed:', error.message);
    return 0;
  }
  return count ?? 0;
}

// ─── test surface ─────────────────────────────────────────────────────
//
// Exposed for the qa-tavern-presence gauntlet only. The map is private
// in production code (every mutation goes through `upsertPresence` /
// `removePresence`) but the gauntlet needs to inspect / clear it
// between scenarios.

export function _testResetPresence(): void {
  presenceByWallet.clear();
  lastDurableSyncAt.clear();
}

export function _testSnapshot(): PresenceRow[] {
  return Array.from(presenceByWallet.values());
}
