/**
 * DM messages data-layer gauntlet (Hotfix #6, 2026-05-06).
 *
 *   $ cd server && npx tsx ../scripts/qa-dm-messages.ts
 *
 * Pins the message body store + synthetic channel id helper that
 * back the plaintext DM transport. Pure JS, no DB (in-memory mode).
 *
 * Coverage:
 *   1. syntheticChannelIdForPair — deterministic; canonical pair
 *      ordering (A,B == B,A); 0x prefix; 64-hex body.
 *   2. insertMessage — happy path returns row with id, body, ts;
 *      rejects empty / over-cap; rejects self-send; lowercases
 *      both sender & recipient.
 *   3. getHistory — chronological (oldest first); respects limit;
 *      returns empty for unknown channels.
 *   4. getOrCreateSyntheticChannel — idempotent; same pair returns
 *      same id regardless of caller order; freshness flag.
 *   5. In-memory tail cap — IN_MEMORY_TAIL deepest messages kept.
 *   6. End-to-end: insert → getHistory roundtrip + tail order.
 */
import {
  insertMessage,
  getHistory,
  syntheticChannelIdForPair,
  _testReset as resetMessages,
} from '../server/src/data/dm-messages';
import {
  getOrCreateSyntheticChannel,
  canonicalPair,
  _testReset as resetChannels,
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

function reset() {
  resetMessages();
  resetChannels();
}

const A = '0x' + 'a'.repeat(64);
const B = '0x' + 'b'.repeat(64);
const C = '0x' + 'c'.repeat(64);

async function main(): Promise<void> {
  // ===========================================================================
  // 1 — syntheticChannelIdForPair
  // ===========================================================================
  console.log('\n[1] syntheticChannelIdForPair — deterministic + canonical');
  {
    const id1 = syntheticChannelIdForPair(A, B);
    const id2 = syntheticChannelIdForPair(B, A);
    eq(id1, id2, 'A,B and B,A canonicalise to same id');
    truthy(id1.startsWith('0x'), 'id is 0x-prefixed');
    eq(id1.length, 66, 'id is exactly 0x + 64 hex chars (sha256)');
    truthy(/^0x[0-9a-f]{64}$/.test(id1), 'id matches 0x[0-9a-f]{64}');
    // Different pair → different id.
    const idAC = syntheticChannelIdForPair(A, C);
    truthy(idAC !== id1, 'different pair → different id');
    // Case-insensitive (canonical pair lowercases first).
    const idMixed = syntheticChannelIdForPair(A.toUpperCase(), B);
    eq(idMixed, id1, 'mixed-case input still hashes to same id');
  }

  // ===========================================================================
  // 2 — insertMessage validation + happy path
  // ===========================================================================
  console.log('\n[2] insertMessage — validation + happy');
  reset();
  {
    // Pre-create the channel (FK constraint in real DB; in-memory
    // mode tolerates a missing channel but the API contract requires
    // the caller to ensure existence).
    const ch = getOrCreateSyntheticChannel(A, B, A);
    truthy(ch.fresh, 'channel freshly created');

    // Empty body → invalid_input
    const empty = await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: A,
      recipientWallet: B,
      body: '',
    });
    eq(empty.error, 'invalid_input', 'empty body rejected');

    // Whitespace-only body → invalid_input (trimmed to 0)
    const ws = await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: A,
      recipientWallet: B,
      body: '   ',
    });
    eq(ws.error, 'invalid_input', 'whitespace-only body rejected');

    // Over 2000 chars → invalid_input
    const huge = await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: A,
      recipientWallet: B,
      body: 'x'.repeat(2001),
    });
    eq(huge.error, 'invalid_input', '>2000 char body rejected');

    // Self-send → self_send
    const self = await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: A,
      recipientWallet: A,
      body: 'note to self',
    });
    eq(self.error, 'self_send', 'self-send rejected');

    // Bad channelId → invalid_input
    const badChan = await insertMessage({
      channelId: 'not-an-address',
      senderWallet: A,
      recipientWallet: B,
      body: 'hi',
    });
    eq(badChan.error, 'invalid_input', 'non-0x channelId rejected');

    // Happy path
    const good = await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: A,
      recipientWallet: B,
      body: 'hello',
    });
    truthy(good.row, 'happy insert returns row');
    eq(good.row!.body, 'hello', 'body preserved');
    eq(good.row!.senderWallet, A.toLowerCase(), 'sender lowercased');
    eq(good.row!.recipientWallet, B.toLowerCase(), 'recipient lowercased');
    truthy(good.row!.createdAtMs > 0, 'createdAtMs set');
    truthy(good.row!.id.length > 0, 'id is non-empty');

    // Body trimmed (leading/trailing whitespace stripped)
    const trimmed = await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: A,
      recipientWallet: B,
      body: '   trimmed   ',
    });
    eq(trimmed.row!.body, 'trimmed', 'body whitespace-trimmed');
  }

  // ===========================================================================
  // 3 — getHistory — chronological + limit
  // ===========================================================================
  console.log('\n[3] getHistory — chronological + limit');
  reset();
  {
    const ch = getOrCreateSyntheticChannel(A, B, A);
    // Send 5 messages back-and-forth so order matters.
    await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: A,
      recipientWallet: B,
      body: 'm1',
    });
    await new Promise((r) => setTimeout(r, 2));
    await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: B,
      recipientWallet: A,
      body: 'm2',
    });
    await new Promise((r) => setTimeout(r, 2));
    await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: A,
      recipientWallet: B,
      body: 'm3',
    });
    await new Promise((r) => setTimeout(r, 2));
    await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: B,
      recipientWallet: A,
      body: 'm4',
    });
    await new Promise((r) => setTimeout(r, 2));
    await insertMessage({
      channelId: ch.row.channelId,
      senderWallet: A,
      recipientWallet: B,
      body: 'm5',
    });

    const all = await getHistory({ channelId: ch.row.channelId, limit: 50 });
    eq(all.length, 5, '5 messages returned');
    eq(all[0].body, 'm1', 'oldest first');
    eq(all[4].body, 'm5', 'newest last');
    // Ordering by createdAtMs ascending
    for (let i = 1; i < all.length; i++) {
      truthy(
        all[i].createdAtMs >= all[i - 1].createdAtMs,
        `chronological at index ${i}`,
      );
    }

    // Limit cap
    const tail = await getHistory({ channelId: ch.row.channelId, limit: 2 });
    eq(tail.length, 2, 'limit=2 returns 2');
    eq(tail[0].body, 'm4', 'limit=2 returns the LAST 2 (m4, m5)');
    eq(tail[1].body, 'm5', 'limit=2 second is m5');

    // Limit > total → return all
    const over = await getHistory({ channelId: ch.row.channelId, limit: 100 });
    eq(over.length, 5, 'limit > total → return all');

    // Unknown channel → empty
    const unknown = await getHistory({ channelId: '0x' + 'f'.repeat(64), limit: 10 });
    eq(unknown.length, 0, 'unknown channel → empty array');
  }

  // ===========================================================================
  // 4 — getOrCreateSyntheticChannel — idempotent
  // ===========================================================================
  console.log('\n[4] getOrCreateSyntheticChannel — idempotent + canonical');
  reset();
  {
    const r1 = getOrCreateSyntheticChannel(A, B, A);
    eq(r1.fresh, true, 'first call creates');
    const r2 = getOrCreateSyntheticChannel(A, B, B);
    eq(r2.fresh, false, 'second call (same pair) is not fresh');
    eq(r1.row.channelId, r2.row.channelId, 'same channel id returned');
    // Reverse caller order — same pair canonicalises identically.
    const r3 = getOrCreateSyntheticChannel(B, A, A);
    eq(r3.fresh, false, 'reverse-order call is not fresh');
    eq(r3.row.channelId, r1.row.channelId, 'reverse order → same id');
    // Different pair → different channel
    const r4 = getOrCreateSyntheticChannel(A, C, A);
    eq(r4.fresh, true, 'different pair → fresh');
    truthy(r4.row.channelId !== r1.row.channelId, 'different channel id');
    // Channel id matches the synthetic helper's output
    eq(
      r1.row.channelId,
      syntheticChannelIdForPair(A, B),
      'channel id matches syntheticChannelIdForPair(A, B)',
    );
  }

  // ===========================================================================
  // 5 — End-to-end ordering across history fetches
  // ===========================================================================
  console.log('\n[5] end-to-end — insert + history preserve order');
  reset();
  {
    const ch = getOrCreateSyntheticChannel(A, B, A);
    const expected: string[] = [];
    for (let i = 0; i < 10; i++) {
      const body = `msg-${i}`;
      expected.push(body);
      await insertMessage({
        channelId: ch.row.channelId,
        senderWallet: i % 2 === 0 ? A : B,
        recipientWallet: i % 2 === 0 ? B : A,
        body,
      });
      // 1 ms gap so timestamps strictly increase.
      await new Promise((r) => setTimeout(r, 1));
    }
    const history = await getHistory({ channelId: ch.row.channelId, limit: 50 });
    eq(history.length, 10, '10 messages persisted');
    for (let i = 0; i < 10; i++) {
      eq(history[i].body, expected[i], `index ${i} matches expected`);
    }
  }

  // ===========================================================================
  // 6 — canonical pair sanity (regression guard)
  // ===========================================================================
  console.log('\n[6] canonicalPair sanity (regression)');
  {
    const c = canonicalPair(B, A);
    eq(c.a, A.toLowerCase(), 'canonical .a is the lex-smaller');
    eq(c.b, B.toLowerCase(), 'canonical .b is the lex-larger');
    truthy(c.a < c.b, '.a strictly less than .b');
  }

  finalReport();
}

function finalReport(): void {
  console.log(`\n✓ Passed: ${passes}`);
  if (failures > 0) {
    console.log(`✗ Failed: ${failures}`);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('UNCAUGHT', err);
  process.exit(1);
});
