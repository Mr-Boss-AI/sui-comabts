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
  { key: "strengthBonus", label: "Strength", color: "var(--stat-str)" },
  { key: "dexterityBonus", label: "Dexterity", color: "var(--stat-dex)" },
  { key: "intuitionBonus", label: "Intuition", color: "var(--stat-int)" },
  { key: "enduranceBonus", label: "Endurance", color: "var(--stat-end)" },
  { key: "hpBonus", label: "HP", color: "var(--stat-hp)" },
  { key: "armorBonus", label: "Armor", color: "var(--sc-steel)" },
  { key: "defenseBonus", label: "Defense", color: "var(--sc-bronze)" },
  { key: "attackBonus", label: "Attack", color: "var(--sc-blood)" },
  { key: "critChanceBonus", label: "Crit Chance", color: "var(--stat-int)" },
  { key: "critMultiplierBonus", label: "Crit Multiplier", color: "var(--stat-int)" },
  { key: "evasionBonus", label: "Evasion", color: "var(--stat-dex)" },
  { key: "antiCritBonus", label: "Anti-Crit", color: "var(--fg-3)" },
  { key: "antiEvasionBonus", label: "Anti-Evasion", color: "var(--fg-3)" },
];

const RARITY_BORDER: Record<number, string> = {
  1: "var(--rarity-common)",
  2: "var(--rarity-uncommon)",
  3: "var(--rarity-rare)",
  4: "var(--rarity-epic)",
  5: "var(--rarity-legendary)",
};

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

  const rarityColor = RARITY_BORDER[item.rarity];
  // Reference RARITY_COLORS for Tailwind JIT scan retention.
  void RARITY_COLORS;

  return (
    <Modal open onClose={onClose} title={item.name}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          fontFamily: "var(--font-ui)",
          color: "var(--sc-parchment)",
        }}
      >
        {/* Header: image + basic info */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={item.name}
              style={{
                width: 80,
                height: 80,
                objectFit: "cover",
                flexShrink: 0,
                border: `3px solid ${rarityColor}`,
                background: "var(--sc-page)",
                borderRadius: 2,
                boxShadow: "var(--sh-plate-sm)",
              }}
            />
          ) : (
            <div
              style={{
                width: 80,
                height: 80,
                background: "var(--sc-panel-2)",
                border: `3px solid ${rarityColor}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                flexShrink: 0,
                borderRadius: 2,
              }}
            >
              {ITEM_TYPE_ICONS[item.itemType] || "?"}
            </div>
          )}
          <div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 22,
                color: rarityColor,
                letterSpacing: "0.01em",
                lineHeight: 1.1,
              }}
            >
              {item.name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--fg-3)",
                marginTop: 4,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {ITEM_TYPE_LABELS[item.itemType]} · {RARITY_LABELS[item.rarity]}
            </div>
            {item.levelReq > 1 && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--sc-bronze)",
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                }}
              >
                Requires Lv {item.levelReq}
              </div>
            )}
          </div>
        </div>

        {/* Damage */}
        {item.minDamage > 0 && (
          <div
            style={{
              padding: "8px 12px",
              background: "var(--sc-panel-2)",
              border: "1px solid var(--sc-rim)",
              borderLeft: "3px solid var(--sc-blood)",
              borderRadius: "var(--r-card)",
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "var(--ls-stamp)",
                textTransform: "uppercase",
                color: "var(--fg-3)",
              }}
            >
              Damage
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--sc-blood)",
                fontWeight: 800,
                fontSize: 18,
                marginTop: 2,
              }}
            >
              {item.minDamage} – {item.maxDamage}
            </div>
          </div>
        )}

        {/* Stats */}
        {nonZeroStats.length > 0 && (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--sc-panel-2)",
              border: "1px solid var(--sc-rim)",
              borderLeft: "3px solid var(--sc-bronze)",
              borderRadius: "var(--r-card)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "var(--ls-stamp)",
                textTransform: "uppercase",
                color: "var(--sc-bronze)",
                borderBottom: "1px solid var(--sc-rim)",
                paddingBottom: 4,
                marginBottom: 2,
              }}
            >
              Bonuses
            </div>
            {nonZeroStats.map((s) => (
              <div
                key={s.key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--fg-2)" }}>{s.label}</span>
                <span
                  style={{
                    color: s.color,
                    fontWeight: 800,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  +{item.statBonuses[s.key]}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        {actions && <div style={{ paddingTop: 4 }}>{actions}</div>}
      </div>
    </Modal>
  );
}
