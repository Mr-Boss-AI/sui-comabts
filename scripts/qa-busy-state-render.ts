/**
 * Busy-state render-slot gauntlet — pure unit tests, no React render.
 *
 *   $ cd server && npx tsx ../scripts/qa-busy-state-render.ts
 *
 * Locks the Bucket 2 polish (2026-05-04): hide irrelevant fight-mode
 * cards when the player is busy, instead of greying them out with a
 * banner. The active state (open wager + Cancel, "Finding opponent…",
 * etc.) is self-explanatory; cluttering the UI with disabled cards
 * adds noise without information.
 *
 * Pure under test: `decideMatchmakingRender` from
 * `frontend/src/lib/busy-state.ts`. Returns four boolean slots:
 *   - showFightTypes
 *   - showWagerCreate
 *   - showWagerLobby
 *   - showEnterQueueButton
 *
 * The matchmaking-queue.tsx component drives JSX from these flags.
 * Server-side `evaluateServerBusy` and `handleQueueFight` gating stay
 * exactly as they were (defense in depth, never trust client) — those
 * tests are in `qa-multi-queue-isolation.ts` and stay untouched.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  decideMatchmakingRender,
  type MatchmakingRenderSlots,
  type BusyKind,
} from '../frontend/src/lib/busy-state';

let passes = 0;
let failures = 0;

function ok(label: string): void { passes++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`); }
function fail(label: string, detail: string): void { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`); }
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) ok(label);
  else fail(label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function deepEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, `\n          actual=${JSON.stringify(actual)}\n          expected=${JSON.stringify(expected)}`);
}
function section(name: string): void { console.log(`\n\x1b[1m▸ ${name}\x1b[0m`); }

// ============================================================================
// Idle (busyKind === "none") — full UX based on selectedFightType
// ============================================================================

function testIdleFriendly(): void {
  section('idle + friendly → fight types + Enter Queue, no wager UI');
  const r = decideMatchmakingRender({ busyKind: 'none', selectedFightType: 'friendly' });
  deepEq(r, {
    showFightTypes: true,
    showWagerCreate: false,
    showWagerLobby: false,
    showEnterQueueButton: true,
  }, 'idle+friendly slots');
}

function testIdleRanked(): void {
  section('idle + ranked → fight types + Enter Queue, no wager UI');
  const r = decideMatchmakingRender({ busyKind: 'none', selectedFightType: 'ranked' });
  deepEq(r, {
    showFightTypes: true,
    showWagerCreate: false,
    showWagerLobby: false,
    showEnterQueueButton: true,
  }, 'idle+ranked slots');
}

function testIdleWager(): void {
  section('idle + wager → fight types + create form + lobby, no Enter Queue');
  const r = decideMatchmakingRender({ busyKind: 'none', selectedFightType: 'wager' });
  deepEq(r, {
    showFightTypes: true,
    showWagerCreate: true,
    showWagerLobby: true,
    showEnterQueueButton: false,
  }, 'idle+wager slots');
}

function testIdleUnknownFightType(): void {
  section('idle + unknown fight type → falls through to non-wager branch');
  // FightType union includes "item_stake" which is server-side-only and
  // doesn't surface in the matchmaking UI — predicate degrades gracefully.
  const r = decideMatchmakingRender({ busyKind: 'none', selectedFightType: 'item_stake' });
  eq(r.showFightTypes, true, 'fight types still render');
  eq(r.showWagerCreate, false, 'no wager create');
  eq(r.showWagerLobby, false, 'no wager lobby');
  eq(r.showEnterQueueButton, true, 'Enter Queue button shows');
}

// ============================================================================
// Busy: ownWager — show ONLY the wager lobby
// ============================================================================

function testOwnWagerWithFriendlySelected(): void {
  section('ownWager + friendly selected → only the lobby');
  const r = decideMatchmakingRender({ busyKind: 'ownWager', selectedFightType: 'friendly' });
  deepEq(r, {
    showFightTypes: false,
    showWagerCreate: false,
    showWagerLobby: true,
    showEnterQueueButton: false,
  }, 'ownWager+friendly → lobby-only');
}

function testOwnWagerWithRankedSelected(): void {
  section('ownWager + ranked selected → only the lobby (selectedType irrelevant)');
  const r = decideMatchmakingRender({ busyKind: 'ownWager', selectedFightType: 'ranked' });
  deepEq(r, {
    showFightTypes: false,
    showWagerCreate: false,
    showWagerLobby: true,
    showEnterQueueButton: false,
  }, 'ownWager+ranked → lobby-only');
}

function testOwnWagerWithWagerSelected(): void {
  section('ownWager + wager selected → still only the lobby (no create form, they already have one)');
  const r = decideMatchmakingRender({ busyKind: 'ownWager', selectedFightType: 'wager' });
  eq(r.showWagerCreate, false, 'create form hidden — already have own wager');
  eq(r.showWagerLobby, true, 'lobby shown');
  eq(r.showFightTypes, false, 'fight type cards hidden');
  eq(r.showEnterQueueButton, false, 'Enter Queue hidden');
}

// ============================================================================
// Busy: kinds handled by parent (fight, fightQueue, pendingWagerAccept) →
// predicate returns all-false defensively
// ============================================================================

function testFightKind(): void {
  section('busyKind === "fight" → predicate all-false (game-screen routes elsewhere)');
  const r = decideMatchmakingRender({ busyKind: 'fight', selectedFightType: 'friendly' });
  deepEq(r, {
    showFightTypes: false, showWagerCreate: false,
    showWagerLobby: false, showEnterQueueButton: false,
  }, 'fight kind → all-false');
}

function testFightQueueKind(): void {
  section('busyKind === "fightQueue" → all-false (parent\'s "Finding opponent…" panel)');
  // The matchmaking-queue.tsx early-return for `fightQueue` renders the
  // queued-status panel; predicate would never actually be consulted in
  // production. Defensive all-false is the safe default.
  const r = decideMatchmakingRender({ busyKind: 'fightQueue', selectedFightType: 'wager' });
  deepEq(r, {
    showFightTypes: false, showWagerCreate: false,
    showWagerLobby: false, showEnterQueueButton: false,
  }, 'fightQueue kind → all-false');
}

function testPendingWagerAcceptKind(): void {
  section('busyKind === "pendingWagerAccept" → all-false (ChallengePopup is modal)');
  const r = decideMatchmakingRender({ busyKind: 'pendingWagerAccept', selectedFightType: 'wager' });
  deepEq(r, {
    showFightTypes: false, showWagerCreate: false,
    showWagerLobby: false, showEnterQueueButton: false,
  }, 'pendingWagerAccept → all-false');
}

// ============================================================================
// Invariants — properties that must hold across all inputs
// ============================================================================

function testInvariants(): void {
  section('Invariants across all (busyKind, fightType) combinations');

  const allKinds: BusyKind[] = ['none', 'fight', 'ownWager', 'fightQueue', 'pendingWagerAccept'];
  const fightTypes = ['friendly', 'ranked', 'wager', 'item_stake'];

  for (const kind of allKinds) {
    for (const ft of fightTypes) {
      const r = decideMatchmakingRender({ busyKind: kind, selectedFightType: ft });
      const tag = `(${kind}, ${ft})`;

      // Inv 1: showWagerCreate implies showWagerLobby. Otherwise the
      // player would create a wager and immediately not see it.
      if (r.showWagerCreate && !r.showWagerLobby) {
        fail(`Inv ${tag}: showWagerCreate without showWagerLobby`, JSON.stringify(r));
      }

      // Inv 2: showFightTypes && showEnterQueueButton XOR showWagerCreate.
      // Either you're in non-wager idle (Enter Queue) or wager idle
      // (Create), never both, never neither — when fight types are
      // visible.
      if (r.showFightTypes) {
        const exactlyOne = (r.showEnterQueueButton ? 1 : 0) + (r.showWagerCreate ? 1 : 0);
        if (exactlyOne !== 1) {
          fail(`Inv ${tag}: showFightTypes implies exactly one of {EnterQueue, WagerCreate}`, JSON.stringify(r));
        }
      }

      // Inv 3: Enter Queue button only when fight types are showing
      // (it's a sibling of the selector).
      if (r.showEnterQueueButton && !r.showFightTypes) {
        fail(`Inv ${tag}: showEnterQueueButton without showFightTypes`, JSON.stringify(r));
      }

      // Inv 4: Non-"none", non-"ownWager" kinds render nothing.
      if (kind !== 'none' && kind !== 'ownWager') {
        if (r.showFightTypes || r.showWagerCreate || r.showWagerLobby || r.showEnterQueueButton) {
          fail(`Inv ${tag}: non-(none|ownWager) kind should render nothing`, JSON.stringify(r));
        }
      }
    }
  }
  // If we got this far without firing fail(), the invariants held.
  ok('all 20 (kind × fightType) combinations satisfy 4 invariants');
}

// ============================================================================
// Bucket 2 polish — concrete user-spec assertions
// ============================================================================

function testUserSpecOwnWagerHidesFightCards(): void {
  section("user spec — when player has open wager, fight cards are HIDDEN (not greyed)");
  const r = decideMatchmakingRender({ busyKind: 'ownWager', selectedFightType: 'wager' });
  eq(r.showFightTypes, false, 'Friendly card hidden');
  eq(r.showWagerCreate, false, 'Wager-create card hidden');
  // (Ranked card hidden is a sub-case of showFightTypes.)
}

function testUserSpecOwnWagerShowsLobby(): void {
  section('user spec — when player has open wager, OPEN WAGERS section visible');
  const r = decideMatchmakingRender({ busyKind: 'ownWager', selectedFightType: 'friendly' });
  eq(r.showWagerLobby, true, 'lobby visible (their wager + Cancel button)');
}

function testUserSpecIdleShowsAll(): void {
  section('user spec — idle player sees full UX');
  const r = decideMatchmakingRender({ busyKind: 'none', selectedFightType: 'wager' });
  eq(r.showFightTypes, true, 'all 3 fight cards visible');
  eq(r.showWagerCreate, true, 'wager create surfaces under wager mode');
  eq(r.showWagerLobby, true, 'lobby browseable under wager mode');
}

// ============================================================================
// Runner
// ============================================================================

function run(): void {
  console.log('\n──────────────────────────────────────────────────');
  console.log(' qa-busy-state-render.ts — Bucket 2 polish');
  console.log('──────────────────────────────────────────────────');

  // Idle states
  testIdleFriendly();
  testIdleRanked();
  testIdleWager();
  testIdleUnknownFightType();

  // ownWager — the headline polish case
  testOwnWagerWithFriendlySelected();
  testOwnWagerWithRankedSelected();
  testOwnWagerWithWagerSelected();

  // Other busy kinds
  testFightKind();
  testFightQueueKind();
  testPendingWagerAcceptKind();

  // Invariants
  testInvariants();

  // User-spec direct
  testUserSpecOwnWagerHidesFightCards();
  testUserSpecOwnWagerShowsLobby();
  testUserSpecIdleShowsAll();

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

// Avoid unused import warning if something gets shaken out.
type _slotsKeepType = MatchmakingRenderSlots;
