"use client";

import { useGame } from "@/hooks/useGameStore";
import { Button } from "@/components/ui/button";

export function ChallengePopup() {
  const { state, dispatch } = useGame();
  const { pendingChallenge } = state;

  if (!pendingChallenge) return null;

  function accept() {
    state.socket.send({
      type: "accept_challenge",
      challengeId: pendingChallenge!.challengeId,
    });
    dispatch({ type: "SET_PENDING_CHALLENGE", challenge: null });
  }

  function decline() {
    state.socket.send({
      type: "decline_challenge",
      challengeId: pendingChallenge!.challengeId,
    });
    dispatch({ type: "SET_PENDING_CHALLENGE", challenge: null });
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 50,
        background: "var(--sc-panel)",
        border: "2px solid var(--sc-bronze)",
        boxShadow: "4px 4px 0 0 var(--sc-bronze-deep), var(--rim-top)",
        padding: 14,
        maxWidth: 360,
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        animation: "bounce-subtle 2s ease-in-out infinite",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 16,
          color: "var(--sc-bronze)",
          marginBottom: 4,
        }}
      >
        Challenge!
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--sc-parchment)" }}>
        <span style={{ color: "var(--sc-bronze)", fontWeight: 800 }}>
          {pendingChallenge.fromName}
        </span>{" "}
        wants to fight ({pendingChallenge.fightType})
      </p>
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <Button size="sm" onClick={accept}>
          Accept
        </Button>
        <Button size="sm" variant="secondary" onClick={decline}>
          Decline
        </Button>
      </div>
    </div>
  );
}
