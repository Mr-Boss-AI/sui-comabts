"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useEquipmentActions } from "@/hooks/useEquipmentActions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ItemCard } from "./item-card";
import { ItemDetailModal } from "./item-detail-modal";
import {
  ITEM_TYPES,
  RARITY_LABELS,
  SLOT_TO_ITEM_TYPE,
  EQUIPMENT_SLOT_LABELS,
  type ItemType,
  type Rarity,
  type Item,
  type EquipmentSlots,
} from "@/types/game";

type Category = "all" | "weapons" | "armor" | "jewelry";

const CATEGORY_TYPES: Record<Category, ItemType[] | null> = {
  all: null,
  weapons: [ITEM_TYPES.WEAPON, ITEM_TYPES.SHIELD],
  armor: [ITEM_TYPES.HELMET, ITEM_TYPES.CHEST, ITEM_TYPES.GLOVES, ITEM_TYPES.BOOTS, ITEM_TYPES.BELT],
  jewelry: [ITEM_TYPES.RING, ITEM_TYPES.NECKLACE],
};

const TABS: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "weapons", label: "Weapons" },
  { id: "armor", label: "Armor" },
  { id: "jewelry", label: "Jewelry" },
];

// Item type -> compatible equipment slots
function getSlotsForItem(item: Item): (keyof EquipmentSlots)[] {
  const slots: (keyof EquipmentSlots)[] = [];
  for (const [slot, types] of Object.entries(SLOT_TO_ITEM_TYPE)) {
    if (types.includes(item.itemType)) {
      slots.push(slot as keyof EquipmentSlots);
    }
  }
  return slots;
}

const ITEM_HEIGHT = 80;
const OVERSCAN = 4;

function VirtualList({ items, renderItem, maxHeight }: {
  items: Item[];
  renderItem: (item: Item, index: number) => React.ReactNode;
  maxHeight: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  const totalHeight = items.length * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(maxHeight / ITEM_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);

  // For small lists, skip virtualization
  if (items.length <= 20) {
    return (
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto scrollbar-thin" ref={containerRef}>
        {items.map((item, i) => (
          <div key={item.id}>{renderItem(item, i)}</div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="overflow-y-auto scrollbar-thin"
      style={{ maxHeight, position: "relative" }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {items.slice(startIndex, endIndex).map((item, i) => (
          <div
            key={item.id}
            style={{
              position: "absolute",
              top: (startIndex + i) * ITEM_HEIGHT,
              left: 0,
              right: 0,
              height: ITEM_HEIGHT,
              padding: "3px 0",
            }}
          >
            {renderItem(item, startIndex + i)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Inventory() {
  const { state } = useGame();
  const { inventory, onChainItems, onChainEquipped, character } = state;
  const { equip } = useEquipmentActions();
  const [category, setCategory] = useState<Category>("all");
  const [filterRarity, setFilterRarity] = useState<Rarity | "all">("all");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

  if (!character) return null;

  // Items already equipped on-chain — excluded from the merged list so a just-
  // equipped item can't reappear here due to fullnode propagation lag or stale
  // optimistic state. Sources both: session cache (set when user equips in
  // this session) AND character.equipment (server-hydrated DOF state that
  // survives reloads). Defense-in-depth against "object owned by object" PTB
  // errors and against legacy NPC-item ids colliding with chain-equipped ids.
  const equippedIds = new Set<string>();
  for (const item of Object.values(onChainEquipped)) if (item) equippedIds.add(item.id);
  for (const item of Object.values(character.equipment)) if (item?.id) equippedIds.add(item.id);
  const serverIds = new Set(inventory.map((i) => i.id));
  const allItems = [
    ...inventory.filter((i) => !equippedIds.has(i.id)),
    ...onChainItems.filter((i) => !serverIds.has(i.id) && !equippedIds.has(i.id)),
  ];

  // Merge equipment for "Replaces" display
  const eq: EquipmentSlots = useMemo(() => {
    const merged = { ...character.equipment };
    for (const [slot, item] of Object.entries(onChainEquipped)) {
      if (item) merged[slot as keyof EquipmentSlots] = item;
    }
    return merged;
  }, [character.equipment, onChainEquipped]);

  const filtered = allItems.filter((item) => {
    const typeList = CATEGORY_TYPES[category];
    if (typeList && !typeList.includes(item.itemType)) return false;
    if (filterRarity !== "all" && item.rarity !== filterRarity) return false;
    return true;
  });

  async function handleEquip(item: Item, slot: keyof EquipmentSlots) {
    const currentItem = eq[slot] || null;
    const ok = await equip(item, slot, currentItem);
    if (ok) setSelectedItem(null);
  }

  // Effective equip level = min(server.level, onChain.level).
  // See character-profile.tsx for the rationale (pre-revert test-XP drift).
  const effectiveLevel = Math.min(
    character.level,
    state.onChainCharacter?.level ?? character.level,
  );

  const selectedSlots = selectedItem
    ? getSlotsForItem(selectedItem).filter(() => selectedItem.levelReq <= effectiveLevel)
    : [];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200">
              Inventory ({allItems.length})
            </span>
            <select
              value={filterRarity}
              onChange={(e) =>
                setFilterRarity(e.target.value === "all" ? "all" : (Number(e.target.value) as Rarity))
              }
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300"
            >
              <option value="all">All Rarities</option>
              {Object.entries(RARITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          {/* Category tabs */}
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCategory(tab.id)}
                className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${
                  category === tab.id
                    ? "bg-zinc-700 text-zinc-100 border border-zinc-600"
                    : "bg-zinc-900/60 text-zinc-500 hover:text-zinc-300 border border-zinc-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-4">
              No items found
            </p>
          ) : (
            <VirtualList
              items={filtered}
              maxHeight={500}
              renderItem={(item) => (
                <ItemCard
                  item={item}
                  compact
                  onClick={() => setSelectedItem(item)}
                />
              )}
            />
          )}
        </CardBody>
      </Card>

      {/* Item detail modal with equip slot choices */}
      {selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          actions={
            selectedSlots.length > 0 ? (
              <div className="space-y-2">
                <span className="text-xs text-zinc-500">Equip to:</span>
                {selectedSlots.map((slot) => {
                  const current = eq[slot];
                  return (
                    <button
                      key={slot}
                      onClick={() => handleEquip(selectedItem, slot)}
                      className="w-full text-left rounded-lg border border-emerald-700/40 bg-emerald-600/10 p-3 hover:bg-emerald-600/20 hover:border-emerald-600/60 transition-all"
                    >
                      <div className="font-semibold text-sm text-emerald-400">
                        {EQUIPMENT_SLOT_LABELS[slot]}
                      </div>
                      {current && (
                        <div className="text-xs text-zinc-500 mt-0.5">
                          Replaces: {current.name}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-zinc-600 text-center">
                Requires Level {selectedItem.levelReq}
              </p>
            )
          }
        />
      )}
    </>
  );
}
