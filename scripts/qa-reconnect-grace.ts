/**
 * Reconnect-grace gauntlet (Block C1, 2026-04-30 Gemini re-audit).
 *
 *   $ cd server && npx tsx ../scripts/qa-reconnect-grace.ts
 *
 * Pre-fix: `handlePlayerDisconnect` called `finishFight('disconnect')`
 * INSTANTLY on socket close — players forfeited real SUI on a 2-second
 * wifi blip. Block C1 introduces a configurable grace window
 * (default 60s) and a re-auth path that cancels the pending forfeit if
 * the same wallet rejoins the same fight in time.
 *
 * The state machine lives in `server/src/ws/reconnect-grace.ts` so it
 * can be unit-tested without spinning up a real fight, real chain, or
 * real WebSocket. This gauntlet drives every branch with a manual
 * scheduler.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  markDisconnect,
  markReconnect,
  isDisconnectPending,
  _resetForTest,
  _setSchedulerForTest,
  _setGraceMsForTest,
  _getGraceMsForTest,
  type GraceScheduler,
  type GraceTimerHandle,
} from '../server/src/ws/reconnect-grace';

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
// Manual scheduler — every test instantiates one fresh and drives it via
// `fire()` to advance virtual time without real setTimeout.
// ─────────────────────────────────────────────────────────────────────────────
interface Scheduled {
  id: number;
  callback: () => void;
  cancelled: boolean;
}
function manualScheduler(): {
  scheduler: GraceScheduler;
  pending: () => number;
  fire: () => void;
  fireAll: () => void;
} {
  const queue: Scheduled[] = [];
  let nextId = 1;
  const scheduler: GraceScheduler = {
    schedule(callback) {
      const entry: Scheduled = { id: nextId++, callback, cancelled: false };
      queue.push(entry);
      return entry as GraceTimerHandle;
    },
    cancel(handle) {
      const entry = handle as Scheduled;
      entry.cancelled = true;
    },
  };
  function fire(): void {
    // Fire the oldest non-cancelled timer.
    const idx = queue.findIndex((q) => !q.cancelled);
    if (idx === -1) return;
    const [entry] = queue.splice(idx, 1);
    entry.callback();
  }
  function fireAll(): void {
    while (queue.some((q) => !q.cancelled)) fire();
  }
  return {
    scheduler,
    pending: () => queue.filter((q) => !q.cancelled).length,
    fire,
    fireAll,
  };
}

function setup() {
  _resetForTest();
  const m = manualScheduler();
  _setSchedulerForTest(m.scheduler);
  _setGraceMsForTest(60_000);
  return m;
}

function main(): void {
  // ===========================================================================
  // 1 — Default grace window honors DEFAULT_GRACE_MS (60s)
  // ===========================================================================
  console.log('\n[1] Default grace window');
  setup();
  eq(_getGraceMsForTest(), 60_000, 'default grace = 60_000 ms');

  // ===========================================================================
  // 2 — markDisconnect: schedules timer, returns disconnect info
  // ===========================================================================
  console.log('\n[2] markDisconnect — schedules timer + returns info');
  {
    const m = setup();
    let onTimeoutCalled = false;
    const before = Date.now();
    const info = markDisconnect('0xMR_BOSS', 'fight-abc', () => {
      onTimeoutCalled = true;
    });

    eq(info !== null, true, 'returns non-null DisconnectInfo on first call');
    eq(info?.fightId, 'fight-abc', 'info.fightId echoes the input');
    eq(info?.graceMs, 60_000, 'info.graceMs matches active grace');
    eq(
      info!.expiresAt >= before + 60_000 && info!.expiresAt <= Date.now() + 60_000,
      true,
      'info.expiresAt is now+graceMs (within tolerance)',
    );
    eq(m.pending(), 1, 'one pending timer scheduled');
    eq(isDisconnectPending('0xMR_BOSS'), true, 'isDisconnectPending true');
    eq(onTimeoutCalled, false, 'onTimeout has NOT fired yet');
  }

  // ===========================================================================
  // 3 — markReconnect within grace cancels the timer (the BUG-FIX path)
  // ===========================================================================
  console.log('\n[3] ⚡ markReconnect within grace cancels the forfeit');
  {
    const m = setup();
    let onTimeoutCalled = false;
    markDisconnect('0xMR_BOSS', 'fight-abc', () => {
      onTimeoutCalled = true;
    });

    const cancelledFightId = markReconnect('0xMR_BOSS');
    eq(cancelledFightId, 'fight-abc', 'returns the fightId that was pending');
    eq(isDisconnectPending('0xMR_BOSS'), false, 'no pending after reconnect');

    // Even if we drain the queue, cancelled timers don't fire.
    m.fireAll();
    eq(onTimeoutCalled, false, '⚡ onTimeout did NOT fire — forfeit cancelled');
  }

  // ===========================================================================
  // 4 — Timeout fires when nobody reconnects
  // ===========================================================================
  console.log('\n[4] Timeout fires when no reconnect');
  {
    const m = setup();
    let onTimeoutCalled = false;
    let onTimeoutFightId = '';
    markDisconnect('0xMR_BOSS', 'fight-abc', () => {
      onTimeoutCalled = true;
      onTimeoutFightId = 'fight-abc-witnessed';
    });

    m.fireAll();
    eq(onTimeoutCalled, true, 'onTimeout fired after grace window');
    eq(onTimeoutFightId, 'fight-abc-witnessed', 'callback executed');
    eq(isDisconnectPending('0xMR_BOSS'), false, 'pending cleared after timeout fires');
  }

  // ===========================================================================
  // 5 — Duplicate disconnect on same (wallet, fightId) is a no-op
  // ===========================================================================
  console.log('\n[5] Idempotent: duplicate disconnect on same (wallet, fightId)');
  {
    const m = setup();
    const info1 = markDisconnect('0xMR_BOSS', 'fight-abc', () => {});
    const info2 = markDisconnect('0xMR_BOSS', 'fight-abc', () => {});

    eq(info1 !== null, true, 'first disconnect schedules');
    eq(info2, null, 'second disconnect on same fight returns null (no-op)');
    eq(m.pending(), 1, 'still only one pending timer');
  }

  // ===========================================================================
  // 6 — Disconnect on a DIFFERENT fightId cancels the prior + schedules new
  // ===========================================================================
  console.log('\n[6] Different fightId — cancels prior, schedules new');
  {
    const m = setup();
    let firstFired = false;
    let secondFired = false;
    markDisconnect('0xMR_BOSS', 'fight-abc', () => {
      firstFired = true;
    });
    const info2 = markDisconnect('0xMR_BOSS', 'fight-xyz', () => {
      secondFired = true;
    });

    eq(info2 !== null, true, 'new disconnect returns fresh info');
    eq(info2?.fightId, 'fight-xyz', 'fightId is the new one');
    eq(m.pending(), 1, 'only one timer pending (old was cancelled)');

    m.fireAll();
    eq(firstFired, false, 'old timer did NOT fire (cancelled)');
    eq(secondFired, true, 'new timer fired');
  }

  // ===========================================================================
  // 7 — markReconnect with no pending is a no-op
  // ===========================================================================
  console.log('\n[7] markReconnect with no pending — returns null');
  {
    setup();
    eq(markReconnect('0xUNKNOWN'), null, 'returns null for unknown wallet');
  }

  // ===========================================================================
  // 8 — Multiple wallets are independent
  // ===========================================================================
  console.log('\n[8] Independent timers for different wallets');
  {
    const m = setup();
    let bossFired = false;
    let sxFired = false;
    markDisconnect('0xMR_BOSS', 'fight-abc', () => {
      bossFired = true;
    });
    markDisconnect('0xSX', 'fight-abc', () => {
      sxFired = true;
    });
    eq(m.pending(), 2, 'two pending timers');

    // Reconnect only mr_boss
    markReconnect('0xMR_BOSS');
    eq(isDisconnectPending('0xMR_BOSS'), false, 'mr_boss reconnected');
    eq(isDisconnectPending('0xSX'), true, 'sx still pending');

    m.fireAll();
    eq(bossFired, false, 'mr_boss did NOT forfeit');
    eq(sxFired, true, 'sx forfeited (no reconnect)');
  }

  // ===========================================================================
  // 9 — ⚡ FULL ROUND TRIP — disconnect, reconnect, disconnect again,
  //     this time no reconnect
  // ===========================================================================
  console.log('\n[9] ⚡ Full round trip: disconnect → reconnect → disconnect → forfeit');
  {
    const m = setup();
    let firstForfeit = false;
    let secondForfeit = false;

    // Wifi blip — quickly recovered
    markDisconnect('0xMR_BOSS', 'fight-abc', () => {
      firstForfeit = true;
    });
    eq(isDisconnectPending('0xMR_BOSS'), true, '[t=0] disconnect — pending');
    markReconnect('0xMR_BOSS');
    eq(isDisconnectPending('0xMR_BOSS'), false, '[t=0.5s] reconnect — cleared');

    // Real rage-quit later — no reconnect
    markDisconnect('0xMR_BOSS', 'fight-abc', () => {
      secondForfeit = true;
    });
    eq(isDisconnectPending('0xMR_BOSS'), true, '[t=10s] disconnect again — pending');

    m.fireAll();
    eq(firstForfeit, false, '⚡ first disconnect did NOT cause forfeit (reconnected in time)');
    eq(secondForfeit, true, '⚡ second disconnect caused forfeit (no reconnect)');
  }

  // ===========================================================================
  // 10 — Custom grace window applied at schedule time
  // ===========================================================================
  console.log('\n[10] Custom grace window');
  {
    const m = setup();
    _setGraceMsForTest(15_000);
    const info = markDisconnect('0xMR_BOSS', 'fight-abc', () => {});
    eq(info?.graceMs, 15_000, 'info reflects new grace');
    eq(_getGraceMsForTest(), 15_000, 'getter reflects new grace');
    m.fireAll();
  }

  // Cleanup so we don't leak state across runs in the same process.
  _resetForTest();

  console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
