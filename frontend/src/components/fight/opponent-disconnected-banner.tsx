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
      style={{
        background: "var(--sc-panel-2)",
        border: "1px solid var(--sc-bronze-deep)",
        borderLeft: "3px solid var(--sc-bronze)",
        borderRadius: "var(--r-card)",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: "var(--sh-plate-sm)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--sc-bronze)",
              animation: "pulse 1.4s ease-in-out infinite",
              boxShadow: "0 0 6px var(--sc-bronze-hot)",
            }}
          />
          <span style={{ color: "var(--sc-bronze)", fontWeight: 800 }}>
            {subjectLabel} disconnected
          </span>
          <span style={{ color: "var(--fg-2)" }}>
            — {verb} reconnecting. Turn timer paused.
          </span>
        </div>
        <div
          style={{
            color: "var(--sc-bronze)",
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {remainingSec}s
        </div>
      </div>
      <div
        style={{
          width: "100%",
          height: 3,
          background: "var(--sc-page)",
          overflow: "hidden",
          borderRadius: 1,
        }}
      >
        <div
          style={{
            height: 3,
            background: "var(--sc-bronze)",
            width: `${pct}%`,
            transition: "width 200ms linear",
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: "var(--fg-3)" }}>
        If no reconnect within {totalSec}s the fight forfeits to the connected
        player.
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}
