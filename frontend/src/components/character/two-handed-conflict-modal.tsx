"use client";

/**
 * Educational center-screen modal for the two-handed-weapon rule.
 *
 * Fires only when the user attempts a *wrong-order* action — e.g.
 * staging an off-hand item while a two-handed weapon is equipped, or
 * staging a 2H weapon into the off-hand slot. The classifier in
 * `lib/two-handed-weapons.ts::classifyStageEquip` decides; the action
 * `SHOW_TWO_HANDED_CONFLICT_MODAL` opens this modal.
 *
 * Players who learn the rule (unequip the 2H weapon first, then equip
 * the off-hand) never trigger the classifier's `block_and_explain`
 * branch and therefore never see this modal again — self-extinguishing
 * by design, no localStorage "seen-it" flag needed.
 *
 * Sits side-by-side with two passive reminders that always stay:
 *   - the bottom toast for the auto-clear notice
 *     ("Off-hand removed — two-handed weapon equipped")
 *   - the dimmed off-hand SlotTile with tooltip when a 2H is equipped
 */

import { Modal } from "@/components/ui/modal";
import { useGame } from "@/hooks/useGameStore";

export function TwoHandedConflictModal() {
  const { state, dispatch } = useGame();
  const open = state.twoHandedConflictModalOpen;
  const close = () => dispatch({ type: "HIDE_TWO_HANDED_CONFLICT_MODAL" });

  return (
    <Modal open={open} onClose={close} title="Two-Handed Weapon">
      <div
        style={{
          fontFamily: "var(--font-ui)",
          color: "var(--sc-parchment)",
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        <p style={{ margin: "0 0 12px 0" }}>
          Two-handed weapons need both hands — you can&apos;t use an off-hand
          at the same time.
        </p>
        <p style={{ margin: "0 0 18px 0", color: "var(--fg-2)" }}>
          Unequip your weapon first to equip an off-hand, or equip the
          two-hander and your off-hand will be removed automatically.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={close}
            autoFocus
            style={{
              background: "var(--sc-bronze)",
              border: "1px solid var(--sc-bronze-deep)",
              color: "var(--sc-page)",
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              padding: "8px 18px",
              cursor: "pointer",
              borderRadius: 2,
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </Modal>
  );
}
