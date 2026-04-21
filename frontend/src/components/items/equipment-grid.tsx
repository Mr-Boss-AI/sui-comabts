"use client";

import { useMemo, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useEquipmentActions } from "@/hooks/useEquipmentActions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ItemCard } from "./item-card";
import { ItemDetailModal } from "./item-detail-modal";
import { Modal } from "@/components/ui/modal";
import {
  EQUIPMENT_SLOT_LABELS,
  SLOT_TO_ITEM_TYPE,
  RARITY_COLORS,
  type EquipmentSlots,
  type Item,
} from "@/types/game";

const SLOT_ORDER: (keyof EquipmentSlots)[] = [
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
];

const SLOT_ICONS: Record<keyof EquipmentSlots, string> = {
  weapon: "\u2694",
  offhand: "\uD83D\uDEE1",
  helmet: "\u26D1",
  chest: "\uD83C\uDFBD",
  gloves: "\uD83E\uDDE4",
  boots: "\uD83D\uDC62",
  belt: "\u26D3",
  ring1: "\uD83D\uDC8D",
  ring2: "\uD83D\uDC8D",
  necklace: "\uD83D\uDCBF",
};

export function EquipmentGrid() {
  const { state } = useGame();
  const { character, inventory, onChainItems, pendingEquipment } = state;
  const { stageEquip, stageUnequip } = useEquipmentActions();
  const [selectedSlot, setSelectedSlot] = useState<keyof EquipmentSlots | null>(null);

  if (!character) return null;

  // Source of truth for what the player WANTS equipped (may not yet be on
  // chain). The Save Loadout button in character-profile commits pending
  // to chain via buildSaveLoadoutTx; the reducer then rebases committed.
  // Display-wise we always render pending so staged changes are visible.
  const eq: EquipmentSlots = pendingEquipment;

  // Items already assigned to a slot in pending — hidden from the picker so
  // the same item can't be staged into two slots at once. Items in committed
  // but not pending (i.e. staged-unequipped) ARE available here because the
  // save PTB will unequip them before the next equip, returning them to
  // the wallet within the same atomic tx.
  const equippedPendingIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of Object.values(pendingEquipment)) {
      if (item) set.add(item.id);
    }
    return set;
  }, [pendingEquipment]);

  const selectedItem = selectedSlot ? eq[selectedSlot] : null;

  // Effective equip level = min(server.level, onChain.level) to avoid offering
  // items that would fail the on-chain ELevelTooLow check.
  const effectiveLevel = Math.min(
    character.level,
    state.onChainCharacter?.level ?? character.level,
  );

  const equippable = useMemo(() => {
    if (!selectedSlot) return [];
    // Merge server + on-chain items, dedup by ID (prefer on-chain version)
    const byId = new Map<string, Item>();
    for (const item of inventory) byId.set(item.id, item);
    for (const item of onChainItems) byId.set(item.id, item);
    return Array.from(byId.values()).filter((item) =>
      !equippedPendingIds.has(item.id) &&
      SLOT_TO_ITEM_TYPE[selectedSlot].includes(item.itemType) &&
      item.levelReq <= effectiveLevel
    );
  }, [selectedSlot, inventory, onChainItems, equippedPendingIds, effectiveLevel]);

  function handleEquip(item: Item) {
    if (!selectedSlot) return;
    const currentItem = eq[selectedSlot] || null;
    stageEquip(item, selectedSlot, currentItem);
    setSelectedSlot(null);
  }

  function handleUnequip(slot: keyof EquipmentSlots) {
    stageUnequip(slot);
    setSelectedSlot(null);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <span className="font-semibold">Equipment</span>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-2">
            {SLOT_ORDER.map((slot) => {
              const item = eq[slot];
              return (
                <div
                  key={slot}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedSlot(slot)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedSlot(slot)}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 text-left hover:border-zinc-700 transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{SLOT_ICONS[slot]}</span>
                    <span className="text-xs text-zinc-500">
                      {EQUIPMENT_SLOT_LABELS[slot]}
                    </span>
                  </div>
                  {item ? (
                    <div
                      className={`text-sm font-medium truncate ${RARITY_COLORS[item.rarity]}`}
                    >
                      {item.name}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-600">Empty</div>
                  )}
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Equipped slot clicked — show item details + Unequip */}
      {selectedSlot && selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          onClose={() => setSelectedSlot(null)}
          actions={
            <button
              onClick={() => handleUnequip(selectedSlot)}
              className="w-full px-4 py-2 text-sm font-bold rounded bg-red-600/20 text-red-400 border border-red-700/40 hover:bg-red-600/30 hover:border-red-600/60 transition-all"
            >
              Unequip
            </button>
          }
        />
      )}

      {/* Empty slot clicked — show compatible items from inventory */}
      {selectedSlot && !selectedItem && (
        <Modal
          open
          onClose={() => setSelectedSlot(null)}
          title={`${EQUIPMENT_SLOT_LABELS[selectedSlot]} — Choose Item`}
          wide
        >
          {equippable.length === 0 ? (
            <p className="text-zinc-400 text-sm text-center py-4">
              No compatible items in inventory
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {equippable.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onClick={() => handleEquip(item)}
                />
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
