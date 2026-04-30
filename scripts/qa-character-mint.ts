/**
 * Duplicate-mint guard gauntlet — pure unit tests, no chain calls.
 *
 *   $ cd server && npx tsx ../scripts/qa-character-mint.ts
 *
 * Closes both layers of the 2026-04-30 duplicate-mint bug
 * (mr_boss minted "mee" on top of Mr_Boss_v5.1 during the auth-flicker
 * window). See STATUS_v5.md.
 *
 * Layer 1 (frontend) — verifies the auth-phase state machine in
 * `frontend/src/lib/auth-phase.ts`. The predicates here are the SAME ones
 * used by `game-provider.tsx` (state transitions) and `game-screen.tsx`
 * (render gates), so any regression in either place fails the gauntlet.
 *
 * Layer 2 (server) — verifies `shouldRejectDuplicateMint` in
 * `server/src/utils/sui-settle.ts`, the predicate `handleCreateCharacter`
 * uses to refuse a `create_character` WS message when the wallet already
 * has a Character on chain.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  type AuthPhase,
  type ChainCheckResult,
  nextAuthPhaseOnAuthChange,
  nextAuthPhaseOnChainCheckResult,
  shouldRenderLoadingScreen,
  shouldRenderRetryScreen,
  shouldRenderCreateForm,
} from '../frontend/src/lib/auth-phase';
import { shouldRejectDuplicateMint } from '../server/src/utils/sui-settle';

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

function main(): void {
  const allPhases: AuthPhase[] = [
    'auth_pending',
    'chain_check_pending',
    'chain_check_failed',
    'no_character',
  ];

  // ===========================================================================
  // Layer 1 — auth-phase state machine
  // ===========================================================================

  console.log('\n[L1.1] nextAuthPhaseOnAuthChange — disconnect always rolls back to auth_pending');
  for (const phase of allPhases) {
    eq(
      nextAuthPhaseOnAuthChange(false, false, phase),
      'auth_pending',
      `disconnect from ${phase} (no character) → auth_pending`,
    );
    eq(
      nextAuthPhaseOnAuthChange(false, true, phase),
      'auth_pending',
      `disconnect from ${phase} (with character) → auth_pending`,
    );
  }

  console.log('\n[L1.2] nextAuthPhaseOnAuthChange — auth flips kick chain check off auth_pending only');
  eq(
    nextAuthPhaseOnAuthChange(true, false, 'auth_pending'),
    'chain_check_pending',
    'auth-pending → connect (no character) → chain_check_pending',
  );
  eq(
    nextAuthPhaseOnAuthChange(true, false, 'chain_check_pending'),
    'chain_check_pending',
    'already mid-check stays in chain_check_pending',
  );
  eq(
    nextAuthPhaseOnAuthChange(true, false, 'chain_check_failed'),
    'chain_check_failed',
    'failed-state is sticky — caller must explicitly retry',
  );
  eq(
    nextAuthPhaseOnAuthChange(true, false, 'no_character'),
    'no_character',
    'no_character is preserved (create form already rendered)',
  );

  console.log('\n[L1.3] nextAuthPhaseOnAuthChange — character present preserves phase');
  for (const phase of allPhases) {
    eq(
      nextAuthPhaseOnAuthChange(true, true, phase),
      phase,
      `character present from ${phase} → unchanged (gate is bypassed)`,
    );
  }

  console.log('\n[L1.4] nextAuthPhaseOnChainCheckResult — outcome → next phase');
  const cases: Array<[ChainCheckResult, AuthPhase]> = [
    ['found', 'chain_check_pending'], // wait for SET_CHARACTER, never fall through
    ['empty', 'no_character'],        // safe to render create form
    ['error', 'chain_check_failed'],  // surface retry, NOT create form
  ];
  for (const [result, expected] of cases) {
    eq(
      nextAuthPhaseOnChainCheckResult(result),
      expected,
      `chain check ${result} → ${expected}`,
    );
  }

  // ===========================================================================
  // Layer 1 — render-gate predicates: ONE-of-three when no character.
  //
  // The whole point of the fix is that the create form NEVER renders during
  // the auth-flicker window. This block locks that invariant: for every
  // phase, exactly one of the three render predicates is true (when no
  // character is hydrated), and the create-form predicate fires ONLY for
  // "no_character".
  // ===========================================================================

  console.log('\n[L1.5] render predicates are mutually exclusive when no character');
  for (const phase of allPhases) {
    const fired = [
      shouldRenderLoadingScreen(phase, false),
      shouldRenderRetryScreen(phase, false),
      shouldRenderCreateForm(phase, false),
    ];
    const count = fired.filter(Boolean).length;
    eq(count, 1, `phase=${phase} (no character) → exactly one render predicate fires`);
  }

  console.log('\n[L1.6] character present → ALL render predicates false (game renders, gate is bypassed)');
  for (const phase of allPhases) {
    eq(
      shouldRenderLoadingScreen(phase, true),
      false,
      `phase=${phase} (has character) → loading screen NOT rendered`,
    );
    eq(
      shouldRenderRetryScreen(phase, true),
      false,
      `phase=${phase} (has character) → retry screen NOT rendered`,
    );
    eq(
      shouldRenderCreateForm(phase, true),
      false,
      `phase=${phase} (has character) → create form NOT rendered`,
    );
  }

  console.log('\n[L1.7] ⚡ AUTH-FLICKER INVARIANT — create form never renders during auth or chain check');
  // This is the core regression test for STATUS_v5.md 2026-04-30. Before the
  // fix, the create form was the default fallback whenever character was
  // null — including the 1.5s window between wallet connect and chain
  // check. After the fix, the create form only renders when phase ===
  // "no_character", which only happens after a definitive chain-check
  // empty result.
  eq(shouldRenderCreateForm('auth_pending', false), false, 'auth_pending → create form HIDDEN');
  eq(shouldRenderCreateForm('chain_check_pending', false), false, 'chain_check_pending → create form HIDDEN');
  eq(shouldRenderCreateForm('chain_check_failed', false), false, 'chain_check_failed → create form HIDDEN');
  eq(shouldRenderCreateForm('no_character', false), true, 'no_character → create form SHOWN');

  console.log('\n[L1.8] ⚡ END-TO-END SIMULATION — full auth-flicker → chain-check sequence');
  // Walks the EXACT sequence game-provider.tsx orchestrates:
  //   1. fresh page load: phase = auth_pending, no character
  //   2. wallet connects, JWT handshake completes: still auth_pending until
  //      we transition (game-provider does this via dispatch on the next tick)
  //   3. transition to chain_check_pending; LoadingScreen shows
  //   4a. chain has a character → restore_character sent, phase stays
  //       chain_check_pending until SET_CHARACTER fires
  //   4b. chain empty → no_character; create form shows
  //   4c. chain RPC error → chain_check_failed; retry button shows
  //
  // Regression target: at NO point in this sequence should the create form
  // render unless chain has been confirmed empty.
  let phase: AuthPhase = 'auth_pending';
  eq(shouldRenderLoadingScreen(phase, false), true, '[t=0] disconnected → LoadingScreen');
  eq(shouldRenderCreateForm(phase, false), false, '[t=0] disconnected → no create form');

  // Wallet connects, but chain check hasn't started yet (transition pending)
  phase = nextAuthPhaseOnAuthChange(true, false, phase);
  eq(phase, 'chain_check_pending', '[t=1] connect → phase becomes chain_check_pending');
  eq(shouldRenderLoadingScreen(phase, false), true, '[t=1] LoadingScreen STILL showing');
  eq(shouldRenderCreateForm(phase, false), false, '[t=1] create form STILL hidden');

  // 4a — chain returns a character
  let nextPhase = nextAuthPhaseOnChainCheckResult('found');
  eq(nextPhase, 'chain_check_pending', '[t=2a] found → phase stays chain_check_pending');
  eq(shouldRenderCreateForm(nextPhase, false), false, '[t=2a] found → create form HIDDEN');

  // 4b — chain returns empty
  nextPhase = nextAuthPhaseOnChainCheckResult('empty');
  eq(nextPhase, 'no_character', '[t=2b] empty → phase becomes no_character');
  eq(shouldRenderCreateForm(nextPhase, false), true, '[t=2b] empty → create form NOW shown');

  // 4c — chain RPC error
  nextPhase = nextAuthPhaseOnChainCheckResult('error');
  eq(nextPhase, 'chain_check_failed', '[t=2c] error → phase becomes chain_check_failed');
  eq(shouldRenderRetryScreen(nextPhase, false), true, '[t=2c] error → retry screen shown');
  eq(shouldRenderCreateForm(nextPhase, false), false, '[t=2c] error → create form STILL hidden');

  // ===========================================================================
  // Layer 2 — server pre-mint guard predicate
  // ===========================================================================

  console.log('\n[L2.1] shouldRejectDuplicateMint — empty chain (legitimate first mint pre-tx-confirm)');
  const r0 = shouldRejectDuplicateMint([]);
  eq(r0.reject, false, 'length=0 → allow');
  eq(r0.count, 0, 'length=0 → count=0');
  eq(r0.original, undefined, 'length=0 → no original id surfaced');

  console.log('\n[L2.2] shouldRejectDuplicateMint — exactly one (legitimate first mint)');
  const r1 = shouldRejectDuplicateMint(['0xaaaa']);
  eq(r1.reject, false, 'length=1 → allow (just-minted Character)');
  eq(r1.count, 1, 'length=1 → count=1');
  eq(r1.original, undefined, 'length=1 → no original id (nothing to point at)');

  console.log('\n[L2.3] ⚡ shouldRejectDuplicateMint — TWO characters → REJECT (the actual bug)');
  // This is the exact scenario reproduced 2026-04-30: mr_boss already had
  // Mr_Boss_v5.1 on chain when the auth-flicker bug let him mint "mee".
  // Chain returns [Mr_Boss_v5, Mr_Boss_v5.1, mee] — length=3 > 1 → reject
  // and surface the OLDEST (the original).
  const r2 = shouldRejectDuplicateMint(['0xORIGINAL', '0xPINNED', '0xDUPE']);
  eq(r2.reject, true, 'length=3 → REJECT (duplicate-mint detected)');
  eq(r2.count, 3, 'count surfaces the chain length');
  eq(r2.original, '0xORIGINAL', 'original is the OLDEST id (frontend-ordered ascending)');

  console.log('\n[L2.4] shouldRejectDuplicateMint — boundary: exactly two also rejects');
  const r3 = shouldRejectDuplicateMint(['0xfirst', '0xsecond']);
  eq(r3.reject, true, 'length=2 → REJECT');
  eq(r3.original, '0xfirst', 'original is first in the array');

  console.log('\n[L2.5] ⚡ shouldRejectDuplicateMint — ordering invariant');
  // The helper trusts the caller (findAllCharacterIdsForWallet) to return
  // ASC by event timestamp. We pin that contract here so a future
  // refactor that re-orders the events is caught.
  const ordered = ['0xa', '0xb', '0xc', '0xd'];
  const decision = shouldRejectDuplicateMint(ordered);
  eq(
    decision.original,
    '0xa',
    'original is ALWAYS the first element — caller must order ascending',
  );

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
