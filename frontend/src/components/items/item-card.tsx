"use client";

import type { Item, ItemType } from "@/types/game";
import {
  RARITY_COLORS,
  RARITY_GLOW,
  RARITY_LABELS,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
} from "@/types/game";

interface ItemCardProps {
  item: Item;
  onClick?: () => void;
  selected?: boolean;
  compact?: boolean;
  showPrice?: boolean;
  /** Render dimmed + grayscaled with a "Lv N" badge and a not-allowed
   *  cursor. When true, the card is non-interactive even if `onClick`
   *  is supplied — defense-in-depth for callers (the slot picker
   *  passes `locked: true` and skips wiring `onClick` for level-locked
   *  items so the detail modal never opens for an item the chain
   *  would refuse). */
  locked?: boolean;
  /** Tooltip text for locked cards (e.g. "Requires Level 5"). Shown
   *  via `title` and as a short visible badge in the top-right. */
  lockedReason?: string;
}

const STAT_DISPLAY: { key: keyof Item["statBonuses"]; label: string; color: string }[] = [
  { key: "strengthBonus", label: "STR", color: "text-red-400" },
  { key: "dexterityBonus", label: "DEX", color: "text-cyan-400" },
  { key: "intuitionBonus", label: "INT", color: "text-purple-400" },
  { key: "enduranceBonus", label: "END", color: "text-amber-400" },
  { key: "hpBonus", label: "HP", color: "text-red-300" },
  { key: "armorBonus", label: "Armor", color: "text-zinc-300" },
  { key: "defenseBonus", label: "Def", color: "text-amber-300" },
  { key: "attackBonus", label: "ATK", color: "text-orange-400" },
  { key: "critChanceBonus", label: "Crit%", color: "text-purple-300" },
  { key: "critMultiplierBonus", label: "CritX", color: "text-purple-300" },
  { key: "evasionBonus", label: "Eva", color: "text-cyan-300" },
  { key: "antiCritBonus", label: "ACrit", color: "text-zinc-400" },
  { key: "antiEvasionBonus", label: "AEva", color: "text-zinc-400" },
];

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

// Rarity-coloured left accent (4px stripe) and surrounding border
// for the v2 forged-plate look.
const RARITY_BORDER: Record<number, string> = {
  1: "var(--rarity-common)",
  2: "var(--rarity-uncommon)",
  3: "var(--rarity-rare)",
  4: "var(--rarity-epic)",
  5: "var(--rarity-legendary)",
};
// Suppress the unused import warning by referencing RARITY_GLOW in
// a no-op (kept available for future selected-state animations).
void RARITY_GLOW;

export function ItemCard({ item, onClick, selected, compact, showPrice, locked, lockedReason }: ItemCardProps) {
  const nonZeroStats = STAT_DISPLAY.filter(
    (s) => item.statBonuses[s.key] > 0
  );
  const isLocked = locked === true;
  const isInteractive = !!onClick && !isLocked;

  const rarityColor = RARITY_BORDER[item.rarity];
  const cardStyle: React.CSSProperties = {
    background: selected ? "var(--sc-panel-2)" : "var(--sc-panel)",
    border: `1px solid var(--sc-rim)`,
    borderLeft: `4px solid ${rarityColor}`,
    borderRadius: "var(--r-sm)",
    padding: 10,
    fontFamily: "var(--font-ui)",
    color: "var(--sc-parchment)",
    boxShadow: selected
      ? `0 0 0 1px ${rarityColor}, var(--sh-plate-sm)`
      : "var(--rim-top), var(--rim-bottom)",
    cursor: isInteractive ? "pointer" : isLocked ? "not-allowed" : "default",
    opacity: isLocked ? 0.45 : 1,
    filter: isLocked ? "grayscale(.6)" : undefined,
    transition: "transform var(--d-fast), box-shadow var(--d-fast), background var(--d-fast)",
    textAlign: "left",
    width: "100%",
  };

  const inner = (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={item.name}
              style={{
                width: 36,
                height: 36,
                borderRadius: 2,
                objectFit: "cover",
                flexShrink: 0,
                border: `1px solid ${rarityColor}`,
                background: "var(--sc-page)",
              }}
            />
          ) : (
            <span style={{ fontSize: 18, marginTop: 2, flexShrink: 0 }}>
              {ITEM_TYPE_ICONS[item.itemType] || ""}
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div
              className={RARITY_COLORS[item.rarity]}
              style={{
                fontWeight: 800,
                fontSize: 13,
                letterSpacing: "-0.01em",
                color: rarityColor,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {item.name}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--fg-3)",
                marginTop: 2,
                fontFamily: "var(--font-ui)",
                letterSpacing: ".02em",
              }}
            >
              {ITEM_TYPE_LABELS[item.itemType]} · {RARITY_LABELS[item.rarity]}
              {item.levelReq > 1 && ` · Lv.${item.levelReq}`}
            </div>
          </div>
        </div>
        {isLocked && (
          <span
            title={lockedReason}
            style={{
              fontSize: 9,
              fontWeight: 800,
              padding: "2px 6px",
              background: "rgba(181,61,44,.15)",
              color: "var(--sc-blood)",
              border: "1px solid var(--sc-blood-deep)",
              borderRadius: 2,
              letterSpacing: ".10em",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            Lv {item.levelReq}
          </span>
        )}
        {item.inKiosk && (
          item.kioskListed ? (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "2px 6px",
                background: "var(--sc-bronze)",
                color: "var(--sc-page)",
                border: "1px solid var(--sc-bronze-deep)",
                borderRadius: 2,
                letterSpacing: ".10em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              Listed
            </span>
          ) : (
            <span
              title="Sitting unlisted in your Kiosk — click to retrieve"
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "2px 6px",
                background: "var(--sc-panel-2)",
                color: "var(--sc-steel)",
                border: "1px solid var(--sc-steel-deep)",
                borderRadius: 2,
                letterSpacing: ".10em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              In Kiosk
            </span>
          )
        )}
        {showPrice && item.price !== undefined && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--sc-bronze)",
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {item.price}g
          </div>
        )}
      </div>

      {!compact && (
        <>
          {item.minDamage > 0 && (
            <div
              style={{
                fontSize: 11,
                color: "var(--sc-blood)",
                marginTop: 4,
                marginLeft: 44,
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
              }}
            >
              {item.minDamage}-{item.maxDamage} dmg
            </div>
          )}
          {nonZeroStats.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0 10px",
                marginTop: 6,
                marginLeft: 44,
                fontSize: 10,
              }}
            >
              {nonZeroStats.map((s) => (
                <span key={s.key} className={s.color} style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                  +{item.statBonuses[s.key]} {s.label}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );

  if (isInteractive) {
    return (
      <button
        onClick={onClick}
        title={lockedReason}
        style={cardStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--sc-panel-2)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = selected ? "var(--sc-panel-2)" : "var(--sc-panel)";
          e.currentTarget.style.transform = "";
        }}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      style={cardStyle}
      title={isLocked ? lockedReason : undefined}
      aria-disabled={isLocked || undefined}
    >
      {inner}
    </div>
  );
}
