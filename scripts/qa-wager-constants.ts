/**
 * v5.2 — wager constants single-source-of-truth gauntlet.
 *
 * Pins that:
 *   1. `frontend/src/lib/wager-constants.ts` exports the chain-mirrored
 *      constants with the exact values from `contracts/sources/arena.move`.
 *   2. No other frontend file hardcodes the literal numbers (300_000 /
 *      1_800_000) — the user explicitly required that timeouts/labels
 *      read from a single source, not magic numbers sprinkled across
 *      components.
 *   3. The pure helper functions behave as expected at boundary values.
 *
 * Pure unit tests — no chain, no React render, no SDK.
 */

import {
  CHALLENGE_TIMEOUT_MS,
  WAGER_RESOLUTION_TIMEOUT_MS,
  LEVEL_BRACKET,
  WAGER_STATUS,
  formatTimeoutMin,
  inLevelBracket,
  levelBracketBlockedReason,
  isReclaimable,
  isChallengeExpired,
} from "../frontend/src/lib/wager-constants";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..");

let passes = 0;
let fails = 0;
function ok(label: string): void {
  console.log(`  \u001b[32mPASS\u001b[0m ${label}`);
  passes++;
}
function fail(label: string, detail?: string): void {
  console.log(`  \u001b[31mFAIL\u001b[0m ${label}`);
  if (detail) console.log(`        ${detail}`);
  fails++;
}
function section(name: string): void {
  console.log(`\n\u001b[1m\u25b8 ${name}\u001b[0m`);
}

// ============================================================================
// (A) Chain parity — exported values match arena.move
// ============================================================================

function testChainParity(): void {
  section("Chain parity — frontend constants mirror arena.move exactly");
  const arenaSrc = readFileSync(join(ROOT, "contracts/sources/arena.move"), "utf8");

  // CHALLENGE_TIMEOUT_MS
  const chMatch = arenaSrc.match(/const CHALLENGE_TIMEOUT_MS:\s*u64\s*=\s*([\d_]+)/);
  if (!chMatch) {
    fail("arena.move declares CHALLENGE_TIMEOUT_MS");
    return;
  }
  const chChain = Number(chMatch[1].replace(/_/g, ""));
  if (CHALLENGE_TIMEOUT_MS === chChain) {
    ok(`CHALLENGE_TIMEOUT_MS=${CHALLENGE_TIMEOUT_MS} matches chain`);
  } else {
    fail(
      "CHALLENGE_TIMEOUT_MS matches chain",
      `frontend=${CHALLENGE_TIMEOUT_MS}, chain=${chChain}`,
    );
  }

  // WAGER_RESOLUTION_TIMEOUT_MS
  const wrMatch = arenaSrc.match(/const WAGER_RESOLUTION_TIMEOUT_MS:\s*u64\s*=\s*([\d_]+)/);
  if (!wrMatch) {
    fail("arena.move declares WAGER_RESOLUTION_TIMEOUT_MS");
    return;
  }
  const wrChain = Number(wrMatch[1].replace(/_/g, ""));
  if (WAGER_RESOLUTION_TIMEOUT_MS === wrChain) {
    ok(`WAGER_RESOLUTION_TIMEOUT_MS=${WAGER_RESOLUTION_TIMEOUT_MS} matches chain`);
  } else {
    fail(
      "WAGER_RESOLUTION_TIMEOUT_MS matches chain",
      `frontend=${WAGER_RESOLUTION_TIMEOUT_MS}, chain=${wrChain}`,
    );
  }

  // LEVEL_BRACKET
  const lbMatch = arenaSrc.match(/const LEVEL_BRACKET:\s*u8\s*=\s*(\d+)/);
  if (!lbMatch) {
    fail("arena.move declares LEVEL_BRACKET");
    return;
  }
  const lbChain = Number(lbMatch[1]);
  if (LEVEL_BRACKET === lbChain) {
    ok(`LEVEL_BRACKET=${LEVEL_BRACKET} matches chain`);
  } else {
    fail("LEVEL_BRACKET matches chain", `frontend=${LEVEL_BRACKET}, chain=${lbChain}`);
  }

  // STATUS_PENDING_APPROVAL
  if (WAGER_STATUS.PENDING_APPROVAL === 3) {
    ok("WAGER_STATUS.PENDING_APPROVAL === 3 (matches arena.move const STATUS_PENDING_APPROVAL)");
  } else {
    fail(
      "WAGER_STATUS.PENDING_APPROVAL === 3",
      `got ${WAGER_STATUS.PENDING_APPROVAL}`,
    );
  }
}

// ============================================================================
// (B) No magic numbers in the frontend — anything that wants these
//     constants must import from wager-constants.ts
// ============================================================================

function listTsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    const s = statSync(full);
    if (s.isDirectory()) listTsxFiles(full, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full);
  }
  return out;
}

