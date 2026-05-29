import { Transaction } from "@mysten/sui/transactions";
import type { EquipmentSlots, Item } from "../types/game";
import {
  EQUIPMENT_SLOT_KEYS,
  isOnChainItem,
  toChainSlot,
} from "./loadout";
import { isTwoHanded } from "./two-handed-weapons";
import { CALL_PACKAGE, SUI_CLOCK } from "./sui-contracts";

// Worst case = 13 slots * (unequip + equip) + 1 save_loadout = 27 moveCalls
// at ~5M MIST each. 200M MIST (0.2 SUI) leaves headroom for the v5.1
// 13-slot loadout plus the worst-case two-handed reconciliation.
const SAVE_LOADOUT_GAS_BUDGET = BigInt(200_000_000);

export interface BuildSaveLoadoutResult {
  tx: Transaction;
  /** Slots that emitted chain calls. UI uses this for progress copy. */
  changedSlots: Array<keyof EquipmentSlots>;
  /** Slots dirty but skipped because the pending item isn't on-chain. */
  skippedNonChainSlots: Array<keyof EquipmentSlots>;
  /**
   * The pending loadout AFTER 2H reconciliation. When `pending.weapon` is
   * two-handed AND `pending.offhand` is non-null, the build silently
   * sanitizes the offhand to `null` (chain enforces — see
   * `equipment.move::equip_weapon EOffhandOccupied=6`). `COMMIT_SAVED`
   * MUST rebase against this value rather than the original `pending`,
   * otherwise the UI shows a stale offhand after a successful save.
   */
  reconciledPending: EquipmentSlots;
  /**
   * Set when the build auto-cleared `pending.offhand` to satisfy the 2H
   * invariant. The caller surfaces a non-blocking notice
   * ("Off-hand removed — two-handed weapon equipped.") so the user
   * understands why their off-hand vanished from the save.
   */
  offhandAutoCleared: boolean;
}

/**
 * Build the one-signature "Save Loadout" PTB.
 *
 * ## Cross-slot invariant — two-handed weapon
 *
 * The chain enforces "two-handed weapon ↔ empty offhand" in two places:
 *
 *   - `equipment.move::equip_weapon` (line 68) — aborts with
 *     `EOffhandOccupied=6` if a 2H weapon is equipped while the offhand
 *     DOF is non-empty.
 *   - `equipment.move::equip_offhand` (line 109) — aborts with
 *     `EWeaponIsTwoHanded=7` if an offhand item is equipped while the
 *     current weapon is two-handed.
 *
 * The frontend mirrors this rule at three layers (belt-and-suspenders):
 *
 *   1. **Picker (`equipment-picker.ts`)** — locks 2H candidates in the
 *      offhand picker and surfaces a tooltip on the conflicting row,
 *      so the user normally cannot stage the conflict.
 *   2. **Slot UI (`character-profile.tsx`)** — the offhand `SlotTile`
 *      disables itself with a tooltip when `pending.weapon` is 2H.
 *   3. **Diff build (this function)** — defence-in-depth. If a 2H
 *      weapon and an occupied offhand both reach the build (e.g. via
 *      programmatic state mutation or a race), the build silently
 *      auto-clears the offhand and surfaces `offhandAutoCleared=true`
 *      so the caller can render a non-blocking notice. The PTB then
 *      reflects the reconciled loadout — no illegal moveCall is ever
 *      emitted.
 *
 * Cleanly auto-clearing is the right call rather than refusing to
 * build: the user's intent in equipping a 2H weapon is unambiguous
 * ("yes, two hands"), and "I tried to equip a two-handed weapon and
 * nothing happened" would be worse UX than "I equipped it and the game
 * cleared my off-hand for me."
 *
 * ## PTB op ordering — unequip before equip
 *
 * The chain accepts moveCalls in a PTB as a sequenced atomic batch. The
 * naïve per-slot loop `unequip_<slot>; equip_<slot>` worked for v5.0
 * because every slot's commands target the same slot's DOF — within a
 * slot, ordering was incidental.
 *
 * v5.1's two-handed rule introduces a **cross-slot** ordering
 * constraint: equipping a 2H weapon checks that the offhand slot is
 * empty NOW (not after later commands run). So if the player swaps
 * "1H + shield → 2H" the PTB MUST emit `unequip_offhand` BEFORE
 * `equip_weapon(2H)`, even though the offhand isn't dirty in the
 * intuitive sense (it was already going to be empty after
 * reconciliation).
 *
 * The general rule we encode here:
 *
 *   **Phase 1**: every dirty slot's `unequip_*` (where committed had an item)
 *   **Phase 2**: every dirty slot's `equip_*` (where pending has an item)
 *   **Phase 3**: `save_loadout`
 *
 * This guarantees that all slots are free by the time any slot is
 * occupied, satisfying the cross-slot invariant without per-case
 * special handling.
 *
 * ## Atomicity
 *
 * Sui commits the whole PTB or none of it. On failure the signer's
 * caller catches and `pending` is preserved for retry.
 */
