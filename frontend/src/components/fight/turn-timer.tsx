"use client";

import { useState, useEffect } from "react";
import { playSoundIf } from "@/lib/sounds";

const TURN_SECONDS = 60;

interface TurnTimerProps {
  deadline: number; // unix ms
  onExpired?: () => void;
}

export function TurnTimer({ deadline, onExpired }: TurnTimerProps) {
  const [remaining, setRemaining] = useState(TURN_SECONDS);

  useEffect(() => {
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
  }, [deadline, onExpired]);

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
      <div className={`text-3xl font-bold font-mono ${textColor}`}>
        {remaining}
      </div>
      <div className="w-32 mx-auto bg-zinc-800 h-1.5 rounded-full overflow-hidden mt-1">
        <div
          className={`${color} h-1.5 rounded-full transition-all duration-200`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-zinc-500 mt-1">seconds</div>
    </div>
  );
}
