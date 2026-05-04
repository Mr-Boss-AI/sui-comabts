/**
 * Multi-queue isolation gauntlet — pure unit tests, no chain calls.
 *
 *   $ cd server && npx tsx ../scripts/qa-multi-queue-isolation.ts
 *
 * Regression-locks the 2026-05-04 cross-mode bug: a player could be in
 * an open wager AND the ranked queue simultaneously. If the ranked
 * queue matched while the wager was still WAITING, a 3rd player could
 * end up paired with a "phantom" wallet already busy in a wager fight.
 *
 *   FIX 1 (frontend) — `computeBusyState` predicate at
 *     `frontend/src/lib/busy-state.ts`. Disables Friendly/Ranked/
 *     Wager-create/Wager-accept whenever the caller has any of:
 *     active fight, own open wager, matchmaking queue entry, or
 *     pending wager-accept tx. Cancel buttons stay enabled so the
 *     player can always exit the busy state.
 *
 *   FIX 1 (server) — `evaluateServerBusy` predicate at
 *     `server/src/ws/busy-state.ts`. Mirror gate applied at the top
 *     of `handleQueueFight`. The wager-accept handler also threads
 *     `callerInMatchmakingQueue` into `decideAcceptOutcome`, which
 *     auto-rolls-back the chain if the accept somehow landed despite
 *     the client gate. Cross-cleanup in the proceed branch removes
 *     both players from the matchmaking queue.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  computeBusyState,
  canCancelOwnState,
  type BusyKind,
} from '../frontend/src/lib/busy-state';
import {
  evaluateServerBusy,
  type ServerBusyKind,
} from '../server/src/ws/busy-state';

const SX      = '0xd05ae8e26e9c239b4888822c83046fe7adaac243f46888ea430d852dafb6e92b';
const M_W     = '0xaaaa11110000000000000000000000000000000000000000000000000000aaaa';
const S_W     = '0xbbbb22220000000000000000000000000000000000000000000000000000bbbb';
const FIGHT_X = 'fight-12345';

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

// ============================================================================
// Frontend predicate — computeBusyState
// ============================================================================

function testFrontendIdle(): void {
  section('computeBusyState — idle baseline');
  const r = computeBusyState({
    callerWallet: SX,
    ownLobbyEntry: null,
    activeFight: null,
    fightQueue: null,
    pendingWagerAccept: null,
  });
  eq(r.busy, false, 'all-null inputs → not busy');
  eq(r.kind, 'none', 'kind = none');
  eq(r.reason, null, 'no reason');
}

function testFrontendNoWallet(): void {
  section('computeBusyState — no wallet (logged-out / pre-auth)');
  const r = computeBusyState({
    callerWallet: null,
    ownLobbyEntry: { wagerMatchId: M_W },
    activeFight: { id: FIGHT_X },
    fightQueue: 'ranked',
    pendingWagerAccept: null,
  });
  eq(r.busy, false, 'no caller → never busy');
  eq(r.kind, 'none', 'kind = none');
}

function testFrontendActiveFight(): void {
  section('computeBusyState — active fight wins priority');
  const r = computeBusyState({
    callerWallet: SX,
    ownLobbyEntry: { wagerMatchId: M_W },
    activeFight: { id: FIGHT_X },
    fightQueue: 'ranked',
    pendingWagerAccept: { wagerMatchId: S_W },
  });
  eq(r.busy, true, 'fight present → busy');
  eq(r.kind, 'fight', 'fight wins priority over wager+queue+accept');
  truthy(r.reason && r.reason.toLowerCase().includes('fight'), `reason mentions fight: ${r.reason}`);
}

function testFrontendOwnWager(): void {
  section('computeBusyState — own wager (no fight)');
  const r = computeBusyState({
    callerWallet: SX,
    ownLobbyEntry: { wagerMatchId: M_W },
    activeFight: null,
    fightQueue: 'ranked',
    pendingWagerAccept: null,
  });
  eq(r.busy, true, 'own wager → busy');
  eq(r.kind, 'ownWager', 'ownWager wins over queue');
  truthy(r.reason && r.reason.toLowerCase().includes('wager'), `reason mentions wager: ${r.reason}`);
}

function testFrontendFightQueue(): void {
  section('computeBusyState — fight queue only');
  const r = computeBusyState({
    callerWallet: SX,
    ownLobbyEntry: null,
    activeFight: null,
    fightQueue: 'friendly',
    pendingWagerAccept: null,
  });
  eq(r.busy, true, 'queue → busy');
  eq(r.kind, 'fightQueue', 'kind = fightQueue');
  truthy(r.reason && r.reason.toLowerCase().includes('queue'), `reason mentions queue: ${r.reason}`);
}

function testFrontendPendingAccept(): void {
  section('computeBusyState — pending wager accept');
  const r = computeBusyState({
    callerWallet: SX,
    ownLobbyEntry: null,
    activeFight: null,
    fightQueue: null,
    pendingWagerAccept: { wagerMatchId: M_W },
  });
  eq(r.busy, true, 'pending accept → busy');
  eq(r.kind, 'pendingWagerAccept', 'kind = pendingWagerAccept');
}

function testCanCancelOwnState(): void {
  section('canCancelOwnState — Cancel/Leave buttons stay enabled');
  const ownWager = computeBusyState({
    callerWallet: SX,
    ownLobbyEntry: { wagerMatchId: M_W },
    activeFight: null,
    fightQueue: null,
    pendingWagerAccept: null,
  });
  const inQueue = computeBusyState({
    callerWallet: SX,
    ownLobbyEntry: null,
    activeFight: null,
    fightQueue: 'ranked',
    pendingWagerAccept: null,
  });

  eq(canCancelOwnState(ownWager, 'ownWager'), true, 'Cancel-wager button stays enabled when own wager');
  eq(canCancelOwnState(ownWager, 'fightQueue'), false, 'Leave-queue button disabled when only own wager');
  eq(canCancelOwnState(inQueue, 'fightQueue'), true, 'Leave-queue stays enabled when queued');
  eq(canCancelOwnState(inQueue, 'ownWager'), false, 'Cancel-wager disabled when only queued');
}

// ============================================================================
// Server predicate — evaluateServerBusy
// ============================================================================

function testServerIdle(): void {
  section('evaluateServerBusy — idle baseline');
  const r = evaluateServerBusy({ hasFight: false, ownWagerId: null, inMatchmakingQueue: false });
  eq(r.busy, false, 'all-false → not busy');
  eq(r.kind, 'none', 'kind = none');
  eq(r.reason, '', 'empty reason when not busy');
}

function testServerFight(): void {
  section('evaluateServerBusy — active fight wins priority');
  const r = evaluateServerBusy({ hasFight: true, ownWagerId: M_W, inMatchmakingQueue: true });
  eq(r.busy, true, 'fight → busy');
  eq(r.kind, 'fight', 'fight beats wager + queue');
}

function testServerOwnWager(): void {
  section('evaluateServerBusy — own wager wins over queue');
  const r = evaluateServerBusy({ hasFight: false, ownWagerId: M_W, inMatchmakingQueue: true });
  eq(r.busy, true, 'own wager → busy');
  eq(r.kind, 'ownWager', 'wager beats queue');
}

function testServerQueue(): void {
  section('evaluateServerBusy — queue alone');
  const r = evaluateServerBusy({ hasFight: false, ownWagerId: null, inMatchmakingQueue: true });
  eq(r.busy, true, 'queue → busy');
  eq(r.kind, 'fightQueue', 'kind = fightQueue');
  truthy(r.reason.toLowerCase().includes('queue'), `reason mentions queue: ${r.reason}`);
}

// ============================================================================
// Cross-checks — frontend + server agree on each scenario
// ============================================================================

interface Scenario {
  name: string;
  // Frontend inputs
  ownLobbyEntry: { wagerMatchId: string } | null;
  activeFight: { id: string } | null;
  fightQueue: string | null;
  pendingWagerAccept: { wagerMatchId: string } | null;
  // Mapped server inputs
  hasFight: boolean;
  ownWagerId: string | null;
  inMatchmakingQueue: boolean;
  // Expected
  busy: boolean;
  kind: BusyKind;       // frontend kind (server kinds are subset)
  serverKind: ServerBusyKind;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'idle',
    ownLobbyEntry: null, activeFight: null, fightQueue: null, pendingWagerAccept: null,
    hasFight: false, ownWagerId: null, inMatchmakingQueue: false,
    busy: false, kind: 'none', serverKind: 'none',
  },
  {
    name: 'wager-only',
    ownLobbyEntry: { wagerMatchId: M_W }, activeFight: null, fightQueue: null, pendingWagerAccept: null,
    hasFight: false, ownWagerId: M_W, inMatchmakingQueue: false,
    busy: true, kind: 'ownWager', serverKind: 'ownWager',
  },
  {
    name: 'queue-only',
    ownLobbyEntry: null, activeFight: null, fightQueue: 'ranked', pendingWagerAccept: null,
    hasFight: false, ownWagerId: null, inMatchmakingQueue: true,
    busy: true, kind: 'fightQueue', serverKind: 'fightQueue',
  },
  {
    name: 'wager + queue (the BUG state)',
    ownLobbyEntry: { wagerMatchId: M_W }, activeFight: null, fightQueue: 'ranked', pendingWagerAccept: null,
    hasFight: false, ownWagerId: M_W, inMatchmakingQueue: true,
    busy: true, kind: 'ownWager', serverKind: 'ownWager',
  },
  {
    name: 'fight in progress',
    ownLobbyEntry: null, activeFight: { id: FIGHT_X }, fightQueue: null, pendingWagerAccept: null,
    hasFight: true, ownWagerId: null, inMatchmakingQueue: false,
    busy: true, kind: 'fight', serverKind: 'fight',
  },
  {
    name: 'fight + lingering queue (race window)',
    ownLobbyEntry: null, activeFight: { id: FIGHT_X }, fightQueue: 'ranked', pendingWagerAccept: null,
    hasFight: true, ownWagerId: null, inMatchmakingQueue: true,
    busy: true, kind: 'fight', serverKind: 'fight',
  },
];

function testCrossAgreement(): void {
  section('Frontend ↔ server agreement on the 6 canonical scenarios');
  for (const s of SCENARIOS) {
    const fe = computeBusyState({
      callerWallet: SX,
      ownLobbyEntry: s.ownLobbyEntry,
      activeFight: s.activeFight,
      fightQueue: s.fightQueue,
      pendingWagerAccept: s.pendingWagerAccept,
    });
    const be = evaluateServerBusy({
      hasFight: s.hasFight,
      ownWagerId: s.ownWagerId,
      inMatchmakingQueue: s.inMatchmakingQueue,
    });
    eq(fe.busy, s.busy, `[${s.name}] frontend busy=${s.busy}`);
    eq(be.busy, s.busy, `[${s.name}] server busy=${s.busy}`);
    eq(fe.kind, s.kind, `[${s.name}] frontend kind=${s.kind}`);
    eq(be.kind, s.serverKind, `[${s.name}] server kind=${s.serverKind}`);
    eq(fe.busy, be.busy, `[${s.name}] frontend.busy === server.busy`);
  }
}

// ============================================================================
// Runner
// ============================================================================

function run(): void {
  console.log('\n──────────────────────────────────────────────────');
  console.log(' qa-multi-queue-isolation.ts — Bucket 2 Fix 1 (cross-mode busy)');
  console.log('──────────────────────────────────────────────────');

  // Frontend predicate
  testFrontendIdle();
  testFrontendNoWallet();
  testFrontendActiveFight();
  testFrontendOwnWager();
  testFrontendFightQueue();
  testFrontendPendingAccept();
  testCanCancelOwnState();

  // Server predicate
  testServerIdle();
  testServerFight();
  testServerOwnWager();
  testServerQueue();

  // Cross-check
  testCrossAgreement();

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
