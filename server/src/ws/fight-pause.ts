/**
 * Turn-timer pause/resume primitive (Block C1, hotfix 2026-04-30 part 2).
 *
 * The C1 reconnect grace window kept players from instantly forfeiting on
 * a wifi blip — but the turn timer kept ticking, so the disconnected
 * player auto-loaded random actions and lost their turn-by-turn agency.
 * This module owns the pause/resume math: when a wallet enters the
 * grace window we capture the remaining ms and clear the setTimeout;
 * when they reconnect we recompute the deadline from "now + remaining"
 * and reschedule.
 *
 * Pulled out of `fight-room.ts` so the qa gauntlet drives both branches
 * with a manual scheduler — no real `setTimeout`, no flaky timing
 * assertions.
 */

/** Cancellable timer + clock seam. Production uses real setTimeout +
 *  Date.now; the unit test passes a manual scheduler that fires when the
 *  test asks. */
export interface FightTimerScheduler {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

export const productionScheduler: FightTimerScheduler = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** The slice of FightState this module touches. Decoupled from the full
 *  shape so the test can pass a minimal fixture. */
export interface PauseableFight {
  turnTimer?: unknown;
  turnDeadline?: number;
  turnPaused?: boolean;
  turnPausedRemainingMs?: number;
}

export interface PauseResult {
  /** True if THIS call paused the timer. False if it was already paused. */
  paused: boolean;
  /** Frozen remaining ms — what `resumeFightTimer` will reschedule with. */
  remainingMs: number;
}

export interface ResumeResult {
  /** True if THIS call resumed the timer. False if it wasn't paused. */
  resumed: boolean;
  /** Newly-recomputed absolute deadline (now + remainingMs). */
  deadline: number;
  /** ms scheduled — equal to the captured frozen value. */
  remainingMs: number;
}

/** Freeze the running turn timer. Idempotent: a second pause while
 *  already paused is a no-op (returns paused=false but the captured
 *  remainingMs is preserved from the first pause). */
export function pauseFightTimer(
  fight: PauseableFight,
  scheduler: FightTimerScheduler = productionScheduler,
): PauseResult {
  if (fight.turnPaused) {
    return { paused: false, remainingMs: fight.turnPausedRemainingMs ?? 0 };
  }
  if (fight.turnTimer !== undefined) {
    scheduler.clearTimeout(fight.turnTimer);
    fight.turnTimer = undefined;
  }
  // If turnDeadline is undefined (no turn in flight — e.g. just before
  // startNextTurn fires for the first time) clamp to 0.
  const remainingMs = Math.max(0, (fight.turnDeadline ?? scheduler.now()) - scheduler.now());
  fight.turnPaused = true;
  fight.turnPausedRemainingMs = remainingMs;
  return { paused: true, remainingMs };
}

/** Resume a paused turn timer. Recomputes the deadline from
 *  `now + remainingMs` so clients can re-render their countdowns. If the
 *  remaining was 0 we still schedule with a 0-ms callback so
 *  `handleTurnTimeout` runs on the next tick (keeps the call stack
 *  shallow vs. firing inline). */
export function resumeFightTimer(
  fight: PauseableFight,
  onTimeout: () => void,
  scheduler: FightTimerScheduler = productionScheduler,
): ResumeResult {
  if (!fight.turnPaused) {
    return { resumed: false, deadline: fight.turnDeadline ?? 0, remainingMs: 0 };
  }
  const remainingMs = Math.max(0, fight.turnPausedRemainingMs ?? 0);
  fight.turnPaused = false;
  fight.turnPausedRemainingMs = undefined;
  fight.turnDeadline = scheduler.now() + remainingMs;
  fight.turnTimer = scheduler.setTimeout(onTimeout, remainingMs);
  return { resumed: true, deadline: fight.turnDeadline, remainingMs };
}
