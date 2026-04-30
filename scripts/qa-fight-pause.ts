/**
 * Turn-timer pause/resume gauntlet (Block C1 hotfix, 2026-04-30 part 2).
 *
 *   $ cd server && npx tsx ../scripts/qa-fight-pause.ts
 *
 * Pre-fix (the first C1 pass), socket disconnect scheduled a forfeit but
 * the turn timer kept ticking — so the disconnected player auto-loaded
 * random actions and lost their agency anyway. The live test
 * 2026-04-30 night reproduced this end-to-end. The hotfix introduces
 * `server/src/ws/fight-pause.ts` with two pure helpers that
 * `fight-room.ts` calls from `handlePlayerDisconnect` /
 * `handlePlayerReconnect`. THIS gauntlet pins the helpers' contract:
 *
 *   - `pauseFightTimer` clears the running setTimeout and captures the
 *     EXACT remaining ms in `turnPausedRemainingMs` so a later
 *     `resumeFightTimer` reschedules with the same budget.
 *   - `resumeFightTimer` rebuilds the absolute deadline from
 *     `now + remainingMs` so client UIs can re-render their countdowns
 *     against the new value (necessary for `fight_resumed` to drop the
 *     rejoining player back into a coherent fight).
 *   - Both are idempotent — duplicate disconnect/reconnect pairs (close
 *     events repeating, the OTHER player flapping while one is in
 *     grace) don't drift the captured ms or fire double timeouts.
 *
 * Drives a manual scheduler — no real `setTimeout`, no flaky timing.
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  pauseFightTimer,
  resumeFightTimer,
  type FightTimerScheduler,
  type PauseableFight,
} from '../server/src/ws/fight-pause';

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

interface ManualClock {
  scheduler: FightTimerScheduler;
  pendingCount(): number;
  fire(): void;
  fireAll(): void;
  setNow(ms: number): void;
  cancelledHandles(): number;
}
function manualClock(): ManualClock {
  let nowMs = 1_700_000_000_000; // arbitrary stable epoch for tests
  interface Scheduled {
    id: number;
    fireAt: number;
    callback: () => void;
    cancelled: boolean;
  }
  const queue: Scheduled[] = [];
  let nextId = 1;
  let cancelled = 0;
  const scheduler: FightTimerScheduler = {
    setTimeout(cb, ms) {
      const entry: Scheduled = { id: nextId++, fireAt: nowMs + ms, callback: cb, cancelled: false };
      queue.push(entry);
      return entry;
    },
    clearTimeout(handle) {
      const e = handle as Scheduled;
      if (!e || e.cancelled) return;
      e.cancelled = true;
      cancelled++;
    },
    now: () => nowMs,
  };
  function fire(): void {
    const idx = queue.findIndex((q) => !q.cancelled);
    if (idx === -1) return;
    const [e] = queue.splice(idx, 1);
    e.callback();
  }
  return {
    scheduler,
    pendingCount: () => queue.filter((q) => !q.cancelled).length,
    fire,
    fireAll() {
      while (queue.some((q) => !q.cancelled)) fire();
    },
    setNow: (ms) => {
      nowMs = ms;
    },
    cancelledHandles: () => cancelled,
  };
}

function freshFight(now: number, deadlineMs = 20_000): PauseableFight {
  return {
    turnDeadline: now + deadlineMs,
    turnPaused: false,
    turnPausedRemainingMs: undefined,
    turnTimer: undefined,
  };
}

function main(): void {
  // ===========================================================================
  // 1 — pauseFightTimer baseline: clears timer, captures remaining ms
  // ===========================================================================
  console.log('\n[1] pauseFightTimer — clears the timer + captures remaining ms');
  {
    const clock = manualClock();
    const fight = freshFight(clock.scheduler.now());

    // Production wiring would call setTimeout in startNextTurn; we
    // mimic that here by handing pauseFightTimer a fight whose timer
    // is "running" (deadline in the future) — pause is responsible for
    // clearing it.
    fight.turnTimer = clock.scheduler.setTimeout(() => {
      fail('timeout fired during pause', 'should never run');
    }, 20_000);
    eq(clock.pendingCount(), 1, 'sanity: timer scheduled before pause');

    // Advance clock 7s into the turn — 13s should remain.
    clock.setNow(clock.scheduler.now() + 7000);

    const result = pauseFightTimer(fight, clock.scheduler);
    eq(result.paused, true, 'reports paused=true');
    eq(result.remainingMs, 13_000, 'captures exactly 13s remaining');
    eq(fight.turnPaused, true, 'fight.turnPaused mutated to true');
    eq(fight.turnPausedRemainingMs, 13_000, 'fight.turnPausedRemainingMs captured');
    eq(fight.turnTimer, undefined, 'fight.turnTimer cleared');
    eq(clock.pendingCount(), 0, 'no pending scheduled callbacks');
    eq(clock.cancelledHandles(), 1, 'old timer was cancelled (not just dropped)');
  }

  // ===========================================================================
  // 2 — pauseFightTimer idempotent: second pause is no-op
  // ===========================================================================
  console.log('\n[2] Idempotent pause — second call returns paused=false but preserves state');
  {
    const clock = manualClock();
    const fight = freshFight(clock.scheduler.now());
    fight.turnTimer = clock.scheduler.setTimeout(() => {}, 20_000);

    clock.setNow(clock.scheduler.now() + 5_000);
    const first = pauseFightTimer(fight, clock.scheduler);
    eq(first.paused, true, 'first call paused');
    eq(first.remainingMs, 15_000, 'first call captured 15s remaining');

    // Move time forward — second pause should NOT recapture from new "now".
    clock.setNow(clock.scheduler.now() + 5_000);
    const second = pauseFightTimer(fight, clock.scheduler);
    eq(second.paused, false, 'second call returns paused=false (already paused)');
    eq(second.remainingMs, 15_000, 'frozen ms preserved (NOT recomputed)');
    eq(fight.turnPausedRemainingMs, 15_000, 'fight.turnPausedRemainingMs unchanged');
  }

  // ===========================================================================
  // 3 — resumeFightTimer reschedules with captured ms, recomputes deadline
  // ===========================================================================
  console.log('\n[3] resumeFightTimer — reschedules + recomputes deadline');
  {
    const clock = manualClock();
    const fight = freshFight(clock.scheduler.now());
    fight.turnTimer = clock.scheduler.setTimeout(() => {}, 20_000);

    clock.setNow(clock.scheduler.now() + 8_000); // 12s remaining
    pauseFightTimer(fight, clock.scheduler);
    eq(fight.turnPausedRemainingMs, 12_000, 'captured 12s during pause');

    // Pretend the player was disconnected for 25 seconds.
    clock.setNow(clock.scheduler.now() + 25_000);

    let timeoutFired = false;
    const resume = resumeFightTimer(fight, () => {
      timeoutFired = true;
    }, clock.scheduler);

    eq(resume.resumed, true, 'reports resumed=true');
    eq(resume.remainingMs, 12_000, 'reschedules with captured ms');
    eq(resume.deadline, clock.scheduler.now() + 12_000, 'deadline = now + remaining');
    eq(fight.turnPaused, false, 'fight.turnPaused cleared');
    eq(fight.turnPausedRemainingMs, undefined, 'fight.turnPausedRemainingMs cleared');
    eq(fight.turnDeadline, clock.scheduler.now() + 12_000, 'fight.turnDeadline updated');
    eq(clock.pendingCount(), 1, 'one new timer scheduled');
    eq(timeoutFired, false, 'onTimeout has not fired yet');

    // Drive the clock to expiration — onTimeout should fire.
    clock.setNow(clock.scheduler.now() + 12_000);
    clock.fireAll();
    eq(timeoutFired, true, 'onTimeout fires after captured ms');
  }

  // ===========================================================================
  // 4 — resumeFightTimer idempotent: noop if not paused
  // ===========================================================================
  console.log('\n[4] resumeFightTimer noop when not paused');
  {
    const clock = manualClock();
    const fight = freshFight(clock.scheduler.now());
    let fired = false;
    const result = resumeFightTimer(fight, () => {
      fired = true;
    }, clock.scheduler);
    eq(result.resumed, false, 'returns resumed=false');
    eq(clock.pendingCount(), 0, 'no timer scheduled');
    clock.fireAll();
    eq(fired, false, 'onTimeout never fires');
  }

  // ===========================================================================
  // 5 — ⚡ Full roundtrip: pause at 7s elapsed, resume after 60s grace,
  //   onTimeout fires exactly once with the captured remainder
  //   (this is the headline integration: prevents the live-test bug
  //    where the disconnected player auto-loaded a random action)
  // ===========================================================================
  console.log('\n[5] ⚡ Full pause→grace→resume roundtrip — single onTimeout fire');
  {
    const clock = manualClock();
    const fight = freshFight(clock.scheduler.now());
    let timeoutFireCount = 0;
    fight.turnTimer = clock.scheduler.setTimeout(() => {
      timeoutFireCount++;
    }, 20_000);

    // Player drops at 7s into the turn → 13s remaining
    clock.setNow(clock.scheduler.now() + 7_000);
    const pause = pauseFightTimer(fight, clock.scheduler);
    eq(pause.remainingMs, 13_000, 'paused with 13s remaining');

    // 50s of disconnect — well within the 60s grace
    clock.setNow(clock.scheduler.now() + 50_000);

    // Reconnect — resume with the captured 13s
    const resume = resumeFightTimer(fight, () => {
      timeoutFireCount++;
    }, clock.scheduler);
    eq(resume.remainingMs, 13_000, 'resume rescheduled with 13s');

    // Pre-pause timer was already cancelled — fire all should run
    // exactly the resume's onTimeout when its time comes.
    clock.setNow(clock.scheduler.now() + 13_000);
    clock.fireAll();
    eq(timeoutFireCount, 1, '⚡ exactly ONE onTimeout fire across the roundtrip');
  }

  // ===========================================================================
  // 6 — Boundary: pause when remaining is already 0
  // ===========================================================================
  console.log('\n[6] Boundary: pause with remaining=0 (race against expiry)');
  {
    const clock = manualClock();
    const start = clock.scheduler.now();
    const fight: PauseableFight = {
      turnDeadline: start, // already expired
      turnPaused: false,
      turnTimer: clock.scheduler.setTimeout(() => {}, 0),
    };
    const result = pauseFightTimer(fight, clock.scheduler);
    eq(result.paused, true, 'paused even at 0 remaining');
    eq(result.remainingMs, 0, 'captures 0 ms');
    eq(fight.turnPausedRemainingMs, 0, 'state matches');
  }

  // ===========================================================================
  // 7 — Boundary: resume with remaining=0 fires onTimeout near-immediately
  // ===========================================================================
  console.log('\n[7] Boundary: resume with remaining=0 fires onTimeout');
  {
    const clock = manualClock();
    const fight: PauseableFight = {
      turnDeadline: clock.scheduler.now(),
      turnPaused: true,
      turnPausedRemainingMs: 0,
      turnTimer: undefined,
    };
    let fired = false;
    resumeFightTimer(fight, () => {
      fired = true;
    }, clock.scheduler);
    eq(clock.pendingCount(), 1, '0-ms timer still scheduled');
    clock.fireAll();
    eq(fired, true, 'fires on next tick');
  }

  // ===========================================================================
  // 8 — Pause→Pause→Resume sequence (e.g. both players drop, one returns,
  //     the other drops again BEFORE the first reconnect)
  // ===========================================================================
  console.log('\n[8] Pause→Pause→Resume sequence preserves the FIRST captured ms');
  {
    const clock = manualClock();
    const fight = freshFight(clock.scheduler.now());
    fight.turnTimer = clock.scheduler.setTimeout(() => {}, 20_000);

    clock.setNow(clock.scheduler.now() + 4_000); // 16s remaining
    pauseFightTimer(fight, clock.scheduler);
    clock.setNow(clock.scheduler.now() + 100_000); // long pause
    pauseFightTimer(fight, clock.scheduler); // second pause — no-op
    eq(fight.turnPausedRemainingMs, 16_000, 'still 16s after second pause');

    let fired = false;
    resumeFightTimer(fight, () => {
      fired = true;
    }, clock.scheduler);
    clock.setNow(clock.scheduler.now() + 16_000);
    clock.fireAll();
    eq(fired, true, 'resume rescheduled with the FIRST capture');
  }

  // ===========================================================================
  // 9 — pauseFightTimer when no timer is set (no turn in flight)
  // ===========================================================================
  console.log('\n[9] pauseFightTimer with no turn in flight (defensive)');
  {
    const clock = manualClock();
    const fight: PauseableFight = {
      // No turnDeadline, no turnTimer — disconnected before turn 1 even started
      turnPaused: false,
    };
    const result = pauseFightTimer(fight, clock.scheduler);
    eq(result.paused, true, 'still flips paused=true (defensive)');
    eq(result.remainingMs, 0, 'captures 0 ms (no deadline to compute from)');
    eq(fight.turnTimer, undefined, 'turnTimer remains undefined');
  }

  // ===========================================================================
  // 10 — ⚡ "Locked choices preserved" — pause/resume does NOT touch
  //   any other field on the fight object. The user spec requires that
  //   choices locked before disconnect survive the pause/resume cycle.
  //   Pause/resume only owns the timer state, so this is verified by
  //   asserting the helper leaves unrelated fields alone.
  // ===========================================================================
  console.log('\n[10] ⚡ Locked-choice preservation — pause/resume does not touch other state');
  {
    const clock = manualClock();
    interface FightWithChoices extends PauseableFight {
      turnActions: Map<string, string>;
      turn: number;
      log: string[];
    }
    const fight: FightWithChoices = {
      turnDeadline: clock.scheduler.now() + 20_000,
      turnPaused: false,
      turnTimer: clock.scheduler.setTimeout(() => {}, 20_000),
      turnActions: new Map([['playerA-charId', 'attack:head;block:chest,stomach']]),
      turn: 3,
      log: ['turn1', 'turn2'],
    };

    clock.setNow(clock.scheduler.now() + 5_000);
    pauseFightTimer(fight, clock.scheduler);
    eq(fight.turnActions.size, 1, 'turnActions preserved through pause');
    eq(
      fight.turnActions.get('playerA-charId'),
      'attack:head;block:chest,stomach',
      'locked choice preserved verbatim',
    );
    eq(fight.turn, 3, 'turn counter unchanged');
    eq(fight.log.length, 2, 'log unchanged');

    clock.setNow(clock.scheduler.now() + 30_000);
    resumeFightTimer(fight, () => {}, clock.scheduler);
    eq(fight.turnActions.size, 1, 'turnActions preserved through resume');
    eq(
      fight.turnActions.get('playerA-charId'),
      'attack:head;block:chest,stomach',
      '⚡ locked choice still intact after pause→resume — server can apply it normally',
    );
  }

  // ===========================================================================
  // 11 — Pause cancels the OLD setTimeout (no double-fire on resume)
  // ===========================================================================
  console.log('\n[11] Pause cancels the OLD setTimeout — no double-fire after resume');
  {
    const clock = manualClock();
    const fight = freshFight(clock.scheduler.now());
    let fireCount = 0;
    fight.turnTimer = clock.scheduler.setTimeout(() => {
      fireCount++;
    }, 20_000);

    clock.setNow(clock.scheduler.now() + 5_000);
    pauseFightTimer(fight, clock.scheduler);
    clock.setNow(clock.scheduler.now() + 1_000);
    resumeFightTimer(fight, () => {
      fireCount++;
    }, clock.scheduler);

    // Drive enough time for BOTH the old (cancelled) timer's deadline
    // AND the resumed timer's deadline. Only the resumed one should
    // fire — the old timer was cancelled at pause time.
    clock.setNow(clock.scheduler.now() + 30_000);
    clock.fireAll();
    eq(fireCount, 1, '⚡ exactly one fire (old timer was cancelled at pause)');
  }

  console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
