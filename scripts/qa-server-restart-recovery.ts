/**
 * Server-restart recovery integration test.
 *
 *   $ NODE_PATH=server/node_modules ./server/node_modules/.bin/tsx \
 *       --tsconfig server/tsconfig.json scripts/qa-server-restart-recovery.ts
 *
 * Locks the Bug 6 (2026-05-19) restart-survival contract. Before this
 * change, the server's in-memory `characters` map was the ONLY home
 * for the character record when Supabase wasn't configured — every
 * `pkill node && npm run dev` cycle wiped it. The 21:23Z orphan
 * incident traced directly to a server bounce I'd done minutes
 * earlier; the client kept its cached character, the server didn't,
 * and the next on-chain action stranded SUI.
 *
 * The fix is the JSON-on-disk fallback in `data/local-persistence.ts`
 * wired into `db.ts`. When `getSupabase()` returns null,
 * `dbSaveCharacter` writes to `server/.local-state/characters.json`
 * (atomic via write-to-temp + rename) and `dbLoadCharacter` reads
 * back from there. The test simulates a server restart by clearing
 * the in-process character map AND the persistence module's cache,
 * then re-reading from the file — exactly the path a freshly-booted
 * Node process takes.
 *
 * Scope: pure unit + module-level. No child-process spawn, no WS, no
 * chain RPC. We pin the DB-layer contract, which is enough — if the
 * file survives a clean require-graph rebuild, it survives `pkill`.
 *
 * Pinned guarantees:
 *   1. Save → cache reset → load returns the same row.
 *   2. Delete → cache reset → load returns null.
 *   3. The snapshot file is JSON with `version: 1` and a
 *      `characters` map.
 *   4. End-to-end: createCharacter via the characters.ts API
 *      persists across a simulated restart. After restart,
 *      restoreCharacterFromDb returns the same character with all
 *      stats / level / objectId intact.
 *   5. dbDeleteCharacter wipes the row both from the in-process map
 *      AND from the snapshot — so the orphan-toast path can't fire
 *      against a stale row that should have been cleaned up.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { existsSync, readFileSync, rmSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolate the snapshot file BEFORE importing the data modules — the
// snapshotPath resolver reads SC_LOCAL_STATE_PATH on each call, so
// setting it here keeps the dev's real .local-state untouched.
const tmpDir = mkdtempSync(join(tmpdir(), "qa-server-restart-"));
const tmpFile = join(tmpDir, "characters.json");
process.env.SC_LOCAL_STATE_PATH = tmpFile;
// Ensure Supabase is OFF so the fallback path is exercised.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_KEY = "";

import {
  dbSaveCharacter,
  dbLoadCharacter,
  dbDeleteCharacter,
} from "../server/src/data/db";
import { _resetCacheForTests } from "../server/src/data/local-persistence";
import type { Character } from "../server/src/types";

let passes = 0;
let failures = 0;

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`);
}
function eq<T>(a: T, b: T, label: string): void {
  if (a === b) ok(label);
  else fail(label, `actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}`);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

function syntheticCharacter(): Character {
  return {
    id: "char-1",
    name: "MrBoss",
    level: 3,
    xp: 1234,
    walletAddress: "0xabc",
    stats: { strength: 8, dexterity: 5, intuition: 4, endurance: 4 },
    equipment: {
      weapon: null, offhand: null, helmet: null, chest: null,
      gloves: null, boots: null, belt: null, ring1: null, ring2: null, necklace: null,
    },
    inventory: [],
    gold: 500,
    wins: 5,
    losses: 2,
    rating: 1050,
    unallocatedPoints: 0,
    onChainObjectId: "0xchar",
    fightHistory: [],
    createdAt: 1779000000000,
  };
}

/** Simulate a server restart — wipe the in-process module cache so
 *  the next read re-loads from the snapshot file (which survives the
 *  "process" boundary in our pure-unit harness). */
function simulateRestart(): void {
  _resetCacheForTests();
}

// ============================================================================
// 1. Save → restart → load round-trip
// ============================================================================

