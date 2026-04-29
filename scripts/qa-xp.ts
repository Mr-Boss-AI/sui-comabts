/**
 * XP semantics + reward gauntlet — pure unit tests, no chain calls.
 *
 *   $ cd server && npx ts-node ../scripts/qa-xp.ts
 *   (ts-node is in server/devDependencies; node_modules is the only requirement)
 *
 * Asserts the three layers (chain table, server table, frontend table) all
 * agree, and that the server's applyXp + calculateXpReward implement the GDD
 * spec. Exits 0 on full pass, 1 on any failure.
 */
import { GAME_CONSTANTS } from '../server/src/config';
import { applyXp, xpForLevel, xpForNextLevel } from '../server/src/game/combat';
import { calculateXpReward } from '../server/src/utils/elo';
import {
  MAX_LEVEL as FE_MAX_LEVEL,
  XP_TABLE as FE_XP_TABLE,
  getXpForNextLevel as feGetXpForNextLevel,
  getXpProgress as feGetXpProgress,
  getXpInCurrentLevel as feGetXpInCurrentLevel,
  getXpSpanForLevel as feGetXpSpanForLevel,
  xpThresholdForLevel as feXpThresholdForLevel,
} from '../frontend/src/types/game';
import type { Character, FightType } from '../server/src/types';

