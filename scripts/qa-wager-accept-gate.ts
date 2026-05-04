/**
 * Wager-accept-gate gauntlet — pure unit tests, no chain calls.
 *
 *   $ cd server && npx tsx ../scripts/qa-wager-accept-gate.ts
 *
 * Regression-locks the 2026-05-04 silent-accept bug in two layers:
 *
 *   FIX A (frontend) — `canAcceptWager` predicate at
 *     `frontend/src/lib/wager-accept-gate.ts`. The Accept button is
 *     disabled when the caller has their own open wager. The
 *     `handleAcceptWager` callback also early-returns BEFORE signing.
 *
 *   FIX B (server) — `decideAcceptOutcome` predicate at
 *     `server/src/ws/wager-accept-gate.ts`. Mirrors the frontend gate +
 *     adds the auto-rollback decision: if the chain says STATUS_ACTIVE
 *     when the late-firing "has own open wager" check trips, both wagers
 *     are admin-cancelled (50/50 split) so neither side stays stuck.
 *
 * Bug background: `arena::accept_wager` has no chain-side "no own open
 * wager" guard; the frontend used to sign before any check; the server's
 * own check fired AFTER the chain tx, by which time the target wager was
 * already STATUS_ACTIVE and `cancel_wager` would abort with code 1
 * (`EMatchNotWaiting`). Verified on chain (WagerAccepted at 12:40, 12:47,
 * 12:53 UTC followed by WagerRefunded 50/50 events 3-5 minutes later from
 * disconnect-cleanup admin-cancel — workaround was hard-refresh).
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { canAcceptWager } from '../frontend/src/lib/wager-accept-gate';
import { decideAcceptOutcome } from '../server/src/ws/wager-accept-gate';

// ===== Pass / fail helpers (mirrors qa-wager-register.ts style) =====
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
function truthy(cond: unknown, label: string, detail = 'expected truthy'): void {
  if (cond) ok(label);
  else fail(label, detail);
}
function section(name: string): void {
  console.log(`\n\x1b[1m▸ ${name}\x1b[0m`);
}

// ===== Fixture wallets =====
const MR_BOSS = '0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624';
const SX      = '0xd05ae8e26e9c239b4888822c83046fe7adaac243f46888ea430d852dafb6e92b';
const M_W = '0xaaaa11110000000000000000000000000000000000000000000000000000aaaa'; // Mr_Boss's wager
const S_W = '0xbbbb22220000000000000000000000000000000000000000000000000000bbbb'; // Sx's wager

// ===== Frontend predicate: canAcceptWager =====

function testCanAcceptWagerHappyPath(): void {
  section('canAcceptWager — happy path');

  // Sx clicks Accept on Mr_Boss's wager when Sx has no open wager.
  const r = canAcceptWager({
    callerWallet: SX,
    targetWagerId: M_W,
    lobby: [{ creatorWallet: MR_BOSS, wagerMatchId: M_W }],
  });
  eq(r.allow, true, 'no own open wager → allow');
  eq(r.reason, undefined, 'no rejection reason');
}

function testCanAcceptWagerOwnOpen(): void {
  section('canAcceptWager — caller has own open wager (the 2026-05-04 bug)');

  // Both Mr_Boss and Sx have open wagers; Sx tries to accept Mr_Boss's.
  const r = canAcceptWager({
    callerWallet: SX,
    targetWagerId: M_W,
    lobby: [
      { creatorWallet: MR_BOSS, wagerMatchId: M_W },
      { creatorWallet: SX,      wagerMatchId: S_W },
    ],
  });
  eq(r.allow, false, 'own open wager → deny');
  truthy(r.reason && r.reason.includes('Cancel your own'), `reason mentions "Cancel your own": ${r.reason}`);
  eq(r.ownWagerId, S_W, 'returns own wager id for diagnostic logging');
}

function testCanAcceptWagerSelfTarget(): void {
  section('canAcceptWager — clicking Accept on own wager (defensive)');

  // The UI surfaces a Cancel button on own cards, not Accept — this case
  // shouldn't normally happen, but the predicate should handle it cleanly.
  const r = canAcceptWager({
    callerWallet: SX,
    targetWagerId: S_W,
    lobby: [{ creatorWallet: SX, wagerMatchId: S_W }],
  });
  eq(r.allow, false, 'self-accept → deny');
  truthy(
    r.reason && r.reason.toLowerCase().includes("can't accept your own"),
    `reason mentions "can't accept your own": ${r.reason}`,
  );
}

function testCanAcceptWagerNoWallet(): void {
  section('canAcceptWager — no wallet connected');

  const blank = canAcceptWager({ callerWallet: '', targetWagerId: M_W, lobby: [] });
  eq(blank.allow, false, 'empty wallet → deny');
  truthy(blank.reason && blank.reason.includes('Connect'), 'reason prompts wallet connect');

  const nul = canAcceptWager({ callerWallet: null, targetWagerId: M_W, lobby: [] });
  eq(nul.allow, false, 'null wallet → deny');

  const undef = canAcceptWager({ callerWallet: undefined, targetWagerId: M_W, lobby: [] });
  eq(undef.allow, false, 'undefined wallet → deny');
}

function testCanAcceptWagerCaseInsensitive(): void {
  section('canAcceptWager — case-insensitive wallet match');

  // dapp-kit sometimes returns checksummed mixed case while the server
  // stores lowercase. The predicate must match either way.
  const upperCaller = SX.toUpperCase();
  const r = canAcceptWager({
    callerWallet: upperCaller,
    targetWagerId: M_W,
    lobby: [
      { creatorWallet: MR_BOSS, wagerMatchId: M_W },
      { creatorWallet: SX.toLowerCase(), wagerMatchId: S_W }, // server lowercase
    ],
  });
  eq(r.allow, false, 'mixed case still detects own wager');
  eq(r.ownWagerId, S_W, 'own wager id is returned regardless of casing');
}

function testCanAcceptWagerEmptyLobby(): void {
  section('canAcceptWager — empty lobby');

  // Edge case: no wagers in the lobby (the target id is therefore stale,
  // but the predicate's job is just "is the caller blocked from accepting"
  // — staleness is the server's job to surface).
  const r = canAcceptWager({
    callerWallet: SX,
    targetWagerId: M_W,
    lobby: [],
  });
  eq(r.allow, true, 'empty lobby → allow (not the predicate\'s concern)');
}

// ===== Server predicate: decideAcceptOutcome =====

function testDecideAcceptOutcomeProceed(): void {
  section('decideAcceptOutcome — happy path');

  // Sx accepts Mr_Boss's wager; Sx has no own. Chain returns ACTIVE (the
  // accept tx already landed). Server should proceed to lobby cleanup +
  // fight start.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 1, // ACTIVE
    callerOwnWagerInLobby: undefined,
    targetInLobby: { creatorWallet: MR_BOSS, wagerMatchId: M_W },
  });
  eq(r.kind, 'proceed', 'chain ACTIVE + no own wager → proceed');
}

function testDecideAcceptOutcomeRejectStaleChain(): void {
  section('decideAcceptOutcome — chain not ACTIVE (frontend race / stale state)');

  // The frontend sent a wager_accepted message but the chain says the
  // wager is still WAITING (status=0) — likely a stale UI message. Reject.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 0, // WAITING
    callerOwnWagerInLobby: undefined,
    targetInLobby: { creatorWallet: MR_BOSS, wagerMatchId: M_W },
  });
  eq(r.kind, 'reject', 'chain not ACTIVE → reject');
  truthy(r.kind === 'reject' && r.reason.toLowerCase().includes('not active'),
    `reason mentions "not active": ${r.kind === 'reject' ? r.reason : ''}`);
}

function testDecideAcceptOutcomeAutoRollback(): void {
  section('decideAcceptOutcome — caller has own open wager + chain ACTIVE (the BUG path)');

  // The exact 2026-05-04 bug: Sx has own open wager; Sx still managed to
  // sign accept_wager(M_W) (e.g. Fix A bypassed); chain is now ACTIVE.
  // The handler must auto-rollback: admin-cancel BOTH wagers (50/50 split
  // for ACTIVE; refund-to-creator for WAITING).
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 1, // ACTIVE — the silent-accept landed
    callerOwnWagerInLobby: { creatorWallet: SX, wagerMatchId: S_W },
    targetInLobby: { creatorWallet: MR_BOSS, wagerMatchId: M_W },
  });
  eq(r.kind, 'autoRollback', 'own wager + chain ACTIVE → autoRollback');
  if (r.kind === 'autoRollback') {
    eq(r.targetWagerId, M_W, 'target wager id surfaced for admin_cancel');
    eq(r.callerOwnWagerId, S_W, 'caller own wager id surfaced for admin_cancel');
    eq(r.removeFromMatchmakingQueue, false, 'no queue drop needed (own wager case)');
    truthy(r.userMessage.includes('rolled back') || r.userMessage.toLowerCase().includes('refund'),
      `user message explains the rollback: ${r.userMessage}`);
  }
}

function testDecideAcceptOutcomeOwnNoChainActive(): void {
  section('decideAcceptOutcome — own wager + chain NOT ACTIVE (gated correctly client-side)');

  // Fix A worked: client-side gate refused the sign, chain never accepted.
  // If by some other path the WS message still arrived, we just reject —
  // no chain rollback needed.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 0, // WAITING — chain didn't accept
    callerOwnWagerInLobby: { creatorWallet: SX, wagerMatchId: S_W },
    targetInLobby: { creatorWallet: MR_BOSS, wagerMatchId: M_W },
  });
  eq(r.kind, 'reject', 'own wager + chain not ACTIVE → plain reject (no rollback)');
  truthy(r.kind === 'reject' && r.reason.toLowerCase().includes('open wager'),
    `reason mentions "open wager": ${r.kind === 'reject' ? r.reason : ''}`);
}

function testDecideAcceptOutcomeAcceptingOwn(): void {
  section('decideAcceptOutcome — caller is creator of target (defensive)');

  // The chain refuses this with ECannotJoinOwnMatch (code 7) — but the
  // server's gate is the first wall, double-defending the case.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: S_W,
    targetChainStatus: 0,
    callerOwnWagerInLobby: { creatorWallet: SX, wagerMatchId: S_W },
    targetInLobby: { creatorWallet: SX, wagerMatchId: S_W },
  });
  eq(r.kind, 'reject', 'self-target → reject');
  truthy(r.kind === 'reject' && r.reason.toLowerCase().includes('own'),
    `reason mentions "own": ${r.kind === 'reject' ? r.reason : ''}`);
}

function testDecideAcceptOutcomeMissingTarget(): void {
  section('decideAcceptOutcome — target wager not in lobby (cancelled/accepted by someone else)');

  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 0,
    callerOwnWagerInLobby: undefined,
    targetInLobby: undefined, // gone from lobby
  });
  eq(r.kind, 'reject', 'missing target → reject');
  truthy(r.kind === 'reject' && r.reason.toLowerCase().includes('not found'),
    `reason mentions "not found": ${r.kind === 'reject' ? r.reason : ''}`);
}

function testDecideAcceptOutcomeQueuedAutoRollback(): void {
  section('decideAcceptOutcome — caller in matchmaking queue + chain ACTIVE (Fix 1 cross-mode)');

  // Sx is in ranked queue (no own wager) and somehow signed accept_wager.
  // The chain is now ACTIVE; we must auto-rollback the target AND drop
  // the caller from the queue.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 1,
    callerOwnWagerInLobby: undefined,
    targetInLobby: { creatorWallet: MR_BOSS, wagerMatchId: M_W },
    callerInMatchmakingQueue: true,
  });
  eq(r.kind, 'autoRollback', 'in queue + chain ACTIVE → autoRollback');
  if (r.kind === 'autoRollback') {
    eq(r.targetWagerId, M_W, 'target wager surfaced for admin_cancel');
    eq(r.callerOwnWagerId, null, 'no own wager to cancel');
    eq(r.removeFromMatchmakingQueue, true, 'handler must drop from queue');
    truthy(r.userMessage.toLowerCase().includes('queue') || r.userMessage.toLowerCase().includes('matchmaking'),
      `user message mentions queue/matchmaking: ${r.userMessage}`);
  }
}

function testDecideAcceptOutcomeQueuedClientGated(): void {
  section('decideAcceptOutcome — caller in queue + chain WAITING (Fix 1 client gate held)');

  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 0, // WAITING — Fix 1 frontend gate worked
    callerOwnWagerInLobby: undefined,
    targetInLobby: { creatorWallet: MR_BOSS, wagerMatchId: M_W },
    callerInMatchmakingQueue: true,
  });
  eq(r.kind, 'reject', 'in queue + chain not ACTIVE → plain reject');
  if (r.kind === 'reject') {
    truthy(r.reason.toLowerCase().includes('queue'),
      `reason mentions queue: ${r.reason}`);
  }
}

function testDecideAcceptOutcomeBothBusy(): void {
  section('decideAcceptOutcome — caller has own wager AND is in queue (extreme legacy)');

  // A pre-Fix-1 player could have both states. The autoRollback must
  // unwind both: admin-cancel both wagers + drop from queue.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 1,
    callerOwnWagerInLobby: { creatorWallet: SX, wagerMatchId: S_W },
    targetInLobby: { creatorWallet: MR_BOSS, wagerMatchId: M_W },
    callerInMatchmakingQueue: true,
  });
  eq(r.kind, 'autoRollback', 'both busy + chain ACTIVE → autoRollback');
  if (r.kind === 'autoRollback') {
    eq(r.callerOwnWagerId, S_W, 'own wager id present');
    eq(r.removeFromMatchmakingQueue, true, 'queue drop required');
  }
}

function testDecideAcceptOutcomeChainSettled(): void {
  section('decideAcceptOutcome — chain status is SETTLED (already cancelled/finished)');

  // The chain wager is SETTLED (e.g. admin-cancelled by disconnect cleanup
  // before the WS message arrived). Reject with a clear "no longer active"
  // message; nothing to roll back.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 2, // SETTLED
    callerOwnWagerInLobby: undefined,
    targetInLobby: { creatorWallet: MR_BOSS, wagerMatchId: M_W },
  });
  eq(r.kind, 'reject', 'chain SETTLED → reject');
}

// ===== Runner =====

function run(): void {
  console.log('\n──────────────────────────────────────────────────');
  console.log(' qa-wager-accept-gate.ts — silent-accept regression lock');
  console.log('──────────────────────────────────────────────────');

  // Frontend predicate
  testCanAcceptWagerHappyPath();
  testCanAcceptWagerOwnOpen();
  testCanAcceptWagerSelfTarget();
  testCanAcceptWagerNoWallet();
  testCanAcceptWagerCaseInsensitive();
  testCanAcceptWagerEmptyLobby();

  // Server predicate
  testDecideAcceptOutcomeProceed();
  testDecideAcceptOutcomeRejectStaleChain();
  testDecideAcceptOutcomeAutoRollback();
  testDecideAcceptOutcomeOwnNoChainActive();
  testDecideAcceptOutcomeAcceptingOwn();
  testDecideAcceptOutcomeMissingTarget();
  testDecideAcceptOutcomeChainSettled();
  // Fix 1 cross-mode (2026-05-04) — caller-in-queue extension
  testDecideAcceptOutcomeQueuedAutoRollback();
  testDecideAcceptOutcomeQueuedClientGated();
  testDecideAcceptOutcomeBothBusy();

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
