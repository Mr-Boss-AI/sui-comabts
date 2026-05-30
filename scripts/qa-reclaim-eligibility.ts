/**
 * v5.2 — ReclaimStalledWagerBanner visibility-gating gauntlet.
 *
 * Tests the pure `computeReclaimEligibility(fight, viewerWallet, nowMs)`
 * helper at every relevant boundary:
 *
 *   (A) Wager fields present + viewer is participant
 *       - elapsed < 30 min → hidden
 *       - elapsed === 30 min (boundary) → visible
 *       - elapsed > 30 min → visible
 *       - either side of the wager can reclaim
 *   (B) Defence — banner never shows when:
 *       - fight is null
 *       - not a wager fight (wagerMatchId undefined)
 *       - wagerAcceptedAtMs not populated yet (server on older wire)
 *       - viewer is not a participant
 *       - fight is finished
 *   (C) Source-grep — verifies the live component imports the helper
 *       (rather than re-implementing the gate inline).
 *
 * Pure: no React render, no SDK, no chain.
 */

import {
  computeReclaimEligibility,
  WAGER_RESOLUTION_TIMEOUT_MS,
  type ReclaimEligibilityFight,
} from "../frontend/src/lib/wager-constants";
import { readFileSync } from "fs";
import { join } from "path";

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

const ALICE = "0xa1111111111111111111111111111111111111111111111111111111111111a1";
const BOB = "0xb2222222222222222222222222222222222222222222222222222222222222b2";
const EVE = "0xe3333333333333333333333333333333333333333333333333333333333333e3";
const WAGER = "0x9000000000000000000000000000000000000000000000000000000000009000";
const ACCEPT_AT = 1_700_000_000_000;

function activeWagerFight(): ReclaimEligibilityFight {
  return {
    status: "active",
    wagerMatchId: WAGER,
    wagerAcceptedAtMs: ACCEPT_AT,
    playerA: { walletAddress: ALICE },
    playerB: { walletAddress: BOB },
  };
}

// ============================================================================
// (A) Happy path — visibility gate around the 30-min boundary
// ============================================================================

function testHappyBoundary(): void {
  section("(A) Visibility gate around the 30-min boundary");
  const fight = activeWagerFight();

  // Just before the cutoff — banner stays hidden.
  const justBefore = computeReclaimEligibility(fight, ALICE, ACCEPT_AT + WAGER_RESOLUTION_TIMEOUT_MS - 1);
  if (!justBefore.show) ok("hidden at elapsed = 30min - 1ms (mid-fight abuse blocked)");
  else fail("hidden at elapsed = 30min - 1ms", `got: ${JSON.stringify(justBefore)}`);

  // Exactly at the cutoff — banner appears.
  const atBoundary = computeReclaimEligibility(fight, ALICE, ACCEPT_AT + WAGER_RESOLUTION_TIMEOUT_MS);
  if (atBoundary.show) ok("VISIBLE at elapsed = 30min (boundary)");
  else fail("VISIBLE at elapsed = 30min (boundary)", `got: ${JSON.stringify(atBoundary)}`);

  // Well past — still visible.
  const wellPast = computeReclaimEligibility(fight, ALICE, ACCEPT_AT + 45 * 60_000);
  if (wellPast.show) ok("VISIBLE at elapsed = 45min (well past)");
  else fail("VISIBLE at elapsed = 45min", `got: ${JSON.stringify(wellPast)}`);

  if (atBoundary.show && atBoundary.wagerMatchId === WAGER) {
    ok("show=true carries the wagerMatchId for the reclaim call");
  } else {
    fail("show=true carries the wagerMatchId", `got: ${JSON.stringify(atBoundary)}`);
  }
}

function testEitherParticipant(): void {
  section("(A) Both participants can fire — symmetry");
  const fight = activeWagerFight();
  const nowMs = ACCEPT_AT + WAGER_RESOLUTION_TIMEOUT_MS;
  const a = computeReclaimEligibility(fight, ALICE, nowMs);
  const b = computeReclaimEligibility(fight, BOB, nowMs);
  if (a.show && b.show) ok("Alice AND Bob both see the banner after 30 min");
  else fail("Alice AND Bob both see the banner", `Alice: ${JSON.stringify(a)} | Bob: ${JSON.stringify(b)}`);
}

