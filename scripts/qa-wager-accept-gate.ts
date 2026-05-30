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
import {
  canAcceptWager,
  canAcceptWagerWithBalance,
  DEFAULT_GAS_RESERVE_MIST,
} from '../frontend/src/lib/wager-accept-gate';
import { decideAcceptOutcome, resolveChallengerWallet } from '../server/src/ws/wager-accept-gate';

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

// ===========================================================================
// v5.2 — 2026-05-30 live-QA regression suite.
//
// The 2026-05-04 silent-accept autoRollback misfired in the v5.2
// creator-approve flow because the caller's "own wager" IS the target.
// The fix is the `ownWagerIsTarget` discriminator (wager-accept-gate.ts).
// These tests pin both halves:
//   - creator approving their own target → PROCEED (no rollback)
//   - caller with a DIFFERENT open wager → autoRollback (preserved)
// Plus they pin the player_b resolution helper for the post-gate
// fight-start.
// ===========================================================================

function testV52CreatorApprovesOwnTarget(): void {
  section('v5.2 — caller is the creator approving their own target wager');

  // Sx created S_W. Mr_Boss requested it (status → PENDING_APPROVAL).
  // Sx then signed approve_challenger and the chain flipped to ACTIVE.
  // The frontend now sends wager_accepted with Sx as caller.
  // Pre-fix this misfired the silent-accept autoRollback. Post-fix:
  // ownWagerIsTarget recognises the v5.2 flow and falls through to PROCEED.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: S_W, // caller IS creator of this wager
    targetChainStatus: 1, // ACTIVE — approve_challenger landed
    callerOwnWagerInLobby: { creatorWallet: SX, wagerMatchId: S_W }, // own = target
    targetInLobby: { creatorWallet: SX, wagerMatchId: S_W },
  });
  eq(r.kind, 'proceed', 'creator approving own target → PROCEED (no autoRollback)');
}

function testV52CallerHasDifferentOwnWagerStillRollsBack(): void {
  section('v5.2 — caller has a DIFFERENT open wager + chain ACTIVE (silent-accept guard preserved)');

  // The original 2026-05-04 Fix B bug case: Sx has their own open wager
  // S_W AND somehow accepted Mr_Boss's wager M_W. Chain is ACTIVE on M_W
  // (the silent-accept landed). The autoRollback MUST still fire — this
  // is the case the fix is preserving.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: M_W,
    targetChainStatus: 1, // ACTIVE — silent-accept landed
    callerOwnWagerInLobby: { creatorWallet: SX, wagerMatchId: S_W }, // own != target
    targetInLobby: { creatorWallet: MR_BOSS, wagerMatchId: M_W },
  });
  eq(r.kind, 'autoRollback', 'different own wager + chain ACTIVE → autoRollback (preserved)');
  if (r.kind === 'autoRollback') {
    eq(r.targetWagerId, M_W, 'target wager id surfaced for admin_cancel');
    eq(r.callerOwnWagerId, S_W, 'caller own wager id surfaced for admin_cancel');
  }
}

function testV52CreatorApprovesOwnTargetPendingApprovalStaysClean(): void {
  section('v5.2 — own == target but chain still PENDING_APPROVAL (probe lag) → no rollback');

  // Edge case: the wager_accepted message arrived but the status probe
  // raced ahead and read PENDING_APPROVAL (3, not yet ACTIVE). The
  // ownWagerIsTarget guard still applies — never rollback the creator's
  // own wager. The chain-status check downstream rejects gracefully.
  const r = decideAcceptOutcome({
    callerWallet: SX,
    targetWagerId: S_W,
    targetChainStatus: 3, // PENDING_APPROVAL — probe lag
    callerOwnWagerInLobby: { creatorWallet: SX, wagerMatchId: S_W },
    targetInLobby: { creatorWallet: SX, wagerMatchId: S_W },
  });
  // With ownWagerIsTarget guard, we skip the busy branch entirely.
  // Falls through to step 4 (chain not ACTIVE → reject) — NOT autoRollback.
  truthy(r.kind === 'reject',
    `own=target + non-ACTIVE → reject (NOT autoRollback): got ${r.kind}`);
  if (r.kind === 'reject') {
    truthy(!r.reason.toLowerCase().includes('rolled back'),
      'reject reason must not mention rollback');
  }
}

