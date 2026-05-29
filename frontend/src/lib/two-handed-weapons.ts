/**
 * Two-handed weapon enforcement — frontend mirror of the chain rule.
 *
 * The chain (contracts/sources/item.move) stamps every minted Item with a
 * `slot_type: u8` field — 0=mainhand, 1=offhand, 2=both_hands — and
 * contracts/sources/equipment.move equip_weapon / equip_offhand consume
 * it directly. The frontend reads `slot_type` off the same chain object
 * (hydrated by `lib/sui-contracts.ts::fetchOwnedItems` and friends, and
 * carried across the wire by `server/src/utils/wire-sanitize.ts`) and
 * mirrors the chain's enforcement in the picker + loadout-save flow so
 * the user is prevented from staging an illegal loadout in the first
 * place — chain enforcement remains the trustless backstop.
 *
 * **History.** Pre-v5.1 the on-chain `Item` had no `slot_type` field, so
 * this module guessed by name (a hardcoded `TWO_HANDED_NAMES` set of
 * three weapon names). That allowlist was deleted on 2026-05-29 when
 * v5.1's chain `slot_type` was plumbed end-to-end. The fix closes the
 * `project_slot_type_seed.md` seed.
 *
 * If you're adding a new two-handed weapon, you only need to mint it
 * with `slot_type = SLOT_BOTH_HANDS` on chain — no frontend change.
 */
import type { EquipmentSlots, Item } from "../types/game";
import { ITEM_TYPES, SLOT_TYPES } from "../types/game";

/**
 * Classifies a stage-equip attempt against the two-handed rule and
 * tells the caller what UX response to fire. Pure: no React state, no
 * dispatch, no side effects — testable in isolation.
 *
 * The three outcomes:
 *
 *   - `'auto_clear'` — the user is staging a 2H weapon over an
 *     occupied off-hand. This is a *correct, intentional* action; the
 *     caller should silently clear the off-hand and surface a
 *     non-blocking toast ("Off-hand removed — two-handed weapon
 *     equipped."). NOT a conflict.
 *
 *   - `'block_and_explain'` — the user is staging something into the
 *     off-hand slot while the rule forbids it (case 2: a 2H candidate
 *     in the off-hand slot, or case 3: anything in the off-hand slot
 *     while the current weapon is 2H). The caller MUST refuse the
 *     stage AND open the educational modal so the player learns the
 *     rule. This is the "wrong order" surface; players who first
 *     unequip the 2H weapon never reach this branch, so the modal
 *     naturally stops firing as the player learns.
 *
 *   - `'ok'` — no two-handed concern; proceed with the normal stage.
 */
export type StageEquipDecision =
  | "auto_clear"
  | "block_and_explain"
  | "ok";

export function classifyStageEquip(args: {
  slot: keyof EquipmentSlots;
  candidate: Pick<Item, "itemType" | "slotType">;
  pending: EquipmentSlots;
}): StageEquipDecision {
  const candidateIs2H = isTwoHanded(args.candidate);

  if (args.slot === "weapon") {
    if (candidateIs2H && args.pending.offhand != null) return "auto_clear";
    return "ok";
  }

  if (args.slot === "offhand") {
    // Case 2 — 2H weapon staged into the off-hand slot. Chain
    // enforcement: equipment.move::equip_offhand asserts slot_type !=
    // BOTH_HANDS → EItemNotOffhand=9.
    if (candidateIs2H) return "block_and_explain";
    // Case 3 — anything (1H weapon, shield) staged into the off-hand
    // slot while the current weapon is 2H. Chain enforcement:
    // equipment.move::equip_offhand asserts the current weapon is not
    // two-handed → EWeaponIsTwoHanded=7.
    const w = args.pending.weapon;
    if (w && isTwoHanded(w)) return "block_and_explain";
    return "ok";
  }

  // Helmet / chest / gloves / boots / belt / rings / necklace / pants /
  // bracelets — the 2H rule never touches these slots.
  return "ok";
}

/**
 * True iff `item` is a two-handed weapon per its chain `slot_type` field.
 * Server-only legacy NPC items (UUID ids, no chain representation) carry
 * `slotType === undefined`; those are never two-handed by construction
 * — the pre-v5.1 NPC loot generator only mints mainhand weapons.
 */
