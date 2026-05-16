/**
 * Plaintext DM pipeline integration gauntlet (Hotfix #6, 2026-05-06).
 *
 *   $ cd server && npx tsx ../scripts/qa-dm-plaintext-pipeline.ts
 *
 * Pins the contract for the plain-WS DM transport that ships by
 * default while the Sui Stack Messaging SDK remains in alpha. Mocks
 * the WS surface (a fake send + subscribe pair) and exercises every
 * realistic failure mode end to end:
 *
 *   1. Happy send — server echoes `dm_message_sent` matched by
 *      clientId; pipeline resolves with the confirmed message.
 *   2. Server rejects send (`error` payload) → pipeline rejects.
 *   3. Server hangs → pipeline rejects within the budget; subscriber
 *      cleaned up; later mock messages don't accidentally resolve.
 *   4. Multiple in-flight sends with different clientIds → each
 *      resolves with its OWN echo (no cross-talk).
 *   5. History happy path — server replies with messages array;
 *      pipeline resolves with channelId + messages + hasMore.
 *   6. History — null channelId path (no DMs ever exchanged).
 *   7. History — unmatched peerWallet in response is ignored
 *      (pipeline waits for the right one).
 *   8. wsSend throws → pipeline rejects + cleans up subscriber.
 *
 * Pure JS, no DB, no real WS. The mocked ws fires events on a
 * microtask so the async timing is realistic without slowing down
 * the gauntlet.
 */

import {
  runPlaintextDmSend,
  runPlaintextDmHistory,
  type PlaintextDmDeps,
} from '../frontend/src/lib/dm-plaintext-pipeline';
import type { DmMessageWire } from '../frontend/src/types/ws-messages';

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

interface FakeWs {
  sent: Array<Record<string, unknown>>;
  /** Listeners registered via subscribe. Each call gets every emit. */
  listeners: Set<(msg: Record<string, unknown>) => void>;
  /** Test-controlled emit — pushes a message to every listener
   *  asynchronously so we model the WS receive ordering. */
  emit: (msg: Record<string, unknown>) => void;
  /** Test-controlled error path — make wsSend throw on next call. */
  failNextSend: boolean;
  deps: PlaintextDmDeps;
}

function makeFakeWs(opts: { timeoutMs?: number } = {}): FakeWs {
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Set<(msg: Record<string, unknown>) => void>();
  const fake: FakeWs = {
    sent,
    listeners,
    failNextSend: false,
    emit(msg) {
      // Microtask so the listener resolves between awaits, not
      // synchronously inside wsSend (which would be unrealistic).
      Promise.resolve().then(() => {
        for (const h of listeners) h(msg);
      });
    },
    deps: undefined as never, // filled below
  };
  fake.deps = {
    wsSend(msg) {
      if (fake.failNextSend) {
        fake.failNextSend = false;
        throw new Error('socket disconnected');
      }
      sent.push(msg);
    },
    subscribe(h) {
      listeners.add(h);
      return () => {
        listeners.delete(h);
      };
    },
    timeoutMs: opts.timeoutMs,
  };
  return fake;
}

function mkWire(over: Partial<DmMessageWire> = {}): DmMessageWire {
  return {
    id: '42',
    channelId: '0x' + 'c'.repeat(64),
    senderWallet: '0x' + 'a'.repeat(64),
    recipientWallet: '0x' + 'b'.repeat(64),
    body: 'hi',
    createdAtMs: 1234567890,
    ...over,
  };
}

