"use client";

import { useMemo, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
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
  const { state, dispatch } = useGame();
  const { character, inventory, onChainItems, onChainEquipped } = state;
  const [selectedSlot, setSelectedSlot] = useState<keyof EquipmentSlots | null>(null);

  if (!character) return null;

  // Merge server equipment with on-chain equipped items
  const eq: EquipmentSlots = useMemo(() => {
    const merged = { ...character.equipment };
    for (const [slot, item] of Object.entries(onChainEquipped)) {
      if (item) merged[slot as keyof EquipmentSlots] = item;
    }
    return merged;
  }, [character.equipment, onChainEquipped]);

  const onChainIds = new Set(onChainItems.map((i) => i.id));
  const selectedItem = selectedSlot ? eq[selectedSlot] : null;

  const equippable = useMemo(() => {
    if (!selectedSlot) return [];
    // Merge server + on-chain items, dedup by ID (prefer on-chain version)
    const byId = new Map<string, Item>();
    for (const item of inventory) byId.set(item.id, item);
    for (const item of onChainItems) byId.set(item.id, item);
    return Array.from(byId.values()).filter((item) =>
      SLOT_TO_ITEM_TYPE[selectedSlot].includes(item.itemType) &&
      item.levelReq <= character.level
    );
  }, [selectedSlot, inventory, onChainItems, character.level]);

  function handleEquip(item: Item) {
    if (!selectedSlot) return;
    if (onChainIds.has(item.id)) {
      dispatch({ type: "EQUIP_ONCHAIN_ITEM", item, slot: selectedSlot });
    } else {
      state.socket.send({ type: "equip_item", itemId: item.id, slot: selectedSlot });
    }
    setSelectedSlot(null);
  }

  function handleUnequip(slot: keyof EquipmentSlots) {
    if (onChainEquipped[slot]) {
      dispatch({ type: "UNEQUIP_ONCHAIN_ITEM", slot });
    } else {
      state.socket.send({ type: "unequip_item", slot });
    }
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
