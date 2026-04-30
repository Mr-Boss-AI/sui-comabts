"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";

/**
 * Persistent banner shown above the fight arena while the opponent (or
 * the local player on the other tab) is in the reconnect-grace window.
 *
 * Block C1.a (hotfix 2026-04-30 part 2). Pre-fix, an `opponent_disconnected`
 * server message dispatched a transient toast that auto-faded after 5s,
 * leaving the connected player no signal that the game was paused.
 *
 * Behaviour:
 *   - Renders only when `state.opponentDisconnect` is non-null.
 *   - Live-counts down to `expiresAt` once per second (250 ms tick to
 *     stay in sync with the server-side grace timer).
 *   - Cannot be dismissed manually — the only ways out are
 *     `opponent_reconnected` (server clears the slot), `fight_resumed`
 *     (we just rejoined), or fight-end.
 *   - Copy adapts to whether the disconnected wallet is the local
 *     player's own (rare — happens if the rejoining tab also receives
 *     the message before the reconnect handler fires) or the opponent's.
 */
export function OpponentDisconnectedBanner() {
  const { state } = useGame();
  const account = useCurrentAccount();
  const drop = state.opponentDisconnect;
  const myAddress = account?.address?.toLowerCase();

  // Tick every 250ms so the visible second-counter stays accurate without
  // burning a render every animation frame.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!drop) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [drop]);

  if (!drop) return null;

  const remainingMs = Math.max(0, drop.expiresAt - now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const totalSec = Math.max(1, Math.round(drop.graceMs / 1000));
  const pct = Math.min(100, Math.max(0, (remainingMs / drop.graceMs) * 100));

  // The local player normally gets a `fight_resumed` instead of seeing
  // their own `opponent_disconnected`, but if the latter does land we
  // should still render gracefully.
  const isSelf =
    myAddress != null && drop.walletAddress.toLowerCase() === myAddress;
  const subjectLabel = isSelf ? "You" : "Opponent";
  const verb = isSelf ? "are" : "is";

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-amber-700/50 bg-amber-950/40 px-4 py-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-amber-100 font-semibold">
            {subjectLabel} disconnected
          </span>
          <span className="text-amber-300/80">
            — {verb} reconnecting. Turn timer paused.
          </span>
        </div>
        <div className="text-amber-200 font-mono tabular-nums text-sm">
          {remainingSec}s
        </div>
      </div>
      <div className="w-full bg-amber-900/40 h-1 rounded-full overflow-hidden">
        <div
          className="bg-amber-400 h-1 rounded-full transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-amber-300/70">
        If no reconnect within {totalSec}s the fight forfeits to the connected
        player.
      </div>
    </div>
  );
}