async function main(): Promise<void> {
  // ===========================================================================
  // 1 — happy send: clientId-matched echo resolves
  // ===========================================================================
  console.log('\n[1] happy send — clientId-matched echo resolves');
  {
    const ws = makeFakeWs();
    const promise = runPlaintextDmSend(ws.deps, {
      peerWallet: '0x' + 'b'.repeat(64),
      body: 'hi',
      clientId: 'cid-1',
    });
    // Server echoes after we send.
    ws.emit({
      type: 'dm_message_sent',
      clientId: 'cid-1',
      message: mkWire({ id: '101', body: 'hi' }),
    });
    const confirmed = await promise;
    eq(confirmed.id, '101', 'pipeline returns the server-confirmed id');
    eq(confirmed.body, 'hi', 'returns the body');
    eq(ws.sent.length, 1, 'one WS send fired');
    eq(ws.sent[0].type, 'dm_send', 'WS send type=dm_send');
    eq(ws.sent[0].clientId, 'cid-1', 'WS send carries clientId');
    eq(ws.sent[0].peerWallet, '0x' + 'b'.repeat(64), 'WS send carries peer');
    eq(ws.sent[0].body, 'hi', 'WS send carries body');
    eq(ws.listeners.size, 0, 'subscriber cleaned up on resolve');
  }

  // ===========================================================================
  // 2 — server rejects send via `error` payload
  // ===========================================================================
  console.log('\n[2] server `error` rejects the pipeline');
  {
    const ws = makeFakeWs();
    const promise = runPlaintextDmSend(ws.deps, {
      peerWallet: '0x' + 'b'.repeat(64),
      body: 'hi',
      clientId: 'cid-2',
    });
    ws.emit({ type: 'error', message: 'recipient is offline' });
    let err: Error | null = null;
    try {
      await promise;
      fail('server-error path', 'expected rejection');
    } catch (e: unknown) {
      err = e as Error;
    }
    truthy(err instanceof Error, 'pipeline rejected with an Error');
    truthy(
      err && /recipient is offline/.test(err.message),
      'rejection includes the server message',
    );
    eq(ws.listeners.size, 0, 'subscriber cleaned up on reject');
  }

  // ===========================================================================
  // 3 — server hangs → master timeout fires; no late-arrival cross-talk
  // ===========================================================================
  console.log('\n[3] server hangs → timeout; late echo does not resolve');
  {
    const ws = makeFakeWs({ timeoutMs: 100 });
    const start = Date.now();
    const promise = runPlaintextDmSend(ws.deps, {
      peerWallet: '0x' + 'b'.repeat(64),
      body: 'hi',
      clientId: 'cid-3',
    });
    let err: Error | null = null;
    try {
      await promise;
      fail('hanging send', 'expected timeout rejection');
    } catch (e: unknown) {
      err = e as Error;
    }
    const elapsed = Date.now() - start;
    truthy(err instanceof Error, 'pipeline rejected on timeout');
    truthy(
      err && /timed out/.test(err.message),
      'rejection message includes "timed out"',
    );
    truthy(
      elapsed >= 100 && elapsed < 1500,
      `rejection fires near budget (got ${elapsed}ms)`,
    );
    eq(ws.listeners.size, 0, 'subscriber cleaned up on timeout');
    // Late echo lands AFTER timeout — must not resolve a stale promise.
    let lateResolveSurprise = false;
    promise.then(
      () => {
        lateResolveSurprise = true;
      },
      () => {
        // Already rejected — ignore.
      },
    );
    ws.emit({
      type: 'dm_message_sent',
      clientId: 'cid-3',
      message: mkWire(),
    });
    await new Promise((r) => setTimeout(r, 30));
    eq(lateResolveSurprise, false, 'late echo does not resolve the timed-out promise');
  }

  // ===========================================================================
  // 4 — multiple in-flight sends with different clientIds
  // ===========================================================================
  console.log('\n[4] concurrent sends — each resolves with its own echo');
  {
    const ws = makeFakeWs();
    const p1 = runPlaintextDmSend(ws.deps, {
      peerWallet: '0x' + 'b'.repeat(64),
      body: 'first',
      clientId: 'cid-4a',
    });
    const p2 = runPlaintextDmSend(ws.deps, {
      peerWallet: '0x' + 'b'.repeat(64),
      body: 'second',
      clientId: 'cid-4b',
    });
    // Server echoes in REVERSE order — should still match correctly.
    ws.emit({
      type: 'dm_message_sent',
      clientId: 'cid-4b',
      message: mkWire({ id: '202', body: 'second' }),
    });
    ws.emit({
      type: 'dm_message_sent',
      clientId: 'cid-4a',
      message: mkWire({ id: '201', body: 'first' }),
    });
    const r1 = await p1;
    const r2 = await p2;
    eq(r1.id, '201', 'p1 (cid-4a) resolves with its echo (id=201)');
    eq(r1.body, 'first', 'p1 body matches');
    eq(r2.id, '202', 'p2 (cid-4b) resolves with its echo (id=202)');
    eq(r2.body, 'second', 'p2 body matches');
    eq(ws.listeners.size, 0, 'all subscribers cleaned up');
  }

  // ===========================================================================
  // 5 — history happy path
  // ===========================================================================
  console.log('\n[5] history — happy path');
  {
    const ws = makeFakeWs();
    const promise = runPlaintextDmHistory(ws.deps, {
      peerWallet: '0x' + 'b'.repeat(64),
      limit: 50,
    });
    const peerLower = ('0x' + 'b'.repeat(64)).toLowerCase();
    ws.emit({
      type: 'dm_history',
      peerWallet: peerLower,
      channelId: '0x' + 'c'.repeat(64),
      messages: [mkWire({ id: '1' }), mkWire({ id: '2', body: 'second' })],
      hasMore: false,
    });
    const result = await promise;
    eq(result.channelId, '0x' + 'c'.repeat(64), 'channelId returned');
    eq(result.messages.length, 2, 'two messages returned');
    eq(result.messages[0].id, '1', 'oldest first');
    eq(result.hasMore, false, 'hasMore=false');
    eq(ws.sent[0].type, 'dm_history', 'WS send type=dm_history');
    eq(ws.sent[0].peerWallet, '0x' + 'b'.repeat(64), 'WS send carries peer');
    eq(ws.sent[0].limit, 50, 'WS send carries limit');
    eq(ws.listeners.size, 0, 'subscriber cleaned up');
  }

  // ===========================================================================
  // 6 — history — channelId null (no DMs ever exchanged)
  // ===========================================================================
  console.log('\n[6] history — channelId null (no DMs yet)');
  {
    const ws = makeFakeWs();
    const promise = runPlaintextDmHistory(ws.deps, {
      peerWallet: '0x' + 'b'.repeat(64),
    });
    ws.emit({
      type: 'dm_history',
      peerWallet: ('0x' + 'b'.repeat(64)).toLowerCase(),
      channelId: null,
      messages: [],
      hasMore: false,
    });
    const result = await promise;
    eq(result.channelId, null, 'channelId is null');
    eq(result.messages.length, 0, 'empty messages');
    eq(result.hasMore, false, 'hasMore=false');
  }

  // ===========================================================================
  // 7 — history — unmatched peer in response is ignored
  // ===========================================================================
  console.log('\n[7] history — unmatched peer ignored, waits for correct one');
  {
    const ws = makeFakeWs({ timeoutMs: 100 });
    const myPeer = '0x' + 'b'.repeat(64);
    const otherPeer = '0x' + 'd'.repeat(64);
    const promise = runPlaintextDmHistory(ws.deps, { peerWallet: myPeer });
    // Some other panel's history reply lands first — we should ignore it.
    ws.emit({
      type: 'dm_history',
      peerWallet: otherPeer.toLowerCase(),
      channelId: '0x' + 'e'.repeat(64),
      messages: [mkWire({ id: 'wrong' })],
      hasMore: false,
    });
    // Then our reply lands.
    ws.emit({
      type: 'dm_history',
      peerWallet: myPeer.toLowerCase(),
      channelId: '0x' + 'c'.repeat(64),
      messages: [mkWire({ id: 'right' })],
      hasMore: false,
    });
    const result = await promise;
    eq(result.messages[0].id, 'right', 'pipeline returned OUR history, not the cross-talk');
  }

  // ===========================================================================
  // 8 — wsSend throws → pipeline rejects + cleans up
  // ===========================================================================
  console.log('\n[8] wsSend throws → pipeline rejects + cleans up subscriber');
  {
    const ws = makeFakeWs();
    ws.failNextSend = true;
    let err: Error | null = null;
    try {
      await runPlaintextDmSend(ws.deps, {
        peerWallet: '0x' + 'b'.repeat(64),
        body: 'hi',
        clientId: 'cid-8',
      });
      fail('wsSend throw', 'expected rejection');
    } catch (e: unknown) {
      err = e as Error;
    }
    truthy(err instanceof Error, 'pipeline rejected');
    truthy(
      err && /socket disconnected/.test(err.message),
      'original error message preserved',
    );
    eq(ws.listeners.size, 0, 'subscriber cleaned up on synchronous send failure');
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
