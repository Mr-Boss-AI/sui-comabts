"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useGame } from "@/hooks/useGameStore";

/**
 * v5.2 (2026-05-31) — centered, dismissable modal for the three
 * wager-handshake transitions the OTHER party didn't sign:
 *   declined         → creator declined the challenger's request
 *   withdrawn        → challenger walked out of a pending request
 *   challengeExpired → 5-min CHALLENGE_TIMEOUT_MS elapsed
 *
 * Replaces the bottom-corner SET_ERROR toast for these specific events.
 * Stake-bearing financial transitions (a refund just landed, or the
 * slot reopened) deserve a deliberate dismiss rather than a 5s fade.
 *
 * Neutral tone — bronze accent, not the red error palette. Matches the
 * site's standard modal language (Modal + Button), same visual family
 * as FightResultModal / LevelUpModal so the result feels native.
 *
 * Dismissable via the × close button, Escape, scrim click, or
 * Continue. Does not block the arena underneath visually beyond the
 * standard scrim — the user can still see the lobby change behind it.
 */
export function WagerNotificationModal() {
  const { state, dispatch } = useGame();
  const notif = state.wagerNotification;
  if (!notif) return null;

  const title =
    notif.kind === "declined"
      ? "Challenge Declined"
      : notif.kind === "withdrawn"
        ? "Challenger Withdrew"
        : "Challenge Timed Out";

  function close() {
    dispatch({ type: "CLEAR_WAGER_NOTIFICATION" });
  }

  return (
    <Modal open onClose={close} title={title}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 18,
          textAlign: "center",
          fontFamily: "var(--font-ui)",
          color: "var(--sc-parchment)",
        }}
      >
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.5,
            color: "var(--sc-parchment)",
            padding: "4px 8px",
          }}
        >
          {notif.message}
        </div>

        <Button onClick={close} style={{ width: "100%" }}>
          Continue
        </Button>
      </div>
    </Modal>
  );
}
