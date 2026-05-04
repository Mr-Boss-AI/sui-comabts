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
      <div className="space-y-4 text-center">
        {/* Headline glow — pure CSS for the celebratory feel. No
            third-party particles; the existing modal shell + a
            gradient + a subtle pulse covers it. */}
        <div className="relative py-2">
          <div
            aria-hidden
            className="absolute inset-0 rounded-lg bg-gradient-to-b from-amber-500/20 via-amber-700/10 to-transparent blur-md"
          />
          <div className="relative">
            <div className="text-5xl font-extrabold bg-gradient-to-b from-amber-300 via-amber-400 to-amber-600 bg-clip-text text-transparent tracking-tight">
              {headline}
            </div>
            <div className="mt-1 text-zinc-300 text-base">{body}</div>
          </div>
        </div>

        {/* Points-to-allocate line. The pulsing accent matches the
            existing `+N points` button on CharacterProfile — players
            recognise it as the same call-to-action. */}
        <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-amber-300 font-semibold animate-pulse">
          {pointsLine}
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleLater} className="flex-1">
            Later
          </Button>
          <Button onClick={handleAllocate} className="flex-1">
            Allocate Stat Points
          </Button>
        </div>

        <p className="text-[10px] text-zinc-600">
          Lv {event.oldLevel} → Lv {event.newLevel}
        </p>
      </div>
    </Modal>
  );
}
