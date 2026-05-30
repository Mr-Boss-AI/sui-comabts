"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useGame } from "@/hooks/useGameStore";
import {
  shouldRenderLevelUp,
  formatLevelUpHeadline,
  formatLevelUpBody,
  formatPointsLine,
} from "@/lib/level-up-display";

/**
 * One-shot celebration modal that fires when the server emits
 * `character_leveled_up` (Fix 3, 2026-05-04).
 *
 * Behavior:
 *   - Reads `state.levelUpEvent` and `state.fight` to decide whether to
 *     render. Active fight → queue (don't disrupt combat UI). The event
 *     stays in the reducer until dismissed.
 *   - "Allocate Stat Points" CTA navigates to the Character area and
 *     flips `pendingStatAllocate` so `CharacterProfile` opens its
 *     existing `StatAllocateModal` automatically.
 *   - "Later" dismisses without navigating. The character page's
 *     existing `+N points to allocate` indicator persists.
 *
 * Multi-level gains render as "Level Up x2!" / "x3!" / etc — see
 * `formatLevelUpHeadline`.
 */
export function LevelUpModal() {
  const { state, dispatch } = useGame();
  const event = shouldRenderLevelUp(state.levelUpEvent, state.fight ? { id: state.fight.id } : null);

  if (!event) return null;

  const headline = formatLevelUpHeadline(event);
  const body = formatLevelUpBody(event);
  const pointsLine = formatPointsLine(event);

  function handleAllocate() {
    dispatch({ type: "SET_PENDING_STAT_ALLOCATE", pending: true });
    dispatch({ type: "SET_AREA", area: "character" });
    dispatch({ type: "CLEAR_LEVEL_UP_EVENT" });
  }

  function handleLater() {
    dispatch({ type: "CLEAR_LEVEL_UP_EVENT" });
  }

  return (
    <Modal open onClose={handleLater} title={headline}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          textAlign: "center",
          fontFamily: "var(--font-ui)",
          color: "var(--sc-parchment)",
        }}
      >
        {/* Celebratory display headline + Slackey-toned wordmark. */}
        <div style={{ position: "relative", padding: "16px 0" }}>
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(200,154,63,.25), transparent 70%)",
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 44,
                lineHeight: 1.05,
                color: "var(--sc-bronze)",
                textShadow:
                  "3px 3px 0 #000, 0 0 24px rgba(200,154,63,.4)",
                letterSpacing: "0.02em",
              }}
            >
              {headline}
            </div>
            <div
              style={{
                marginTop: 6,
                color: "var(--sc-parchment)",
                fontSize: 14,
              }}
            >
              {body}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "10px 14px",
            background: "var(--sc-bronze)",
            color: "var(--sc-page)",
            border: "2px solid var(--sc-bronze-deep)",
            fontFamily: "var(--font-ui)",
            fontWeight: 800,
            fontSize: 14,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            boxShadow: "var(--sh-plate-sm)",
            animation: "lv-pulse 1.4s ease-in-out infinite",
          }}
        >
          {pointsLine}
        </div>
        <style>{`@keyframes lv-pulse{0%,100%{box-shadow:var(--sh-plate-sm)}50%{box-shadow:0 0 14px var(--sc-bronze-hot), var(--sh-plate-sm)}}`}</style>

        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={handleLater} style={{ flex: 1 }}>
            Later
          </Button>
          <Button onClick={handleAllocate} style={{ flex: 1 }}>
            Allocate Stat Points
          </Button>
        </div>

        <p
          style={{
            fontSize: 10,
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            margin: 0,
          }}
        >
          Lv {event.oldLevel} → Lv {event.newLevel}
        </p>
      </div>
    </Modal>
  );
}
