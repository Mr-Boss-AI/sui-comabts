/**
 * Fight-request state machine gauntlet (Bucket 3 — Tavern, 2026-05-06).
 *
 *   $ cd server && npx tsx ../scripts/qa-tavern-fight-requests.ts
 *
 * Pins the fight-request lifecycle:
 *   • evaluateCreate — input validation + per-sender throttle +
 *     duplicate-pair detection
 *   • evaluateTransition — state-machine transitions with actor checks
 *   • createRequest / transitionRequest — store wiring
 *   • getPendingForTarget / getPendingFromSender — index correctness
 *   • sweepExpired — TTL eviction
 *   • boundary cases for stake validation
 *
 * Pure JS, no DB, no WS.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  evaluateCreate,
  evaluateTransition,
  createRequest,
  transitionRequest,
  getPendingForTarget,
  getPendingFromSender,
  sweepExpired,
  TTL_MS,
  MIN_STAKE_MIST,
  MAX_PENDING_PER_SENDER,
  MESSAGE_MAX,
  _testReset,
  _testSnapshot,
  type FightRequest,
} from '../server/src/data/fight-requests';

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
function truthy(v: unknown, label: string): void {
  if (v) ok(label);
  else fail(label, `expected truthy, got ${JSON.stringify(v)}`);
}

const A = '0xa1';
const B = '0xb2';
const C = '0xc3';

function main(): void {
  // ===========================================================================
  // 1 — evaluateCreate: input validation
  // ===========================================================================
  console.log('\n[1] evaluateCreate — input validation');
  const ctx0 = { pendingFromSenderCount: 0, hasDuplicatePendingForPair: false };

  eq(evaluateCreate({ requestType: 'friendly', fromWallet: A, toWallet: B }, ctx0).ok, true,
    'happy: friendly A→B with no context flags');
  eq(evaluateCreate({ requestType: 'wager', fromWallet: A, toWallet: B, stakeMist: '500000000' }, ctx0).ok, true,
    'happy: wager A→B with 0.5 SUI stake');

  const r1 = evaluateCreate({ requestType: 'friendly', fromWallet: A, toWallet: A }, ctx0);
  eq(r1.ok, false, 'self target rejected');
  if (!r1.ok) eq(r1.reason, 'self_target', 'self target reason matches');

  const r2 = evaluateCreate({ requestType: 'friendly', fromWallet: 'bad', toWallet: B }, ctx0);
  eq(r2.ok, false, 'non-0x sender rejected');
  if (!r2.ok) eq(r2.reason, 'invalid_target', 'non-0x sender reason');

  const r3 = evaluateCreate({ requestType: 'friendly', fromWallet: A, toWallet: '' }, ctx0);
  eq(r3.ok, false, 'empty target rejected');

  const r4 = evaluateCreate({ requestType: 'wager', fromWallet: A, toWallet: B, stakeMist: '0' }, ctx0);
  eq(r4.ok, false, 'zero stake rejected');
  if (!r4.ok) eq(r4.reason, 'invalid_stake', 'zero stake reason');

  const minMinus1 = (MIN_STAKE_MIST - 1n).toString();
  const r5 = evaluateCreate({ requestType: 'wager', fromWallet: A, toWallet: B, stakeMist: minMinus1 }, ctx0);
  eq(r5.ok, false, 'stake < 0.1 SUI rejected');

  const r6 = evaluateCreate({ requestType: 'wager', fromWallet: A, toWallet: B, stakeMist: 'NaN' }, ctx0);
  eq(r6.ok, false, 'unparseable stake rejected');

  const tooLong = 'x'.repeat(MESSAGE_MAX + 1);
  const r7 = evaluateCreate({ requestType: 'friendly', fromWallet: A, toWallet: B, message: tooLong }, ctx0);
  eq(r7.ok, false, 'message > 280 chars rejected');

  const ctxOver = { pendingFromSenderCount: MAX_PENDING_PER_SENDER, hasDuplicatePendingForPair: false };
  const r8 = evaluateCreate({ requestType: 'friendly', fromWallet: A, toWallet: B }, ctxOver);
  eq(r8.ok, false, 'over MAX_PENDING_PER_SENDER rejected');

  const ctxDup = { pendingFromSenderCount: 0, hasDuplicatePendingForPair: true };
  const r9 = evaluateCreate({ requestType: 'friendly', fromWallet: A, toWallet: B }, ctxDup);
  eq(r9.ok, false, 'duplicate pending pair rejected');

  const r10 = evaluateCreate({ requestType: 'invalid' as never, fromWallet: A, toWallet: B }, ctx0);
  eq(r10.ok, false, 'invalid requestType rejected');

  // ===========================================================================
  // 2 — evaluateTransition: state machine
  // ===========================================================================
  console.log('\n[2] evaluateTransition — state machine');
  const pending: FightRequest = {
    id: 'req-1',
    requestType: 'friendly',
    fromWallet: A,
    fromName: 'Alice',
    toWallet: B,
    toName: 'Bob',
    status: 'pending',
    expiresAt: Date.now() + TTL_MS,
    createdAt: Date.now(),
  };

  const acceptOk = evaluateTransition(pending, 'accept', B);
  eq(acceptOk.ok, true, 'target can accept pending');
  if (acceptOk.ok) eq(acceptOk.nextStatus, 'accepted', 'accept → accepted');

  const acceptByWrong = evaluateTransition(pending, 'accept', A);
  eq(acceptByWrong.ok, false, 'sender cannot accept own request');
  if (!acceptByWrong.ok) eq(acceptByWrong.reason, 'not_authorized', 'sender-accept reason');

  const cancelOk = evaluateTransition(pending, 'cancel', A);
  eq(cancelOk.ok, true, 'sender can cancel');
  if (cancelOk.ok) eq(cancelOk.nextStatus, 'canceled', 'cancel → canceled');

  const cancelByTarget = evaluateTransition(pending, 'cancel', B);
  eq(cancelByTarget.ok, false, 'target cannot cancel');

  const declineOk = evaluateTransition(pending, 'decline', B);
  eq(declineOk.ok, true, 'target can decline');
  if (declineOk.ok) eq(declineOk.nextStatus, 'declined', 'decline → declined');

  const expireOk = evaluateTransition(pending, 'expire', undefined);
  eq(expireOk.ok, true, 'system can expire (no actor)');
  if (expireOk.ok) eq(expireOk.nextStatus, 'expired', 'expire → expired');

  const accepted: FightRequest = { ...pending, status: 'accepted' };
  const acceptAccept = evaluateTransition(accepted, 'accept', B);
  eq(acceptAccept.ok, false, 'cannot transition non-pending');
  if (!acceptAccept.ok) eq(acceptAccept.reason, 'not_pending', 'accepted→reject reason');

  const expired: FightRequest = { ...pending, expiresAt: Date.now() - 1 };
  const expiredAccept = evaluateTransition(expired, 'accept', B);
  eq(expiredAccept.ok, false, 'expired-time accept rejected');
  if (!expiredAccept.ok) eq(expiredAccept.reason, 'expired', 'expired-time reason');

  const notFound = evaluateTransition(undefined, 'accept', B);
  eq(notFound.ok, false, 'undefined request rejected');

  // ===========================================================================
  // 3 — createRequest + index
  // ===========================================================================
  console.log('\n[3] createRequest — store + index');
  _testReset();
  const c1 = createRequest({ requestType: 'friendly', fromWallet: A, toWallet: B });
  truthy(c1.request, 'createRequest returned a request');
  eq(c1.request!.fromWallet, A.toLowerCase(), 'fromWallet lowercased');
  eq(c1.request!.toWallet, B.toLowerCase(), 'toWallet lowercased');
  eq(c1.request!.status, 'pending', 'fresh request is pending');

  // Sender index
  const fromList = getPendingFromSender(A);
  eq(fromList.length, 1, 'index has 1 from sender');

  // Target index
  const toList = getPendingForTarget(B);
  eq(toList.length, 1, 'index has 1 for target');

  // Duplicate pair
  const c2 = createRequest({ requestType: 'friendly', fromWallet: A, toWallet: B });
  eq(c2.error, 'duplicate_pending', 'duplicate pair rejected');

  // Different target same sender
  const c3 = createRequest({ requestType: 'friendly', fromWallet: A, toWallet: C });
  truthy(c3.request, 'A→C also accepted');

  // ===========================================================================
  // 4 — transitionRequest: state changes propagate
  // ===========================================================================
  console.log('\n[4] transitionRequest — state changes + index updates');
  const decline = transitionRequest(c1.request!.id, 'decline', B);
  eq(decline.request!.status, 'declined', 'decline → declined');
  eq(getPendingForTarget(B).length, 0, 'declined removed from target index');
  eq(getPendingFromSender(A).length, 1, 'A still has 1 pending (the C one)');

  // Cannot re-decline
  const reDecline = transitionRequest(c1.request!.id, 'decline', B);
  eq(reDecline.error, 'not_pending', 'cannot re-decline');

  // ===========================================================================
  // 5 — sweepExpired: TTL eviction
  // ===========================================================================
  console.log('\n[5] sweepExpired — TTL eviction');
  _testReset();
  const stale = createRequest({ requestType: 'friendly', fromWallet: A, toWallet: B });
  // Mutate expires_at to the past
  const sn = _testSnapshot();
  sn[0].expiresAt = Date.now() - 1_000;
  let expiredCount = 0;
  const swept = sweepExpired((req) => { expiredCount++; });
  eq(swept, 1, 'one request swept');
  eq(expiredCount, 1, 'callback invoked once');
  eq(_testSnapshot()[0].status, 'expired', 'request flipped to expired');

  // ===========================================================================
  // 6 — per-sender limit
  // ===========================================================================
  console.log('\n[6] per-sender pending limit');
  _testReset();
  for (let i = 0; i < MAX_PENDING_PER_SENDER; i++) {
    const target = `0xtarget${i}`;
    const r = createRequest({ requestType: 'friendly', fromWallet: A, toWallet: target });
    truthy(r.request, `request ${i + 1} accepted`);
  }
  const overflow = createRequest({ requestType: 'friendly', fromWallet: A, toWallet: '0xoverflow' });
  eq(overflow.error, 'over_limit', `${MAX_PENDING_PER_SENDER + 1}th request rejected`);

  // ===========================================================================
  // 7 — wager request: stake propagation
  // ===========================================================================
  console.log('\n[7] wager request — stake propagation');
  _testReset();
  const w = createRequest({
    requestType: 'wager',
    fromWallet: A,
    toWallet: B,
    stakeMist: '1000000000',
  });
  truthy(w.request, 'wager accepted');
  eq(w.request!.requestType, 'wager', 'requestType preserved');
  eq(w.request!.stakeMist, '1000000000', 'stake preserved as string');

  // Friendly should not carry stake
  _testReset();
  const f = createRequest({
    requestType: 'friendly',
    fromWallet: A,
    toWallet: B,
    stakeMist: '999',
  });
  eq(f.request!.stakeMist, undefined, 'friendly drops stakeMist');

  // ===========================================================================
  // 8 — message field
  // ===========================================================================
  console.log('\n[8] optional message field');
  _testReset();
  const m = createRequest({
    requestType: 'friendly',
    fromWallet: A,
    toWallet: B,
    message: 'gg first to 3',
  });
  eq(m.request!.message, 'gg first to 3', 'message preserved');

  _testReset();
  const longMsg = 'x'.repeat(MESSAGE_MAX + 100);
  const m2 = createRequest({
    requestType: 'friendly',
    fromWallet: A,
    toWallet: B,
    message: longMsg,
  });
  eq(m2.error, 'message_too_long', 'over-MAX message rejected at create');

  // Final
  console.log(`\n✓ Passed: ${passes}`);
  if (failures > 0) {
    console.log(`✗ Failed: ${failures}`);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
