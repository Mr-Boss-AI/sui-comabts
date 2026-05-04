/**
 * Pure helpers for the level-up celebration modal (Fix 3, 2026-05-04).
 *
 * The reducer in `useGameStore` parks the WS-supplied event in
 * `state.levelUpEvent`. The modal renders only when:
 *   - an event is present, AND
 *   - no active fight is in progress (otherwise the modal would
 *     disrupt the combat UI — queue until the fight ends).
 *
 * `formatLevelUpHeadline` builds the user-facing string. Multi-level
 * gains are surfaced as "Level Up xN" so the modal celebrates the
 * full jump rather than understating it as a single-level event.
 *
 * Pure: no React, no chain calls, no globals. Tested in
 * `scripts/qa-level-up-modal.ts`.
 */

export interface LevelUpEvent {
  oldLevel: number;
  newLevel: number;
  pointsGranted: number;
  newTotalUnallocated: number;
  fightId?: string;
}

/**
 * Should the modal render right now? Returns the event when it should
 * be rendered, `null` when it should stay queued.
 *
 *   - `event === null` → null (nothing to show)
 *   - `activeFight` truthy → null (queue until fight ends)
 *   - else → event (render)
 *
 * The reducer holds the event indefinitely until either the user
 * dismisses (CLEAR_LEVEL_UP_EVENT) or another event arrives (merged).
 * So a level-up earned during a fight will surface naturally on the
 * post-fight screen.
 */
export function shouldRenderLevelUp(
  event: LevelUpEvent | null,
  activeFight: { id: string } | null,
): LevelUpEvent | null {
  if (!event) return null;
  if (activeFight) return null;
  return event;
}

/** Headline text — "Level Up!" or "Level Up x2!" etc. */
export function formatLevelUpHeadline(event: LevelUpEvent): string {
  const levelsGained = event.newLevel - event.oldLevel;
  if (levelsGained <= 1) return "Level Up!";
  return `Level Up x${levelsGained}!`;
}

/** Body line — "You reached Level N" with the new level highlighted. */
export function formatLevelUpBody(event: LevelUpEvent): string {
  return `You reached Level ${event.newLevel}.`;
}

/** Points line — accounts for prior unallocated points the player had. */
export function formatPointsLine(event: LevelUpEvent): string {
  const earned = event.pointsGranted;
  const total = event.newTotalUnallocated;
  if (earned === total) {
    return `+${earned} stat point${earned === 1 ? "" : "s"} to allocate.`;
  }
  // Player had unspent points before this level-up — surface the total
  // so they know exactly how many to spend in the modal.
  return `+${earned} stat point${earned === 1 ? "" : "s"} to allocate ` +
    `(${total} total available, including unspent from before).`;
}

/**
 * Validate a server payload before dispatching. Defensive — the WS
 * type system says fields are required, but a malformed server send
 * shouldn't crash the modal.
 */
export function isValidLevelUpEvent(input: unknown): input is LevelUpEvent {
  if (!input || typeof input !== "object") return false;
  const e = input as Record<string, unknown>;
  if (typeof e.oldLevel !== "number" || e.oldLevel < 1) return false;
  if (typeof e.newLevel !== "number" || e.newLevel < 1) return false;
  if (e.newLevel < e.oldLevel) return false;
  if (typeof e.pointsGranted !== "number" || e.pointsGranted < 0) return false;
  if (typeof e.newTotalUnallocated !== "number" || e.newTotalUnallocated < 0) return false;
  if (e.newTotalUnallocated < e.pointsGranted) return false;
  return true;
}

/**
 * Merge a freshly-arrived event with any pending event already in the
 * store. Multi-fight bursts (rare — would require two fights settling
 * before the first modal renders) collapse into a single celebration
 * spanning the lower oldLevel → higher newLevel.
 *
 *   - prev=null              → return next verbatim
 *   - both present           → merged event with:
 *       oldLevel: min(prev, next)
 *       newLevel: max(prev, next)
 *       pointsGranted: prev + next        (cumulative earned)
 *       newTotalUnallocated: next         (chain truth from latest tx)
 *       fightId: next.fightId             (most recent context)
 *
 * Pure: no reducer, no React. Used by `useGameStore`'s
 * `SET_LEVEL_UP_EVENT` case so the merge is testable in isolation.
 */
export function mergeLevelUpEvent(
  prev: LevelUpEvent | null,
  next: LevelUpEvent,
): LevelUpEvent {
  if (!prev) return next;
  return {
    oldLevel: Math.min(prev.oldLevel, next.oldLevel),
    newLevel: Math.max(prev.newLevel, next.newLevel),
    pointsGranted: prev.pointsGranted + next.pointsGranted,
    newTotalUnallocated: next.newTotalUnallocated,
    fightId: next.fightId ?? prev.fightId,
  };
}
