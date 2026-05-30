/**
 * Slot-picker entry builder.
 *
 * Why this exists: the character-profile slot picker (click an empty
 * doll slot → "Weapon — Choose Item") used to drop level-locked items
 * out of its result set entirely. A Lv4 player with an Epic Cursed
 * Greatsword (Lv5 required) saw three Common weapons and zero hint
 * that the Epic existed. Compare with the inventory-click flow where
 * the same item opens a detail modal showing "Requires Level 5" — same
 * data, completely different player feeling. The fix: never drop
 * locked items, render them dimmed with a "Lv N" badge instead.
 *
 * This module is the single point of truth for what the slot picker
 * shows and in what order. Pure function so the qa gauntlet can pin
 * every selection rule.
 *
 * Selection rules (for slot S, level L):
 *   - merge server inventory + on-chain items, dedup by id (on-chain
 *     wins on conflict — DOF reads are authoritative for level/stat
 *     truth at fight time);
 *   - drop items where `inKiosk` is true (listed-for-sale or
 *     parked-but-unlisted; both block equip);
 *   - drop items already slotted in pendingEquipment (the user's view
 *     of "what will be on the doll after the next save");
 *   - drop items whose `itemType` doesn't satisfy the slot
 *     (`SLOT_TO_ITEM_TYPE[slot]`);
 *   - keep level-locked items, mark them `locked: true` with a
 *     `lockedReason` of "Requires Level N".
 *
 * Sort order: unlocked items first (alpha by name), then locked items
 * (ascending levelReq, then alpha). Players see what they can use now
 * at the top, what they're working toward at the bottom.
 */
import type { EquipmentSlots, Item } from "../types/game";
import { ITEM_TYPES, SLOT_TO_ITEM_TYPE, SLOT_TYPES } from "../types/game";
import { evaluateTwoHandedConflict, isTwoHanded } from "./two-handed-weapons";

/**
 * The inverse of `buildSlotPickerEntries`: given an Item, return every
 * slot the item is legally allowed to occupy. Drives the "EQUIP TO:"
 * panel in the inventory item-detail view.
 *
 * Per-item-type the answer comes from `SLOT_TO_ITEM_TYPE` — e.g. a
 * shield can go in `offhand`, a helmet can go in `helmet`. The wrinkle
 * is **weapons**: `SLOT_TO_ITEM_TYPE.offhand` includes WEAPON because
 * dual-wield is a real configuration, but a **two-handed** weapon must
 * never present `offhand` as an equip target. The chain rejects it
 * (`equipment.move::equip_offhand` asserts `slot_type != BOTH_HANDS`
 * → `EItemNotOffhand=9`), and surfacing the choice teaches the user a
 * lie — "you can put your maul in your off-hand" is wrong before the
 * click, not just after the save.
 *
 * The rule per weapon `slot_type`:
 *   - MAINHAND → both `weapon` and `offhand` (single-hand → dual-wield-eligible)
 *   - BOTH_HANDS → `weapon` only
 *   - OFFHAND → `offhand` only (defence — chain mint validation forbids
 *     a WEAPON with slot_type=OFFHAND but we mirror the constraint)
 *   - undefined (legacy server-only NPC items) → both `weapon` and
 *     `offhand`, matching the pre-v5.1 implicit shape so existing NPC
 *     loot keeps working.
 */
