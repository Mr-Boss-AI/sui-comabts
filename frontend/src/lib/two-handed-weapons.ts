/**
 * Two-handed weapon enforcement (Path A — frontend hardcoded list).
 *
 * Bug 2026-05-04 — `Item` has no `slot_type` field on chain (`item.move`),
 * so a player can equip a two-handed weapon (Cursed Greatsword,
 * Skullcrusher Maul) in `weapon` AND another two-handed weapon in
 * `offhand` (the dual-wield slot). The combat math sums both damage
 * ranges plus grants the dual-wield "+1 attack zone" bonus, breaking
 * intended balance — and is visually impossible (you can't hold two
 * greatswords).
 *
 * Path A enforces the constraint via a hardcoded name allowlist of
 * two-handed weapons. The slot picker greys out conflicting candidates
 * (same UX as level-locked items, fd56b4a) and `stageEquip` refuses
 * conflicting equips before the dirty-state mutation.
 *
 * Path B (chain `slot_type: u8` on Item, `equipment::equip` enforces) is
 * the trustless fix and lives in the v5.1 republish bundle alongside
 * `CharacterRegistry`, `OpenWagerRegistry`, `burn_character`, on-chain
 * loot mint. Until then, this allowlist covers all UI users in practice;
 * a hand-crafted PTB could still bypass it but the chain wager system
 * doesn't surface in normal play.
 *
 * To add a new two-handed weapon: append its on-chain `name` field to
 * `TWO_HANDED_NAMES`. The list is small enough that O(n) lookup is fine,
 * but we use a Set for clarity + future growth. Names match the chain
 * `Item.name` String exactly — same value the picker / inventory render.
 */
import type { EquipmentSlots, Item } from "../types/game";
import { ITEM_TYPES } from "../types/game";

/**
 * The chain `name` of every two-handed weapon currently in circulation.
 * Update this list when a new two-handed weapon is minted.
 *
 * v5 catalog two-handed weapons (per `deployment.testnet-v5.json`):
 *   - "Steel Greatsword"   (Lv5 Rare)
 *   - "Cursed Greatsword"  (Lv5 Epic)
 *   - "Skullcrusher Maul"  (Lv6 Epic — nft_catalog_v5_1)
 *
 * Daggers + stilettos that read like two-handed by name (Twin Stilettos)
 * are intentionally NOT in this set — those are dual-wieldable weapons
 * that fit one-handed; current testnet design treats them as mainhand.
 * See `project_slot_type_seed.md` memory for the v5.1+ refactor that
 * subsumes this hardcoded list.
 */
export const TWO_HANDED_NAMES: ReadonlySet<string> = new Set([
  "Steel Greatsword",
  "Cursed Greatsword",
  "Skullcrusher Maul",
]);

/** True if `item` is a two-handed weapon per the hardcoded allowlist. */
export function isTwoHanded(item: Pick<Item, "name" | "itemType">): boolean {
  // Defence: only weapons can be two-handed. A future "two-handed shield"
  // would need a separate primitive anyway.
  if (item.itemType !== ITEM_TYPES.WEAPON) return false;
  return TWO_HANDED_NAMES.has(item.name);
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
 * Design rule (locked, 2026-05-04): **two-handed weapons take both
 * slots — they go in `weapon` only, and the `offhand` must be empty
 * while one is equipped.** The three concrete conflict cases:
 *
 *   1. 2H candidate → `weapon` slot, `pending.offhand` non-null
 *      Reason: "Two-handed weapon — requires both slots empty.
 *               Unequip your off-hand first."
 *
 *   2. 2H candidate → `offhand` slot (regardless of mainhand state)
 *      Reason: "Two-handed weapon — requires both slots empty.
 *               Equip in the weapon slot."
 *      Why: 2H weapons don't fit in the off-hand slot. Closes the
 *      2026-05-04 gap where Skullcrusher Maul appeared selectable
 *      in the offhand picker even when mainhand had a 1H sword,
 *      letting players dual-wield Longsword + Maul.
 *
 *   3. Anything → `offhand` slot while `pending.weapon` is 2H
 *      Reason: "Two-handed weapon equipped — unequip it before
 *               adding an off-hand."
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
  candidate: Pick<Item, "name" | "itemType">;
  pending: EquipmentSlots;
}): TwoHandedConflict {
  const candidateIs2H = isTwoHanded(args.candidate);

  if (args.slot === "weapon") {
    // Case 1 — 2H mainhand requires offhand empty.
    if (candidateIs2H && args.pending.offhand !== null) {
      return {
        conflict: true,
        reason: "Two-handed weapon — requires both slots empty. Unequip your off-hand first.",
      };
    }
    return { conflict: false };
  }

  if (args.slot === "offhand") {
    // Case 2 — 2H never goes in offhand, regardless of mainhand state.
    if (candidateIs2H) {
      return {
        conflict: true,
        reason: "Two-handed weapon — requires both slots empty. Equip in the weapon slot.",
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

  // Helmet / chest / gloves / boots / belt / rings / necklace — unaffected.
  return { conflict: false };
}