// =============================================================================
// CHAIN — the canonical table per character.move::xp_for_level. If you ever
// upgrade the on-chain XP curve, update THIS first, then mirror to server +
// frontend. The test will fail loudly if they drift.
// =============================================================================
const CHAIN_XP_FOR_LEVEL: Record<number, number> = {
  1: 0,
  2: 100,
  3: 300,
  4: 700,
  5: 1_500,
  6: 3_000,
  7: 6_000,
  8: 12_000,
  9: 25_000,
  10: 50_000,
  11: 80_000,
  12: 120_000,
  13: 170_000,
  14: 250_000,
  15: 350_000,
  16: 430_000,
  17: 550_000,
  18: 700_000,
  19: 850_000,
  20: 1_000_000,
};

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
  else fail(label, `actual=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
}
function near(actual: number, expected: number, epsilon: number, label: string): void {
  if (Math.abs(actual - expected) <= epsilon) ok(label);
  else fail(label, `actual=${actual}  expected≈${expected} ±${epsilon}`);
}
function between(actual: number, lo: number, hi: number, label: string): void {
  if (actual >= lo && actual <= hi) ok(label);
  else fail(label, `actual=${actual}  expected in [${lo}, ${hi}]`);
}

// Builds a minimal Character with whatever fields the function under test needs.
function mkChar(level: number, xp: number, unalloc = 0): Character {
  return {
    id: 'test',
    name: 'Test',
    level,
    xp,
    walletAddress: '0xtest',
    stats: { strength: 5, dexterity: 5, intuition: 5, endurance: 5 },
    equipment: {
      weapon: null, offhand: null, helmet: null, chest: null, gloves: null,
      boots: null, belt: null, ring1: null, ring2: null, necklace: null,
    },
    inventory: [],
    gold: 0,
    wins: 0,
    losses: 0,
    rating: 1000,
    unallocatedPoints: unalloc,
    fightHistory: [],
    createdAt: 0,
  };
}

// =============================================================================
// 1 — Tables: chain == server == frontend
// =============================================================================
console.log('\n[1] XP tables agree across chain / server / frontend');

for (const [levelStr, expected] of Object.entries(CHAIN_XP_FOR_LEVEL)) {
  const level = Number(levelStr);
  const serverVal = GAME_CONSTANTS.LEVEL_XP_CUMULATIVE[level - 1];
  eq(serverVal, expected, `server.LEVEL_XP_CUMULATIVE[L${level}] = ${expected}`);

  const serverHelper = xpForLevel(level);
  eq(serverHelper, expected, `server.xpForLevel(${level}) = ${expected}`);

  const feVal = FE_XP_TABLE[level];
  eq(feVal, expected, `frontend.XP_TABLE[L${level}] = ${expected}`);

  const feHelper = feXpThresholdForLevel(level);
  eq(feHelper, expected, `frontend.xpThresholdForLevel(${level}) = ${expected}`);
}

eq(FE_MAX_LEVEL, 20, 'frontend MAX_LEVEL = 20');
eq(GAME_CONSTANTS.MAX_LEVEL, 20, 'server MAX_LEVEL = 20');
eq(GAME_CONSTANTS.MAX_XP_PER_FIGHT, 1000, 'server MAX_XP_PER_FIGHT = 1000');

// Boundary sentinels
eq(xpForLevel(0), 0, 'server.xpForLevel(0) clamps to 0');
eq(xpForLevel(21), Number.POSITIVE_INFINITY, 'server.xpForLevel(21) → Infinity');
eq(feXpThresholdForLevel(0), 0, 'frontend.xpThresholdForLevel(0) clamps to 0');
eq(feXpThresholdForLevel(21), Number.POSITIVE_INFINITY, 'frontend.xpThresholdForLevel(21) → Infinity');
eq(xpForNextLevel(20), Number.POSITIVE_INFINITY, 'server.xpForNextLevel(MAX) → Infinity');
eq(feGetXpForNextLevel(20), null, 'frontend.getXpForNextLevel(MAX) → null');

// =============================================================================
// 2 — Server applyXp: cumulative semantics, multi-level, max-level cap
// =============================================================================
console.log('\n[2] applyXp — cumulative semantics');

// Single fight, no level-up
{
  const c = mkChar(1, 0, 0);
  const r = applyXp(c, 75);
  eq(c.xp, 75, 'L1 + 75 → xp 75');
  eq(c.level, 1, 'L1 + 75 → still L1');
  eq(c.unallocatedPoints, 0, 'L1 + 75 → 0 unalloc');
  eq(r.leveledUp, false, 'L1 + 75 → no level-up');
}

// Single fight, single level-up (Sx_v5.1 case: 0 → 167 cumulative, lands at L2)
{
  const c = mkChar(1, 0, 0);
  const r = applyXp(c, 167);
  eq(c.xp, 167, 'L1 + 167 → xp 167 (cumulative, NOT decremented)');
  eq(c.level, 2, 'L1 + 167 → L2');
  eq(c.unallocatedPoints, 3, 'L1 + 167 → +3 unalloc');
  eq(r.leveledUp, true, 'L1 + 167 → leveledUp');
  eq(r.levelsGained, 1, 'L1 + 167 → 1 level gained');
}

// Multi-level loop (huge XP grant — admin grant style)
{
  const c = mkChar(1, 0, 0);
  applyXp(c, 1000);  // crosses L2 (100) and L3 (300) but not L4 (700) since 1000 > 700 → also L4. 1000 < 1500 so stops at L4.
  eq(c.level, 4, 'L1 + 1000 → L4 (loop fired 3 times)');
  eq(c.xp, 1000, 'L1 + 1000 → cumulative xp 1000');
  eq(c.unallocatedPoints, 9, 'L1 + 1000 → +9 unalloc (3 level-ups)');
}

// Exact threshold lands AT the level (>= boundary in chain)
{
  const c = mkChar(1, 0, 0);
  applyXp(c, 100);
  eq(c.level, 2, 'xp == L2 threshold → L2');
}
{
  const c = mkChar(2, 100, 0);
  applyXp(c, 200); // 100 → 300 (exact L3 threshold)
  eq(c.level, 3, 'xp == L3 threshold → L3');
}

// Max-level cap
{
  const c = mkChar(20, 1_000_000, 0);
  const r = applyXp(c, 1_000_000);
  eq(c.level, 20, 'L20 + huge XP → still L20 (cap)');
  eq(c.xp, 2_000_000, 'cumulative XP still tracked past cap');
  eq(r.leveledUp, false, 'past-cap → no level-up reported');
}

// Negative XP is clamped to 0 (defensive)
{
  const c = mkChar(3, 500, 0);
  applyXp(c, -50);
  eq(c.xp, 500, 'negative XP grant → no-op');
  eq(c.level, 3, 'negative XP grant → no level change');
}

// =============================================================================
// 3 — calculateXpReward: GDD §9.2 formulas
// =============================================================================
console.log('\n[3] calculateXpReward — GDD §9.2 formulas');

// --- Win ranked: clamp(50 + (oppRating - myRating)/10, 50, 200) ---
{
  // Equal rating (0 diff) → 50
  eq(calculateXpReward('ranked' as FightType, true, 1000, 1000), 50,
    'ranked win, equal rating → 50');

  // Underdog by 500 ELO → 50 + 500/10 = 100
  eq(calculateXpReward('ranked' as FightType, true, 1000, 1500), 100,
    'ranked win, underdog by 500 → 100');

  // Massive underdog by 2000 ELO → clamp to 200
  eq(calculateXpReward('ranked' as FightType, true, 100, 2100), 200,
    'ranked win, underdog by 2000 → clamp 200');

  // Heavy favorite (winner > loser by 500) → 50 + (-500)/10 = 0 → clamp to 50
  eq(calculateXpReward('ranked' as FightType, true, 2000, 1500), 50,
    'ranked win, favorite by 500 → clamp floor 50');
}

// --- Loss ranked: randomInt(10, 30), inclusive ---
for (let i = 0; i < 200; i++) {
  const v = calculateXpReward('ranked' as FightType, false, 1000, 1000);
  if (v < 10 || v > 30) {
    fail('ranked loss within [10, 30]', `got ${v}`);
    break;
  }
}
ok('ranked loss within [10, 30] (200 samples)');

// --- Win wager: clamp(100 + (oppRating - myRating)/5, 100, 400) ---
{
  eq(calculateXpReward('wager' as FightType, true, 1000, 1000), 100,
    'wager win, equal rating → 100');
  eq(calculateXpReward('wager' as FightType, true, 1000, 1500), 200,
    'wager win, underdog by 500 → 100 + 500/5 = 200');
  eq(calculateXpReward('wager' as FightType, true, 100, 2100), 400,
    'wager win, underdog by 2000 → clamp 400');
  eq(calculateXpReward('wager' as FightType, true, 2000, 1500), 100,
    'wager win, favorite by 500 → clamp floor 100');
}

// --- Loss wager: randomInt(20, 50) ---
for (let i = 0; i < 200; i++) {
  const v = calculateXpReward('wager' as FightType, false, 1000, 1000);
  if (v < 20 || v > 50) {
    fail('wager loss within [20, 50]', `got ${v}`);
    break;
  }
}
ok('wager loss within [20, 50] (200 samples)');

// --- Friendly: zero, both sides ---
eq(calculateXpReward('friendly' as FightType, true, 1000, 1000), 0,
  'friendly win → 0 XP (practice)');
eq(calculateXpReward('friendly' as FightType, false, 1000, 1000), 0,
  'friendly loss → 0 XP (practice)');

// --- Item-stake: same curve as ranked ---
eq(calculateXpReward('item_stake' as FightType, true, 1000, 1000), 50,
  'item_stake win, equal rating → 50 (ranked curve)');

// --- MAX_XP_PER_FIGHT cap (synthetic — bands are below 1000, cap is defensive)
{
  // Even a +9000 ELO underdog can't exceed 200 (ranked) or 400 (wager) per the
  // clamps, so this just asserts the post-cap rounded integer.
  const v = calculateXpReward('wager' as FightType, true, 100, 100_000);
  eq(v, 400, 'extreme wager underdog still clamps at 400 (band) ≤ 1000 (chain cap)');
}

// =============================================================================
// 4 — Frontend XP helpers — partial-within-level rendering
// =============================================================================
console.log('\n[4] frontend getXpInCurrentLevel / getXpProgress / getXpSpanForLevel');

// L1 character with 75 XP (cumulative) — shows 75/100 in the bar
eq(feGetXpInCurrentLevel(1, 75), 75, 'L1, xp=75 → in-level 75');
eq(feGetXpSpanForLevel(1), 100, 'L1 → span 100 (= L2 threshold - L1 threshold)');
near(feGetXpProgress(1, 75), 0.75, 0.0001, 'L1, xp=75 → progress 0.75');

// The Sx_v5.1 case: L2 with cumulative 167 XP. Display: 67/200 toward L3.
eq(feGetXpInCurrentLevel(2, 167), 67, 'L2, xp=167 cumulative → in-level 67');
eq(feGetXpSpanForLevel(2), 200, 'L2 → span 200 (300 - 100)');
near(feGetXpProgress(2, 167), 67 / 200, 0.0001, 'L2, xp=167 → progress 67/200');

// Boundary: L3 entry (cumulative 300) reads as 0 in L3.
eq(feGetXpInCurrentLevel(3, 300), 0, 'L3, xp=300 → in-level 0 (just hit threshold)');
near(feGetXpProgress(3, 300), 0, 0.0001, 'L3, xp=300 → progress 0');

// Mid-game sanity: L10 with cumulative 60_000 → 10_000/30_000 toward L11
eq(feGetXpInCurrentLevel(10, 60_000), 10_000, 'L10, xp=60k → in-level 10k');
eq(feGetXpSpanForLevel(10), 30_000, 'L10 → span 30_000');
near(feGetXpProgress(10, 60_000), 10_000 / 30_000, 0.0001, 'L10, xp=60k → progress 1/3');

// MAX cap: progress always 1, no span
eq(feGetXpInCurrentLevel(20, 1_500_000), 0, 'L20 → in-level 0 (no further band)');
eq(feGetXpSpanForLevel(20), 0, 'L20 → span 0');
near(feGetXpProgress(20, 1_500_000), 1, 0.0001, 'L20 → progress 1.0');

// =============================================================================
// 5 — End-to-end: simulate a fresh L1 character winning ~3 ranked fights
// =============================================================================
console.log('\n[5] end-to-end — fresh L1 winning ~3 equal-rated ranked fights');
{
  const c = mkChar(1, 0, 0);
  // Each equal-rated win: 50 XP. After 1 fight: 50 (still L1). After 2: 100 (L2). After 3: 150 (L2, in-level 50).
  applyXp(c, 50);
  eq(c.level, 1, 'after 1 win @ 50 XP → still L1');
  applyXp(c, 50);
  eq(c.level, 2, 'after 2 wins → L2 (cumulative 100 = threshold)');
  eq(c.unallocatedPoints, 3, 'after 2 wins → +3 unalloc');
  applyXp(c, 50);
  eq(c.level, 2, 'after 3 wins → still L2 (cumulative 150 < L3 threshold 300)');
  eq(c.xp, 150, 'after 3 wins → cumulative xp 150');
  // Frontend display would be 50/200 toward L3
  eq(feGetXpInCurrentLevel(c.level, c.xp), 50, 'display: 50 in-level XP');
  eq(feGetXpSpanForLevel(c.level), 200, 'display: 200 span to L3');
}

// =============================================================================
// Summary
// =============================================================================
console.log();
console.log(`${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
