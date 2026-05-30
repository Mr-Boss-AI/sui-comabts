/**
 * DM channel registry gauntlet (Bucket 3 — Tavern, 2026-05-06).
 *
 *   $ cd server && npx tsx ../scripts/qa-tavern-dm-channels.ts
 *
 * Pins the DM channel registry behaviour:
 *   • canonicalPair / isCanonicalPair — pair ordering invariant
 *   • registerChannel — insert + dedupe
 *   • getChannelForPair — bi-directional lookup
 *   • bumpUnread / clearUnread / getUnread — counter math
 *   • listChannelsForWallet — filter by participant
 *   • getTotalUnreadForWallet — sum across channels
 *
 * Pure JS, no DB, no WS.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  canonicalPair,
  isCanonicalPair,
  registerChannel,
  getChannelById,
  getChannelForPair,
  listChannelsForWallet,
  bumpUnread,
  clearUnread,
  getUnread,
  getTotalUnreadForWallet,
  _testReset,
  _testSnapshot,
} from '../server/src/data/dm-channels';

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
function falsy(v: unknown, label: string): void {
  if (!v) ok(label);
  else fail(label, `expected falsy, got ${JSON.stringify(v)}`);
}

const A = '0x000000000000000000000000000000000000000000000000000000000000000A';
const B = '0x000000000000000000000000000000000000000000000000000000000000000B';
const C = '0x000000000000000000000000000000000000000000000000000000000000000C';
const CHAN1 = '0x' + 'aa'.repeat(32);
const CHAN2 = '0x' + 'bb'.repeat(32);
const CHAN3 = '0x' + 'cc'.repeat(32);

function main(): void {
  // ===========================================================================
  // 1 — canonicalPair: pair ordering
  // ===========================================================================
  console.log('\n[1] canonicalPair — unordered pair canonicalisation');
  const c1 = canonicalPair(A, B);
  const c2 = canonicalPair(B, A);
  eq(c1.a, c2.a, 'A,B and B,A canonicalise to same a');
  eq(c1.b, c2.b, 'A,B and B,A canonicalise to same b');
  truthy(c1.a < c1.b, 'a is lex smaller than b');
  eq(c1.a, A.toLowerCase(), 'lowercased');
  eq(c1.b, B.toLowerCase(), 'lowercased');

  truthy(isCanonicalPair(A.toLowerCase(), B.toLowerCase()), 'lower(A), lower(B) is canonical (A<B)');
  falsy(isCanonicalPair(B.toLowerCase(), A.toLowerCase()), 'B,A is NOT canonical');
  falsy(isCanonicalPair(A, B), 'uppercase rejected as non-canonical');

  // ===========================================================================
  // 2 — registerChannel: insert + dedupe
  // ===========================================================================
  console.log('\n[2] registerChannel — insert + dedupe');
  _testReset();
  const r1 = registerChannel({
    channelId: CHAN1,
    walletA: A,
    walletB: B,
    memberCapA: '0xcapA',
    memberCapB: '0xcapB',
    encryptedKeyB64: 'ZW5jZHNkamhza2RoYg==',
    createdBy: A,
  });
  truthy(r1.row, 'first register returned row');
  eq(r1.row!.channelId, CHAN1, 'channelId preserved');
  eq(r1.row!.participantA, A.toLowerCase(), 'participantA canonical');
  eq(r1.row!.participantB, B.toLowerCase(), 'participantB canonical');
  eq(r1.row!.createdBy, A.toLowerCase(), 'createdBy lowercased');

  // Self pair rejected
  const rSelf = registerChannel({
    channelId: CHAN2,
    walletA: A,
    walletB: A,
    createdBy: A,
  });
  eq(rSelf.error, 'self_pair', 'self pair rejected');

  // Invalid input
  const rInvalid = registerChannel({
    channelId: 'not-an-address',
    walletA: A,
    walletB: B,
    createdBy: A,
  });
  eq(rInvalid.error, 'invalid_input', 'non-0x channelId rejected');

  // Same channelId, registered second time → idempotent (returns same row)
  const r1again = registerChannel({
    channelId: CHAN1,
    walletA: B,
    walletB: A,
    createdBy: B,
  });
  truthy(r1again.row, 'second register of same id still returns row');

  // ===========================================================================
  // 3 — getChannelForPair: bi-directional lookup
  // ===========================================================================
  console.log('\n[3] getChannelForPair — bi-directional lookup');
  const ab = getChannelForPair(A, B);
  truthy(ab, 'A,B lookup found');
  eq(ab!.channelId, CHAN1, 'A,B → CHAN1');

  const ba = getChannelForPair(B, A);
  truthy(ba, 'B,A lookup found');
  eq(ba!.channelId, CHAN1, 'B,A → CHAN1 (same channel)');

  // Different pair → null
  eq(getChannelForPair(A, C), null, 'A,C has no channel');

  // ===========================================================================
  // 4 — listChannelsForWallet
  // ===========================================================================
  console.log('\n[4] listChannelsForWallet — filter by participant');
  // Add a second channel A↔C
  registerChannel({
    channelId: CHAN2,
    walletA: A,
    walletB: C,
    createdBy: A,
  });
  // And a channel B↔C
  registerChannel({
    channelId: CHAN3,
    walletA: B,
    walletB: C,
    createdBy: C,
  });
  eq(listChannelsForWallet(A).length, 2, 'A has 2 channels');
  eq(listChannelsForWallet(B).length, 2, 'B has 2 channels');
  eq(listChannelsForWallet(C).length, 2, 'C has 2 channels');
  eq(listChannelsForWallet('0xunknown').length, 0, 'unknown wallet has 0 channels');

  // ===========================================================================
  // 5 — bumpUnread / clearUnread / getUnread
  // ===========================================================================
  console.log('\n[5] unread counter math');
  _testReset();
  registerChannel({ channelId: CHAN1, walletA: A, walletB: B, createdBy: A });

  eq(getUnread(CHAN1, B), 0, 'fresh channel has 0 unread');

  const b1 = bumpUnread(CHAN1, B);
  truthy(b1, 'bump returned result');
  eq(b1!.unreadCount, 1, 'bump → 1');
  eq(getUnread(CHAN1, B), 1, 'getUnread reflects bump');

  bumpUnread(CHAN1, B);
  bumpUnread(CHAN1, B);
  eq(getUnread(CHAN1, B), 3, 'three bumps → 3');

  clearUnread(CHAN1, B);
  eq(getUnread(CHAN1, B), 0, 'clear resets to 0');

  // Bump for non-participant → null
  const bumpRogue = bumpUnread(CHAN1, C);
  eq(bumpRogue, null, 'non-participant bump rejected');

  // Bump for unknown channel → null
  const bumpUnknown = bumpUnread('0xUNKNOWNCHAN', B);
  eq(bumpUnknown, null, 'unknown channel bump rejected');

  // ===========================================================================
  // 6 — getTotalUnreadForWallet
  // ===========================================================================
  console.log('\n[6] total unread sum across channels');
  _testReset();
  registerChannel({ channelId: CHAN1, walletA: A, walletB: B, createdBy: A });
  registerChannel({ channelId: CHAN2, walletA: A, walletB: C, createdBy: A });
  bumpUnread(CHAN1, B);
  bumpUnread(CHAN1, B);
  bumpUnread(CHAN2, C);
  eq(getTotalUnreadForWallet(B), 2, 'B has 2 unread total');
  eq(getTotalUnreadForWallet(C), 1, 'C has 1 unread total');
  eq(getTotalUnreadForWallet(A), 0, 'A (sender) has 0 unread');

  // ===========================================================================
  // 7 — lastMessageAt is bumped
  // ===========================================================================
  console.log('\n[7] lastMessageAt updated on bump');
  _testReset();
  registerChannel({ channelId: CHAN1, walletA: A, walletB: B, createdBy: A });
  const before = getChannelById(CHAN1)!;
  eq(before.lastMessageAt, undefined, 'fresh channel has no lastMessageAt');
  bumpUnread(CHAN1, B);
  const after = getChannelById(CHAN1)!;
  truthy(after.lastMessageAt, 'lastMessageAt set after bump');
  truthy((after.lastMessageAt ?? 0) >= before.createdAt, 'lastMessageAt >= createdAt');

  // ===========================================================================
  // 7b — recipient notification preconditions
  //
  // The WS layer's `notify_dm_sent` handler depends on three data-layer
  // guarantees to attribute and route a DM toast correctly:
  //   1. bumpUnread on a fresh channel returns count=1 (not 0, not 2).
  //   2. The sender side must NOT see their own count bump.
  //   3. lastMessageAt is bumped strictly after createdAt so the
  //      sidebar's "most-recent first" sort surfaces new messages.
  //   4. clearUnread on a non-existent channel/recipient is a no-op
  //      (idempotent — the WS handler can call it speculatively).
  //   5. Repeated notify_dm_sent for the same channel keeps stacking
  //      until clearUnread (drives the badge count past 1).
  //
  // Pre-2026-05-06 hotfix #4 the sender-side WS hang (Bug 1) meant
  // these were never exercised end-to-end live. Adding the data-layer
  // contract here makes the WS test (qa-tavern-handlers.ts §7b) a
  // pure handler test instead of one that re-asserts store maths.
  // ===========================================================================
  console.log('\n[7b] recipient notification preconditions');
  _testReset();
  registerChannel({ channelId: CHAN1, walletA: A, walletB: B, createdBy: A });
  // Guarantee 1
  const firstBump = bumpUnread(CHAN1, B);
  truthy(firstBump, 'fresh-channel bump returns row');
  eq(firstBump!.unreadCount, 1, 'fresh-channel bump → count=1');
  // Guarantee 5
  bumpUnread(CHAN1, B);
  bumpUnread(CHAN1, B);
  eq(getUnread(CHAN1, B), 3, 'three bumps in a row → count=3');
  // Guarantee 2 (asymmetry — the sender is NOT charged unread)
  eq(getUnread(CHAN1, A), 0, 'sender (A) keeps unread=0 after 3 bumps to recipient');
  // Guarantee 3 — lastMessageAt advanced past createdAt
  const afterBumps = getChannelById(CHAN1)!;
  truthy(
    (afterBumps.lastMessageAt ?? 0) >= afterBumps.createdAt,
    'lastMessageAt >= createdAt after recipient bumps',
  );
  // Guarantee 4 — clearUnread is idempotent on never-bumped pair
  clearUnread('0xnope', B);
  clearUnread(CHAN1, '0xunknown');
  eq(getUnread(CHAN1, B), 3, 'no-op clears do not corrupt B counter');
  // Sequel — clearing then bumping resets to 1
  clearUnread(CHAN1, B);
  eq(getUnread(CHAN1, B), 0, 'clear → 0');
  const reBump = bumpUnread(CHAN1, B);
  eq(reBump!.unreadCount, 1, 'bump after clear → 1 (not 4)');

  // Total-unread aggregator survives multiple channels with the SAME
  // recipient (the recipient is in N channels, each with K unread).
  _testReset();
  registerChannel({ channelId: CHAN1, walletA: A, walletB: B, createdBy: A });
  registerChannel({ channelId: CHAN2, walletA: C, walletB: B, createdBy: C });
  bumpUnread(CHAN1, B);
  bumpUnread(CHAN1, B);
  bumpUnread(CHAN2, B);
  eq(
    getTotalUnreadForWallet(B),
    3,
    'B totalUnread sums across multiple peers (2 from A + 1 from C)',
  );

  // ===========================================================================
  // 8 — list ordering by lastMessageAt
  // ===========================================================================
  console.log('\n[8] listChannelsForWallet — sort by lastMessageAt desc');
  _testReset();
  registerChannel({ channelId: CHAN1, walletA: A, walletB: B, createdBy: A });
  // Block briefly so CHAN2's createdAt/lastMessageAt is strictly later
  // than CHAN1's. JS Date.now() granularity is 1ms; we need >= 2ms gap
  // to be safe.
  const blockUntil = Date.now() + 5;
  while (Date.now() < blockUntil) { /* spin */ }
  registerChannel({ channelId: CHAN2, walletA: A, walletB: C, createdBy: A });
  const blockUntil2 = Date.now() + 5;
  while (Date.now() < blockUntil2) { /* spin */ }
  bumpUnread(CHAN2, C);
  const list = listChannelsForWallet(A);
  eq(list.length, 2, 'A has 2 channels');
  eq(list[0].channelId, CHAN2, 'most-recent channel first');
  eq(list[1].channelId, CHAN1, 'older channel second');

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
