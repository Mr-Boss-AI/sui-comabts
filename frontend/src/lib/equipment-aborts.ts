/**
 * Equipment Move abort codes → human-readable copy.
 *
 * Mirrors the constants in `contracts/sources/equipment.move`. Pinned by
 * `scripts/qa-equipment-aborts.ts`; if the Move constants ever renumber,
 * the gauntlet fails and forces this table to be re-synced before any
 * frontend ships against a republished package.
 *
 * Bug ledger context — the 2026-05-29 two-handed-weapon report was the
 * first time codes 6/7/8/9 needed human strings. Pre-fix the user got
 * raw `Abort code 6 (at equipment::equip_weapon:86)` toasts from the
 * dapp-kit 2.16 SDK (which throws Error directly on MoveAbort rather
 * than resolving with `$kind=FailedTransaction`). The catch block in
 * `useEquipmentActions.ts::saveLoadout` now passes this table to
 * `humanizeChainError`, so the same abort reads as the friendly
 * sentence above the code instead.
 *
 * Mapping rules:
 *   - One sentence, plain English. No Move identifiers.
 *   - Tell the user what's broken AND what to do next when there's a
 *     reasonable recovery path (unequip, swap, refresh).
 *   - For invariants that the picker / save-time auto-reconcile should
 *     prevent (codes 6, 7, 9 — two-handed conflicts), the copy is still
 *     written assuming the user landed here despite our gates.
 */

import type { AbortCodeMap } from "./tx-result";

export const EQUIPMENT_ABORT_CODES: AbortCodeMap = {
  // EWrongItemType = 0 — item.itemType doesn't match the slot.
  0: "Wrong item type for this slot",
  // ESlotOccupied = 1 — DOF already present at this slot key.
  1: "Slot already occupied",
  // ESlotEmpty = 2 — unequip called on an empty slot.
  2: "Slot is empty — nothing to unequip",
  // ELevelTooLow = 3 — character.level < item.level_req.
  3: "Character level too low for this item",
  // ENotOwner = 4 — tx_context::sender(ctx) != character::owner.
  4: "Not your character",
  // EFightLocked = 5 — character.fight_lock_expires_at > clock::now.
  5: "Character is locked in an active fight",
  // EOffhandOccupied = 6 — equip_weapon with slot_type=BOTH_HANDS while
  // offhand DOF is non-empty. The save-time auto-reconcile in
  // buildSaveLoadoutTx clears the offhand before this can fire; a hit
  // here means defence-in-depth failed (race, programmatic mutation).
  6: "That's a two-handed weapon — unequip your off-hand first.",
  // EWeaponIsTwoHanded = 7 — equip_offhand while current weapon's
  // slot_type=BOTH_HANDS. The offhand SlotTile locks itself in this
  // case; a hit here means the user bypassed the lock somehow.
  7: "You're holding a two-handed weapon. Unequip it to use an off-hand.",
  // EItemNotMainhand = 8 — equip_weapon with slot_type=OFFHAND. The
  // picker filters offhand-only items out of the weapon slot list, so
  // a hit here means a chain-side mismint or a stale picker.
  8: "That item can't go in the weapon slot — it's an off-hand item.",
  // EItemNotOffhand = 9 — equip_offhand with slot_type=BOTH_HANDS, or
  // a shield without slot_type=OFFHAND. The picker filters 2H weapons
  // out of the offhand list; a hit here is the same fault class as 8.
  9: "That item can't go in the off-hand slot — it's a two-handed or main-hand-only item.",
};