function testV52ResolveChallengerV52ApproveFlow(): void {
  section('resolveChallengerWallet — v5.2 approve flow (caller IS creator)');
  const r = resolveChallengerWallet({
    callerWallet: SX, // creator + caller
    creatorWallet: SX,
    pendingChallengerWallet: MR_BOSS, // populated by earlier wager_request_accepted
  });
  if (r.ok) {
    eq(r.wallet, MR_BOSS, 'challenger resolved from pendingChallenger.wallet');
    eq(r.flow, 'v5.2-approve', 'flow label = v5.2-approve');
  } else {
    fail('resolveChallengerWallet must succeed in v5.2 approve flow', r.reason);
  }
}

function testV52ResolveChallengerV51LegacyFlow(): void {
  section('resolveChallengerWallet — v5.1 legacy flow (caller IS challenger)');
  const r = resolveChallengerWallet({
    callerWallet: MR_BOSS, // challenger + caller (v5.1)
    creatorWallet: SX,
    // pendingChallengerWallet may or may not be present; not consulted in v5.1 path
  });
  if (r.ok) {
    eq(r.wallet, MR_BOSS, 'challenger resolved from callerWallet (v5.1 legacy)');
    eq(r.flow, 'v5.1-legacy', 'flow label = v5.1-legacy');
  } else {
    fail('resolveChallengerWallet must succeed in v5.1 legacy flow', r.reason);
  }
}

function testV52ResolveChallengerMissingPending(): void {
  section('resolveChallengerWallet — v5.2 caller=creator but lobby pending missing (defensive)');
  const r = resolveChallengerWallet({
    callerWallet: SX,
    creatorWallet: SX,
    // pendingChallengerWallet absent — server restart between request_accept and approve
  });
  if (!r.ok) {
    truthy(r.reason.toLowerCase().includes('pendingchallenger'),
      `reason mentions pendingChallenger: ${r.reason}`);
    ok('missing pending challenger reported with clear error');
  } else {
    fail('resolveChallengerWallet must fail when caller=creator and no pending', `got: ${r.wallet}`);
  }
}

