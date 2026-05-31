/**
 * v5.2 wager-fairness — UI-facing constants mirrored from the Move
 * contract. Single source of truth for any timeout / threshold the
 * UI reads.
 *
 * Mirrors `contracts/sources/arena.move`:
 *   const CHALLENGE_TIMEOUT_MS          = 300_000;     // 5 min
 *   const WAGER_RESOLUTION_TIMEOUT_MS   = 1_800_000;   // 30 min
 *   const LEVEL_BRACKET                 = 1;
 *
 * If the chain constants ever change, pin them here and re-publish.
 * Pinned by `scripts/qa-wager-constants.ts` — see PHASE 6 of the
 * v5.2 cut-over checklist.
 *
 * NEVER hardcode these numbers anywhere else in the frontend; always
 * import from here. The user explicitly wants timeouts/labels to read
 * from a single source, not magic numbers sprinkled across components.
 */

/** Auto-refund timeout for a PENDING_APPROVAL wager — after this long
 *  with no approve/decline, anyone (typically the challenger) can call
 *  `cancel_expired_challenge` to clear the slot + refund the
 *  challenger's stake. */
export const CHALLENGE_TIMEOUT_MS = 300_000; // 5 min

/** Referee-liveness escape hatch — after this long in ACTIVE with no
 *  settle, either participant can call `reclaim_stalled_wager` to
 *  refund both stakes (no winner declared). The clock gate prevents
 *  mid-fight abuse where a losing player would otherwise escape a
 *  loss. */
export const WAGER_RESOLUTION_TIMEOUT_MS = 1_800_000; // 30 min

/** Inclusive level-bracket width. ±1 means the challenger's level must
 *  satisfy `|challenger_level - creator_level_snapshot| <= 1`. Server
 *  ALSO enforces this; we pre-check in the UI for a friendly
 *  "out of bracket" message before opening the wallet popup. */
export const LEVEL_BRACKET = 1;

/** Pretty-print a millisecond timeout as "5 min" / "30 min". */
export function formatTimeoutMin(ms: number): string {
  const mins = Math.round(ms / 60_000);
  return `${mins} min`;
}

/** True iff a challenger's level is within ±LEVEL_BRACKET of the
 *  creator's snapshot. The chain assertion is the authority — this is
 *  for pre-click UX (hide / disable / explain). */
export function inLevelBracket(challengerLevel: number, creatorSnapshotLevel: number): boolean {
  return Math.abs(challengerLevel - creatorSnapshotLevel) <= LEVEL_BRACKET;
}

/** Friendly "blocked: out of bracket" copy. Threaded into the wager
 *  card's Accept-disabled tooltip + the SET_ERROR dispatch if a user
 *  clicks an out-of-bracket card via keyboard / dev-tools. */
export function levelBracketBlockedReason(
  challengerLevel: number,
  creatorSnapshotLevel: number,
): string {
  const delta = challengerLevel - creatorSnapshotLevel;
  const sign = delta > 0 ? "+" : "";
  return (
    `Out of ±${LEVEL_BRACKET} level bracket (you Lv.${challengerLevel}, creator Lv.${creatorSnapshotLevel}, ` +
    `delta ${sign}${delta}). Find a wager from a player closer to your level.`
  );
}

/** True iff a wager that's been ACTIVE for `elapsedMs` is now past
 *  the reclaim window. Used to gate the "Reclaim Stalled Wager"
 *  button visibility in the fight arena. */
export function isReclaimable(elapsedMsSinceAccept: number): boolean {
  return elapsedMsSinceAccept >= WAGER_RESOLUTION_TIMEOUT_MS;
}

/** True iff a PENDING_APPROVAL wager is past the challenge-expiry
 *  window. Used to gate the "Clear expired challenge" action. */
export function isChallengeExpired(elapsedMsSincePending: number): boolean {
  return elapsedMsSincePending >= CHALLENGE_TIMEOUT_MS;
}

/** Wager status enum mirrored from arena.move. */
export const WAGER_STATUS = {
  WAITING: 0,
  ACTIVE: 1,
  SETTLED: 2,
  PENDING_APPROVAL: 3,
} as const;

export type WagerStatus = (typeof WAGER_STATUS)[keyof typeof WAGER_STATUS];

// ============================================================================
// ReclaimStalledWagerBanner — visibility eligibility
// ============================================================================

/** Minimal fight shape the eligibility helper reads. Decoupled from
 *  the full FightState type so the unit test doesn't have to construct
 *  a full FighterState graph. */
export interface ReclaimEligibilityFight {
  status: "waiting" | "active" | "finished";
  wagerMatchId?: string;
  wagerAcceptedAtMs?: number;
  playerA: { walletAddress: string };
  playerB: { walletAddress: string };
}

export type ReclaimEligibility =
  | { show: false; reason: string }
  | { show: true; wagerMatchId: string; elapsedMs: number };

/** Decide whether the Reclaim Stalled Wager banner should render.
 *
 * Visible iff (in order):
 *   - the fight is wager-typed (`wagerMatchId` populated by server)
 *   - chain `WagerMatch.accepted_at` is known (`wagerAcceptedAtMs` populated)
 *   - viewer is one of the two participants
 *   - fight isn't already finished
 *   - elapsed since accept >= WAGER_RESOLUTION_TIMEOUT_MS (30 min)
 *
 * The reason field is for telemetry / diagnostic logs — production UI
 * just renders null when `show === false`.
 *
 * Pure (no Date.now() call inside) — caller injects `nowMs` so the
 * unit test can drive boundary behaviour deterministically.
 */
export function computeReclaimEligibility(
  fight: ReclaimEligibilityFight | null | undefined,
  viewerWallet: string,
  nowMs: number,
): ReclaimEligibility {
  if (!fight) return { show: false, reason: "no fight" };
  if (!fight.wagerMatchId) return { show: false, reason: "not a wager fight" };
  if (!fight.wagerAcceptedAtMs) {
    return { show: false, reason: "wagerAcceptedAtMs not populated yet" };
  }
  if (fight.status === "finished") {
    return { show: false, reason: "fight finished — settle path covered it" };
  }
  const isParticipant =
    fight.playerA.walletAddress === viewerWallet ||
    fight.playerB.walletAddress === viewerWallet;
  if (!isParticipant) {
    return { show: false, reason: "viewer is not a participant" };
  }
  const elapsedMs = nowMs - fight.wagerAcceptedAtMs;
  if (!isReclaimable(elapsedMs)) {
    return { show: false, reason: `elapsed ${elapsedMs}ms < 30 min` };
  }
  return { show: true, wagerMatchId: fight.wagerMatchId, elapsedMs };
}
