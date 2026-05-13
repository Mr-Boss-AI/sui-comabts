"use client";

/**
 * Phase 2 v2 — TavernRoom — the Bucket 3 social hub layout.
 *
 *   ┌───────────────────────────────────────────┬──────────────┐
 *   │                                           │              │
 *   │         Global chat (left, 2/3)           │   Player     │
 *   │                                           │   Sidebar    │
 *   │                                           │  (right, 1/3)│
 *   └───────────────────────────────────────────┴──────────────┘
 *
 * The DM panel is rendered globally (game-screen mount) so it survives
 * navigating away from the Tavern. Same for the FightRequestToasts
 * and PlayerProfileModal.
 */

import { RimFrame, DisplayTitle } from "@/components/v2";
import { ChatPanel } from "./chat-panel";
import { PlayerSidebar } from "./player-sidebar";

export function TavernRoom() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
        gap: 14,
      }}
    >
      <RimFrame
        padless
        style={{
          height: 620,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            borderBottom: "1px solid var(--sc-rim)",
            padding: "12px 16px",
            background: "var(--sc-panel-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <DisplayTitle size="sm" style={{ color: "var(--sc-bronze)" }}>
            Tavern Chat
          </DisplayTitle>
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "var(--ls-stamp)",
              textTransform: "uppercase",
              color: "var(--fg-3)",
            }}
          >
            Global · In-game
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ChatPanel />
        </div>
      </RimFrame>
      <RimFrame
        padless
        style={{
          height: 620,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <PlayerSidebar />
      </RimFrame>
    </div>
  );
}
