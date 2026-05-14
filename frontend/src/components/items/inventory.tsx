"use client";

import { useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useEquipmentActions } from "@/hooks/useEquipmentActions";
import { useKiosk } from "@/hooks/useKiosk";
import { useMarketplaceActions } from "@/hooks/useMarketplaceActions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
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

/**
 * Spec: design_v2/specs/character_v2_measurements.md  §Section 5 (60-67)
 * 84.14×84.14 square slot, 1 px solid rarity border, image objectFit contain,
 * label below in Poppins 8/700 uppercase bronze.
 *
 * Epic rarity uses --sc-grape (#8a6abf) per spec global tokens. Other rarity
 * tokens are inherited from --rarity-{common,uncommon,rare,legendary}.
 */
const INV_TILE_BORDER: Record<number, string> = {
  1: "var(--rarity-common)",
  2: "var(--rarity-uncommon)",
  3: "var(--rarity-rare)",
  4: "var(--sc-grape)",
  5: "var(--rarity-legendary)",
};

const INV_TILE_TYPE_LABEL: Record<number, string> = {
  [ITEM_TYPES.WEAPON]: "WEAPON",
  [ITEM_TYPES.SHIELD]: "OFFHAND",
  [ITEM_TYPES.HELMET]: "HELMET",
  [ITEM_TYPES.CHEST]: "CHEST",
  [ITEM_TYPES.GLOVES]: "GLOVES",
  [ITEM_TYPES.BOOTS]: "BOOTS",
  [ITEM_TYPES.BELT]: "BELT",
  [ITEM_TYPES.RING]: "RING",
  [ITEM_TYPES.NECKLACE]: "NECKLACE",
};

