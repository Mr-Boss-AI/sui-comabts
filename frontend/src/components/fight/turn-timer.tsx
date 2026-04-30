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
  const color =
    remaining > 15 ? "bg-emerald-500" : remaining > 5 ? "bg-amber-500" : "bg-red-500";
  const textColor =
    remaining > 15
      ? "text-emerald-400"
      : remaining > 5
        ? "text-amber-400"
        : "text-red-400 animate-pulse";

  return (
    <div className="text-center">
      <div
        className={`text-3xl font-bold font-mono ${
          paused ? "text-amber-300" : textColor
        }`}
      >
        {remaining}
      </div>
      <div className="w-32 mx-auto bg-zinc-800 h-1.5 rounded-full overflow-hidden mt-1">
        <div
          className={`${paused ? "bg-amber-500/60" : color} h-1.5 rounded-full transition-all duration-200`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-zinc-500 mt-1">
        {paused ? "paused" : "seconds"}
      </div>
    </div>
  );
}
