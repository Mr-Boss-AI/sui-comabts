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

// Left border color by rarity (solid colors for the accent stripe)
const RARITY_LEFT_BORDER: Record<number, string> = {
  1: "border-l-zinc-500",
  2: "border-l-green-500",
  3: "border-l-blue-500",
  4: "border-l-purple-500",
  5: "border-l-orange-500",
};

export function ItemCard({ item, onClick, selected, compact, showPrice, locked, lockedReason }: ItemCardProps) {
  const nonZeroStats = STAT_DISPLAY.filter(
    (s) => item.statBonuses[s.key] > 0
  );

  // When locked, the card renders as a non-interactive <div> with dimmed
  // styling, regardless of whether onClick was supplied. Hover/cursor
  // affordances are removed and rarity glow is suppressed so the locked
  // state reads as "not for you yet" rather than "broken".
  const isLocked = locked === true;
  const isInteractive = !!onClick && !isLocked;

  // Render a <button> only when this card is the click target. When ItemCard
  // is presentational (no onClick) or nested inside another clickable parent
  // (e.g. the marketplace-browser cell wraps each listing in its own
  // <button>), render a <div> instead — nested <button>s are invalid HTML
  // and React 19 logs a hydration error for them.
  const stateClass = isLocked
    ? "bg-[#0a0a0d] opacity-60 grayscale cursor-not-allowed"
    : selected
      ? `${RARITY_GLOW[item.rarity]} ring-1 ring-emerald-500 bg-zinc-900/80 ${isInteractive ? "cursor-pointer" : "cursor-default"}`
      : `${RARITY_GLOW[item.rarity]} bg-[#0e0e12] ${isInteractive ? "cursor-pointer hover:bg-zinc-900/60" : "cursor-default"}`;
  const className = `text-left rounded-sm border border-zinc-800/40 border-l-2 ${RARITY_LEFT_BORDER[item.rarity]} p-2.5 transition-all w-full ${stateClass}`;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="w-8 h-8 rounded object-cover shrink-0 mt-0.5"
            />
          ) : (
            <span className="text-base mt-0.5 shrink-0">{ITEM_TYPE_ICONS[item.itemType] || ""}</span>
          )}
          <div className="min-w-0">
            <div className={`font-semibold text-sm ${RARITY_COLORS[item.rarity]} truncate`}>
              {item.name}
            </div>
            <div className="text-[10px] text-zinc-600 mt-0.5">
              {ITEM_TYPE_LABELS[item.itemType]} · {RARITY_LABELS[item.rarity]}
              {item.levelReq > 1 && ` · Lv.${item.levelReq}`}
            </div>
          </div>
        </div>
        {isLocked && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-red-950/50 text-red-300 border border-red-800/50 shrink-0 font-bold tracking-wide"
            title={lockedReason}
          >
            Lv {item.levelReq}
          </span>
        )}
        {item.inKiosk && (
          item.kioskListed ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-700/30 shrink-0">
              Listed
            </span>
          ) : (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-400 border border-zinc-700/40 shrink-0"
              title="Sitting unlisted in your Kiosk — click to retrieve"
            >
              In Kiosk
            </span>
          )
        )}
        {showPrice && item.price !== undefined && (
          <div className="text-xs text-amber-400 font-bold shrink-0">
            {item.price}g
          </div>
        )}
      </div>

      {!compact && (
        <>
          {item.minDamage > 0 && (
            <div className="text-xs text-orange-400/80 mt-1 ml-7">
              {item.minDamage}-{item.maxDamage} dmg
            </div>
          )}
          {nonZeroStats.length > 0 && (
            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1.5 ml-7">
              {nonZeroStats.map((s) => (
                <span key={s.key} className={`text-[10px] ${s.color}`}>
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
      <button onClick={onClick} className={className} title={lockedReason}>
        {inner}
      </button>
    );
  }
  return (
    <div
      className={className}
      title={isLocked ? lockedReason : undefined}
      aria-disabled={isLocked || undefined}
    >
      {inner}
    </div>
  );
}
