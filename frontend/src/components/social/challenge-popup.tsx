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
    <div className="fixed top-4 right-4 z-50 bg-zinc-900 border border-amber-600 rounded-xl shadow-2xl shadow-amber-900/30 p-4 max-w-sm animate-bounce-subtle">
      <div className="text-sm font-medium mb-1">Challenge!</div>
      <p className="text-zinc-300 text-sm">
        <span className="text-amber-400 font-bold">{pendingChallenge.fromName}</span>{" "}
        wants to fight ({pendingChallenge.fightType})
      </p>
      <div className="flex gap-2 mt-3">
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
