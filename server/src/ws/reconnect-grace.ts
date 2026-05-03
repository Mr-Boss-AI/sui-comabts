/**
 * Reconnect grace window for active fights — with a cumulative
 * fight-total budget.
 *
 * The pre-Block-C1 code instant-forfeited on socket close. Block C1
 * (2026-04-30) added a 60 s grace window so wifi blips don't cost
 * real SUI. That fix had a flaw caught in the 2026-05-03 arena
 * gauntlet (Bug 1): a bad-faith player could disconnect, reconnect
 * at 30 s, disconnect again — and get a fresh 60 s budget every
 * time. Cumulative stalling was unbounded. Honest wifi blips are
 * brief; abusers cycle.
 *
 * Fix: the 60 s ms budget is now spent across the WHOLE FIGHT, not
 * per disconnect cycle. A wallet that uses 30 s on its first
 * disconnect has 30 s left for any subsequent disconnects this
 * fight. When it runs out, the next disconnect synchronously
 * forfeits — no banner, no countdown, the player has already had
 * their full window of grace.
 *
 * The state machine still lives in this module so
 * `scripts/qa-reconnect-grace.ts` (per-cycle) and
 * `scripts/qa-grace-budget.ts` (cumulative) can drive every branch
 * with a manual scheduler + injectable clock — no real `setTimeout`,
 * no flaky timing.
 *
 * fight-room.ts owns the side effects (notify opponent, finish
 * fight on timeout, pause/resume turn timer, broadcast
 * opponent_disconnected). When a fight ends, fight-room calls
 * `clearFightGrace(fightId)` to wipe records — otherwise the next
 * fight on the same wallet would inherit the previous fight's
 * usedMs.
 */

/** Production grace BUDGET (per fight, cumulative). Long enough for
 *  one or two genuine wifi blips on a flaky connection, short enough
 *  that an abuser can't ping-pong a fight forever. Override per-test
 *  via `_setGraceMsForTest`. */
const DEFAULT_GRACE_MS = 60_000;

/** Cancellable timer abstraction. The production scheduler is `setTimeout`;
 *  the unit test passes a manual scheduler that fires when the test asks. */
export interface GraceScheduler {
  schedule(callback: () => void, ms: number): GraceTimerHandle;
  cancel(handle: GraceTimerHandle): void;
}

export type GraceTimerHandle = unknown;

/** A wallet's grace state for one specific fight. The record is kept
 *  across reconnects (with `active` cleared) so cumulative `usedMs`
 *  survives connect/disconnect cycles. */
