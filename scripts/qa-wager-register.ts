/**
 * Wager-registration ACK gauntlet (post-orphan fix, 2026-05-02).
 *
 *   $ cd server && npx tsx ../scripts/qa-wager-register.ts
 *
 * Pre-fix (live test 2026-05-02): Mr_Boss created an 0.8 SUI wager
 * (WagerMatch 0xbdd3c596…). The on-chain TX succeeded, but the
 * `queue_fight` WS message that registers it with the game server was
 * silently lost — `socket.send` returned true (`readyState === OPEN` at
 * check-time), but the underlying TCP connection was already half-closed
 * and the bytes never reached the server. No lobby entry, no fight.
 * Wager orphaned until manual admin recovery (refund completed via
 * /api/admin/cancel-wager, tx f1okCdAi5R7p8hpVXVnaKHEKAoPNbN8vLUisigF1WLv).
 *
 * Fix: `registerWagerWithServer` waits for an ACK message (server
 * broadcasts `wager_lobby_added` carrying our wagerMatchId) within a
 * timeout. If the ACK doesn't arrive we fall back to POST
 * /api/admin/adopt-wager — REST has TCP-level error reporting, no silent
 * loss.
 *
 * This gauntlet pins every branch via mocked deps + a manual scheduler.
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  registerWagerWithServer,
  deriveHttpBaseUrl,
  type WagerRegisterDeps,
  type WagerRegisterResult,
} from '../frontend/src/lib/wager-register';
import type { ServerMessage } from '../frontend/src/types/ws-messages';

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

// ─────────────────────────────────────────────────────────────────────────────
// Manual scheduler — drives the timeout in tests deterministically.
// ─────────────────────────────────────────────────────────────────────────────
interface Manual {
  setTimeoutFn: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
  fireAll: () => void;
  pendingCount: () => number;
}
function manual(): Manual {
  interface Sched { id: number; cb: () => void; cancelled: boolean }
  const queue: Sched[] = [];
  let nextId = 1;
  return {
    setTimeoutFn(cb) {
      const e: Sched = { id: nextId++, cb, cancelled: false };
      queue.push(e);
      return e;
    },
    clearTimeoutFn(handle) {
      const e = handle as Sched;
      if (!e || e.cancelled) return;
      e.cancelled = true;
    },
    fireAll() {
      while (queue.some((q) => !q.cancelled)) {
        const idx = queue.findIndex((q) => !q.cancelled);
        if (idx === -1) return;
        const [e] = queue.splice(idx, 1);
        e.cb();
      }
    },
    pendingCount: () => queue.filter((q) => !q.cancelled).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock WS message bus — buildEmit triggers handlers in registration order.
// ─────────────────────────────────────────────────────────────────────────────
function buildBus() {
  const handlers = new Set<(m: ServerMessage) => void>();
  return {
    onMessage(handler: (m: ServerMessage) => void) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    emit(msg: ServerMessage) {
      for (const h of [...handlers]) h(msg);
    },
    handlerCount: () => handlers.size,
  };
}

const SAMPLE_WAGER_ID = '0xbdd3c59664ac87b9c40fcebcc84a1735da6e5a0c53b61c4695362771a85fcd65';

function lobbyAddedMsg(wagerMatchId: string, extra: Partial<{ creatorWallet: string }> = {}): ServerMessage {
  // Cast to ServerMessage — the real shape includes more fields, but this
  // helper only asserts wagerMatchId routing. Other fields aren't read by
  // registerWagerWithServer.
  return {
    type: 'wager_lobby_added',
    entry: {
      wagerMatchId,
      creatorWallet: extra.creatorWallet ?? '0xMR_BOSS',
      creatorCharacterId: 'char-uuid',
      creatorName: 'Mr_Boss',
      creatorLevel: 3,
      creatorRating: 1019,
      creatorStats: { strength: 5, dexterity: 5, intuition: 5, endurance: 5 },
      wagerAmount: 0.8,
      createdAt: Date.now(),
    },
  } as ServerMessage;
}

async function main(): Promise<void> {
  // ===========================================================================
  // 1 — Happy path: WS send succeeds + ACK arrives before timeout
  // ===========================================================================
  console.log('\n[1] Happy path — WS ACK arrives before timeout');
  {
    const m = manual();
    const bus = buildBus();
    let sendCalls = 0;
    let adoptCalls = 0;
    const deps: WagerRegisterDeps = {
      sendQueueFight: () => {
        sendCalls++;
        return true;
      },
      onMessage: (h) => bus.onMessage(h),
      adoptWager: async () => {
        adoptCalls++;
        return { ok: true };
      },
      setTimeoutFn: m.setTimeoutFn,
      clearTimeoutFn: m.clearTimeoutFn,
    };

    const promise = registerWagerWithServer(SAMPLE_WAGER_ID, deps, 7000);
    // Yield once so the function can subscribe + call sendQueueFight.
    await Promise.resolve();
    eq(sendCalls, 1, 'sendQueueFight called exactly once');
    eq(bus.handlerCount(), 1, 'one handler subscribed');

    // Server ACKs.
    bus.emit(lobbyAddedMsg(SAMPLE_WAGER_ID));
    const result = await promise;
    eq(result.kind, 'ack', 'returns kind=ack');
    eq(adoptCalls, 0, 'adopt-wager NOT called (ACK arrived in time)');
    eq(bus.handlerCount(), 0, 'handler unsubscribed after ACK');
    eq(m.pendingCount(), 0, 'timeout cleared');
  }

  // ===========================================================================
  // 2 — ⚡ Silent WS loss: ACK times out → adopt-wager succeeds
  //   (the EXACT scenario that orphaned 0xbdd3c596… on 2026-05-02)
  // ===========================================================================
  console.log('\n[2] ⚡ Silent WS loss — adopt-wager recovers');
  {
    const m = manual();
    const bus = buildBus();
    let adoptCalls = 0;
    let adoptedId: string | null = null;
    const deps: WagerRegisterDeps = {
      sendQueueFight: () => true, // socket.readyState OPEN → returns true
      onMessage: (h) => bus.onMessage(h),
      adoptWager: async (id) => {
        adoptCalls++;
        adoptedId = id;
        return { ok: true };
      },
      setTimeoutFn: m.setTimeoutFn,
      clearTimeoutFn: m.clearTimeoutFn,
    };

    const promise = registerWagerWithServer(SAMPLE_WAGER_ID, deps, 7000);
    await Promise.resolve();
    // Server NEVER emits wager_lobby_added — TCP silently dropped the WS bytes.
    m.fireAll();
    const result = await promise;

    eq(result.kind, 'recovered', '⚡ returns kind=recovered (orphan averted)');
    if (result.kind === 'recovered') {
      eq(result.via, 'adopt-wager', 'recovery path = adopt-wager');
    }
    eq(adoptCalls, 1, 'adopt-wager called exactly once');
    eq(adoptedId, SAMPLE_WAGER_ID, 'adopt-wager received the right wagerMatchId');
    eq(bus.handlerCount(), 0, 'handler unsubscribed on timeout');
  }

  // ===========================================================================
  // 3 — ACK arrives but is for a DIFFERENT wager (someone else's)
  //     We should ignore it and still wait for ours.
  // ===========================================================================
  console.log('\n[3] Other player\'s lobby entry doesn\'t false-ACK');
  {
    const m = manual();
    const bus = buildBus();
    let adoptCalls = 0;
    const deps: WagerRegisterDeps = {
      sendQueueFight: () => true,
      onMessage: (h) => bus.onMessage(h),
      adoptWager: async () => {
        adoptCalls++;
        return { ok: true };
      },
      setTimeoutFn: m.setTimeoutFn,
      clearTimeoutFn: m.clearTimeoutFn,
    };
    const promise = registerWagerWithServer(SAMPLE_WAGER_ID, deps, 7000);
    await Promise.resolve();

    // Sx creates a different wager in the same window.
    bus.emit(lobbyAddedMsg('0xDIFFERENT_WAGER_FROM_SX'));

    // Our wager ACK never arrives. Timeout fires → adopt-wager.
    m.fireAll();
    const result = await promise;
    eq(result.kind, 'recovered', 'unrelated lobby_added ignored; recovered');
    eq(adoptCalls, 1, 'adopt-wager called once');
  }

  // ===========================================================================
  // 4 — Both paths fail: WS ACK times out, adopt-wager rejects
  // ===========================================================================
  console.log('\n[4] Both paths fail — kind=failed with reason');
  {
    const m = manual();
    const bus = buildBus();
    const deps: WagerRegisterDeps = {
      sendQueueFight: () => true,
      onMessage: (h) => bus.onMessage(h),
      adoptWager: async () => ({
        ok: false,
        error: 'Wager not found on chain',
      }),
      setTimeoutFn: m.setTimeoutFn,
      clearTimeoutFn: m.clearTimeoutFn,
    };
    const promise = registerWagerWithServer(SAMPLE_WAGER_ID, deps, 7000);
    await Promise.resolve();
    m.fireAll();
    const result = await promise;
    eq(result.kind, 'failed', 'both-fail returns kind=failed');
    if (result.kind === 'failed') {
      eq(result.reason, 'Wager not found on chain', 'reason propagated');
    }
  }

  // ===========================================================================
  // 5 — adopt-wager throws (network down) → kind=failed with humanized reason
  // ===========================================================================
  console.log('\n[5] adopt-wager throws — kind=failed');
  {
    const m = manual();
    const bus = buildBus();
    const deps: WagerRegisterDeps = {
      sendQueueFight: () => true,
      onMessage: (h) => bus.onMessage(h),
      adoptWager: async () => {
        throw new Error('fetch failed: getaddrinfo ENOTFOUND');
      },
      setTimeoutFn: m.setTimeoutFn,
      clearTimeoutFn: m.clearTimeoutFn,
    };
    const promise = registerWagerWithServer(SAMPLE_WAGER_ID, deps, 7000);
    await Promise.resolve();
    m.fireAll();
    const result = await promise;
    eq(result.kind, 'failed', 'thrown error returned as kind=failed');
    if (result.kind === 'failed') {
      eq(
        result.reason.includes('getaddrinfo ENOTFOUND'),
        true,
        'reason carries the underlying error',
      );
    }
  }

  // ===========================================================================
  // 6 — sendQueueFight returns false (WS already closed) — STILL try adopt
  //     This is more aggressive than the pre-fix code (which returned
  //     immediately on send=false). REST works even when WS doesn't.
  // ===========================================================================
  console.log('\n[6] WS send returns false → still try adopt-wager (recovers)');
  {
    const m = manual();
    const bus = buildBus();
    let adoptCalls = 0;
    const deps: WagerRegisterDeps = {
      sendQueueFight: () => false, // WS dead at check time
      onMessage: (h) => bus.onMessage(h),
      adoptWager: async () => {
        adoptCalls++;
        return { ok: true };
      },
      setTimeoutFn: m.setTimeoutFn,
      clearTimeoutFn: m.clearTimeoutFn,
    };
    const promise = registerWagerWithServer(SAMPLE_WAGER_ID, deps, 7000);
    await Promise.resolve();
    m.fireAll();
    const result = await promise;
    eq(result.kind, 'recovered', 'send=false still recovers via REST');
    eq(adoptCalls, 1, 'adopt-wager called');
  }

  // ===========================================================================
  // 7 — ⚡ Race resolution: ACK arrives DURING the same tick as timeout
  //   The contract: whichever fires first wins. We test that no double-
  //   resolve happens (the resolver in the helper is unique per Promise).
  // ===========================================================================
  console.log('\n[7] ⚡ ACK arrives just before timeout — single resolution');
  {
    const m = manual();
    const bus = buildBus();
    let adoptCalls = 0;
    const deps: WagerRegisterDeps = {
      sendQueueFight: () => true,
      onMessage: (h) => bus.onMessage(h),
      adoptWager: async () => {
        adoptCalls++;
        return { ok: true };
      },
      setTimeoutFn: m.setTimeoutFn,
      clearTimeoutFn: m.clearTimeoutFn,
    };
    const promise = registerWagerWithServer(SAMPLE_WAGER_ID, deps, 7000);
    await Promise.resolve();

    // ACK fires first.
    bus.emit(lobbyAddedMsg(SAMPLE_WAGER_ID));
    // Then the timeout would fire — but it should have been cancelled.
    m.fireAll();

    const result = await promise;
    eq(result.kind, 'ack', 'first-wins is the ACK');
    eq(adoptCalls, 0, 'adopt-wager NOT called (ACK already won)');
    eq(m.pendingCount(), 0, 'no leftover timers');
  }

  // ===========================================================================
  // 8 — deriveHttpBaseUrl: WS → HTTP scheme conversion
  // ===========================================================================
  console.log('\n[8] deriveHttpBaseUrl — scheme conversion');
  eq(deriveHttpBaseUrl('ws://localhost:3001'), 'http://localhost:3001', 'ws → http');
  eq(deriveHttpBaseUrl('wss://api.example.com'), 'https://api.example.com', 'wss → https');
  eq(
    deriveHttpBaseUrl('localhost:3001'),
    'http://localhost:3001',
    'bare host → http (testnet dev fallback)',
  );

  console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n\x1b[31m✘ Gauntlet crashed:\x1b[0m', err);
  process.exit(1);
});