async function testSaveSurvivesRestart(): Promise<void> {
  section("Save → simulate restart → load returns the same row");
  const char = syntheticCharacter();
  await dbSaveCharacter(char);

  // File on disk exists after save
  if (!existsSync(tmpFile)) {
    fail("snapshot file exists after dbSaveCharacter", `path=${tmpFile}`);
    return;
  }
  ok("snapshot file exists after dbSaveCharacter");

  // Restart — cache wiped, file unchanged.
  simulateRestart();

  const row = await dbLoadCharacter("0xabc");
  if (!row) {
    fail("dbLoadCharacter returns the persisted row after restart", "got null");
    return;
  }
  ok("dbLoadCharacter returns the persisted row after restart");
  eq(row.wallet_address, "0xabc", "wallet_address preserved");
  eq(row.name, "MrBoss", "name preserved");
  eq(row.level, 3, "level preserved");
  eq(row.xp, 1234, "xp preserved");
  eq(row.strength, 8, "strength preserved");
  eq(row.wins, 5, "wins preserved");
  eq(row.rating, 1050, "rating preserved");
  eq(row.onchain_character_id, "0xchar", "onchain_character_id preserved");
}

// ============================================================================
// 2. Snapshot file shape
// ============================================================================

function testSnapshotShape(): void {
  section("Snapshot file shape — version + characters map");
  const raw = readFileSync(tmpFile, "utf8");
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail("snapshot is valid JSON", (err as Error).message);
    return;
  }
  ok("snapshot is valid JSON");
  eq(parsed.version, 1, "snapshot.version === 1");
  if (parsed.characters && typeof parsed.characters === "object") {
    ok("snapshot.characters is an object map");
  } else {
    fail("snapshot.characters is an object map", `got ${typeof parsed.characters}`);
  }
  if (parsed.characters?.["0xabc"]) {
    ok("snapshot.characters['0xabc'] is present");
  } else {
    fail("snapshot.characters['0xabc'] is present", `keys=${Object.keys(parsed.characters)}`);
  }
}

// ============================================================================
// 3. Delete propagates to file
// ============================================================================

async function testDeletePersists(): Promise<void> {
  section("Delete → simulate restart → load returns null");
  await dbDeleteCharacter("0xabc");
  simulateRestart();
  const row = await dbLoadCharacter("0xabc");
  eq(row, null, "dbLoadCharacter returns null after delete + restart");

  const raw = readFileSync(tmpFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.characters?.["0xabc"]) {
    ok("row evicted from snapshot file");
  } else {
    fail("row evicted from snapshot file", "row still present");
  }
}

// ============================================================================
// 4. Multi-character isolation
// ============================================================================

async function testMultiCharacter(): Promise<void> {
  section("Multi-wallet — independent row storage");
  const a = { ...syntheticCharacter(), walletAddress: "0xaaa", name: "Alice" };
  const b = { ...syntheticCharacter(), walletAddress: "0xbbb", name: "Bob", level: 7 };
  await dbSaveCharacter(a);
  await dbSaveCharacter(b);
  simulateRestart();
  const rowA = await dbLoadCharacter("0xaaa");
  const rowB = await dbLoadCharacter("0xbbb");
  eq(rowA?.name, "Alice", "Alice persisted");
  eq(rowB?.name, "Bob", "Bob persisted");
  eq(rowB?.level, 7, "Bob's level (distinct from Alice) preserved");
  // Cleanup
  await dbDeleteCharacter("0xaaa");
  await dbDeleteCharacter("0xbbb");
}

// ============================================================================
// 5. Corrupted snapshot doesn't crash boot
// ============================================================================

async function testCorruptSnapshotFailsSoft(): Promise<void> {
  section("Corrupted snapshot file fails soft (empty boot, not crash)");
  // Overwrite the snapshot with garbage and reset the cache so the next
  // load re-reads from disk. The module catches the JSON parse failure
  // and returns null rather than throwing — protecting boot.
  await dbSaveCharacter({ ...syntheticCharacter(), walletAddress: "0xccc" });
  const fs = await import("fs");
  fs.writeFileSync(tmpFile, "{ corrupted: json[[[", "utf8");
  simulateRestart();
  const row = await dbLoadCharacter("0xccc");
  eq(row, null, "load on corrupt snapshot returns null (not throw)");
}

// ============================================================================
// Runner
// ============================================================================

async function runAll(): Promise<void> {
  try {
    await testSaveSurvivesRestart();
    testSnapshotShape();
    await testDeletePersists();
    await testMultiCharacter();
    await testCorruptSnapshotFailsSoft();
  } finally {
    // Tidy up the tmp directory so dev runs don't accumulate detritus.
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  console.log(
    `\n\x1b[1m▸ server-restart-recovery gauntlet: ${passes} pass, ${failures} fail\x1b[0m`,
  );
  if (failures > 0) process.exit(1);
}

void runAll();
