/**
 * Level-up modal gauntlet — pure unit tests, no React render.
 *
 *   $ cd server && npx tsx ../scripts/qa-level-up-modal.ts
 *
 * Regression-locks Bucket 2 Fix 3 (2026-05-04): when a character
 * crosses an XP threshold during a fight, the server emits
 * `character_leveled_up`; the reducer parks the event in
 * `state.levelUpEvent`; the modal renders the celebration with an
 * Allocate-Stat-Points CTA — but only when no active fight is in
 * progress (otherwise queue until the fight ends).
 *
 * Pure pieces under test:
 *   - shouldRenderLevelUp(event, fight) — gating decision
 *   - formatLevelUpHeadline / Body / PointsLine — display formatting
 *   - isValidLevelUpEvent — defensive payload validator
 *   - reducer SET_LEVEL_UP_EVENT merge logic for multi-burst
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  shouldRenderLevelUp,
  formatLevelUpHeadline,
  formatLevelUpBody,
  formatPointsLine,
  isValidLevelUpEvent,
  mergeLevelUpEvent,
  type LevelUpEvent,
} from '../frontend/src/lib/level-up-display';

let passes = 0;
let failures = 0;

function ok(label: string): void { passes++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`); }
function fail(label: string, detail: string): void { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`); }
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) ok(label);
  else fail(label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function truthy(cond: unknown, label: string, detail = 'expected truthy'): void {
  if (cond) ok(label); else fail(label, detail);
}
function section(name: string): void { console.log(`\n\x1b[1m▸ ${name}\x1b[0m`); }

const FIGHT_ID = 'fight-abc';
const SAMPLE_EVENT: LevelUpEvent = {
  oldLevel: 5,
  newLevel: 6,
  pointsGranted: 3,
  newTotalUnallocated: 3,
  fightId: FIGHT_ID,
};

// ============================================================================
// shouldRenderLevelUp — gating decision tree
// ============================================================================

function testShouldRenderNoEvent(): void {
  section('shouldRenderLevelUp — no event → null');
  eq(shouldRenderLevelUp(null, null), null, 'event=null → null');
  eq(shouldRenderLevelUp(null, { id: FIGHT_ID }), null, 'event=null + fight → null');
}

function testShouldRenderActiveFight(): void {
  section('shouldRenderLevelUp — active fight → queue (return null)');
  const r = shouldRenderLevelUp(SAMPLE_EVENT, { id: FIGHT_ID });
  eq(r, null, 'fight present → null (queue)');
}

function testShouldRenderIdle(): void {
  section('shouldRenderLevelUp — idle (no fight) → render');
  const r = shouldRenderLevelUp(SAMPLE_EVENT, null);
  truthy(r === SAMPLE_EVENT, 'returns the event verbatim');
}

// ============================================================================
// Headline / body / points formatting
// ============================================================================

function testHeadlineSingleLevel(): void {
  section('formatLevelUpHeadline — single level → "Level Up!"');
  eq(formatLevelUpHeadline(SAMPLE_EVENT), 'Level Up!', '5→6 → "Level Up!"');
}

function testHeadlineMultiLevel(): void {
  section('formatLevelUpHeadline — multi-level → "Level Up xN!"');
  eq(formatLevelUpHeadline({ ...SAMPLE_EVENT, oldLevel: 5, newLevel: 7 }),
    'Level Up x2!', '5→7 → "Level Up x2!"');
  eq(formatLevelUpHeadline({ ...SAMPLE_EVENT, oldLevel: 1, newLevel: 5 }),
    'Level Up x4!', '1→5 → "Level Up x4!"');
}

function testHeadlineSameLevel(): void {
  section('formatLevelUpHeadline — same level (defensive) → "Level Up!"');
  // shouldn't happen in practice (server only emits on actual level-up),
  // but the predicate degrades gracefully.
  eq(formatLevelUpHeadline({ ...SAMPLE_EVENT, oldLevel: 5, newLevel: 5 }),
    'Level Up!', 'no panic on weird input');
}

function testBody(): void {
  section('formatLevelUpBody — "You reached Level N."');
  eq(formatLevelUpBody(SAMPLE_EVENT), 'You reached Level 6.', '5→6 body');
  eq(formatLevelUpBody({ ...SAMPLE_EVENT, oldLevel: 9, newLevel: 12 }),
    'You reached Level 12.', '9→12 body');
}

function testPointsExactMatch(): void {
  section('formatPointsLine — earned == total → simple form');
  eq(formatPointsLine(SAMPLE_EVENT), '+3 stat points to allocate.',
    'no prior unspent → simple');
  eq(formatPointsLine({ ...SAMPLE_EVENT, pointsGranted: 1, newTotalUnallocated: 1 }),
    '+1 stat point to allocate.', 'singular form when granted=1');
}

function testPointsHasPrior(): void {
  section('formatPointsLine — earned < total → mention prior unspent');
  const e: LevelUpEvent = { ...SAMPLE_EVENT, pointsGranted: 3, newTotalUnallocated: 8 };
  const line = formatPointsLine(e);
  truthy(line.includes('+3'), `mentions earned: ${line}`);
  truthy(line.includes('8'), `mentions total 8: ${line}`);
  truthy(line.toLowerCase().includes('total') || line.toLowerCase().includes('available'),
    `explains the difference: ${line}`);
}

// ============================================================================
// isValidLevelUpEvent — defensive validation
// ============================================================================

function testValidatorAcceptsValid(): void {
  section('isValidLevelUpEvent — accepts well-formed payload');
  eq(isValidLevelUpEvent(SAMPLE_EVENT), true, 'sample event valid');
  eq(isValidLevelUpEvent({ ...SAMPLE_EVENT, fightId: undefined }), true,
    'fightId is optional');
}

function testValidatorRejects(): void {
  section('isValidLevelUpEvent — rejects malformed payloads');
  eq(isValidLevelUpEvent(null), false, 'null → false');
  eq(isValidLevelUpEvent('not an object'), false, 'string → false');
  eq(isValidLevelUpEvent({}), false, 'empty → false');
  eq(isValidLevelUpEvent({ ...SAMPLE_EVENT, oldLevel: 0 }), false, 'oldLevel<1 → false');
  eq(isValidLevelUpEvent({ ...SAMPLE_EVENT, newLevel: 0 }), false, 'newLevel<1 → false');
  eq(isValidLevelUpEvent({ ...SAMPLE_EVENT, oldLevel: 7, newLevel: 5 }), false,
    'newLevel < oldLevel → false');
  eq(isValidLevelUpEvent({ ...SAMPLE_EVENT, pointsGranted: -1 }), false,
    'negative points → false');
  eq(isValidLevelUpEvent({ ...SAMPLE_EVENT, pointsGranted: 5, newTotalUnallocated: 3 }), false,
    'total < granted → false');
}

// ============================================================================
// mergeLevelUpEvent — multi-burst handling
// ============================================================================

function testMergeFirstEvent(): void {
  section('mergeLevelUpEvent — first event (no prior) → returns next verbatim');
  const r = mergeLevelUpEvent(null, SAMPLE_EVENT);
  eq(r.oldLevel, 5, 'oldLevel = 5');
  eq(r.newLevel, 6, 'newLevel = 6');
  eq(r.pointsGranted, 3, 'pointsGranted = 3');
  eq(r.fightId, FIGHT_ID, 'fightId carried');
}

function testMergeSequentialFights(): void {
  section('mergeLevelUpEvent — two fights cross thresholds back-to-back');
  // Player at Lv5 wins fight A (→Lv6), then immediately fight B (→Lv7)
  // before the first modal has rendered. Merge into a single "Lv5→Lv7"
  // celebration instead of stacking modals.
  const a: LevelUpEvent = { oldLevel: 5, newLevel: 6, pointsGranted: 3, newTotalUnallocated: 3, fightId: 'fight-A' };
  const b: LevelUpEvent = { oldLevel: 6, newLevel: 7, pointsGranted: 3, newTotalUnallocated: 6, fightId: 'fight-B' };
  const r = mergeLevelUpEvent(a, b);

  eq(r.oldLevel, 5, 'oldLevel = MIN(5, 6) = 5');
  eq(r.newLevel, 7, 'newLevel = MAX(6, 7) = 7');
  eq(r.pointsGranted, 6, 'pointsGranted = 3 + 3');
  eq(r.newTotalUnallocated, 6, 'total = latest payload (chain truth)');
  eq(r.fightId, 'fight-B', 'fightId = most recent');

  // The merged celebration headline spans 5→7.
  eq(formatLevelUpHeadline(r), 'Level Up x2!', 'merged headline spans both levels');
}

function testMergeMultiLevelSingleFight(): void {
  section('mergeLevelUpEvent — single fight grants multiple levels');
  // E.g. a Lv1 character winning a high-XP fight could jump to Lv3+ in
  // one tx. The chain reports newLevel=3 directly (no merge needed),
  // but if it does merge with a follow-up event, the math should hold.
  const single: LevelUpEvent = { oldLevel: 1, newLevel: 4, pointsGranted: 9, newTotalUnallocated: 9 };
  const r = mergeLevelUpEvent(null, single);
  eq(r.newLevel - r.oldLevel, 3, 'levelsGained = 3');
  eq(formatLevelUpHeadline(r), 'Level Up x3!', 'multi-level headline');
}

function testMergePreservesFightIdFallback(): void {
  section('mergeLevelUpEvent — fightId fallback to prev when next has none');
  const a: LevelUpEvent = { oldLevel: 5, newLevel: 6, pointsGranted: 3, newTotalUnallocated: 3, fightId: 'fight-A' };
  const b: LevelUpEvent = { oldLevel: 6, newLevel: 7, pointsGranted: 3, newTotalUnallocated: 6 }; // no fightId
  const r = mergeLevelUpEvent(a, b);
  eq(r.fightId, 'fight-A', 'falls back to prev when next has none');
}

// ============================================================================
// Integration — predicate flow simulation (no React, no reducer)
// ============================================================================

function testIntegrationDuringFightThenIdle(): void {
  section('Integration — level-up during fight queues, surfaces post-fight');
  // Simulate the in-store flow purely via shouldRenderLevelUp:
  //   1. event arrives mid-fight
  //   2. modal does NOT render (fight active)
  //   3. fight ends
  //   4. modal renders with the same event

  const event = SAMPLE_EVENT;
  const fight = { id: FIGHT_ID };

  eq(shouldRenderLevelUp(event, fight), null, 'mid-fight → null (queue)');
  eq(shouldRenderLevelUp(event, null), event, 'post-fight → event surfaces');
}

function testIntegrationMultiBurstReducerShape(): void {
  section('Integration — back-to-back events without modal dismissal');
  // Player wins fight A → event a parked. Modal queued because still in
  // fight transition. Player wins fight B before modal renders → event b
  // arrives. Reducer (in production) calls mergeLevelUpEvent(a, b).
  // Final modal celebrates the full Lv5→Lv7 jump.

  const a: LevelUpEvent = { oldLevel: 5, newLevel: 6, pointsGranted: 3, newTotalUnallocated: 3 };
  const b: LevelUpEvent = { oldLevel: 6, newLevel: 7, pointsGranted: 3, newTotalUnallocated: 6 };

  let stored: LevelUpEvent | null = null;
  stored = mergeLevelUpEvent(stored, a);
  stored = mergeLevelUpEvent(stored, b);

  eq(stored.newLevel, 7, 'final newLevel = 7');
  eq(stored.oldLevel, 5, 'final oldLevel = 5');
  eq(stored.pointsGranted, 6, '6 points to allocate (cumulative)');
  eq(formatLevelUpHeadline(stored), 'Level Up x2!', 'celebration spans both');
}

// ============================================================================
// Runner
// ============================================================================

function run(): void {
  console.log('\n──────────────────────────────────────────────────');
  console.log(' qa-level-up-modal.ts — Bucket 2 Fix 3 (celebration modal)');
  console.log('──────────────────────────────────────────────────');

  // Gating predicate
  testShouldRenderNoEvent();
  testShouldRenderActiveFight();
  testShouldRenderIdle();

  // Formatting
  testHeadlineSingleLevel();
  testHeadlineMultiLevel();
  testHeadlineSameLevel();
  testBody();
  testPointsExactMatch();
  testPointsHasPrior();

  // Defensive validation
  testValidatorAcceptsValid();
  testValidatorRejects();

  // Merge logic (multi-burst handling)
  testMergeFirstEvent();
  testMergeSequentialFights();
  testMergeMultiLevelSingleFight();
  testMergePreservesFightIdFallback();

  // End-to-end predicate flow
  testIntegrationDuringFightThenIdle();
  testIntegrationMultiBurstReducerShape();

  const total = passes + failures;
  console.log('\n──────────────────────────────────────────────────');
  if (failures === 0) {
    console.log(` \x1b[32m✓ ${passes}/${total} PASS\x1b[0m`);
  } else {
    console.log(` \x1b[31m✗ ${failures}/${total} FAIL\x1b[0m  (${passes} pass)`);
  }
  console.log('──────────────────────────────────────────────────\n');

  if (failures > 0) process.exit(1);
}

run();