export function buildSaveLoadoutTx(
  characterObjectId: string,
  committed: EquipmentSlots,
  pending: EquipmentSlots,
): BuildSaveLoadoutResult {
  // -------------------------------------------------------------------
  // Step 1 — reconcile the 2H invariant.
  //
  // We mutate a local copy of pending, never the caller's object, so
  // the reducer's state stays consistent. On success the caller rebases
  // committed := reconciledPending (NOT the original pending).
  // -------------------------------------------------------------------
  let reconciledPending: EquipmentSlots = pending;
  let offhandAutoCleared = false;
  if (
    pending.weapon != null &&
    isTwoHanded(pending.weapon) &&
    pending.offhand != null
  ) {
    reconciledPending = { ...pending, offhand: null };
    offhandAutoCleared = true;
  }

  // -------------------------------------------------------------------
  // Step 2 — compute the per-slot ops we'll emit, grouped by phase.
  //
  // Walked in canonical EQUIPMENT_SLOT_KEYS order so the PTB sequence
  // is deterministic + stable across renders (useful for digest-based
  // dedupe + log parsing). Items that aren't on-chain are skipped at
  // this stage so the legacy NPC-item path stays out of the PTB.
  // -------------------------------------------------------------------
  type SlotOp = {
    slot: keyof EquipmentSlots;
    chainSlot: ReturnType<typeof toChainSlot>;
    needsUnequip: boolean;
    equipItem: Item | null;
  };
  const ops: SlotOp[] = [];
  const skippedNonChainSlots: Array<keyof EquipmentSlots> = [];

  for (const slot of EQUIPMENT_SLOT_KEYS) {
    const committedItem = committed[slot];
    const pendingItem = reconciledPending[slot];
    const committedId = committedItem?.id ?? null;
    const pendingId = pendingItem?.id ?? null;

    if (committedId === pendingId) continue;

    const committedOk = committedItem == null || isOnChainItem(committedItem);
    const pendingOk = pendingItem == null || isOnChainItem(pendingItem);
    if (!committedOk || !pendingOk) {
      skippedNonChainSlots.push(slot);
      continue;
    }

    ops.push({
      slot,
      chainSlot: toChainSlot(slot),
      needsUnequip: committedItem != null,
      equipItem: pendingItem,
    });
  }

  // -------------------------------------------------------------------
  // Step 3 — emit moveCalls in two phases.
  //
  // Phase 1: every unequip (frees slots). Phase 2: every equip (occupies
  // slots). The phase boundary is what makes the 1H+shield → 2H swap
  // legal: the offhand-unequip from phase 1 runs before the
  // 2H-weapon-equip in phase 2, so the chain sees the offhand DOF empty
  // at the moment equip_weapon's `EOffhandOccupied` check fires.
  // -------------------------------------------------------------------
  const tx = new Transaction();
  const changedSlots: Array<keyof EquipmentSlots> = ops.map((op) => op.slot);

  // Phase 1 — unequips
  for (const op of ops) {
    if (!op.needsUnequip) continue;
    tx.moveCall({
      target: `${CALL_PACKAGE}::equipment::unequip_${op.chainSlot}`,
      arguments: [tx.object(characterObjectId), tx.object(SUI_CLOCK)],
    });
  }

  // Phase 2 — equips
  for (const op of ops) {
    if (op.equipItem == null) continue;
    tx.moveCall({
      target: `${CALL_PACKAGE}::equipment::equip_${op.chainSlot}`,
      arguments: [
        tx.object(characterObjectId),
        tx.object(op.equipItem.id),
        tx.object(SUI_CLOCK),
      ],
    });
  }

  // Phase 3 — save_loadout (bump version + emit LoadoutSaved). Only
  // attached when there's at least one slot change — we don't want a
  // no-op tx if the user somehow clicks Save without dirty slots.
  if (changedSlots.length > 0) {
    tx.moveCall({
      target: `${CALL_PACKAGE}::equipment::save_loadout`,
      arguments: [tx.object(characterObjectId)],
    });
  }

  tx.setGasBudget(SAVE_LOADOUT_GAS_BUDGET);
  return {
    tx,
    changedSlots,
    skippedNonChainSlots,
    reconciledPending,
    offhandAutoCleared,
  };
}
