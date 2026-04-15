"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import type { Item } from "@/types/game";
import {
  RARITY_COLORS,
  RARITY_LABELS,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
} from "@/types/game";

const STAT_DISPLAY: { key: keyof Item["statBonuses"]; label: string; color: string }[] = [
  { key: "strengthBonus", label: "Strength", color: "text-red-400" },
  { key: "dexterityBonus", label: "Dexterity", color: "text-cyan-400" },
  { key: "intuitionBonus", label: "Intuition", color: "text-purple-400" },
  { key: "enduranceBonus", label: "Endurance", color: "text-amber-400" },
  { key: "hpBonus", label: "HP", color: "text-red-300" },
  { key: "armorBonus", label: "Armor", color: "text-zinc-300" },
  { key: "defenseBonus", label: "Defense", color: "text-amber-300" },
  { key: "attackBonus", label: "Attack", color: "text-orange-400" },
  { key: "critChanceBonus", label: "Crit Chance", color: "text-purple-300" },
  { key: "critMultiplierBonus", label: "Crit Multiplier", color: "text-purple-300" },
  { key: "evasionBonus", label: "Evasion", color: "text-cyan-300" },
  { key: "antiCritBonus", label: "Anti-Crit", color: "text-zinc-400" },
  { key: "antiEvasionBonus", label: "Anti-Evasion", color: "text-zinc-400" },
];

const ITEM_TYPE_ICONS: Record<number, string> = {
  [ITEM_TYPES.WEAPON]: "\u2694\uFE0F",
  [ITEM_TYPES.SHIELD]: "\uD83D\uDEE1\uFE0F",
  [ITEM_TYPES.HELMET]: "\u26D1\uFE0F",
  [ITEM_TYPES.CHEST]: "\uD83C\uDFBD",
  [ITEM_TYPES.GLOVES]: "\uD83E\uDDE4",
  [ITEM_TYPES.BOOTS]: "\uD83D\uDC62",
  [ITEM_TYPES.BELT]: "\u26D3\uFE0F",
  [ITEM_TYPES.RING]: "\uD83D\uDC8D",
  [ITEM_TYPES.NECKLACE]: "\uD83D\uDCBF",
};

interface ItemDetailModalProps {
  item: Item;
  onClose: () => void;
  actions?: ReactNode;
}

export function ItemDetailModal({ item, onClose, actions }: ItemDetailModalProps) {
  const nonZeroStats = STAT_DISPLAY.filter((s) => item.statBonuses[s.key] > 0);

  return (
    <Modal open onClose={onClose} title={item.name}>
      <div className="space-y-4">
        {/* Header: image + basic info */}
        <div className="flex items-start gap-4">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="w-16 h-16 rounded-lg object-cover shrink-0 border border-zinc-700"
            />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-zinc-900 border border-zinc-700 flex items-center justify-center text-2xl shrink-0">
              {ITEM_TYPE_ICONS[item.itemType] || "?"}
            </div>
          )}
          <div>
            <div className={`text-lg font-bold ${RARITY_COLORS[item.rarity]}`}>
              {item.name}
            </div>
            <div className="text-sm text-zinc-500 mt-0.5">
              {ITEM_TYPE_LABELS[item.itemType]} &middot; {RARITY_LABELS[item.rarity]}
            </div>
            {item.levelReq > 1 && (
              <div className="text-xs text-zinc-600 mt-1">
                Requires Level {item.levelReq}
              </div>
            )}
          </div>
        </div>

        {/* Damage */}
        {item.minDamage > 0 && (
          <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2">
            <span className="text-xs text-zinc-500">Damage</span>
            <div className="text-orange-400 font-bold">
              {item.minDamage} - {item.maxDamage}
            </div>
          </div>
        )}

        {/* Stats */}
        {nonZeroStats.length > 0 && (
          <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2 space-y-1.5">
            <span className="text-xs text-zinc-500">Bonuses</span>
            {nonZeroStats.map((s) => (
              <div key={s.key} className="flex justify-between text-sm">
                <span className="text-zinc-400">{s.label}</span>
                <span className={`font-medium ${s.color}`}>
                  +{item.statBonuses[s.key]}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        {actions && <div className="pt-1">{actions}</div>}
      </div>
    </Modal>
  );
}
