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
import {
  humanizeChainError,
  readStructuredAbort,
  formatStructuredAbort,
  assertTxSucceeded,
} from "../frontend/src/lib/tx-result";

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
    // v5.1
    11: "EAlreadyHasOpenWager",
    // v5.2 — wager fairness
    12: "ELevelOutOfBracket",
    13: "ENotPendingApproval",
    14: "EChallengerSlotTaken",
    15: "ENotCreatorForApproval",
    16: "ENotPendingChallenger",
    17: "EChallengeNotExpired",
    18: "ENotActiveForReclaim",
    19: "EWagerNotStalled",
    20: "ENotWagerParticipant",
    // v5.2 — judgment-call codes (spec §14.1)
    21: "ECreatorFightLocked",
    22: "ENotCharacterOwner",
    23: "EWrongExpiryEntrypoint",
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
  // v5.1 baseline (0–11) + v5.2 wager-fairness range (12–20) + v5.2
  // judgment-call codes 21/22/23 (see docs/V5.2_WAGER_FAIRNESS_SPEC.md
  // §14.1). If the Move source adds another const, append here.
  const allowed = new Set([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23,
  ]);
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
// Structured ExecutionError path — 2026-05-31 create_wager incident.
// SDK 2.16 puts an OBJECT in `status.error` (not a string). The pre-fix
// `assertTxSucceeded` only knew about strings, fell through to the
// empty fallback, and the user saw the generic "aborted on-chain (see
// console for raw result)" toast instead of the friendly EAlready copy.
// ============================================================================

function structured16Envelope(code: number, opts: { fnName?: string; instruction?: number } = {}) {
  // Mirrors the @mysten/sui types.ts:350-362 SimulateTransactionResult
  // FailedTransaction shape with the ExecutionStatus.error object that
  // carries the structured MoveAbort. The real envelope has gas /
  // changedObjects / etc — only the abort-relevant subset matters here.
  return {
    $kind: "FailedTransaction",
    FailedTransaction: {
      status: {
        success: false,
        status: "failure",
        error: {
          message: "", // INTENTIONALLY EMPTY — the bug's defining feature
          command: 0,
          $kind: "MoveAbort",
          MoveAbort: {
            abortCode: String(code),
            location: {
              package: "0x9c01ad55dd3aecafe671758fe4c9837b9fdfef1739793eb6bc094cc476f7d38f",
              module: "arena",
              function: 12,
              functionName: opts.fnName ?? "create_wager",
              instruction: opts.instruction ?? 14,
            },
          },
        },
      },
    },
    commandResults: undefined,
  };
}

function testReadStructuredAbortMoveAbort(): void {
  section("readStructuredAbort — extracts code + module + functionName from MoveAbort");
  const err = structured16Envelope(11).FailedTransaction.status.error;
  const sa = readStructuredAbort(err);
  if (!sa) {
    fail("returns a StructuredAbort", "got null");
    return;
  }
  eq(sa.abortCode, 11, "abortCode is the numeric Move code");
  eq(sa.module, "arena", "module preserved");
  eq(sa.functionName, "create_wager", "functionName preserved");
  eq(sa.instruction, 14, "instruction preserved");
}

function testReadStructuredAbortNonMoveAbort(): void {
  section("readStructuredAbort — non-MoveAbort kinds → null");
  const err = { $kind: "SizeError", message: "too big" };
  eq(readStructuredAbort(err), null, "SizeError → null");
  eq(readStructuredAbort(null), null, "null → null");
  eq(readStructuredAbort("plain string"), null, "string → null");
  eq(readStructuredAbort(undefined), null, "undefined → null");
}

function testFormatStructuredAbort(): void {
  section("formatStructuredAbort — produces the same shape humanizeChainError does");
  const sa = { abortCode: 11, module: "arena", functionName: "create_wager", instruction: 14 };
  const out = formatStructuredAbort(sa, ARENA_ABORT_CODES);
  includes(out, "You already have an open wager", "uses friendly copy for code 11");
  includes(out, "arena::create_wager", "preserves module::function location");
  includes(out, ":14", "preserves bytecode instruction offset");
}

function testAssertTxSucceededStructuredAbort(): void {
  section("assertTxSucceeded — structured FailedTransaction with empty .message reaches code 11");
  // This is the 2026-05-31 incident exactly. Pre-fix this case threw
  // "create_wager aborted on-chain (see console for raw result)";
  // post-fix it throws "You already have an open wager…".
  const envelope = structured16Envelope(11);
  let caught: Error | null = null;
  try {
    assertTxSucceeded(envelope, "create_wager", ARENA_ABORT_CODES);
  } catch (e) {
    caught = e as Error;
  }
  if (!caught) {
    fail("assertTxSucceeded throws", "did not throw on FailedTransaction envelope");
    return;
  }
  includes(
    caught.message,
    "You already have an open wager",
    "thrown message contains friendly EAlreadyHasOpenWager copy",
  );
  includes(caught.message, "create_wager", "thrown message names the ctxLabel");
  // Regression guard — the generic fallback substring must NOT appear.
  if (caught.message.includes("aborted on-chain (see console for raw result)")) {
    fail(
      "no generic fallback substring",
      "structured-abort branch fell through to the generic toast copy — humanizer regression",
    );
  } else {
    ok("no generic fallback substring (modal-friendly copy reaches user)");
  }
}

function testAssertTxSucceededStructuredCoversEveryCode(): void {
  section("assertTxSucceeded — every arena abort code routes through the structured path");
  for (const codeStr of Object.keys(ARENA_ABORT_CODES)) {
    const code = Number(codeStr);
    const envelope = structured16Envelope(code, { fnName: "create_wager" });
    try {
      assertTxSucceeded(envelope, "create_wager", ARENA_ABORT_CODES);
      fail(`code ${code} throws`, "did not throw");
    } catch (e) {
      const msg = (e as Error).message;
      const expectedCopy = ARENA_ABORT_CODES[code];
      if (msg.includes(expectedCopy)) ok(`code ${code} → "${expectedCopy.slice(0, 40)}…"`);
      else fail(`code ${code} surfaces friendly copy`, `got=${JSON.stringify(msg)}`);
    }
  }
}

function testAssertTxSucceededStructuredFallbackPreservesString(): void {
  section("assertTxSucceeded — string-error legacy envelope still works (no regression)");
  // Pre-2.16 envelope: status.error is a string, not an object.
  const legacy = {
    $kind: "FailedTransaction",
    FailedTransaction: {
      status: {
        success: false,
        error:
          "MoveAbort in 1st command, abort code: 11, in '0xabc::arena::create_wager' (instruction 14)",
      },
    },
  };
  let caught: Error | null = null;
  try {
    assertTxSucceeded(legacy, "create_wager", ARENA_ABORT_CODES);
  } catch (e) {
    caught = e as Error;
  }
  includes(caught?.message ?? null, "You already have an open wager", "legacy string path still humanizes code 11");
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
  // Structured-envelope path (2026-05-31 regression guard).
  testReadStructuredAbortMoveAbort();
  testReadStructuredAbortNonMoveAbort();
  testFormatStructuredAbort();
  testAssertTxSucceededStructuredAbort();
  testAssertTxSucceededStructuredCoversEveryCode();
  testAssertTxSucceededStructuredFallbackPreservesString();

  console.log(
    `\n\x1b[1m▸ arena-aborts gauntlet: ${passes} pass, ${failures} fail\x1b[0m`,
  );
  if (failures > 0) process.exit(1);
}

runAll();