export function getEquipTargetsForItem(
  item: Pick<Item, "itemType" | "slotType">,
): Array<keyof EquipmentSlots> {
  const slots: Array<keyof EquipmentSlots> = [];
  for (const [slot, types] of Object.entries(SLOT_TO_ITEM_TYPE)) {
    if (!types.includes(item.itemType)) continue;
    const slotKey = slot as keyof EquipmentSlots;

    // v5.1 — weapon-specific filter. Non-weapon item_types fall through
    // to the default include below (a shield only ever matches the
    // offhand row, jewellery only its own slot, etc.).
    if (item.itemType === ITEM_TYPES.WEAPON) {
      if (slotKey === "offhand") {
        // Two-handed weapon — never offer the offhand row.
        if (isTwoHanded(item)) continue;
        // Defence — a WEAPON with slot_type=OFFHAND shouldn't exist
        // (item.move::mint_item_admin rejects it with
        // EWeaponSlotTypeInvalid=7), but if one ever did, only show
        // offhand.
        if (item.slotType === SLOT_TYPES.OFFHAND) {
          // offhand-only weapon — push offhand, but ALSO skip the
          // weapon-row push below by short-circuiting the outer loop.
        }
      }
      if (slotKey === "weapon" && item.slotType === SLOT_TYPES.OFFHAND) {
        // Mirror of the above: an OFFHAND-typed weapon must not show
        // the weapon row either.
        continue;
      }
    }

    slots.push(slotKey);
  }
  return slots;
}

export interface PickerEntry {
  item: Item;
  locked: boolean;
  /** Present iff `locked === true`. One of:
   *   - "Requires Level N"                         (level-gated)
   *   - "Two-handed — unequip your off-hand first." (2H weapon → weapon slot)
   *   - "Two-handed weapon equipped — …"           (anything → offhand slot)
   */
  lockedReason?: string;
}

/**
 * `pendingEquipment` is optional for backward-compatibility with older
 * call sites. When provided, two-handed conflicts are surfaced as locked
 * entries (same UX as level-locked items). When omitted, the function
 * falls back to the pre-2026-05-04 behaviour of ignoring the 2H rule.
 */
export function buildSlotPickerEntries(
  slot: keyof EquipmentSlots,
  serverInventory: readonly Item[],
  onChainItems: readonly Item[],
  equippedPendingIds: ReadonlySet<string>,
  effectiveLevel: number,
  pendingEquipment?: EquipmentSlots,
): PickerEntry[] {
  const byId = new Map<string, Item>();
  for (const item of serverInventory) byId.set(item.id, item);
  // On-chain items overwrite server entries for the same id — chain is
  // the authority for `levelReq` (the Move struct field, set at mint).
  for (const item of onChainItems) byId.set(item.id, item);

  const compatibleTypes = SLOT_TO_ITEM_TYPE[slot];
  const entries: PickerEntry[] = [];

  for (const item of byId.values()) {
    if (item.inKiosk) continue;
    if (equippedPendingIds.has(item.id)) continue;
    if (!compatibleTypes.includes(item.itemType)) continue;

    // Level lock takes precedence — the chain would `ELevelTooLow` an
    // equip before any 2H consideration, and the player's mental model
    // is "I need to level up first" rather than "I need to swap gear".
    const levelLocked = item.levelReq > effectiveLevel;
    if (levelLocked) {
      entries.push({
        item,
        locked: true,
        lockedReason: `Requires Level ${item.levelReq}`,
      });
      continue;
    }

    // Two-handed conflict — only consulted when pendingEquipment is
    // supplied. Same locked + reason UX as level-locked items so the
    // player sees what they'd need to do to make the item equippable.
    if (pendingEquipment) {
      const twoHanded = evaluateTwoHandedConflict({
        slot,
        candidate: item,
        pending: pendingEquipment,
      });
      if (twoHanded.conflict) {
        entries.push({ item, locked: true, lockedReason: twoHanded.reason });
        continue;
      }
    }

    entries.push({ item, locked: false });
  }

  entries.sort(comparePickerEntries);
  return entries;
}

function comparePickerEntries(a: PickerEntry, b: PickerEntry): number {
  if (a.locked !== b.locked) return a.locked ? 1 : -1;
  if (a.locked && b.locked && a.item.levelReq !== b.item.levelReq) {
    return a.item.levelReq - b.item.levelReq;
  }
  return a.item.name.localeCompare(b.item.name);
}