function testV52ResolveChallengerCaseInsensitive(): void {
  section('resolveChallengerWallet — wallet comparison is case-insensitive');
  const r = resolveChallengerWallet({
    callerWallet: SX.toUpperCase(),
    creatorWallet: SX.toLowerCase(),
    pendingChallengerWallet: MR_BOSS,
  });
  if (r.ok) {
    eq(r.flow, 'v5.2-approve', 'case-mismatched wallets still classified as v5.2 approve');
    eq(r.wallet, MR_BOSS, 'challenger correctly resolved');
  } else {
    fail('case-insensitive comparison must succeed', r.reason);
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

// ===========================================================================
// Phase A (2026-05-17) — Bug A pre-flight balance check.
//
// The 2026-05-16 live test reproduced the silent-fail UX bug end-to-end:
// acceptor Mr_Boss_v5.1 had 0.501 SUI on chain and clicked ACCEPT on a
// 0.5 SUI wager. The wallet signed, the chain tx failed (escrow lock
// left no gas headroom), `WagerMatch.status` stayed at 0, and the toast
// read "Wager not active on-chain (status: 0). Did the accept_wager
// transaction succeed?" — technically true, but useless for the user.
//
// `canAcceptWagerWithBalance` refuses the click BEFORE the wallet popup
// when the caller's balance can't cover stake + estimated gas. These
// fixtures pin the exact decision boundary (stake = 0.5 SUI, default
// reserve = 0.02 SUI, threshold = 0.52 SUI).
// ===========================================================================

const ONE_SUI = BigInt(1_000_000_000);
const HALF_SUI = ONE_SUI / BigInt(2);
const RESERVE = DEFAULT_GAS_RESERVE_MIST; // 20_000_000 MIST = 0.02 SUI
const LOBBY_ALLOW = { allow: true as const };

function testBalanceGateInsufficient(): void {
  section('canAcceptWagerWithBalance — insufficient SUI (live 2026-05-16 repro)');

  // Mr_Boss_v5.1 with 0.501 SUI on a 0.5 SUI wager — needs 0.52, has 0.501.
  const r = canAcceptWagerWithBalance({
    lobbyGate: LOBBY_ALLOW,
    stakeMist: HALF_SUI,
    balanceMist: BigInt(501_000_000),
  });
  eq(r.allow, false, '0.501 SUI vs 0.5 stake + 0.02 gas → refuse');
  truthy(
    typeof r.reason === 'string' && r.reason.includes('0.5') && r.reason.includes('0.501'),
    'reason mentions stake + actual balance',
    `reason=${r.reason}`,
  );
}

function testBalanceGateExactlyEqual(): void {
  section('canAcceptWagerWithBalance — balance == stake + reserve (boundary, allow)');

  const r = canAcceptWagerWithBalance({
    lobbyGate: LOBBY_ALLOW,
    stakeMist: HALF_SUI,
    balanceMist: HALF_SUI + RESERVE,
  });
  eq(r.allow, true, 'balance exactly equals stake + reserve → allow');
}

function testBalanceGateJustEnough(): void {
  section('canAcceptWagerWithBalance — balance one MIST below threshold (boundary, refuse)');

  const r = canAcceptWagerWithBalance({
    lobbyGate: LOBBY_ALLOW,
    stakeMist: HALF_SUI,
    balanceMist: HALF_SUI + RESERVE - BigInt(1),
  });
  eq(r.allow, false, 'balance one MIST short → refuse (strict <)');
}

function testBalanceGateWellFunded(): void {
  section('canAcceptWagerWithBalance — caller well-funded → allow');

  const r = canAcceptWagerWithBalance({
    lobbyGate: LOBBY_ALLOW,
    stakeMist: HALF_SUI,
    balanceMist: BigInt(10) * ONE_SUI,
  });
  eq(r.allow, true, '10 SUI vs 0.5 stake → allow');
  eq(r.reason, undefined, 'no reason when allowing');
}

function testBalanceGateLoadingState(): void {
  section('canAcceptWagerWithBalance — balance hook still loading → refuse');

  const r = canAcceptWagerWithBalance({
    lobbyGate: LOBBY_ALLOW,
    stakeMist: HALF_SUI,
    balanceMist: null, // useWalletBalance is loading or errored
  });
  eq(r.allow, false, 'null balance → refuse');
  truthy(
    typeof r.reason === 'string' && r.reason.toLowerCase().includes('loading'),
    'reason hints at loading state',
    `reason=${r.reason}`,
  );
}

function testBalanceGateZeroBalance(): void {
  section('canAcceptWagerWithBalance — balance 0n → refuse');

  const r = canAcceptWagerWithBalance({
    lobbyGate: LOBBY_ALLOW,
    stakeMist: HALF_SUI,
    balanceMist: BigInt(0),
  });
  eq(r.allow, false, '0 SUI balance → refuse');
}

function testBalanceGateCustomReserve(): void {
  section('canAcceptWagerWithBalance — caller-supplied gas reserve overrides default');

  // Use a 0.1 SUI reserve. Now 0.5 SUI stake + 0.1 reserve = 0.6 required.
  const customReserve = BigInt(100_000_000); // 0.1 SUI
  const r1 = canAcceptWagerWithBalance({
    lobbyGate: LOBBY_ALLOW,
    stakeMist: HALF_SUI,
    balanceMist: HALF_SUI + RESERVE, // 0.52, below the custom 0.6 threshold
    gasReserveMist: customReserve,
  });
  eq(r1.allow, false, '0.52 vs 0.5 + 0.1 custom reserve → refuse');

  const r2 = canAcceptWagerWithBalance({
    lobbyGate: LOBBY_ALLOW,
    stakeMist: HALF_SUI,
    balanceMist: HALF_SUI + customReserve, // exactly 0.6
    gasReserveMist: customReserve,
  });
  eq(r2.allow, true, '0.6 vs 0.5 + 0.1 custom reserve → allow');
}

function testBalanceGateLobbyShortCircuit(): void {
  section('canAcceptWagerWithBalance — lobby refusal short-circuits balance check');

  // Even with infinite balance, a lobby refusal must pass through
  // unchanged so the user-facing reason stays actionable ("Connect a
  // wallet first." or "Cancel your own open wager first") rather than
  // being overridden by an irrelevant balance message.
  const lobbyRefusal = { allow: false as const, reason: 'Connect a wallet first.' };
  const r = canAcceptWagerWithBalance({
    lobbyGate: lobbyRefusal,
    stakeMist: HALF_SUI,
    balanceMist: BigInt(1_000_000_000_000), // 1000 SUI, plenty
  });
  eq(r.allow, false, 'lobby refusal preserved');
  eq(r.reason, 'Connect a wallet first.', 'reason passed through unchanged');
}

function testBalanceGateOwnWagerShortCircuit(): void {
  section('canAcceptWagerWithBalance — own-wager refusal short-circuits + retains ownWagerId');

  // The own-wager refusal carries `ownWagerId` for diagnostic logging.
  // canAcceptWagerWithBalance must preserve it so the caller can log it.
  const ownWagerRefusal = {
    allow: false as const,
    reason: 'Cancel your own open wager first before accepting another.',
    ownWagerId: S_W,
  };
  const r = canAcceptWagerWithBalance({
    lobbyGate: ownWagerRefusal,
    stakeMist: HALF_SUI,
    balanceMist: BigInt(10_000_000_000),
  });
  eq(r.allow, false, 'own-wager refusal preserved');
  eq(r.ownWagerId, S_W, 'ownWagerId preserved through balance gate');
}

function testBalanceGateDefaultReserveValue(): void {
  section('canAcceptWagerWithBalance — DEFAULT_GAS_RESERVE_MIST pinned to 0.02 SUI');

  // Pin the exported constant so a quiet refactor of the reserve doesn't
  // silently change the refusal threshold across the live build.
  eq(DEFAULT_GAS_RESERVE_MIST, BigInt(20_000_000), 'reserve = 20_000_000 MIST (0.02 SUI)');
}

// ===========================================================================
// Phase A (2026-05-17) — Bug B FailedTransaction branching.
//
// The Sui SDK signer returns either { Transaction: {...} } on success
// or { FailedTransaction: { error, ... } } when the chain rejected the
// tx. The pre-fix `matchmaking-queue.tsx:398-407` grabbed a digest from
// either wrapper and proceeded to send `wager_accepted` over the WS,
// surfacing the failure only through the server's misleading
// "not active on-chain" toast.
//
// This pin verifies the FailedTransaction branch is wired in the
// matchmaking-queue source. We grep the source rather than execute it
// because the actual signer is a wallet-popup-bound async function and
// can't be unit-tested without a live wallet — the branch shape is the
// regression-relevant fact.
// ===========================================================================

function testFailedTransactionBranchingShape(): void {
  section('matchmaking-queue.tsx — assertTxSucceeded wired into create + accept');

  // Static pin: both create_wager and accept_wager paths must route
  // through the shared `assertTxSucceeded` helper from
  // `frontend/src/lib/tx-result.ts`. The pre-Phase-A code coalesced
  // `Transaction || FailedTransaction || result` into a single
  // `txData`, masking chain failures. Both call sites now share the
  // same FailedTransaction branching that `useEquipmentActions` has
  // had since the loadout PTB landed.
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'components', 'fight', 'matchmaking-queue.tsx'),
    'utf8',
  );
  truthy(
    src.includes('from "@/lib/tx-result"'),
    'imports the shared tx-result helper module',
  );
  // 2026-05-18 — both sites now pass ARENA_ABORT_CODES so the post-sign
  // failure path emits the same humanized copy as the pre-flight. The
  // bare label call (`assertTxSucceeded(result, "...")`) is gone.
  truthy(
    src.includes('assertTxSucceeded(result, "create_wager", ARENA_ABORT_CODES)'),
    'create_wager path passes ARENA_ABORT_CODES to assertTxSucceeded',
  );
  // v5.2 (2026-05-30) — accept_wager is REMOVED; the v5.2 handshake
  // replaces it with request_accept_wager + approve_challenger +
  // decline_challenger + withdraw_challenge + cancel_expired_challenge.
  // Each new entrypoint passes ARENA_ABORT_CODES at its own assertTxSucceeded
  // site for the post-sign humanizer.
  truthy(
    src.includes('assertTxSucceeded(result, "request_accept_wager", ARENA_ABORT_CODES)'),
    'request_accept_wager path passes ARENA_ABORT_CODES to assertTxSucceeded',
  );
  truthy(
    src.includes('assertTxSucceeded(result, "approve_challenger", ARENA_ABORT_CODES)'),
    'approve_challenger path passes ARENA_ABORT_CODES to assertTxSucceeded',
  );
  truthy(
    src.includes('assertTxSucceeded(result, "decline_challenger", ARENA_ABORT_CODES)'),
    'decline_challenger path passes ARENA_ABORT_CODES to assertTxSucceeded',
  );
  truthy(
    src.includes('assertTxSucceeded(result, "withdraw_challenge", ARENA_ABORT_CODES)'),
    'withdraw_challenge path passes ARENA_ABORT_CODES to assertTxSucceeded',
  );
  truthy(
    src.includes('simulateWagerTx('),
    'pre-flight simulateWagerTx wired ahead of the wallet popup',
  );
  truthy(
    src.includes('extractTxDigest(result)'),
    'accept_wager path uses extractTxDigest for the digest',
  );
  truthy(
    !src.includes('resultAny.Transaction || resultAny.FailedTransaction || resultAny'),
    'old OR-coalesce expression removed',
  );
  truthy(
    src.includes('canAcceptWagerWithBalance'),
    'balance gate is invoked in the accept-handler',
  );

  // Static pin on the shared helper itself — the module exists, exports
  // the public surface, and the equipment helper still uses it (so we
  // didn't accidentally leave a fork).
  const txResultSrc = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'tx-result.ts'),
    'utf8',
  );
  truthy(
    txResultSrc.includes('export function assertTxSucceeded'),
    'tx-result exports assertTxSucceeded',
  );
  truthy(
    txResultSrc.includes('export function humanizeChainError'),
    'tx-result exports humanizeChainError',
  );
  truthy(
    txResultSrc.includes('export function extractTxDigest'),
    'tx-result exports extractTxDigest',
  );
  truthy(
    txResultSrc.includes('export type AbortCodeMap'),
    'tx-result exports the AbortCodeMap type',
  );

  const equipSrc = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'hooks', 'useEquipmentActions.ts'),
    'utf8',
  );
  truthy(
    equipSrc.includes('from "@/lib/tx-result"'),
    'useEquipmentActions imports from shared tx-result (no fork)',
  );
  truthy(
    equipSrc.includes('assertTxSucceeded(result, "save_loadout", EQUIPMENT_ABORT_CODES)'),
    'useEquipmentActions calls the shared helper with its abort-code map',
  );
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

  // Phase A (2026-05-17) — Bug A pre-flight balance check + Bug B
  // FailedTransaction branching, both filed in
  // STATE_OF_PROJECT_2026-05-16.md and shipped in this session.
  testBalanceGateInsufficient();
  testBalanceGateExactlyEqual();
  testBalanceGateJustEnough();
  testBalanceGateWellFunded();
  testBalanceGateLoadingState();
  testBalanceGateZeroBalance();
  testBalanceGateCustomReserve();
  testBalanceGateLobbyShortCircuit();
  testBalanceGateOwnWagerShortCircuit();
  testBalanceGateDefaultReserveValue();
  testFailedTransactionBranchingShape();

  // v5.2 (2026-05-30) — gate fix + player_b resolution.
  testV52CreatorApprovesOwnTarget();
  testV52CallerHasDifferentOwnWagerStillRollsBack();
  testV52CreatorApprovesOwnTargetPendingApprovalStaysClean();
  testV52ResolveChallengerV52ApproveFlow();
  testV52ResolveChallengerV51LegacyFlow();
  testV52ResolveChallengerMissingPending();
  testV52ResolveChallengerCaseInsensitive();

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
