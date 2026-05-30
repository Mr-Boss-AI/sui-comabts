/**
 * JSON-on-disk persistence fallback.
 *
 * Bug 6 (2026-05-19) restart-survival. When `SUPABASE_URL` /
 * `SUPABASE_KEY` aren't configured (default dev mode, and the actual
 * state of the host that produced the orphan-wager incident at
 * 21:23Z), the in-memory character map is wiped on every restart.
 * The frontend's auth_ok self-heal recovers the *user-facing* UX —
 * the chain-check round-trip re-restores via on-chain NFT data — but
 * the SERVER-side record still depends on the client reinitialising
 * the session before any action.
 *
 * This module is a zero-config insurance layer: dbSaveCharacter and
 * friends in `db.ts` now fall through to a local JSON file when
 * Supabase isn't available, so:
 *   - characters survive `pkill node && npm run dev` cycles
 *   - the server can hydrate them at boot without any chain RPC
 *   - the orphan-toast UX path stays as last-resort but is no longer
 *     the FIRST line of defence
 *
 * The file lives at `server/.local-state/characters.json`. Atomic
 * write (write-to-temp + rename) so a SIGKILL mid-flush can't
 * corrupt the snapshot. The file is gitignored — it's host-local
 * state, never committed.
 *
 * Schema: `DbCharacter[]` — same shape as the Supabase row, so
 * `dbLoadCharacter` can return either source interchangeably.
 *
 * Pinned by `qa-server-restart-recovery.ts` (integration test) and
 * `qa-local-persistence.ts` (pure unit test). The integration test
 * exercises the full `start → mint → kill → restart → reconnect →
 * assert restored` flow without any Supabase dependency.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import type { DbCharacter } from './db';

/**
 * Snapshot path. Resolves to `<server>/.local-state/characters.json`.
 * The `..` jumps out of `src/data/` to the server package root.
 *
 * Overridable for tests via `SC_LOCAL_STATE_PATH` env so the gauntlet
 * can target an isolated directory without trampling dev state.
 */
function snapshotPath(): string {
  const override = process.env.SC_LOCAL_STATE_PATH;
  if (override) return override;
  return join(__dirname, '..', '..', '.local-state', 'characters.json');
}

interface Snapshot {
  version: 1;
  /** Wallet address → row. Stored as an object so JSON parses to a
   *  plain map shape; lookup is O(1) without rebuilding a Map. */
  characters: Record<string, DbCharacter>;
}

function emptySnapshot(): Snapshot {
  return { version: 1, characters: {} };
}

let cache: Snapshot | null = null;

function loadSnapshot(): Snapshot {
  if (cache) return cache;
  const path = snapshotPath();
  if (!existsSync(path)) {
    cache = emptySnapshot();
    return cache;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Snapshot;
    // Defensive — a hand-edited or partially-written snapshot
    // shouldn't crash the boot path. Fall back to empty.
    if (!parsed || parsed.version !== 1 || typeof parsed.characters !== 'object') {
      console.warn(`[LocalPersistence] Snapshot at ${path} has unexpected shape — using empty`);
      cache = emptySnapshot();
      return cache;
    }
    cache = parsed;
    return cache;
  } catch (err) {
    console.warn(
      `[LocalPersistence] Could not read snapshot at ${path}:`,
      (err as Error).message,
    );
    cache = emptySnapshot();
    return cache;
  }
}

function saveSnapshot(snap: Snapshot): void {
  const path = snapshotPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Atomic write: write-to-temp + rename. A SIGKILL between the two
  // calls can leave a `.tmp` file (cleaned on next save) but the
  // canonical snapshot is never half-written.
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(snap, null, 2), 'utf8');
  renameSync(tmp, path);
  cache = snap;
}

/**
 * Reset the in-process cache so the next read re-loads from disk.
 * Only used by tests that mutate the snapshot file out-of-band.
 */
export function _resetCacheForTests(): void {
  cache = null;
}

/**
 * Persist a character row to the local snapshot. No-op when Supabase
 * is configured (the db.ts adapter only calls this on the fallback
 * branch). Safe to call from any thread — the cache is in-process
 * and the write is synchronous-atomic.
 */
export function localSaveCharacter(row: DbCharacter): void {
  const snap = loadSnapshot();
  snap.characters[row.wallet_address] = row;
  saveSnapshot(snap);
}

export function localLoadCharacter(walletAddress: string): DbCharacter | null {
  const snap = loadSnapshot();
  return snap.characters[walletAddress] ?? null;
}

export function localDeleteCharacter(walletAddress: string): void {
  const snap = loadSnapshot();
  if (!(walletAddress in snap.characters)) return;
  delete snap.characters[walletAddress];
  saveSnapshot(snap);
}

/**
 * Return every persisted character. Used by the boot-time hydration
 * path in characters.ts so the server can re-populate its in-memory
 * map without waiting for individual clients to reconnect.
 */
export function localLoadAllCharacters(): DbCharacter[] {
  const snap = loadSnapshot();
  return Object.values(snap.characters);
}