function InventoryTileGrid({
  items,
  onSelect,
}: {
  items: Item[];
  onSelect: (item: Item) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 8,
      }}
    >
      {items.map((item) => {
        const borderColor = INV_TILE_BORDER[item.rarity] ?? "var(--sc-rim-2)";
        const label = INV_TILE_TYPE_LABEL[item.itemType] ?? "ITEM";
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            title={item.name}
            style={{
              padding: 0,
              cursor: "pointer",
              background: "var(--sc-panel-2)",
              border: `1px solid ${borderColor}`,
              borderRadius: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              fontFamily: "var(--font-ui)",
              transition: "transform var(--d-fast)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "";
            }}
          >
            <div
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
                position: "relative",
                overflow: "hidden",
                background: "var(--sc-page)",
              }}
            >
              {item.imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : (
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    color: borderColor,
                    opacity: 0.7,
                  }}
                >
                  ◆
                </span>
              )}
            </div>
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: "var(--sc-bronze)",
                textAlign: "center",
                padding: "4px 0 5px",
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

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
        <CardHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* Spec §[59] — Poppins 36/400 parchment, tracking -0.36px. */}
                <span
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 36,
                    fontWeight: 400,
                    lineHeight: 1.15,
                    color: "var(--sc-parchment)",
                    letterSpacing: "-0.36px",
                  }}
                >
                  Inventory
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 26,
                    height: 22,
                    padding: "0 8px",
                    background: "var(--sc-page)",
                    color: "var(--sc-bronze)",
                    border: "1.5px solid var(--sc-bronze)",
                    borderRadius: "var(--r-pill)",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 800,
                    fontSize: 12,
                  }}
                >
                  {allItems.length}
                </span>
              </div>
              <select
                value={filterRarity}
                onChange={(e) =>
                  setFilterRarity(e.target.value === "all" ? "all" : (Number(e.target.value) as Rarity))
                }
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  padding: "4px 8px",
                  background: "var(--sc-panel-2)",
                  color: "var(--sc-parchment)",
                  border: "1px solid var(--sc-rim-2)",
                  borderRadius: "var(--r-sm)",
                  cursor: "pointer",
                }}
              >
                <option value="all">All Rarities</option>
                {Object.entries(RARITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {TABS.map((tab) => {
                const active = category === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setCategory(tab.id)}
                    style={{
                      padding: "4px 10px",
                      fontFamily: "var(--font-ui)",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: ".04em",
                      border: `1px solid ${active ? "var(--sc-bronze)" : "var(--sc-rim-2)"}`,
                      background: active ? "rgba(200,154,63,0.20)" : "var(--sc-panel-2)",
                      color: active ? "var(--sc-bronze)" : "var(--fg-2)",
                      borderRadius: "var(--r-card)",
                      cursor: "pointer",
                      transition: "all var(--d-fast)",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-4">
              No items found
            </p>
          ) : (
            <InventoryTileGrid
              items={filtered}
              onSelect={setSelectedItem}
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
              {selectedItem.inKiosk && !selectedItem.kioskListed && kiosk.kioskId && kiosk.capId && (
                <div
                  style={{
                    padding: 12,
                    background: "var(--sc-panel-2)",
                    border: "1px solid var(--sc-rim)",
                    borderLeft: "3px solid var(--sc-steel)",
                    borderRadius: "var(--r-card)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 11, color: "var(--fg-2)", lineHeight: 1.45 }}>
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
                    style={{
                      width: "100%",
                      padding: "8px 14px",
                      fontFamily: "var(--font-ui)",
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: "var(--ls-button)",
                      textTransform: "uppercase",
                      background: "var(--sc-steel-low)",
                      color: "var(--sc-steel)",
                      border: "2px solid var(--sc-steel-deep)",
                      borderRadius: "var(--r-button)",
                      cursor: marketSigning ? "not-allowed" : "pointer",
                      boxShadow: marketSigning ? "none" : "var(--sh-plate-sm)",
                      opacity: marketSigning ? 0.6 : 1,
                    }}
                  >
                    {marketSigning ? "Signing…" : "Retrieve to Wallet"}
                  </button>
                </div>
              )}

              {selectedItem.inKiosk && selectedItem.kioskListed && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    color: "var(--sc-bronze)",
                    textAlign: "center",
                    fontStyle: "italic",
                  }}
                >
                  Currently listed for sale. Use Delist in My Kiosk to take it back.
                </p>
              )}

              {!selectedItem.inKiosk && (selectedSlots.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: "var(--ls-stamp)",
                      textTransform: "uppercase",
                      color: "var(--sc-bronze)",
                    }}
                  >
                    Equip to
                  </span>
                  {selectedSlots.map((slot) => {
                    const current = eq[slot];
                    return (
                      <button
                        key={slot}
                        onClick={() => handleEquip(selectedItem, slot)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: 12,
                          background: "var(--sc-panel-2)",
                          border: "1px solid var(--sc-rim)",
                          borderLeft: "3px solid var(--rarity-uncommon)",
                          borderRadius: "var(--r-card)",
                          cursor: "pointer",
                          transition: "all var(--d-fast)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--sc-panel-3)";
                          e.currentTarget.style.borderLeftColor = "var(--rarity-uncommon)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "var(--sc-panel-2)";
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 13,
                            color: "var(--rarity-uncommon)",
                          }}
                        >
                          {EQUIPMENT_SLOT_LABELS[slot]}
                        </div>
                        {current && (
                          <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>
                            Replaces: {current.name}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontSize: 11, color: "var(--fg-3)", textAlign: "center", margin: 0 }}>
                  Requires Level {selectedItem.levelReq}
                </p>
              ))}

              {selectedItem.id.startsWith("0x") &&
                selectedItem.id.length >= 42 &&
                !selectedItem.inKiosk && (
                  <div style={{ borderTop: "1px solid var(--sc-rim)", paddingTop: 12 }}>
                    {kiosk.kioskId && kiosk.capId ? (
                      <button
                        onClick={() => {
                          setListingItem(selectedItem);
                          setSelectedItem(null);
                        }}
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          fontFamily: "var(--font-ui)",
                          fontWeight: 700,
                          fontSize: 12,
                          letterSpacing: "var(--ls-button)",
                          textTransform: "uppercase",
                          background: "var(--sc-bronze)",
                          color: "var(--sc-page)",
                          border: "2px solid var(--sc-bronze-deep)",
                          borderRadius: "var(--r-button)",
                          cursor: "pointer",
                          boxShadow: "var(--sh-plate-sm)",
                        }}
                      >
                        List on Marketplace
                      </button>
                    ) : kiosk.loaded ? (
                      <p style={{ fontSize: 11, color: "var(--fg-3)", textAlign: "center", margin: 0 }}>
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
