/**
 * Pure predicate for "the player is already engaged in a match-finding or
 * combat state" — single source of truth across the matchmaking UI.
 *
 * Bug 2026-05-04 — `arena::create_wager` and the matchmaking queue have no
 * cross-mode awareness. A player could create a wager (locks 0.1 SUI on
 * chain) AND join the ranked queue simultaneously. If the ranked queue
 * matched while the wager was still WAITING, a 3rd player could end up
 * paired with a "phantom" wallet that was already busy in a wager fight.
 *
 * This predicate gates every queue / wager entry point: the matchmaking
 * queue Friendly/Ranked buttons, the Create Wager flow, and the Accept
 * Wager flow. The server has its own mirror gate (`assertNotBusy` in
 * `server/src/ws/handler.ts`) so even if the client gate is bypassed,
 * the chain tx never fires (no wallet popup, no SUI locked).
 *
 * Pure: no React state, no chain calls. Same shape as
 * `canAcceptWager` / `evaluateTwoHandedConflict` — predicate first,
 * UI + handlers consume.
 */

/** Minimal store-shape narrowing — accepts the full GameState or any
 *  subset that exposes the four busy-state inputs. */
export interface BusyStateInput {
  callerWallet: string | null | undefined;
  /** Caller's own open wager in the lobby, if any. */
  ownLobbyEntry: { wagerMatchId: string } | null | undefined;
  /** Active fight (server-authoritative). */
  activeFight: { id: string } | null | undefined;
  /** Friendly / ranked queue type — null when not queued. */
  fightQueue: string | null | undefined;
  /** A wager-accept that has been signed but not yet resolved. */
  pendingWagerAccept: { wagerMatchId: string } | null | undefined;
}

export interface BusyState {
  busy: boolean;
  /** Human reason — surfaced as a banner above the matchmaking card and
   *  as a tooltip on disabled buttons. Null when `busy === false`. */
  reason: string | null;
  /** Tag identifying which state caused the busy flag — useful for
   *  per-button targeting (e.g. "wager" lets the Cancel button stay
   *  enabled while Friendly/Ranked are disabled). */
  kind: BusyKind;
}

export type BusyKind =
  | "none"
  | "ownWager"          // caller has an open wager in the lobby
  | "fight"             // active fight in progress
  | "fightQueue"        // queued for friendly or ranked
  | "pendingWagerAccept"; // accept-wager tx signed, awaiting resolution

/**
 * Decide whether the caller is busy and which mode is responsible.
 * Priority order matches user mental model:
 *   1. fight   — ALL queue actions blocked while in combat
 *   2. ownWager — wager exists; need to cancel before queuing elsewhere
 *   3. fightQueue — queued; need to leave before creating wager
 *   4. pendingWagerAccept — accept-wager tx mid-flight; brief window
 */
export function computeBusyState(input: BusyStateInput): BusyState {
  if (!input.callerWallet) {
    return { busy: false, reason: null, kind: "none" };
  }

  if (input.activeFight) {
    return {
      busy: true,
      reason: "You are already in a fight. Finish or forfeit it before queuing for another.",
      kind: "fight",
    };
  }

  if (input.ownLobbyEntry) {
    return {
      busy: true,
      reason: "You have an open wager. Cancel it before queuing for another fight.",
      kind: "ownWager",
    };
  }

  if (input.fightQueue) {
    return {
      busy: true,
      reason: `You are already queued for ${input.fightQueue}. Leave that queue before starting another.`,
      kind: "fightQueue",
    };
  }

  if (input.pendingWagerAccept) {
    return {
      busy: true,
      reason: "Wager accept already in progress. Wait for the wallet popup to resolve.",
      kind: "pendingWagerAccept",
    };
  }

  return { busy: false, reason: null, kind: "none" };
}

/**
 * Cancel/leave actions that should stay enabled even when `busy` is true.
 * UI consumers call `canCancelOwnState(busy)` to decide whether the
 * Cancel button on a busy state should remain clickable — otherwise the
 * player would have no way out.
 */
export function canCancelOwnState(state: BusyState, target: BusyKind): boolean {
  // The Cancel button on a wager card targets "ownWager" → must stay
  // enabled. Same for "Leave Queue" targeting "fightQueue".
  return state.busy && state.kind === target;
}
