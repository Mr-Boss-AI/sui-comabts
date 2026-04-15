"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ItemCard } from "./item-card";
import { Modal } from "@/components/ui/modal";
import type { Item } from "@/types/game";
import { RARITY_COLORS, ITEM_TYPE_LABELS, ITEM_TYPES } from "@/types/game";

const ITEM_TYPE_ICONS: Record<number, string> = {
  [ITEM_TYPES.WEAPON]: "\u2694\uFE0F",
  [ITEM_TYPES.SHIELD]: "\ud83d\udee1\uFE0F",
  [ITEM_TYPES.HELMET]: "\u26d1\uFE0F",
  [ITEM_TYPES.CHEST]: "\ud83c\udfbd",
  [ITEM_TYPES.GLOVES]: "\ud83e\udde4",
  [ITEM_TYPES.BOOTS]: "\ud83d\udc62",
  [ITEM_TYPES.BELT]: "\u26d3\uFE0F",
  [ITEM_TYPES.RING]: "\ud83d\udc8d",
  [ITEM_TYPES.NECKLACE]: "\ud83d\udcbf",
};

export function NpcShop() {
  const { state } = useGame();
  const { shopItems, character } = state;
  const [selectedItem, setSelectedItem] = useState<(Item & { price: number }) | null>(null);

  useEffect(() => {
    if (state.socket.authenticated) {
      state.socket.send({ type: "get_shop" });
    }
  }, [state.socket, state.socket.authenticated]);

  function handleBuy() {
    if (!selectedItem) return;
    state.socket.send({ type: "buy_shop_item", itemId: selectedItem.id });
    setSelectedItem(null);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <span className="font-semibold">NPC Shop</span>
        </CardHeader>
        <CardBody>
          {shopItems.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-8">
              Loading shop...
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[500px] overflow-y-auto">
              {shopItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  showPrice
                  onClick={() => setSelectedItem(item)}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {selectedItem && (
        <Modal open onClose={() => setSelectedItem(null)} title="Buy Item">
          <div className="space-y-4">
            <div className="bg-black/30 border border-zinc-800/30 rounded p-4">
              <div className={`text-lg font-bold ${RARITY_COLORS[selectedItem.rarity]} flex items-center gap-2`}>
                <span>{ITEM_TYPE_ICONS[selectedItem.itemType] || ""}</span>
                {selectedItem.name}
              </div>
              <div className="text-sm text-zinc-400">
                {ITEM_TYPE_LABELS[selectedItem.itemType]}
              </div>
              {selectedItem.minDamage > 0 && (
                <div className="text-sm text-orange-400 mt-1">
                  Damage: {selectedItem.minDamage}-{selectedItem.maxDamage}
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(selectedItem.statBonuses)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => (
                    <span key={k} className="text-xs text-emerald-400">
                      +{v} {k.replace("Bonus", "")}
                    </span>
                  ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Price</span>
              <span className="text-amber-400 font-bold text-lg">
                {selectedItem.price} SUI
              </span>
            </div>
            {character && selectedItem.levelReq > character.level && (
              <p className="text-red-400 text-sm">
                Requires Level {selectedItem.levelReq} (you are Level{" "}
                {character.level})
              </p>
            )}
            <Button onClick={handleBuy} className="w-full">
              Buy Item
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