export function isTwoHanded(item: Pick<Item, "itemType" | "slotType">): boolean {
  // Defence: only weapons can be two-handed. A shield with slot_type=2
  // would be a chain-side mint bug; refuse to treat it as 2H even then.
  if (item.itemType !== ITEM_TYPES.WEAPON) return false;
  return item.slotType === SLOT_TYPES.BOTH_HANDS;
}

export interface TwoHandedConflict {
  /** True if this candidate conflicts with the current pending loadout. */
  conflict: boolean;
  /** User-facing reason — surfaced as a picker `lockedReason` and as a
   *  toast on the `stageEquip` defence-in-depth path. */
  reason?: string;
}

/**
 * Decide whether equipping `candidate` into `slot` would create a
 * two-handed conflict given the current `pending` equipment. Pure: no
 * React state, no chain calls.
 *
 * Design rule (locked, 2026-05-04, re-anchored to chain `slot_type` on
 * 2026-05-29): **two-handed weapons take both slots — they go in
 * `weapon` only, and the `offhand` must be empty while one is
 * equipped.** The three concrete conflict cases:
 *
 *   1. 2H candidate → `weapon` slot, `pending.offhand` non-null
 *      Reason: "Two-handed weapon — unequip your off-hand first."
 *      Note: the save path also auto-clears the offhand for this case
 *      (loadout-tx.ts), so this guard is primarily picker-side UX. The
 *      `stageEquip` hook reconciles via the auto-clear, so the toast
 *      here is a tooltip in the picker rather than a save-time error.
 *
 *   2. 2H candidate → `offhand` slot (regardless of mainhand state)
 *      Reason: "Two-handed weapon — equip in the weapon slot."
 *      Why: 2H weapons don't fit in the off-hand slot at all. Chain
 *      enforcement: equipment.move equip_offhand asserts slot_type !=
 *      both_hands → EItemNotOffhand (code 9).
 *
 *   3. Anything → `offhand` slot while `pending.weapon` is 2H
 *      Reason: "Two-handed weapon equipped — unequip it before adding
 *      an off-hand."
 *      Chain enforcement: equipment.move equip_offhand asserts the
 *      current weapon is not two-handed → EWeaponIsTwoHanded (code 7).
 *
 * Replace semantics: equipping a 2H into `weapon` REPLACES the existing
 * mainhand (1H or 2H); we don't require the mainhand to be empty.
 * Forcing manual unequip-first there would break normal RPG flow ("I
 * want to swap weapons"). The "feels heavy and committed" intent comes
 * from the offhand-empty requirement + offhand-never-2H rule above —
 * not from blocking weapon-slot replacement.
 */
export function evaluateTwoHandedConflict(args: {
  slot: keyof EquipmentSlots;
  candidate: Pick<Item, "itemType" | "slotType">;
  pending: EquipmentSlots;
}): TwoHandedConflict {
  const candidateIs2H = isTwoHanded(args.candidate);

  if (args.slot === "weapon") {
    // Case 1 — 2H mainhand requires offhand empty. Note: the save-path
    // auto-clears the offhand for this case, so the picker surfaces
    // this as informational rather than blocking. Returning conflict
    // here lets the picker render the "we'll clear the off-hand"
    // notice on the candidate row.
    if (candidateIs2H && args.pending.offhand !== null) {
      return {
        conflict: true,
        reason: "Two-handed weapon — equipping will clear your off-hand.",
      };
    }
    return { conflict: false };
  }

  if (args.slot === "offhand") {
    // Case 2 — 2H never goes in offhand, regardless of mainhand state.
    if (candidateIs2H) {
      return {
        conflict: true,
        reason: "Two-handed weapon — equip in the weapon slot.",
      };
    }
    // Case 3 — anything (1H weapon / shield) blocked while mainhand has 2H.
    const w = args.pending.weapon;
    if (w && isTwoHanded(w)) {
      return {
        conflict: true,
        reason: "Two-handed weapon equipped — unequip it before adding an off-hand.",
      };
    }
    return { conflict: false };
  }

  // Helmet / chest / gloves / boots / belt / rings / necklace / pants /
  // bracelets — unaffected by the two-handed rule.
  return { conflict: false };
}