interface FightGraceRecord {
  fightId: string;
  /** Total budget (ms) for this fight. Snapshotted at first disconnect
   *  so a mid-fight `_setGraceMsForTest` doesn't change the deal. */
  budgetMs: number;
  /** Cumulative ms spent disconnected during this fight. Capped at
   *  budgetMs in `markReconnect` so an over-shoot from clock skew
   *  doesn't go negative on the next remainingMs computation. */
  usedMs: number;
  /** Set iff currently disconnected (a timer is pending). Cleared by
   *  `markReconnect`. */
  active?: {
    handle: GraceTimerHandle;
    startedAt: number;
    expiresAt: number;
  };
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
let activeBudgetMs: number = DEFAULT_GRACE_MS;
let activeNow: () => number = () => Date.now();

const records = new Map<string, FightGraceRecord>();

export interface DisconnectInfo {
  /** Where in the fight this disconnect happened. */
  fightId: string;
  /** Wall-clock ms when the forfeit timer will fire if no reconnect. */
  expiresAt: number;
  /** Ms remaining in THIS cycle (budgetMs - usedMs). What the opponent
   *  banner counts down. Equals `budgetMs` on the first disconnect of
   *  a fight, smaller on subsequent ones. */
  graceMs: number;
  /** Cumulative ms already consumed by previous disconnects this
   *  fight (0 on first disconnect). Surfaced for diagnostics / a
   *  future "you've already used Xs of your grace" banner. */
  usedMs: number;
  /** Total ms budgeted for this fight — the cap that `usedMs` will
   *  eventually hit. */
  budgetMs: number;
}

/** Mark a wallet as disconnected from `fightId` and either schedule
 *  the `onTimeout` callback to fire after the remaining grace, OR —
 *  if the wallet has already exhausted its budget across previous
 *  disconnects this fight — fire `onTimeout` synchronously and
 *  return null.
 *
 *  Idempotent: a duplicate close event on the same socket (record
 *  already has `active` set, same fightId) returns null without
 *  starting a new timer.
 *
 *  Returns `DisconnectInfo` for callers that broadcast
 *  "opponent_disconnected"; returns `null` to mean "no banner" — the
 *  caller's existing `if (!info) return` short-circuit is correct
 *  for both the duplicate-close case AND the budget-exhausted case
 *  (in the latter, `onTimeout` already ran synchronously, so there's
 *  no fight left to broadcast about). */
export function markDisconnect(
  walletAddress: string,
  fightId: string,
  onTimeout: () => void,
): DisconnectInfo | null {
  const existing = records.get(walletAddress);

  // Different fight → reset. The previous fight is over from this
  // wallet's side; the new fight gets a fresh budget.
  if (existing && existing.fightId !== fightId) {
    if (existing.active) activeScheduler.cancel(existing.active.handle);
    records.delete(walletAddress);
  }

  // Already pending an active disconnect for the same fight: duplicate
  // close on one socket. No-op so the grace clock doesn't reset.
  const rec = records.get(walletAddress);
  if (rec?.active) return null;

  // Snapshot budget at first disconnect (so test-only mid-fight
  // _setGraceMsForTest doesn't move the goalposts). Reuse the
  // existing snapshot if the player is in a continuing fight.
  const budgetMs = rec?.budgetMs ?? activeBudgetMs;
  const usedMs = rec?.usedMs ?? 0;
  const remainingMs = budgetMs - usedMs;
  const now = activeNow();

  if (remainingMs <= 0) {
    // Budget already spent across prior disconnects → forfeit
    // synchronously. Clean the record before firing onTimeout so a
    // re-entrant call from inside the callback sees a fresh slate.
    records.delete(walletAddress);
    onTimeout();
    return null;
  }

  const expiresAt = now + remainingMs;
  const handle = activeScheduler.schedule(() => {
    // Self-clean. The callback fires once; remove the entry first so
    // a re-entrant markReconnect inside onTimeout doesn't see a
    // stale record.
    records.delete(walletAddress);
    onTimeout();
  }, remainingMs);

  records.set(walletAddress, {
    fightId,
    budgetMs,
    usedMs,
    active: { handle, startedAt: now, expiresAt },
  });

  return {
    fightId,
    expiresAt,
    graceMs: remainingMs,
    usedMs,
    budgetMs,
  };
}

/** Cancel any pending disconnect for `walletAddress` and accumulate
 *  the elapsed disconnect time into `usedMs`. The record stays in
 *  the map (with `active` cleared) so subsequent disconnects this
 *  fight see the consumed budget.
 *
 *  Returns the fightId that was pending (or `null` if nothing was
 *  pending) so the caller can emit "opponent_reconnected" scoped to
 *  the right fight. */
export function markReconnect(walletAddress: string): string | null {
  const rec = records.get(walletAddress);
  if (!rec || !rec.active) return null;

  activeScheduler.cancel(rec.active.handle);
  const elapsed = Math.max(0, activeNow() - rec.active.startedAt);
  // Cap at budgetMs — clock skew or a bizarre scheduler could push
  // usedMs above budget; we'd rather pin to the cap than underflow
  // remainingMs on the next disconnect.
  rec.usedMs = Math.min(rec.budgetMs, rec.usedMs + elapsed);
  rec.active = undefined;
  // Record stays — next disconnect this fight sees the accumulated usedMs.
  return rec.fightId;
}

/** True if a disconnect timer is currently pending for `walletAddress`. */
export function isDisconnectPending(walletAddress: string): boolean {
  return records.get(walletAddress)?.active !== undefined;
}

/** Wipe every record tied to `fightId`. Called from `finishFight` so
 *  a freshly-started fight on the same wallets begins with a clean
 *  budget. Idempotent — fights that never had a disconnect simply
 *  have no records to wipe. */
export function clearFightGrace(fightId: string): void {
  for (const [wallet, rec] of records) {
    if (rec.fightId !== fightId) continue;
    if (rec.active) activeScheduler.cancel(rec.active.handle);
    records.delete(wallet);
  }
}

/** Test seam: clear all pending timers and reset state. */
export function _resetForTest(): void {
  for (const rec of records.values()) {
    if (rec.active) activeScheduler.cancel(rec.active.handle);
  }
  records.clear();
  activeScheduler = productionScheduler;
  activeBudgetMs = DEFAULT_GRACE_MS;
  activeNow = () => Date.now();
}

/** Test seam: swap in a manual scheduler so the gauntlet drives time. */
export function _setSchedulerForTest(scheduler: GraceScheduler): void {
  activeScheduler = scheduler;
}

/** Test seam: tighten or loosen the per-fight budget. Honored only
 *  on the *first* disconnect of a fight; subsequent disconnects use
 *  the budget that was snapshotted then. */
export function _setGraceMsForTest(ms: number): void {
  activeBudgetMs = ms;
}

/** Test seam: read the active budget (for assertion). */
export function _getGraceMsForTest(): number {
  return activeBudgetMs;
}

/** Test seam: inject a fake "now" so the gauntlet can simulate
 *  elapsed disconnect time without `setTimeout`. */
export function _setNowForTest(fn: () => number): void {
  activeNow = fn;
}

/** Test seam: read a wallet's cumulative usedMs (for assertion). */
export function _getUsedMsForTest(walletAddress: string): number | null {
  const rec = records.get(walletAddress);
  return rec ? rec.usedMs : null;
}