function testNoMagicNumbers(): void {
  section("No magic numbers — frontend imports CHALLENGE/WAGER timeouts via constants");
  const allow = new Set([
    join(ROOT, "frontend/src/lib/wager-constants.ts"),
  ]);
  const files = listTsxFiles(join(ROOT, "frontend/src"));
  const offenders: string[] = [];
  for (const f of files) {
    if (allow.has(f)) continue;
    const txt = readFileSync(f, "utf8");
    // We're hunting for the literal numbers without an underscore (the
    // form a magic-number-adder would type). The underscore form would
    // be unusual in a non-constants file too, so check both.
    if (
      txt.includes("300000") ||
      txt.includes("300_000") ||
      txt.includes("1800000") ||
      txt.includes("1_800_000")
    ) {
      offenders.push(relative(ROOT, f));
    }
  }
  if (offenders.length === 0) {
    ok("zero magic-number hits in frontend (all CHALLENGE/WAGER timeouts go through wager-constants)");
  } else {
    fail(
      "zero magic-number hits in frontend",
      `offenders: ${offenders.join(", ")}`,
    );
  }
}

// ============================================================================
// (C) Pure helpers — boundary behaviour
// ============================================================================

function testHelpers(): void {
  section("Pure helpers — boundary behaviour");

  // inLevelBracket
  if (inLevelBracket(5, 5)) ok("inLevelBracket(5,5) === true (equal)");
  else fail("inLevelBracket(5,5)");
  if (inLevelBracket(5, 6)) ok("inLevelBracket(5,6) === true (-1)");
  else fail("inLevelBracket(5,6)");
  if (inLevelBracket(6, 5)) ok("inLevelBracket(6,5) === true (+1)");
  else fail("inLevelBracket(6,5)");
  if (!inLevelBracket(7, 5)) ok("inLevelBracket(7,5) === false (+2 over)");
  else fail("inLevelBracket(7,5)");
  if (!inLevelBracket(3, 5)) ok("inLevelBracket(3,5) === false (-2 under)");
  else fail("inLevelBracket(3,5)");

  // levelBracketBlockedReason
  const r = levelBracketBlockedReason(7, 5);
  if (r.includes("Lv.7") && r.includes("Lv.5") && r.includes("+2")) {
    ok("levelBracketBlockedReason renders both levels + signed delta");
  } else {
    fail("levelBracketBlockedReason renders correctly", `got: ${r}`);
  }

  // isReclaimable
  if (!isReclaimable(0)) ok("isReclaimable(0) === false (immediate)");
  else fail("isReclaimable(0)");
  if (!isReclaimable(WAGER_RESOLUTION_TIMEOUT_MS - 1))
    ok("isReclaimable(TIMEOUT-1) === false (just under)");
  else fail("isReclaimable(TIMEOUT-1)");
  if (isReclaimable(WAGER_RESOLUTION_TIMEOUT_MS))
    ok("isReclaimable(TIMEOUT) === true (boundary)");
  else fail("isReclaimable(TIMEOUT)");
  if (isReclaimable(WAGER_RESOLUTION_TIMEOUT_MS + 1))
    ok("isReclaimable(TIMEOUT+1) === true (past)");
  else fail("isReclaimable(TIMEOUT+1)");

  // isChallengeExpired
  if (!isChallengeExpired(0)) ok("isChallengeExpired(0) === false");
  else fail("isChallengeExpired(0)");
  if (isChallengeExpired(CHALLENGE_TIMEOUT_MS))
    ok("isChallengeExpired(TIMEOUT) === true (boundary)");
  else fail("isChallengeExpired(TIMEOUT)");

  // formatTimeoutMin
  if (formatTimeoutMin(CHALLENGE_TIMEOUT_MS) === "5 min") {
    ok("formatTimeoutMin(CHALLENGE_TIMEOUT_MS) === '5 min'");
  } else {
    fail("formatTimeoutMin(CHALLENGE_TIMEOUT_MS) === '5 min'", `got: ${formatTimeoutMin(CHALLENGE_TIMEOUT_MS)}`);
  }
  if (formatTimeoutMin(WAGER_RESOLUTION_TIMEOUT_MS) === "30 min") {
    ok("formatTimeoutMin(WAGER_RESOLUTION_TIMEOUT_MS) === '30 min'");
  } else {
    fail(
      "formatTimeoutMin(WAGER_RESOLUTION_TIMEOUT_MS) === '30 min'",
      `got: ${formatTimeoutMin(WAGER_RESOLUTION_TIMEOUT_MS)}`,
    );
  }
}

// ============================================================================
// Runner
// ============================================================================

testChainParity();
testNoMagicNumbers();
testHelpers();

console.log("\n" + "─".repeat(50));
if (fails === 0) {
  console.log(`\u001b[32m\u2713 wager-constants gauntlet: ${passes} pass / 0 fail\u001b[0m`);
} else {
  console.log(
    `\u001b[31m\u2717 wager-constants gauntlet: ${passes} pass / ${fails} fail\u001b[0m`,
  );
  process.exit(1);
}