// ============================================================================
// (B) Defence — banner never shows when context isn't a stalled wager fight
// ============================================================================

function testDefenceCases(): void {
  section("(B) Defence — banner hidden in every non-stalled context");
  const farPast = ACCEPT_AT + WAGER_RESOLUTION_TIMEOUT_MS + 1;

  // 1. No fight at all (player not currently in one).
  const noFight = computeReclaimEligibility(null, ALICE, farPast);
  if (!noFight.show) ok("hidden when fight is null");
  else fail("hidden when fight is null", JSON.stringify(noFight));
  const undefFight = computeReclaimEligibility(undefined, ALICE, farPast);
  if (!undefFight.show) ok("hidden when fight is undefined");
  else fail("hidden when fight is undefined", JSON.stringify(undefFight));

  // 2. Friendly / ranked fight (no wagerMatchId).
  const friendly: ReclaimEligibilityFight = {
    ...activeWagerFight(),
    wagerMatchId: undefined,
  };
  const r = computeReclaimEligibility(friendly, ALICE, farPast);
  if (!r.show) ok("hidden when wagerMatchId is undefined (friendly/ranked)");
  else fail("hidden when wagerMatchId is undefined", JSON.stringify(r));

  // 3. Server hasn't populated wagerAcceptedAtMs yet.
  const noAcceptedAt: ReclaimEligibilityFight = {
    ...activeWagerFight(),
    wagerAcceptedAtMs: undefined,
  };
  const na = computeReclaimEligibility(noAcceptedAt, ALICE, farPast);
  if (!na.show) ok("hidden when wagerAcceptedAtMs not populated (graceful degrade)");
  else fail("hidden when wagerAcceptedAtMs not populated", JSON.stringify(na));

  // 4. Non-participant (someone else's fight; can't happen in normal UI
  //    but proves the guard exists).
  const np = computeReclaimEligibility(activeWagerFight(), EVE, farPast);
  if (!np.show) ok("hidden when viewer is not a participant");
  else fail("hidden when viewer is not a participant", JSON.stringify(np));

  // 5. Fight already finished — settle path covered the escrow.
  const finished: ReclaimEligibilityFight = {
    ...activeWagerFight(),
    status: "finished",
  };
  const f = computeReclaimEligibility(finished, ALICE, farPast);
  if (!f.show) ok("hidden when fight.status === 'finished'");
  else fail("hidden when fight.status === 'finished'", JSON.stringify(f));

  // 6. Zero elapsed (just-started fight).
  const zero = computeReclaimEligibility(activeWagerFight(), ALICE, ACCEPT_AT);
  if (!zero.show) ok("hidden at elapsed = 0 (fight just started)");
  else fail("hidden at elapsed = 0", JSON.stringify(zero));
}

// ============================================================================
// (C) Live component uses the helper (no inline reimplementation)
// ============================================================================

function testComponentImportsHelper(): void {
  section("(C) ReclaimStalledWagerBanner imports the pure helper");
  const banner = readFileSync(
    join(ROOT, "frontend/src/components/fight/reclaim-stalled-wager-banner.tsx"),
    "utf8",
  );
  if (banner.includes("computeReclaimEligibility")) {
    ok("banner.tsx imports computeReclaimEligibility");
  } else {
    fail(
      "banner.tsx imports computeReclaimEligibility",
      "if you change the import name, update the source-grep too",
    );
  }
  // Hidden vs visible behaviour — `return null` on hidden, eligibility
  // value referenced for the reclaim call.
  if (banner.includes("if (!eligibility.show) return null")) {
    ok("banner returns null when eligibility.show is false");
  } else {
    fail(
      "banner returns null when eligibility.show is false",
      "the guard pattern shifted — re-pin the assertion",
    );
  }
}

// ============================================================================
// Runner
// ============================================================================

testHappyBoundary();
testEitherParticipant();
testDefenceCases();
testComponentImportsHelper();

console.log("\n" + "─".repeat(50));
if (fails === 0) {
  console.log(`\u001b[32m\u2713 reclaim-eligibility gauntlet: ${passes} pass / 0 fail\u001b[0m`);
} else {
  console.log(
    `\u001b[31m\u2717 reclaim-eligibility gauntlet: ${passes} pass / ${fails} fail\u001b[0m`,
  );
  process.exit(1);
}
