/**
 * Arena Move abort codes → human-readable copy.
 *
 * Mirrors the constants in `contracts/sources/arena.move`. Pinned by
 * `scripts/qa-arena-aborts.ts`; if the Move constants ever renumber,
 * the gauntlet fails and forces this table to be re-synced before any
 * frontend ships against a republished package.
 *
 * Bug ledger context — the 2026-05-18 EMatchNotWaiting (code 1) report
 * was the first time we needed this table. Pre-fix the user got the
 * raw `MoveAbort in 2nd command, abort code: 1` toast straight from
 * the SDK; no domain context, no recovery hint. Routed through
 * `humanizeChainError(err, ARENA_ABORT_CODES)` the same error now
 * reads: `accept_wager failed: The wager is no longer waiting for an
 * opponent — it was just accepted or cancelled. Refresh the lobby.`
 *
 * Mapping rules:
 *   - One sentence, plain English. No Move identifiers.
 *   - Tell the user what's broken AND what to do next when there's a
 *     reasonable recovery path (refresh, wait, check balance).
 *   - For invariants that should never reach the user (treasury-only
 *     bypass attempts, etc.) the copy is still polite — these would
 *     only show up if our admin tooling itself misbehaves.
 */

import type { AbortCodeMap } from "./tx-result";

export const ARENA_ABORT_CODES: AbortCodeMap = {
  // EInvalidStake = 0 — create_wager only.
  0: "Stake amount must be greater than zero.",
  // EMatchNotWaiting = 1 — accept_wager / cancel_wager.
  // 99% of real hits: the wager was already accepted (status → ACTIVE)
  // or already cancelled (status → SETTLED) between the lobby render
  // and this click. The fix is a fresh lobby fetch.
  1: "The wager is no longer waiting for an opponent — it was just accepted or cancelled. Refresh the lobby.",
  // EMatchNotActive = 2 — settle_wager only (treasury path).
  2: "The wager is not active — it can't be settled right now.",
  // EStakeMismatch = 3 — accept_wager.
  // Frontend gates against this with canAcceptWagerWithBalance, so a
  // user-visible hit means the chain stake amount drifted after the
  // lobby entry was cached. Re-fetch and retry.
  3: "Your stake doesn't match the wager amount. Refresh the lobby and try again.",
  // ENotPlayerA = 4 — cancel_wager.
  4: "Only the wager creator can cancel this match.",
  // EInvalidWinner = 5 — settle_wager (treasury).
  5: "The settlement winner isn't a participant in this wager.",
  // EMatchAlreadySettled = 6 — admin_cancel_wager / cancel_expired_wager.
  6: "This wager has already been settled.",
  // ECannotJoinOwnMatch = 7 — accept_wager.
  // Defence-in-depth — the frontend gate already refuses this.
  7: "You can't accept your own wager.",
  // EUnauthorized = 8 — treasury-only paths.
  8: "Only the treasury can perform this action.",
  // ENotExpired = 9 — cancel_expired_wager.
  9: "This wager hasn't expired yet — only the creator (or treasury) can cancel it before then.",
  // ENoOpponent = 10 — settle_wager / admin_cancel_wager.
  10: "No opponent has joined this wager yet.",
};
