/**
 * Cumulative-grace-budget gauntlet (Bug 1, 2026-05-03 arena gauntlet).
 *
 *   $ cd server && npx tsx ../scripts/qa-grace-budget.ts
 *
 * Pre-fix: Block C1 (2026-04-30) added a 60 s reconnect grace per
 * disconnect cycle. The per-cycle reset meant a bad-faith player
 * could disconnect, reconnect at 30 s, disconnect again, and get a
 * fresh 60 s — repeating indefinitely to stall the fight forever
 * (12-test wager-fight gauntlet 2026-05-03 surfaced this as Bug 1).
 *
 * Fix: the 60 s window is now interpreted as a CUMULATIVE budget
 * spent across the WHOLE fight, not per cycle. This gauntlet
 * specifically pins the cumulative semantics — the per-cycle
 * mechanics (cancellation on reconnect, idempotent close, etc.) are
 * already covered by `qa-reconnect-grace.ts`. Together they cover
 * the full state machine.
 *
 * Manual scheduler + injectable now() drive every branch — no real
 * setTimeout, no flaky timing.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  markDisconnect,
  markReconnect,
  isDisconnectPending,
  clearFightGrace,
  _resetForTest,
  _setSchedulerForTest,
  _setGraceMsForTest,
  _setNowForTest,
  _getUsedMsForTest,
  type GraceScheduler,
  type GraceTimerHandle,
  type DisconnectInfo,
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
  return {
    scheduler,
    pending: () => queue.filter((q) => !q.cancelled).length,
    fire: () => {
      const idx = queue.findIndex((q) => !q.cancelled);
      if (idx === -1) return;
      const [entry] = queue.splice(idx, 1);
      entry.callback();
    },
    fireAll: () => {
      while (queue.some((q) => !q.cancelled)) {
        const idx = queue.findIndex((q) => !q.cancelled);
        const [entry] = queue.splice(idx, 1);
        entry.callback();
      }
    },
  };
}

function clockMock(start = 0): { now: () => number; advance: (ms: number) => void; set: (t: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (val: number) => {
      t = val;
    },
  };
}

function setup(budgetMs = 60_000): {
  s: ReturnType<typeof manualScheduler>;
  c: ReturnType<typeof clockMock>;
} {
  _resetForTest();
  const s = manualScheduler();
  const c = clockMock(1_000);
  _setSchedulerForTest(s.scheduler);
  _setGraceMsForTest(budgetMs);
  _setNowForTest(c.now);
  return { s, c };
}

function main(): void {
  // ===========================================================================
  // 1 — first disconnect of a fight has the full budget
  // ===========================================================================
  console.log('\n[1] First disconnect → full budget');
  {
    const { s, c } = setup(60_000);
    const info = markDisconnect('0xA', 'fight-1', () => {});
    if (!info) {
      fail('first disconnect schedules', 'returned null unexpectedly');
    } else {
      eq(info.graceMs, 60_000, 'graceMs = full budget on first disconnect');
      eq(info.usedMs, 0, 'usedMs = 0 on first disconnect');
      eq(info.budgetMs, 60_000, 'budgetMs reported correctly');
      eq(info.expiresAt, c.now() + 60_000, 'expiresAt = now + budget');
    }
    eq(s.pending(), 1, 'one timer pending');
  }

  // ===========================================================================
  // 2 — ⚡ THE BUG: reconnect+disconnect cycle does NOT reset the budget
  // ===========================================================================
  console.log('\n[2] ⚡ Reconnect+disconnect cycle does NOT reset the budget');
  {
    const { s, c } = setup(60_000);
    let forfeited = false;

    // Cycle 1: disconnect, 30s elapses, reconnect.
    markDisconnect('0xA', 'fight-1', () => { forfeited = true; });
    c.advance(30_000);
    markReconnect('0xA');
    eq(_getUsedMsForTest('0xA'), 30_000, '⚡ 30s consumed after cycle 1');

    // Cycle 2: disconnect again — should get only 30s remaining.
    const info2 = markDisconnect('0xA', 'fight-1', () => { forfeited = true; });
    if (!info2) {
      fail('cycle 2 schedules', 'returned null');
    } else {
      eq(info2.graceMs, 30_000, '⚡ cycle 2 graceMs = 30_000 (NOT 60_000)');
      eq(info2.usedMs, 30_000, 'cycle 2 carries over usedMs');
      eq(info2.budgetMs, 60_000, 'budgetMs unchanged');
    }
    // Drain the timer to confirm forfeit fires.
    s.fireAll();
    eq(forfeited, true, 'forfeit fires when remaining budget runs out');
  }

  // ===========================================================================
  // 3 — three cycles totaling >60s → forfeit on the third
  // ===========================================================================
  console.log('\n[3] ⚡ Three cycles totaling >budget → forfeit on the third');
  {
    const { s, c } = setup(60_000);
    let forfeited = false;
    const cb = () => { forfeited = true; };

    // Cycle 1: 25s
    markDisconnect('0xA', 'fight-1', cb);
    c.advance(25_000);
    markReconnect('0xA');
    eq(_getUsedMsForTest('0xA'), 25_000, 'after cycle 1: 25s used');

    // Cycle 2: 30s
    const info2 = markDisconnect('0xA', 'fight-1', cb);
    eq(info2?.graceMs, 35_000, 'cycle 2 starts with 35s remaining');
    c.advance(30_000);
    markReconnect('0xA');
    eq(_getUsedMsForTest('0xA'), 55_000, 'after cycle 2: 55s used');

    // Cycle 3: schedules with only 5s remaining
    const info3 = markDisconnect('0xA', 'fight-1', cb);
    eq(info3?.graceMs, 5_000, 'cycle 3 starts with 5s remaining');
    eq(info3?.usedMs, 55_000, 'cycle 3 sees 55s already used');

    // Timer fires → forfeit
    s.fireAll();
    eq(forfeited, true, '⚡ forfeit fires on cycle 3 (5s into 70s of total disconnect time)');
    eq(isDisconnectPending('0xA'), false, 'no pending after forfeit');
  }

  // ===========================================================================
  // 4 — budget exhausted → next disconnect is SYNCHRONOUS forfeit
  // ===========================================================================
  console.log('\n[4] ⚡ Budget exhausted → next disconnect forfeits synchronously');
  {
    const { s, c } = setup(60_000);
    let forfeited = false;

    // Burn the full budget in one cycle.
    markDisconnect('0xA', 'fight-1', () => {});
    c.advance(60_000);
    markReconnect('0xA');
    eq(_getUsedMsForTest('0xA'), 60_000, 'full budget consumed');

    // Next disconnect: should fire synchronously, return null, no timer.
    const pendingBefore = s.pending();
    const info = markDisconnect('0xA', 'fight-1', () => { forfeited = true; });
    eq(info, null, '⚡ markDisconnect returns null (synchronous forfeit)');
    eq(forfeited, true, '⚡ onTimeout fired synchronously inside markDisconnect');
    eq(s.pending(), pendingBefore, 'no NEW timer scheduled (sync path)');
    eq(isDisconnectPending('0xA'), false, 'no pending state after sync forfeit');
  }

  // ===========================================================================
  // 5 — over-budget single cycle: usedMs caps at budgetMs
  // ===========================================================================
  console.log('\n[5] Over-budget single cycle caps at budgetMs');
  {
    const { c } = setup(60_000);
    markDisconnect('0xA', 'fight-1', () => {});
    // Simulate massive clock jump — usedMs should pin at budgetMs, not blow past.
    c.advance(120_000);
    markReconnect('0xA');
    eq(_getUsedMsForTest('0xA'), 60_000, 'usedMs capped at budgetMs (no 120k overflow)');
  }

  // ===========================================================================
  // 6 — different fightId resets the budget (new fight, new deal)
  // ===========================================================================
  console.log('\n[6] Different fightId resets the budget');
  {
    const { c } = setup(60_000);
    markDisconnect('0xA', 'fight-1', () => {});
    c.advance(45_000);
    markReconnect('0xA');
    eq(_getUsedMsForTest('0xA'), 45_000, 'fight-1 used 45s');

    // Now fight-2 starts (different id). The wallet's grace tracker
    // should reset to fresh budget.
    const info = markDisconnect('0xA', 'fight-2', () => {});
    eq(info?.graceMs, 60_000, 'fight-2 has full 60s (not 15s leftover from fight-1)');
    eq(info?.usedMs, 0, 'fight-2 starts with usedMs=0');
  }

  // ===========================================================================
  // 7 — clearFightGrace wipes records tied to a fightId
  // ===========================================================================
  console.log('\n[7] clearFightGrace wipes records for one fightId');
  {
    const { s, c } = setup(60_000);
    markDisconnect('0xA', 'fight-1', () => {});
    markDisconnect('0xB', 'fight-1', () => {});
    markDisconnect('0xC', 'fight-2', () => {});
    eq(s.pending(), 3, '3 timers pending');
    eq(_getUsedMsForTest('0xA') !== null, true, 'A has a record');
    eq(_getUsedMsForTest('0xC') !== null, true, 'C has a record');

    clearFightGrace('fight-1');
    eq(s.pending(), 1, 'only fight-2 timer remains');
    eq(_getUsedMsForTest('0xA'), null, 'A record gone');
    eq(_getUsedMsForTest('0xB'), null, 'B record gone');
    eq(_getUsedMsForTest('0xC') !== null, true, 'C record kept (different fight)');
  }

  // ===========================================================================
  // 8 — clearFightGrace is idempotent + safe for unknown fight
  // ===========================================================================
  console.log('\n[8] clearFightGrace idempotent + safe for unknown fight');
  {
    setup(60_000);
    clearFightGrace('does-not-exist'); // no-op, no throw
    ok('no-op for unknown fightId');
    markDisconnect('0xA', 'fight-1', () => {});
    clearFightGrace('fight-1');
    clearFightGrace('fight-1'); // double-clear no-op
    eq(_getUsedMsForTest('0xA'), null, 'A wiped after first clear');
    ok('double-clear is a no-op');
  }

  // ===========================================================================
  // 9 — multi-wallet independence under cumulative semantics
  // ===========================================================================
  console.log('\n[9] Multi-wallet independent budgets in same fight');
  {
    const { s, c } = setup(60_000);
    let aForfeited = false;
    let bForfeited = false;

    // A burns 50s and reconnects; B never disconnects.
    markDisconnect('0xA', 'fight-1', () => { aForfeited = true; });
    c.advance(50_000);
    markReconnect('0xA');

    // A disconnects again — only 10s left.
    const info = markDisconnect('0xA', 'fight-1', () => { aForfeited = true; });
    eq(info?.graceMs, 10_000, 'A has 10s left');

    // B disconnects fresh — full 60s.
    const bInfo = markDisconnect('0xB', 'fight-1', () => { bForfeited = true; });
    eq(bInfo?.graceMs, 60_000, 'B has fresh 60s (independent budget)');

    s.fireAll();
    eq(aForfeited, true, 'A forfeited (budget exhausted)');
    eq(bForfeited, true, 'B forfeited (no reconnect within their full window)');
  }

  // ===========================================================================
  // 10 — reconnect on a record with no active disconnect is a no-op
  // ===========================================================================
  console.log('\n[10] Reconnect with no active disconnect is a no-op');
  {
    const { c } = setup(60_000);
    // Build a record with usedMs but no active disconnect.
    markDisconnect('0xA', 'fight-1', () => {});
    c.advance(20_000);
    markReconnect('0xA');
    eq(_getUsedMsForTest('0xA'), 20_000, 'record carries 20s used');
    // Now markReconnect again — should no-op since no active timer.
    eq(markReconnect('0xA'), null, 'second markReconnect → null (no active state)');
    eq(_getUsedMsForTest('0xA'), 20_000, 'usedMs not double-counted');
  }

  // ===========================================================================
  // 11 — full live-bug repro: 3 disconnect-reconnect cycles totalling 70s
  // ===========================================================================
  console.log('\n[11] ⚡ Full repro: 3 cycles totalling 70s of disconnected time');
  {
    const { s, c } = setup(60_000);
    let forfeited = false;
    const cb = () => { forfeited = true; };

    // Cycle 1: 25s gone
    markDisconnect('0xABUSER', 'wager-fight', cb);
    c.advance(25_000);
    markReconnect('0xABUSER');

    // Cycle 2: 25s more (50s total)
    markDisconnect('0xABUSER', 'wager-fight', cb);
    c.advance(25_000);
    markReconnect('0xABUSER');
    eq(_getUsedMsForTest('0xABUSER'), 50_000, 'after 2 cycles: 50s used');

    // Cycle 3: 20s more (70s total — over budget)
    // Should schedule with only 10s remaining; if abuser holds for the full
    // 20s, the timer fires at 10s and we forfeit.
    const info3 = markDisconnect('0xABUSER', 'wager-fight', cb);
    eq(info3?.graceMs, 10_000, 'cycle 3 has only 10s left');
    s.fireAll();
    eq(forfeited, true, '⚡ abuser forfeited — total grace capped at 60s of disconnect time');
  }

  // Cleanup so process.exit works cleanly.
  _resetForTest();

  const total = passes + failures;
  console.log('\n' + '='.repeat(60));
  console.log(`grace-budget gauntlet: ${passes}/${total} PASS, ${failures} FAIL`);
  console.log('='.repeat(60));
  if (failures > 0) process.exit(1);
}

main();
