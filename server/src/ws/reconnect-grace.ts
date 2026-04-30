/**
 * Reconnect grace window for active fights.
 *
 * The pre-fix `handlePlayerDisconnect` called `finishFight(reason: 'disconnect')`
 * IMMEDIATELY when a WebSocket dropped — players lost real SUI to a 2-second
 * wifi blip. Gemini flagged this as a pre-mainnet blocker on 2026-04-30
 * (Block C1).
 *
 * This module owns the timer state. When a player's socket closes mid-fight
 * we call `markDisconnect`, which schedules `onTimeout` to fire after
 * `graceMs`. If the same wallet reconnects (re-authenticates) and rejoins
 * the same fight before the timer expires, `markReconnect` cancels the
 * pending forfeit and the fight continues seamlessly.
 *
 * Pulled out of `fight-room.ts` for two reasons:
 *   1. The unit test in `scripts/qa-reconnect-grace.ts` can drive every
 *      branch by injecting a fake scheduler — no real `setTimeout`, no
 *      flaky timing.
 *   2. The state lives in one place. fight-room.ts handles the side
 *      effects (notify opponent, finish fight on timeout) and stays
 *      uncluttered by timer bookkeeping.
 */

/** Production grace window. Long enough for a wifi blip / 4G handover, short
 *  enough that an actual rage-quit doesn't leave the opponent twiddling
 *  their thumbs forever. Override per-test via `setGraceMsForTest`. */
const DEFAULT_GRACE_MS = 60_000;

/** Cancellable timer abstraction. The production scheduler is `setTimeout`;
 *  the unit test passes a manual scheduler that fires when the test asks. */
export interface GraceScheduler {
  schedule(callback: () => void, ms: number): GraceTimerHandle;
  cancel(handle: GraceTimerHandle): void;
}

export type GraceTimerHandle = unknown;

interface PendingDisconnect {
  fightId: string;
  handle: GraceTimerHandle;
  expiresAt: number;
}

const productionScheduler: GraceScheduler = {
  schedule(callback, ms) {
    const t = setTimeout(callback, ms);
    // Don't keep the event loop alive solely because of a pending forfeit
    // — Node should still be able to exit on shutdown signals.
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref: () => void }).unref();
    }
    return t;
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

let activeScheduler: GraceScheduler = productionScheduler;
let activeGraceMs: number = DEFAULT_GRACE_MS;

const pending = new Map<string, PendingDisconnect>();

export interface DisconnectInfo {
  /** Where in the fight this disconnect happened — opaque to the grace
   *  module, surfaced back to fight-room for the timeout callback. */
  fightId: string;
  expiresAt: number;
  graceMs: number;
}

/** Mark a wallet as disconnected from `fightId` and schedule the
 *  `onTimeout` callback to fire if no reconnect happens before the grace
 *  window expires.
 *
 *  Idempotent on the same `(wallet, fightId)` pair — duplicate close
 *  events for one socket don't reset the grace clock.
 *
 *  Returns the disconnect info on a NEW schedule, or `null` if there was
 *  already a pending disconnect for the same wallet (callers can tell
 *  whether to broadcast the "opponent_disconnected" message). */
export function markDisconnect(
  walletAddress: string,
  fightId: string,
  onTimeout: () => void,
): DisconnectInfo | null {
  const existing = pending.get(walletAddress);
  if (existing) {
    // Same fight → no-op (duplicate close events on one socket)
    if (existing.fightId === fightId) return null;
    // Different fight (very unusual: player switched fights between two
    // close events). Cancel the old timer and start fresh — the old
    // fight is already over from this player's side, the new one is
    // the live one.
    activeScheduler.cancel(existing.handle);
    pending.delete(walletAddress);
  }

  const expiresAt = Date.now() + activeGraceMs;
  const handle = activeScheduler.schedule(() => {
    // Self-clean. The callback fires once; remove the entry first so a
    // re-entrant markReconnect inside onTimeout doesn't see a stale
    // record.
    pending.delete(walletAddress);
    onTimeout();
  }, activeGraceMs);

  pending.set(walletAddress, { fightId, handle, expiresAt });
  return { fightId, expiresAt, graceMs: activeGraceMs };
}

/** Cancel any pending disconnect for `walletAddress`. Returns the fightId
 *  that was pending (or `null` if nothing was pending) so the caller can
 *  emit the "opponent_reconnected" notification scoped to the right
 *  fight. */
export function markReconnect(walletAddress: string): string | null {
  const existing = pending.get(walletAddress);
  if (!existing) return null;
  activeScheduler.cancel(existing.handle);
  pending.delete(walletAddress);
  return existing.fightId;
}

/** True if a disconnect timer is currently pending for `walletAddress`.
 *  Used by callers that want to know whether to send a fresh fight_state
 *  payload back to the rejoining client. */
export function isDisconnectPending(walletAddress: string): boolean {
  return pending.has(walletAddress);
}

/** Test seam: clear all pending timers and reset state. */
export function _resetForTest(): void {
  for (const entry of pending.values()) activeScheduler.cancel(entry.handle);
  pending.clear();
  activeScheduler = productionScheduler;
  activeGraceMs = DEFAULT_GRACE_MS;
}

/** Test seam: swap in a manual scheduler so the gauntlet drives time. */
export function _setSchedulerForTest(scheduler: GraceScheduler): void {
  activeScheduler = scheduler;
}

/** Test seam: tighten or loosen the grace window for a single test. */
export function _setGraceMsForTest(ms: number): void {
  activeGraceMs = ms;
}

/** Test seam: read the current grace ms (for assertion). */
export function _getGraceMsForTest(): number {
  return activeGraceMs;
}
