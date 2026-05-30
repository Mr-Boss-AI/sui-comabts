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
 * reads: `request_accept_wager failed: The wager is no longer waiting
 * for an opponent — it was just accepted or cancelled. Refresh the
 * lobby.`
 *
 * Mapping rules:
 *   - One sentence, plain English. No Move identifiers.
 *   - Tell the user what's broken AND what to do next when there's a
 *     reasonable recovery path (refresh, wait, check balance).
 *   - For invariants that should never reach the user (treasury-only
 *     bypass attempts, etc.) the copy is still polite — these would
 *     only show up if our admin tooling itself misbehaves.
 *
 * v5.2 (2026-05-30) — Codes 12–23 added for wager-fairness:
 *   - 12–20 per spec §6 (level bracket + approval handshake +
 *     reclaim_stalled_wager escape hatch)
 *   - 21–23 are spec §14.1 judgment calls (fight-lock, character
 *     ownership, expiry entrypoint routing)
 */

import type { AbortCodeMap } from "./tx-result";

export const ARENA_ABORT_CODES: AbortCodeMap = {
  // ============================================================
  // v5.1 codes 0–11 — unchanged.
  // ============================================================

  // EInvalidStake = 0 — create_wager only.
  0: "Stake amount must be greater than zero.",
  // EMatchNotWaiting = 1 — request_accept_wager / cancel_wager.
  // 99% of real hits: the wager was already accepted (status → PENDING_APPROVAL)
  // or already cancelled (status → SETTLED) between the lobby render
  // and this click. The fix is a fresh lobby fetch.
  1: "The wager is no longer waiting for an opponent — it was just accepted or cancelled. Refresh the lobby.",
  // EMatchNotActive = 2 — settle_wager / settle_tie (treasury path).
  2: "The wager is not active — it can't be settled right now.",
  // EStakeMismatch = 3 — request_accept_wager.
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
  // ECannotJoinOwnMatch = 7 — request_accept_wager.
  // Defence-in-depth — the frontend gate already refuses this; in
  // practice EAlreadyHasOpenWager (11) fires first because the creator
  // is in the registry.
  7: "You can't accept your own wager.",
  // EUnauthorized = 8 — treasury-only paths.
  8: "Only the treasury can perform this action.",
  // ENotExpired = 9 — cancel_expired_wager.
  9: "This wager hasn't expired yet — only the creator (or treasury) can cancel it before then.",
  // ENoOpponent = 10 — settle_wager / admin_cancel_wager / reclaim_stalled_wager.
  10: "No opponent has joined this wager yet.",
  // EAlreadyHasOpenWager = 11 — create_wager / request_accept_wager.
  // Fires when the caller already has a wager in the OpenWagerRegistry
  // (WAITING or ACTIVE). The frontend gate refuses the click before
  // signing, but a programmatic / dev-tools bypass hits this here.
  11: "You already have an open wager. Settle or cancel it before starting another.",

  // ============================================================
  // v5.2 codes 12–20 — wager-fairness, per spec §6.
  // ============================================================

  // ELevelOutOfBracket = 12 — request_accept_wager.
  // Pre-checked client-side from the wager card's `creatorLevel` snapshot
  // (±1 LEVEL_BRACKET), but the chain assertion is the trustless backstop.
  12: "You're outside the ±1 level bracket for this wager — try a wager from a player closer to your level.",
  // ENotPendingApproval = 13 — approve_challenger / decline_challenger /
  // withdraw_challenge / cancel_expired_challenge.
  // Fires when one of the PENDING_APPROVAL transitions is called on a
  // wager in a different state (WAITING / ACTIVE / SETTLED). User-facing
  // case: someone refreshes their tab right after the creator already
  // approved — the lobby card still shows "Approve" but the wager moved
  // on. Refresh resolves it.
  13: "This wager isn't waiting for approval anymore — it moved on (approved, declined, or withdrew). Refresh the lobby.",
  // EChallengerSlotTaken = 14 — request_accept_wager.
  // Belt-and-suspenders for an unreachable-by-construction state
  // (status=WAITING with a pending challenger). EMatchNotWaiting (1)
  // fires first in practice — keep this copy polite for the
  // theoretical case.
  14: "Someone else just submitted a challenge on this wager — refresh and try again.",
  // ENotCreatorForApproval = 15 — approve_challenger / decline_challenger.
  // Fires when the wrong wallet tries to approve/decline. Defence-in-depth;
  // the frontend hides those buttons unless the viewer is the creator.
  15: "Only the wager creator can approve or decline a challenger.",
  // ENotPendingChallenger = 16 — withdraw_challenge.
  // Fires when the wrong wallet tries to withdraw a pending challenge.
  // Frontend hides the Withdraw button unless viewer is the
  // pending_challenger.
  16: "Only the pending challenger can withdraw this challenge.",
  // EChallengeNotExpired = 17 — cancel_expired_challenge.
  // Frontend renders the "Clear expired challenge" action only after the
  // 5-minute CHALLENGE_TIMEOUT_MS — this fires if a programmatic call
  // beats the clock.
  17: "The challenge hasn't been pending long enough to expire — wait for the 5-minute timeout.",
  // ENotActiveForReclaim = 18 — reclaim_stalled_wager.
  // Fires when the participant-escape-hatch path is called on a wager
  // that isn't ACTIVE (WAITING / PENDING_APPROVAL / SETTLED). Distinct
  // from EMatchNotActive (2) so the abort-humanizer copy can be specific
  // to the reclaim path.
  18: "Reclaim is only available once the fight is active — and only after the 30-minute settlement window has elapsed.",
  // EWagerNotStalled = 19 — reclaim_stalled_wager.
  // The critical mid-fight abuse gate. Frontend hides the Reclaim button
  // before WAGER_RESOLUTION_TIMEOUT_MS (30 min); this fires on any
  // early-call attempt.
  19: "The wager isn't stalled yet — settlement window still open. Try again after 30 minutes from accept.",
  // ENotWagerParticipant = 20 — reclaim_stalled_wager.
  // Only the two players in the wager can call reclaim. Frontend hides
  // the button for non-participants; this fires on programmatic bypass.
  20: "Only the two participants in this wager can reclaim its escrow.",

  // ============================================================
  // v5.2 codes 21–23 — judgment calls (spec §14.1).
  // Suggested copy lives in docs/V5.2_WAGER_FAIRNESS_SPEC.md §14.1.
  // ============================================================

  // ECreatorFightLocked = 21 — create_wager.
  // Defence-in-depth — the equipment module's fight-lock already covers
  // equip/unequip mid-fight. This is the new "no opening a wager while
  // another fight is in flight on the same character" guard.
  21: "Can't open a wager while a fight is in progress on this character.",
  // ENotCharacterOwner = 22 — create_wager / request_accept_wager.
  // Anti-spoofing — prevents a wallet from passing someone else's
  // Character to read a different level for the bracket check. Should
  // never reach the user unless they're crafting PTBs manually.
  22: "That character doesn't belong to your wallet.",
  // EWrongExpiryEntrypoint = 23 — cancel_expired_wager.
  // Routes PENDING_APPROVAL callers to cancel_expired_challenge instead
  // of letting them fall through to a misleading ENoOpponent (10).
  // Frontend pre-routes; this fires on programmatic bypass.
  23: "This wager is awaiting approval — use the challenge-expiry function instead.",
};
