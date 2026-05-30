/**
 * Server-side cross-mode busy predicate. Mirrors
 * `frontend/src/lib/busy-state.ts` so the client and the WS handlers
 * agree on what "busy" means: the player is already in a fight,
 * already has an open wager, or is already queued for matchmaking.
 *
 * Bug 2026-05-04 (Fix 1) — `arena::create_wager` and the matchmaking
 * queue had no cross-mode awareness. A player could create a wager
 * (locks 0.1 SUI on chain) AND join the ranked queue simultaneously.
 * The WAGER fight could land mid-queue, leaving a "phantom" wallet in
 * the matchmaking pool that was already busy in combat.
 *
 * This predicate is the single source of truth for the WS-side gate
 * applied at the top of `handleQueueFight` and `handleWagerAccepted`.
 * Pure: no I/O, no globals — caller resolves the inputs from the
 * runtime maps (`wagerLobby` / `MatchmakingQueue` / `client.currentFightId`)
 * and feeds them in.
 */

export type ServerBusyKind =
  | "none"
  | "fight"           // currently in an active fight (ws-handler currentFightId)
  | "ownWager"        // has an open wager in the lobby
  | "fightQueue";     // queued for friendly or ranked

export interface ServerBusyResult {
  busy: boolean;
  kind: ServerBusyKind;
  /** User-facing message — sent verbatim via `sendError`. Empty when not busy. */
  reason: string;
}

export interface ServerBusyInput {
  /** True when `client.currentFightId` is set. */
  hasFight: boolean;
  /** The caller's open wager id from `wagerLobby`, or null if none. */
  ownWagerId: string | null;
  /** True when the caller is in `getMatchmaking()`. */
  inMatchmakingQueue: boolean;
}

/**
 * Decide whether the caller is busy and which mode caused it. Priority
 * order matches the user mental model — "you're in a fight" beats
 * "you have a wager" beats "you're in queue", because finishing a
 * fight is the most committed state and unwinding it surfaces last.
 */
export function evaluateServerBusy(input: ServerBusyInput): ServerBusyResult {
  if (input.hasFight) {
    return {
      busy: true,
      kind: "fight",
      reason: "You are already in a fight. Finish or forfeit it before queuing for another.",
    };
  }
  if (input.ownWagerId) {
    return {
      busy: true,
      kind: "ownWager",
      reason: "You have an open wager. Cancel it before queuing for another fight.",
    };
  }
  if (input.inMatchmakingQueue) {
    return {
      busy: true,
      kind: "fightQueue",
      reason: "You are queued for a fight. Leave the queue before starting another.",
    };
  }
  return { busy: false, kind: "none", reason: "" };
}
