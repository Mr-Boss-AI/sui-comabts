/**
 * WebSocket pending-queue gauntlet — pure unit tests, no real socket.
 *
 *   $ cd server && npx tsx ../scripts/qa-ws-readystate.ts
 *
 * Regression-locks Bucket 2 Fix 2 (2026-05-04): outbound messages
 * fired while `readyState !== OPEN` (CONNECTING / CLOSING / CLOSED)
 * used to print `[WS] DROPPED outbound … — readyState=0` errors. Now
 * they queue and drain on reconnect; messages older than the staleness
 * threshold are discarded; the queue is capped against runaway
 * producers.
 *
 * `drainPendingMessages` and `capPendingQueue` are the pure pieces
 * that are testable without a real socket — the hook (`useGameSocket`)
 * just calls them with the live WebSocket.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  drainPendingMessages,
  capPendingQueue,
  type PendingMessage,
} from '../frontend/src/lib/ws-pending-queue';

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

function mkMsg(type: string, enqueuedAt: number): PendingMessage {
  return { type, payload: JSON.stringify({ type }), enqueuedAt };
}

const STALE_MS = 30_000;

// ============================================================================
// drainPendingMessages — happy path
// ============================================================================

function testDrainEmpty(): void {
  section('drainPendingMessages — empty queue');
  const queue: PendingMessage[] = [];
  let sentPayloads: string[] = [];
  const result = drainPendingMessages(queue, (p) => { sentPayloads.push(p); return true; }, 1000, STALE_MS);
  eq(result.sent, 0, 'sent count = 0');
  eq(result.discarded, 0, 'discarded count = 0');
  eq(queue.length, 0, 'queue still empty');
  eq(sentPayloads.length, 0, 'send never called');
}

function testDrainAllFresh(): void {
  section('drainPendingMessages — all fresh, all sent in FIFO order');
  const now = 10_000;
  const queue: PendingMessage[] = [
    mkMsg('a', now - 100),
    mkMsg('b', now - 50),
    mkMsg('c', now - 25),
  ];
  const sentPayloads: string[] = [];
  const result = drainPendingMessages(queue, (p) => { sentPayloads.push(p); return true; }, now, STALE_MS);
  eq(result.sent, 3, '3 sent');
  eq(result.discarded, 0, '0 discarded');
  eq(queue.length, 0, 'queue drained');
  deepEq(sentPayloads, [
    JSON.stringify({ type: 'a' }),
    JSON.stringify({ type: 'b' }),
    JSON.stringify({ type: 'c' }),
  ], 'FIFO order preserved');
}

function testDrainStaleDiscarded(): void {
  section('drainPendingMessages — stale entries (> threshold) discarded');
  const now = 100_000;
  const queue: PendingMessage[] = [
    mkMsg('really-old', now - 60_000),  // 60 s — over threshold (30 s)
    mkMsg('also-old', now - 31_000),
    mkMsg('fresh', now - 5_000),
  ];
  const sentPayloads: string[] = [];
  const result = drainPendingMessages(queue, (p) => { sentPayloads.push(p); return true; }, now, STALE_MS);
  eq(result.sent, 1, 'only fresh sent');
  eq(result.discarded, 2, '2 stale discarded');
  eq(queue.length, 0, 'queue empty');
  deepEq(sentPayloads, [JSON.stringify({ type: 'fresh' })], 'only the fresh one');
}

function testDrainBoundary(): void {
  section('drainPendingMessages — boundary: age === threshold is fresh');
  const now = 100_000;
  const queue: PendingMessage[] = [
    mkMsg('exact', now - STALE_MS),         // exactly threshold — fresh
    mkMsg('one-over', now - STALE_MS - 1),  // 1 ms over — stale
  ];
  const sentPayloads: string[] = [];
  const result = drainPendingMessages(queue, (p) => { sentPayloads.push(p); return true; }, now, STALE_MS);
  eq(result.sent, 1, 'boundary fresh sent');
  eq(result.discarded, 1, 'one-over discarded');
}

function testDrainBailMidway(): void {
  section('drainPendingMessages — send returns false mid-drain → bail');
  const now = 10_000;
  const queue: PendingMessage[] = [
    mkMsg('a', now - 100),
    mkMsg('b', now - 50),
    mkMsg('c', now - 25),
  ];
  let calls = 0;
  const sentPayloads: string[] = [];
  const result = drainPendingMessages(
    queue,
    (p) => {
      calls++;
      if (calls === 2) return false;  // simulate socket transition
      sentPayloads.push(p);
      return true;
    },
    now,
    STALE_MS,
  );
  eq(result.sent, 1, '1 sent before bail');
  eq(result.discarded, 0, 'no stale');
  eq(queue.length, 2, 'remaining 2 still queued (b + c)');
  eq(queue[0].type, 'b', 'failed entry b stays at head');
  eq(queue[1].type, 'c', 'untouched entry c follows');
}

function testDrainStaleBeforeFresh(): void {
  section('drainPendingMessages — stale leading, then fresh');
  const now = 100_000;
  const queue: PendingMessage[] = [
    mkMsg('stale-1', now - 60_000),
    mkMsg('stale-2', now - 45_000),
    mkMsg('fresh-1', now - 10_000),
    mkMsg('fresh-2', now - 5_000),
  ];
  const sentPayloads: string[] = [];
  const result = drainPendingMessages(queue, (p) => { sentPayloads.push(p); return true; }, now, STALE_MS);
  eq(result.sent, 2, 'two fresh sent');
  eq(result.discarded, 2, 'two stale discarded');
  deepEq(sentPayloads, [JSON.stringify({ type: 'fresh-1' }), JSON.stringify({ type: 'fresh-2' })],
    'fresh ones, in order');
}

// ============================================================================
// capPendingQueue — overflow handling
// ============================================================================

function testCapNoOp(): void {
  section('capPendingQueue — under cap is a no-op');
  const queue: PendingMessage[] = [mkMsg('a', 0), mkMsg('b', 0), mkMsg('c', 0)];
  const dropped = capPendingQueue(queue, 5);
  eq(dropped, 0, '0 dropped');
  eq(queue.length, 3, 'queue unchanged');
}

function testCapEqualsLength(): void {
  section('capPendingQueue — queue.length === maxLength is a no-op');
  const queue: PendingMessage[] = [mkMsg('a', 0), mkMsg('b', 0), mkMsg('c', 0)];
  const dropped = capPendingQueue(queue, 3);
  eq(dropped, 0, '0 dropped (boundary)');
  eq(queue.length, 3, 'queue unchanged');
}

function testCapDropsOldest(): void {
  section('capPendingQueue — oldest entries dropped first');
  const queue: PendingMessage[] = [
    mkMsg('oldest', 0),
    mkMsg('older', 1),
    mkMsg('mid', 2),
    mkMsg('newer', 3),
    mkMsg('newest', 4),
  ];
  const dropped = capPendingQueue(queue, 3);
  eq(dropped, 2, 'dropped 2 (5 → 3)');
  eq(queue.length, 3, 'queue length 3');
  deepEq(queue.map((m) => m.type), ['mid', 'newer', 'newest'], 'oldest two evicted');
}

// ============================================================================
// Integration — simulated reconnect cycle
// ============================================================================

function testIntegrationReconnectCycle(): void {
  section('Integration — simulated reconnect cycle');

  // Disconnected: enqueue 4 messages over 40 seconds.
  const queue: PendingMessage[] = [];
  queue.push(mkMsg('get_inventory', 0));        // age 35 s when drained → stale
  queue.push(mkMsg('get_character', 10_000));   // age 25 s → fresh
  queue.push(mkMsg('get_wager_lobby', 20_000)); // age 15 s → fresh
  queue.push(mkMsg('get_online_players', 30_000)); // age 5 s → fresh

  const drainTime = 35_000;
  const sentPayloads: string[] = [];
  const result = drainPendingMessages(
    queue, (p) => { sentPayloads.push(p); return true; }, drainTime, STALE_MS,
  );

  eq(result.sent, 3, '3 fresh polls sent on reconnect');
  eq(result.discarded, 1, '1 stale poll discarded');
  eq(queue.length, 0, 'queue fully drained');

  // The discarded 35 s-old `get_inventory` is fine — the polling effect
  // re-fires it on next mount-time render, the player never notices.
  deepEq(
    sentPayloads.map((p) => JSON.parse(p).type),
    ['get_character', 'get_wager_lobby', 'get_online_players'],
    'sent in original FIFO order',
  );
}

function testIntegrationOverflow(): void {
  section('Integration — runaway producer overflows the cap');

  const queue: PendingMessage[] = [];
  for (let i = 0; i < 250; i++) {
    queue.push(mkMsg(`poll-${i}`, i * 10));
  }

  const dropped = capPendingQueue(queue, 200);
  eq(dropped, 50, '50 oldest dropped');
  eq(queue.length, 200, 'queue capped at 200');
  eq(queue[0].type, 'poll-50', 'first surviving entry is index 50');
  eq(queue[199].type, 'poll-249', 'last is the newest');
}

// ============================================================================
// Runner
// ============================================================================

function run(): void {
  console.log('\n──────────────────────────────────────────────────');
  console.log(' qa-ws-readystate.ts — Bucket 2 Fix 2 (queue + drain)');
  console.log('──────────────────────────────────────────────────');

  // drainPendingMessages
  testDrainEmpty();
  testDrainAllFresh();
  testDrainStaleDiscarded();
  testDrainBoundary();
  testDrainBailMidway();
  testDrainStaleBeforeFresh();

  // capPendingQueue
  testCapNoOp();
  testCapEqualsLength();
  testCapDropsOldest();

  // Integration
  testIntegrationReconnectCycle();
  testIntegrationOverflow();

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
