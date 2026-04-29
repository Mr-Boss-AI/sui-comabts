"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useEquipmentActions } from "@/hooks/useEquipmentActions";
import { useKiosk } from "@/hooks/useKiosk";
import { useMarketplaceActions } from "@/hooks/useMarketplaceActions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ItemCard } from "./item-card";
import { ItemDetailModal } from "./item-detail-modal";
import { ListItemModal } from "@/components/marketplace/list-item-modal";
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
  const { state, dispatch } = useGame();
  const { inventory, onChainItems, pendingEquipment, committedEquipment, character } = state;
  const { stageEquip } = useEquipmentActions();
  const kiosk = useKiosk(state.onChainRefreshTrigger);
  const { retrieveFromKiosk, signing: marketSigning } = useMarketplaceActions();
  const [category, setCategory] = useState<Category>("all");
  const [filterRarity, setFilterRarity] = useState<Rarity | "all">("all");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [listingItem, setListingItem] = useState<Item | null>(null);

  if (!character) return null;

  // Hide from the list any item currently slotted in pending (visible on the
  // doll) OR currently a DOF in committed (chain says it's equipped — passing
  // it as a tx input would fail with "object owned by object"). Union covers
  // the moment between "user stages unequip" and "save commits on chain":
  // pending says free, committed says DOF — until Save lands, the item is
  // genuinely not passable as a fresh input.
  const equippedIds = new Set<string>();
  for (const item of Object.values(pendingEquipment)) if (item) equippedIds.add(item.id);
  for (const item of Object.values(committedEquipment)) if (item?.id) equippedIds.add(item.id);
  const serverIds = new Set(inventory.map((i) => i.id));
  // `inKiosk` and `kioskListed` are stamped chain-side by `fetchKioskItems`
  // (lib/sui-contracts.ts). No consumer-side enrichment needed.
  const allItems = [
    ...inventory.filter((i) => !equippedIds.has(i.id)),
    ...onChainItems.filter((i) => !serverIds.has(i.id) && !equippedIds.has(i.id)),
  ];

  // "Replaces: X" blurb in the slot picker uses the pending view, since that's
  // what the user will see on the doll after the click (and what the save PTB
  // will diff against committed).
  const eq: EquipmentSlots = pendingEquipment;

  const filtered = allItems.filter((item) => {
    const typeList = CATEGORY_TYPES[category];
    if (typeList && !typeList.includes(item.itemType)) return false;
    if (filterRarity !== "all" && item.rarity !== filterRarity) return false;
    return true;
  });

  function handleEquip(item: Item, slot: keyof EquipmentSlots) {
    const currentItem = eq[slot] || null;
    stageEquip(item, slot, currentItem);
    setSelectedItem(null);
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

      {/* Item detail modal with equip / list / retrieve actions */}
      {selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          actions={
            <div className="space-y-3">
              {/* Stuck-in-kiosk migration: the item is a DOF of a Kiosk but
                  not listed for sale (probably a leftover from a vanilla
                  delist that didn't take). Surface a single Retrieve button
                  — equip / list both require ownership in the wallet. */}
              {selectedItem.inKiosk && !selectedItem.kioskListed && kiosk.kioskId && kiosk.capId && (
                <div className="rounded-lg border border-zinc-700/40 bg-zinc-900/40 p-3 space-y-2">
                  <p className="text-xs text-zinc-400">
                    This item is sitting unlisted inside your Kiosk. Pull it
                    back to your wallet to equip or relist.
                  </p>
                  <button
                    onClick={async () => {
                      const result = await retrieveFromKiosk(
                        selectedItem.id,
                        kiosk.kioskId!,
                        kiosk.capId!,
                      );
                      if (result.ok) {
                        dispatch({
                          type: "SET_ERROR",
                          message: `${selectedItem.name} is back in your wallet.`,
                        });
                        setSelectedItem(null);
                        kiosk.refresh();
                      } else {
                        dispatch({
                          type: "SET_ERROR",
                          message: result.error || "Retrieve failed",
                        });
                      }
                    }}
                    disabled={marketSigning}
                    className="w-full px-4 py-2.5 text-sm font-bold rounded bg-zinc-700/50 text-zinc-100 border border-zinc-600/60 hover:bg-zinc-700/70 hover:border-zinc-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {marketSigning ? "Signing…" : "Retrieve to Wallet"}
                  </button>
                </div>
              )}

              {/* Listed-for-sale items can't be equipped or relisted. Direct
                  the user to the Kiosk panel to delist (which now atomically
                  takes back). */}
              {selectedItem.inKiosk && selectedItem.kioskListed && (
                <p className="text-xs text-amber-300/80 text-center">
                  Currently listed for sale. Use Delist in My Kiosk to take it back.
                </p>
              )}

              {/* Equip slot choices — only when the item is not in a kiosk. */}
              {!selectedItem.inKiosk && (selectedSlots.length > 0 ? (
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
              ))}

              {/* List-on-marketplace affordance — only for on-chain NFTs the
                  user actually owns (0x... id) and that aren't already inside
                  a Kiosk. NPC items have no chain rep and can't be listed. */}
              {selectedItem.id.startsWith("0x") &&
                selectedItem.id.length >= 42 &&
                !selectedItem.inKiosk && (
                  <div className="border-t border-zinc-800 pt-3">
                    {kiosk.kioskId && kiosk.capId ? (
                      <button
                        onClick={() => {
                          setListingItem(selectedItem);
                          setSelectedItem(null);
                        }}
                        className="w-full px-4 py-2.5 text-sm font-bold rounded bg-amber-600/20 text-amber-300 border border-amber-700/40 hover:bg-amber-600/30 hover:border-amber-600/60 transition-all"
                      >
                        List on Marketplace
                      </button>
                    ) : kiosk.loaded ? (
                      <p className="text-xs text-zinc-600 text-center">
                        Open the Marketplace tab to create a Kiosk before listing.
                      </p>
                    ) : null}
                  </div>
                )}
            </div>
          }
        />
      )}

      {/* List-item modal — opens when user clicks "List on Marketplace" above */}
      {listingItem && kiosk.kioskId && kiosk.capId && (
        <ListItemModal
          item={listingItem}
          kioskId={kiosk.kioskId}
          capId={kiosk.capId}
          onClose={() => setListingItem(null)}
          onListed={() => kiosk.refresh()}
        />
      )}
    </>
  );
}
