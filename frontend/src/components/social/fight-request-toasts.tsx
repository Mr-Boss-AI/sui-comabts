"use client";

/**
 * Stacked fight-request toasts — top-right corner.
 *
 * Each pending incoming request renders one toast. Newest at the top.
 * Toast auto-disappears when the request resolves (accept / decline /
 * cancel / expire) — the reducer drops it from `incomingFightRequests`
 * and React unmounts the entry.
 *
 * Behaviour:
 *   • 90s countdown derived from `request.expiresAt`. The toast
 *     re-renders every 500 ms via a tick interval.
 *   • Accept / Decline buttons fire the matching WS messages.
 *   • For wager challenges, accepting opens a confirmation step that
 *     shows the stake — accept again to fire the WS accept (which
 *     triggers the challenger's create_wager flow).
 */

import { useEffect, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { Button } from "@/components/ui/button";
import type { FightRequestWire } from "@/types/ws-messages";

function formatRemaining(expiresAt: number, now: number): string {
  const ms = Math.max(0, expiresAt - now);
  const s = Math.ceil(ms / 1000);
  return `${s}s`;
}

function suiFromMist(stakeMist: string | null): string | null {
  if (!stakeMist) return null;
  try {
    const mist = BigInt(stakeMist);
    const whole = mist / 1_000_000_000n;
    const frac = mist % 1_000_000_000n;
    if (frac === 0n) return `${whole.toString()} SUI`;
    const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
    return `${whole.toString()}.${fracStr} SUI`;
  } catch {
    return null;
  }
}

function FightRequestToastCard({ request }: { request: FightRequestWire }) {
  const { state, dispatch } = useGame();
  const [now, setNow] = useState(() => Date.now());
  const [confirmingWager, setConfirmingWager] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  function handleAccept() {
    if (request.requestType === "wager" && !confirmingWager) {
      setConfirmingWager(true);
      return;
    }
    state.socket.send({ type: "accept_fight_request", requestId: request.id });
    dispatch({ type: "REMOVE_FIGHT_REQUEST", requestId: request.id });
  }

  function handleDecline() {
    state.socket.send({ type: "decline_fight_request", requestId: request.id });
    dispatch({ type: "REMOVE_FIGHT_REQUEST", requestId: request.id });
  }

  const stake = suiFromMist(request.stakeMist);
  const expired = now > request.expiresAt;
  const isWager = request.requestType === "wager";
  const accent = isWager ? "var(--sc-blood)" : "var(--sc-steel)";

  if (expired) {
    return (
      <div
        style={{
          background: "var(--sc-panel)",
          border: "1px solid var(--sc-rim)",
          padding: 14,
          maxWidth: 360,
          opacity: 0.55,
          boxShadow: "var(--sh-plate)",
          fontFamily: "var(--font-ui)",
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "var(--ls-stamp)",
            textTransform: "uppercase",
            color: "var(--fg-3)",
          }}
        >
          Challenge expired
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 4 }}>
          {request.fromName}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--sc-panel)",
        border: `2px solid ${accent}`,
        boxShadow: `4px 4px 0 0 ${
          isWager ? "var(--sc-blood-deep)" : "var(--sc-steel-deep)"
        }, var(--rim-top)`,
        padding: 14,
        maxWidth: 360,
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 14,
            color: accent,
            letterSpacing: "0.01em",
          }}
        >
          {isWager ? "Wager Challenge" : "Friendly Fight"}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-3)",
            fontWeight: 700,
          }}
        >
          {formatRemaining(request.expiresAt, now)}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--sc-parchment)" }}>
        <span style={{ color: "var(--sc-bronze)", fontWeight: 800 }}>
          {request.fromName}
        </span>{" "}
        {isWager && stake ? (
          <>
            challenges you to a{" "}
            <span style={{ color: "var(--sc-bronze)", fontFamily: "var(--font-mono)" }}>
              {stake}
            </span>{" "}
            wager
          </>
        ) : (
          <>wants to fight you</>
        )}
      </p>
      {request.message && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 11,
            fontStyle: "italic",
            color: "var(--fg-2)",
            borderLeft: "2px solid var(--sc-rim-2)",
            paddingLeft: 8,
          }}
        >
          &ldquo;{request.message}&rdquo;
        </p>
      )}
      {confirmingWager && stake && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 11,
            color: "var(--sc-bronze)",
            background: "rgba(200,154,63,.10)",
            borderLeft: "3px solid var(--sc-bronze)",
            padding: "6px 8px",
          }}
        >
          Click Accept again to confirm. Once both sides commit you'll need to
          sign accept_wager to match the {stake} stake.
        </p>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <Button
          size="sm"
          variant={isWager ? "primary" : "primary"}
          onClick={handleAccept}
          style={{ flex: 1 }}
        >
          {confirmingWager ? "Confirm" : "Accept"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleDecline}
          style={{ flex: 1 }}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}

export function FightRequestToasts() {
  const { state } = useGame();
  if (state.incomingFightRequests.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-sm pointer-events-none">
      {state.incomingFightRequests
        .slice()
        .reverse()
        .map((req) => (
          <div key={req.id} className="pointer-events-auto">
            <FightRequestToastCard request={req} />
          </div>
        ))}
    </div>
  );
}
