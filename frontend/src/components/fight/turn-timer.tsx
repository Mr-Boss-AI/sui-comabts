"use client";

import { useState, useEffect } from "react";
import { playSoundIf } from "@/lib/sounds";

const TURN_SECONDS = 20;

interface TurnTimerProps {
  deadline: number; // unix ms
  onExpired?: () => void;
  // When this player has locked in, freeze the countdown at its current
  // value. The server-side turn timer still runs (waiting for opponent),
  // but for the local player the time pressure is over.
  frozen?: boolean;
  // Block C1.b (hotfix 2026-04-30) — server-side pause due to a player
  // being in the reconnect-grace window. Differs from `frozen` semantically
  // (`frozen` = "I locked in"; `paused` = "the world is paused") but the
  // UI behaviour is the same: stop ticking. When `paused` is true and
  // `pausedRemainingMs` is provided, render the frozen value from that
  // instead of computing it from `deadline`.
  paused?: boolean;
  pausedRemainingMs?: number | null;
}

export function TurnTimer({ deadline, onExpired, frozen, paused, pausedRemainingMs }: TurnTimerProps) {
  const [remaining, setRemaining] = useState(TURN_SECONDS);

  useEffect(() => {
    if (frozen || paused) return;
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 5 && left > 0) playSoundIf("countdown");
      if (left <= 0) {
        clearInterval(interval);
        onExpired?.();
      }
    }, 250);
    return () => clearInterval(interval);
  }, [deadline, onExpired, frozen, paused]);

  // While paused, render the server-reported frozen remainder so both
  // tabs stay visually in sync (the local computation would drift if we
  // kept reading deadline-now during the pause).
  useEffect(() => {
    if (paused && typeof pausedRemainingMs === "number") {
      setRemaining(Math.max(0, Math.ceil(pausedRemainingMs / 1000)));
    }
  }, [paused, pausedRemainingMs]);

  const pct = Math.max(0, (remaining / TURN_SECONDS) * 100);
  // Tone-color the timer per design system threshold (matches HpBar).
  const fill =
    remaining > 15
      ? "var(--rarity-uncommon)"
      : remaining > 5
        ? "var(--sc-bronze)"
        : "var(--sc-blood)";
  const textColor = paused ? "var(--sc-bronze)" : fill;

  return (
    <div style={{ textAlign: "center", fontFamily: "var(--font-ui)" }}>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 38,
          fontWeight: 400,
          color: textColor,
          lineHeight: 1,
          letterSpacing: "0.02em",
          animation: !paused && remaining <= 5 ? "pulse-timer 0.6s ease-in-out infinite" : undefined,
        }}
      >
        {remaining}
      </div>
      <div
        style={{
          width: 128,
          margin: "6px auto 0",
          background: "var(--sc-page)",
          height: 4,
          overflow: "hidden",
          border: "1px solid var(--sc-rim-2)",
          borderRadius: 1,
        }}
      >
        <div
          style={{
            background: paused ? "rgba(200,154,63,.55)" : fill,
            height: "100%",
            width: `${pct}%`,
            transition: "width 200ms linear",
          }}
        />
      </div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: "var(--ls-stamp)",
          textTransform: "uppercase",
          color: "var(--fg-3)",
          marginTop: 4,
        }}
      >
        {paused ? "paused" : "seconds"}
      </div>
      <style>{`@keyframes pulse-timer{0%,100%{opacity:1}50%{opacity:.55}}`}</style>
    </div>
  );
}
