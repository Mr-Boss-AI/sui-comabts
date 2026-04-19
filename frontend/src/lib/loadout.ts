import type { EquipmentSlots, Item } from "@/types/game";

// Canonical slot order. Also used by the PTB builder to produce a stable
// moveCall sequence in save transactions (Step 4 will import this).
export const EQUIPMENT_SLOT_KEYS: readonly (keyof EquipmentSlots)[] = [
  "weapon",
  "offhand",
  "helmet",
  "chest",
  "gloves",
  "boots",
  "belt",
  "ring1",
  "ring2",
  "necklace",
] as const;

// Empty loadout sentinel — every slot null. Used for initial state and for
// re-initialization when a character hasn't been hydrated yet.
export const EMPTY_EQUIPMENT: EquipmentSlots = {
  weapon: null,
  offhand: null,
  helmet: null,
  chest: null,
  gloves: null,
  boots: null,
  belt: null,
  ring1: null,
  ring2: null,
  necklace: null,
};

/** Shallow clone of an EquipmentSlots map. Items are shared references;
 * that's fine because Item objects are treated as immutable throughout the
 * codebase — mutation always happens via "replace slot" not "mutate item". */
export function cloneEquipment(eq: EquipmentSlots): EquipmentSlots {
  return {
    weapon: eq.weapon ?? null,
    offhand: eq.offhand ?? null,
    helmet: eq.helmet ?? null,
    chest: eq.chest ?? null,
    gloves: eq.gloves ?? null,
    boots: eq.boots ?? null,
    belt: eq.belt ?? null,
    ring1: eq.ring1 ?? null,
    ring2: eq.ring2 ?? null,
    necklace: eq.necklace ?? null,
  };
}

/** Slots where pending differs from committed. Compared by item id;
 * null ≡ "slot empty". Two items with the same id are treated as
 * equal even if other fields happen to differ. */
export function computeDirtySlots(
  committed: EquipmentSlots,
  pending: EquipmentSlots,
): Set<keyof EquipmentSlots> {
  const dirty = new Set<keyof EquipmentSlots>();
  for (const slot of EQUIPMENT_SLOT_KEYS) {
    const c = committed[slot]?.id ?? null;
    const p = pending[slot]?.id ?? null;
    if (c !== p) dirty.add(slot);
  }
  return dirty;
}

/** True iff any slot is dirty. Use this for buttons ("Save", "Discard"
 * visibility) and for suppressing combat-resolution reads of pending. */
export function isLoadoutDirty(
  committed: EquipmentSlots,
  pending: EquipmentSlots,
): boolean {
  return computeDirtySlots(committed, pending).size > 0;
}

/** True iff the slot's item comes from an on-chain NFT (0x… id, ≥42 chars).
 * The PTB builder uses this to know whether to emit a chain equip/unequip
 * call vs skip (server-only NPC items never enter the loadout PTB — they
 * stay on the legacy WS equip path).
 *
 * Exported so UI surfaces can render a "saved on chain" badge without
 * re-deriving the rule per component. */
export function isOnChainItem(item: Item | null | undefined): boolean {
  return !!item && typeof item.id === "string" && item.id.startsWith("0x") && item.id.length >= 42;
}
