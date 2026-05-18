/**
 * Arena abort-codes gauntlet — pure unit tests, no chain, no React.
 *
 *   $ NODE_PATH=frontend/node_modules ./server/node_modules/.bin/tsx \
 *       --tsconfig frontend/tsconfig.json scripts/qa-arena-aborts.ts
 *
 * Locks the 2026-05-18 wager-accept abort-code → toast mapping. Before
 * the fix, a wager that flipped WAITING→ACTIVE between lobby render
 * and the accept click surfaced as the raw SDK string:
 *
 *   Transaction resolution failed: MoveAbort in 2nd command,
 *   abort code: 1, in '0xa7dc...::arena::accept_wager' (instruction 14)
 *
 * Routed through `humanizeChainError(raw, ARENA_ABORT_CODES)` the same
 * error now reads:
 *
 *   The wager is no longer waiting for an opponent — it was just
 *   accepted or cancelled. Refresh the lobby. (at arena::accept_wager:14)
 *
 * This gauntlet pins:
 *   - Every Move-side error constant (0-10 in arena.move) has a
 *     non-empty human-readable copy in ARENA_ABORT_CODES.
 *   - `humanizeChainError` extracts the right code from the canonical
 *     SDK error string AND from the bare-code variant.
 *   - Module + function + instruction location is preserved in the
 *     formatted message so the user (or a support engineer) can
 *     identify which check fired.
 *
 * If the Move-side error constants ever renumber (would require a
 * v5.x republish), the matching test below fails and forces a
 * resync before the frontend ships against the new package.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { ARENA_ABORT_CODES } from "../frontend/src/lib/arena-aborts";
import { humanizeChainError } from "../frontend/src/lib/tx-result";

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
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) ok(label);
  else fail(label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function includes(haystack: string | null, needle: string, label: string): void {
  if (haystack && haystack.includes(needle)) ok(label);
  else
    fail(label, `expected to include ${JSON.stringify(needle)}; got ${JSON.stringify(haystack)}`);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

// ============================================================================
// Map completeness — every arena.move constant has a friendly message
// ============================================================================

function testEveryAbortCodeHasCopy(): void {
  section("ARENA_ABORT_CODES — completeness");
  // Source of truth: contracts/sources/arena.move:9-19
  const expected: Record<number, string> = {
    0: "EInvalidStake",
    1: "EMatchNotWaiting",
    2: "EMatchNotActive",
    3: "EStakeMismatch",
    4: "ENotPlayerA",
    5: "EInvalidWinner",
    6: "EMatchAlreadySettled",
    7: "ECannotJoinOwnMatch",
    8: "EUnauthorized",
    9: "ENotExpired",
    10: "ENoOpponent",
  };
  for (const [code, name] of Object.entries(expected)) {
    const msg = ARENA_ABORT_CODES[Number(code)];
    if (msg && msg.length > 10) ok(`code ${code} (${name}) has copy ≥ 10 chars`);
    else fail(`code ${code} (${name}) has copy ≥ 10 chars`, `got: ${JSON.stringify(msg)}`);
  }
}

function testNoStrayCodes(): void {
  section("ARENA_ABORT_CODES — no stray entries");
  const keys = Object.keys(ARENA_ABORT_CODES).map(Number);
  const allowed = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const k of keys) {
    if (allowed.has(k)) ok(`code ${k} is a known arena constant`);
    else
      fail(
        `code ${k} is a known arena constant`,
        "extraneous entry — either the Move file added a constant we missed, or this entry is stale",
      );
  }
}

// ============================================================================
// humanizeChainError — extraction from real-world SDK error shapes
// ============================================================================

function testCanonicalMoveAbortString(): void {
  section("humanizeChainError — canonical MoveAbort string");
  // Verbatim from the 2026-05-18 incident report.
  const raw =
    "Transaction resolution failed: MoveAbort in 2nd command, abort code: 1, " +
    "in '0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1::arena::accept_wager' " +
    "(instruction 14)";
  const out = humanizeChainError(raw, ARENA_ABORT_CODES);
  includes(out, "no longer waiting", "extracts EMatchNotWaiting copy from full SDK string");
  includes(out, "arena", "preserves module name in location suffix");
  includes(out, "accept_wager", "preserves function name in location suffix");
  includes(out, ":14", "preserves bytecode instruction offset");
}

function testBareCodeFallback(): void {
  section("humanizeChainError — bare 'abort code: N' fallback");
  const raw = "VMError: abort code: 7";
  const out = humanizeChainError(raw, ARENA_ABORT_CODES);
  includes(out, "can't accept your own wager", "bare-code path lookups ECannotJoinOwnMatch copy");
}

function testEachCodeRoundTrips(): void {
  section("humanizeChainError — every code round-trips via canonical string");
  for (let code = 0; code <= 10; code++) {
    const raw = `MoveAbort in 1st command, abort code: ${code}, in '0xabc::arena::some_fn' (instruction 0)`;
    const out = humanizeChainError(raw, ARENA_ABORT_CODES);
    const expectedCopy = ARENA_ABORT_CODES[code];
    if (out && expectedCopy && out.includes(expectedCopy)) {
      ok(`code ${code} surfaces matching copy`);
    } else {
      fail(`code ${code} surfaces matching copy`, `got=${JSON.stringify(out)}`);
    }
  }
}

function testUnknownCodeStillReadable(): void {
  section("humanizeChainError — unknown codes still produce SOMETHING readable");
  // 99 is a fictional code — exercises the `?? \`Abort code N\`` fallback
  // path inside humanizeChainError. The user shouldn't see a blank toast
  // even if the Move side adds a constant we haven't synced yet.
  const raw = `MoveAbort in 2nd command, abort code: 99, in '0xabc::arena::accept_wager' (instruction 14)`;
  const out = humanizeChainError(raw, ARENA_ABORT_CODES);
  includes(out, "Abort code 99", "unknown code falls back to 'Abort code N'");
  includes(out, "accept_wager", "still pinpoints function for support");
}

function testNoMatchReturnsNull(): void {
  section("humanizeChainError — non-MoveAbort errors fall through");
  const raw = "WebSocket disconnected before tx submitted";
  const out = humanizeChainError(raw, ARENA_ABORT_CODES);
  eq(out, null, "non-MoveAbort returns null so caller can pick its own fallback copy");
}

// ============================================================================
// Runner
// ============================================================================

function runAll(): void {
  testEveryAbortCodeHasCopy();
  testNoStrayCodes();
  testCanonicalMoveAbortString();
  testBareCodeFallback();
  testEachCodeRoundTrips();
  testUnknownCodeStillReadable();
  testNoMatchReturnsNull();

  console.log(
    `\n\x1b[1m▸ arena-aborts gauntlet: ${passes} pass, ${failures} fail\x1b[0m`,
  );
  if (failures > 0) process.exit(1);
}

runAll();
