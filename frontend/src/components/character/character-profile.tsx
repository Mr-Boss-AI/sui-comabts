"use client";

/**
 * Character — Loadout composition (Phase 2 layout sweep).
 *
 * Matches the Claude Design screenshot at
 * `design_v2/screenshopts/Screenshot from 2026-05-13 14-01-04.png`:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ "Loadout"  Slot in your gear …            [ ON CHAIN ]       │  ← TopBanner
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ ┌───── Equipment Frame ─────┐ ┌── Stats ──┐ ┌─ Inventory ─┐  │
 *   │ │ helm  | HP bar |  necklace│ │ name      │ │             │  │
 *   │ │ brc.* | NFT    |  3 rings │ │ STR/DEX...│ │ items grid  │  │
 *   │ │ wpn   |  frame |  gloves  │ │ HP/ATK... │ │             │  │
 *   │ │ chst  | ornm   |  offhd   │ │ XP bar    │ │             │  │
 *   │ │ belt  |        |  boots   │ │ W/L       │ │             │  │
 *   │ └─────────────────────────────┘ └──────────┘ └─────────────┘  │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ Recent fights — WIN/LOSS rows                                 │  ← below frame
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Pixel spec for the EquipmentFrame at the 1024px reference width:
 *   - Big slot tiles: 216×216 (helmet / bracers / weapon / chest / belt /
 *     necklace / gloves / off-hand / boots)
 *   - Belt 216×102 (shorter, sits at the bottom of the left column)
 *   - Center column: HP bar 462×40, NFT portrait 462×462, Ornament 462×120
 *   - 3-ring cluster: 3 × 64×64 in a row spanning 216px
 *   - 6px gap between cells, 14px frame padding, 2px bronze double rim
 *
 * Three breakpoint regimes (driven by useBreakpoint):
 *   xl (≥ 1440px) — 3-column outer: EquipmentFrame · Stats · Inventory
 *   lg (1024–1439) — 2-column outer: EquipmentFrame · Stats; Inventory below
 *   md / sm — stacked
 *
 * Every existing behaviour preserved verbatim: stage/save/discard,
 * stat-allocate modal-controller boolean + pendingStatAllocate bridge,
 * ItemDetailModal + ItemCard pickers, dirty-slot rings, 2H Path A
 * locks, effectiveUnallocatedPoints clamp, NFT portrait picker.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useGame } from "@/hooks/useGameStore";
import { useEquipmentActions } from "@/hooks/useEquipmentActions";
import { computeDerivedStats, getArchetype, getArchetypeColor } from "@/lib/combat";
import { effectiveUnallocatedPoints } from "@/lib/stat-points";
import { buildSlotPickerEntries } from "@/lib/equipment-picker";
import { isTwoHanded } from "@/lib/two-handed-weapons";
import { MAX_LEVEL, getXpInCurrentLevel, getXpProgress, getXpSpanForLevel } from "@/types/game";
import { RARITY_COLORS, EQUIPMENT_SLOT_LABELS } from "@/types/game";
import type { Character, EquipmentSlots, Item, Rarity } from "@/types/game";
import { StatAllocateModal } from "./stat-allocate-modal";
import { ItemDetailModal } from "@/components/items/item-detail-modal";
import { ItemCard } from "@/components/items/item-card";
import { Modal } from "@/components/ui/modal";
import { NftPortraitPicker } from "./nft-portrait-picker";
import {
  portraitKeyForWallet,
  readPortrait,
  writePortrait,
  type NftCandidate,
} from "@/lib/nft-portrait";
import {
  BronzeButton,
  SectionLabel,
  Stamp,
} from "@/components/v2";
import {
  ScreenLayout,
  SectionHeader,
  TopBanner,
  bpGte,
  useBreakpoint,
} from "@/components/v2/layout";
import { Inventory } from "@/components/items/inventory";

export const RARITY_BORDER_HEX: Record<Rarity, string> = {
  1: "var(--rarity-common)",
  2: "var(--rarity-uncommon)",
  3: "var(--rarity-rare)",
  4: "var(--rarity-epic)",
  5: "var(--rarity-legendary)",
};

/* ─────────────────────────── slot tile ─────────────────────────────── */

export interface SlotTileProps {
  slot: keyof EquipmentSlots | null;
  item: Item | null;
  future?: boolean;
  futureLabel?: string;
  /** Pixel size. Pass a single number for square tiles, or
   *  `{ w, h }` for rectangles (e.g. the bottom Belt slot). */
  size: number | { w: number; h: number };
  isDirty?: boolean;
  onClick?: () => void;
  emptyLabel?: string;
  /** v5.1 — visually lock the tile (no hover, no click, dimmed) AND
   *  swap the tooltip to `disabledReason`. Used by the offhand slot
   *  when the pending weapon is two-handed: chain rejects equipping an
   *  offhand under a 2H weapon (EWeaponIsTwoHanded=7), so we render the
   *  slot as unavailable rather than letting the user spend a click on
   *  a save-time abort. */
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Spec: design_v2/specs/character_equipment_frame_extracted.md  §SlotTile
 *
 *   - border        2px solid {rarityColor}  (filled)
 *                   1px solid var(--sc-rim-2) (empty)
 *   - border-radius 2 px
 *   - padding       0 (image sits with internal padding: 4)
 *   - bg            empty → var(--sc-panel-2)  /  future → var(--sc-page)
 *   - opacity       future slot → 0.45
 *   - shadow empty  inset 0 1px 0 rgba(255,255,255,.05),
 *                   inset 0 -1px 0 rgba(0,0,0,.55),
 *                   1px 1px 0 rgba(0,0,0,.6)
 *   - shadow dirty  0 0 0 1px var(--sc-bronze)
 *   - transition    transform .15s, border-color .15s, box-shadow .15s
 *   - image         100% / 100%, objectFit:contain, padding:4, drop-shadow
 *   - empty icon    IconComp at Math.min(w, h) * 0.42
 */
export function SlotTile({
  slot,
  item,
  future,
  futureLabel,
  size,
  isDirty,
  onClick,
  emptyLabel,
  disabled,
  disabledReason,
}: SlotTileProps) {
  const w = typeof size === "number" ? size : size.w;
  const h = typeof size === "number" ? size : size.h;
  const rarityColor = item ? RARITY_BORDER_HEX[item.rarity] : null;

  const SHADOW_EMPTY =
    "inset 0 1px 0 rgba(255,255,255,.05), inset 0 -1px 0 rgba(0,0,0,.55), 1px 1px 0 rgba(0,0,0,.6)";
  const SHADOW_DIRTY = "0 0 0 1px var(--sc-bronze)";

  const inert = future || disabled;
  const title = future
    ? `${futureLabel ?? "Slot"} — unlocks in v5.1 contract bundle`
    : disabled
      ? disabledReason ?? "Slot unavailable"
      : item
        ? `${item.name} (click to manage)`
        : slot
          ? `${EQUIPMENT_SLOT_LABELS[slot]} (click to equip)`
          : "Empty slot";

  const filled = item != null;

  return (
    <button
      type="button"
      onClick={inert ? undefined : onClick}
      title={title}
      aria-label={title}
      aria-disabled={disabled || undefined}
      style={{
        width: w,
        height: h,
        padding: 0,
        cursor: inert ? "not-allowed" : "pointer",
        background: future ? "var(--sc-page)" : "var(--sc-panel-2)",
        border: filled
          ? `2px solid ${rarityColor}`
          : "1px solid var(--sc-rim-2)",
        borderRadius: 2,
        opacity: future ? 0.45 : disabled ? 0.4 : 1,
        boxShadow: isDirty ? SHADOW_DIRTY : SHADOW_EMPTY,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition:
          "transform .15s, border-color .15s, box-shadow .15s",
        fontFamily: "var(--font-mono)",
        color: "var(--sc-ash)",
      }}
      onMouseEnter={(e) => {
        if (inert) return;
        e.currentTarget.style.transform = "translateY(-1px)";
        if (!item) e.currentTarget.style.borderColor = "var(--sc-bronze)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        if (!item) e.currentTarget.style.borderColor = "var(--sc-rim-2)";
      }}
    >
      {item ? (
        item.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={item.imageUrl}
            alt={item.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              padding: 4,
              boxSizing: "border-box",
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,.65))",
            }}
          />
        ) : (
          <SlotGlyph size={Math.min(w, h) * 0.42} color={rarityColor ?? "var(--sc-ash)"} />
        )
      ) : (
        <SlotGlyph
          size={Math.min(w, h) * 0.42}
          color={future ? "var(--sc-ash-2)" : "var(--sc-ash)"}
        />
      )}
      {future && (
        <span
          style={{
            position: "absolute",
            bottom: 3,
            right: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            fontWeight: 700,
            color: "var(--sc-bronze)",
            letterSpacing: ".06em",
            background: "rgba(10,13,18,.85)",
            padding: "1px 5px",
            border: "1px solid var(--sc-bronze-deep)",
            lineHeight: 1,
          }}
        >
          v5.1
        </span>
      )}
      {!future && !item && emptyLabel && (
        <span
          style={{
            position: "absolute",
            bottom: 5,
            left: 6,
            right: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            fontWeight: 700,
            color: "var(--sc-muted)",
            letterSpacing: ".10em",
            textTransform: "uppercase",
            textAlign: "center",
            lineHeight: 1,
            opacity: 0.7,
            pointerEvents: "none",
          }}
        >
          {emptyLabel}
        </span>
      )}
      {isDirty && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            width: 10,
            height: 10,
            borderRadius: 999,
            background: "var(--sc-bronze)",
            boxShadow: "0 0 6px var(--sc-bronze-hot)",
          }}
        />
      )}
    </button>
  );
}

function SlotGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Spec §[22]/[23] — stroke width 2.2 px on empty-slot glyphs. */}
      <path
        d="M12 3 L12 21 M3 12 L21 12"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        opacity={0.8}
      />
    </svg>
  );
}

/* ─────────────────────────── HP bar ───────────────────────────────── */

/**
 * Spec: design_v2/specs/character_equipment_frame_extracted.md  §HpBar
 *
 *   - height 22 px
 *   - bg var(--sc-page) · border 2px solid var(--sc-bronze)
 *   - inset 0 1px 0 rgba(255,255,255,.06), inset 0 -2px 0 rgba(0,0,0,.55)
 *   - fill gradient #7ba84a → #5a8a3a → #3f6b29
 *   - text JetBrains Mono 13 / 700, --sc-parchment, letter-spacing 0.06em
 */
export function HpBar({
  current,
  max,
  height = 22,
}: {
  current: number;
  max: number;
  height?: number;
}) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        background: "var(--sc-page)",
        border: "2px solid var(--sc-bronze)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,.06), inset 0 -2px 0 rgba(0,0,0,.55)",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${pct}%`,
          background:
            "linear-gradient(180deg, #7ba84a 0%, #5a8a3a 50%, #3f6b29 100%)",
          transition: "width var(--d-slow) var(--ease-out)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          fontWeight: 700,
          color: "var(--sc-parchment)",
          letterSpacing: "0.06em",
          pointerEvents: "none",
          textShadow: "0 1px 0 rgba(0,0,0,.6)",
        }}
      >
        {current.toLocaleString()} / {max.toLocaleString()}
      </div>
    </div>
  );
}

/* ──────────────────────── Portrait Frame ──────────────────────────── */

/**
 * Spec: design_v2/specs/character_equipment_frame_extracted.md  §PortraitFrame
 *
 *   - width 100% of center column
 *   - min-height 0, flex: 1 (grows to fill — set by parent grid cell)
 *   - bg empty #0a0a0c · border 2px solid var(--sc-bronze) · border-radius 0
 *   - inset 0 0 0 1px rgba(0,0,0,.4), inset 0 2px 4px rgba(0,0,0,.6)
 *   - "Portrait" badge: bronze bg / parchment-on-page text / 3 8 pad / 1px bronze border
 *   - Plus icon: 60×60, 2px solid bronze, opacity 0.55, IPlus 36
 *   - "PLACE YOUR NFT HERE": font-ui 14/800 uppercase --sc-ash
 *   - subtitle: font-ui 11 --sc-ash-2, max-width 200, line-height 1.45
 */
export interface PortraitFrameProps {
  portrait: NftCandidate | null;
  /** When omitted the frame renders as a read-only `<div>` instead of
   *  a `<button>` — used by the Player Profile mini frame. */
  onClick?: () => void;
  /** Override the "Place your NFT here" headline. */
  emptyTitle?: string;
  /** Override the "Click to choose…" subtitle. Pass empty string to hide. */
  emptySubtitle?: ReactNode;
  /** Hide the bronze "+" placeholder (used when the empty state is purely
   *  informational, e.g. read-only profile of another player). */
  hidePlusIcon?: boolean;
}

export function PortraitFrame({
  portrait,
  onClick,
  emptyTitle,
  emptySubtitle,
  hidePlusIcon,
}: PortraitFrameProps) {
  const interactive = typeof onClick === "function";
  const Tag = (interactive ? "button" : "div") as "button" | "div";
  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={onClick}
      title={
        interactive
          ? portrait
            ? `${portrait.name} — click to change`
            : "Click to set a portrait NFT"
          : portrait
            ? portrait.name
            : undefined
      }
      style={{
        width: "100%",
        flex: 1,
        minHeight: 0,
        padding: 0,
        cursor: interactive ? "pointer" : "default",
        overflow: "hidden",
        background: portrait ? "var(--sc-page)" : "#0a0a0c",
        border: "2px solid var(--sc-bronze)",
        borderRadius: 0,
        boxShadow:
          "inset 0 0 0 1px rgba(0,0,0,.4), inset 0 2px 4px rgba(0,0,0,.6)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        position: "relative",
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        transition: "border-color var(--d-fast)",
        boxSizing: "border-box",
      }}
      onMouseEnter={(e) => {
        if (!interactive) return;
        e.currentTarget.style.borderColor = "var(--sc-bronze-hot)";
      }}
      onMouseLeave={(e) => {
        if (!interactive) return;
        e.currentTarget.style.borderColor = "var(--sc-bronze)";
      }}
    >
      {portrait ? (
        <>
          {portrait.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={portrait.imageUrl}
              alt={portrait.name}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 36,
                color: "var(--sc-bronze)",
                textAlign: "center",
                padding: 16,
              }}
            >
              {portrait.name}
            </div>
          )}
          <span
            style={{
              position: "absolute",
              left: 8,
              top: 8,
              fontFamily: "var(--font-ui)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "rgba(10,13,18,.85)",
              background: "var(--sc-bronze)",
              padding: "3px 8px",
              border: "1px solid var(--sc-bronze)",
            }}
          >
            Portrait
          </span>
        </>
      ) : (
        <>
          {/* Plus icon — fixed 60×60 per spec. Hidden in read-only mode. */}
          {!hidePlusIcon && (
            <div
              style={{
                width: 60,
                height: 60,
                border: "2px solid var(--sc-bronze)",
                color: "var(--sc-bronze)",
                opacity: 0.55,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 36,
                fontWeight: 300,
                lineHeight: 1,
              }}
              aria-hidden
            >
              +
            </div>
          )}
          {/* Headline — defaults to "Place your NFT here" but read-only
              callers (Player Profile mini frame) override with "No
              portrait set". */}
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--sc-ash)",
              textAlign: "center",
              padding: "0 12px",
            }}
          >
            {emptyTitle ?? "Place your NFT here"}
          </div>
          {/* Subtitle — font-ui 11 --sc-ash-2, max-width 200. */}
          {emptySubtitle !== "" && (
            <div
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 11,
                color: "var(--sc-ash-2)",
                textAlign: "center",
                maxWidth: 200,
                lineHeight: 1.45,
                padding: "0 12px",
              }}
            >
              {emptySubtitle ?? (
                <>
                  Click to choose a portrait —<br />
                  cosmetic only
                </>
              )}
            </div>
          )}
        </>
      )}
    </Tag>
  );
}

/* ──────────────────────── Tribal ornament ────────────────────────── */

/**
 * Spec: design_v2/specs/character_equipment_frame_extracted.md  §Ornament
 *
 *   - height 56 px (caller sets it)
 *   - bg var(--sc-panel-3) · border 1px solid var(--sc-rim-2)
 *   - inset 0 1px 0 rgba(255,255,255,.04), inset 0 -1px 0 rgba(0,0,0,.55)
 *   - SVG tribal/heraldic decoration, bronze strokes
 */
export function TribalOrnament({ height }: { height: number }) {
  return (
    <div
      style={{
        width: "100%",
        height,
        background: "var(--sc-panel-3)",
        border: "1px solid var(--sc-rim-2)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,.04), inset 0 -1px 0 rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
      aria-hidden
    >
      <svg
        viewBox="0 0 480 110"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        fill="none"
      >
        <g
          stroke="var(--sc-bronze-deep)"
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
          opacity={0.55}
        >
          <path d="M40 55 Q 110 14 180 38 Q 215 50 225 55" />
          <path d="M40 55 Q 110 96 180 72 Q 215 60 225 55" />
          <path d="M70 22 L 56 40 M 100 30 L 84 46 M 130 36 L 116 52 M 50 32 L 66 50" />
          <path d="M70 88 L 56 70 M 100 80 L 84 64 M 130 74 L 116 58" />
          <path d="M440 55 Q 370 14 300 38 Q 265 50 255 55" />
          <path d="M440 55 Q 370 96 300 72 Q 265 60 255 55" />
          <path d="M410 22 L 424 40 M 380 30 L 396 46 M 350 36 L 364 52 M 430 32 L 414 50" />
          <path d="M410 88 L 424 70 M 380 80 L 396 64 M 350 74 L 364 58" />
        </g>
        <g
          stroke="var(--sc-bronze)"
          strokeWidth={1.6}
          strokeLinecap="round"
          fill="none"
        >
          <path d="M155 28 L 165 42 L 175 28 M 175 82 L 165 68 L 155 82" />
          <path d="M325 28 L 315 42 L 305 28 M 305 82 L 315 68 L 325 82" />
        </g>
        <g fill="none">
          <circle cx="240" cy="55" r="26" stroke="var(--sc-bronze)" strokeWidth={2.2} />
          <circle cx="240" cy="55" r="20" stroke="var(--sc-bronze-deep)" strokeWidth={1.4} />
          <circle cx="240" cy="55" r="14" stroke="var(--sc-bronze)" strokeWidth={1.8} />
        </g>
        <text
          x="240"
          y="62"
          textAnchor="middle"
          fontFamily="var(--font-display)"
          fontSize="20"
          fill="var(--sc-bronze)"
          letterSpacing="0.05em"
        >
          SUI
        </text>
        <g fill="var(--sc-bronze)">
          <circle cx="14" cy="14" r="2.2" />
          <circle cx="466" cy="14" r="2.2" />
          <circle cx="14" cy="96" r="2.2" />
          <circle cx="466" cy="96" r="2.2" />
        </g>
      </svg>
    </div>
  );
}

/* ─────────────────────── Frame Title ───────────────────────────── */

/**
 * Spec: design_v2/specs/character_v2_measurements.md  §Section 3
 *   [16] Class label "Bruiser" — Slackey 26px / 400, color --sc-bronze,
 *        letter-spacing 0.52px
 *   [17] Level [14] — JetBrains Mono 18px / 700, --sc-bronze, opacity 0.85
 *   [18] ⓘ info icon — small steel-blue square i-button on the right
 */
function FrameTitle({
  archetype,
  level,
}: {
  /** Character display name — passed for tooltip / aria only. */
  name: string;
  level: number;
  archetype: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "10px 0",
        fontFamily: "var(--font-ui)",
      }}
    >
      <svg
        width={22}
        height={22}
        viewBox="0 0 24 24"
        fill="var(--sc-bronze)"
        stroke="var(--sc-page)"
        strokeWidth={1.2}
        aria-hidden
      >
        <path d="M12 2L22 9L20 22L12 18L4 22L2 9z" />
      </svg>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 26,
          fontWeight: 400,
          lineHeight: 1,
          color: "var(--sc-bronze)",
          letterSpacing: "0.52px",
        }}
        title={`${archetype} archetype`}
      >
        {archetype}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 18,
          color: "var(--sc-bronze)",
          opacity: 0.85,
        }}
      >
        [{level}]
      </span>
      <button
        type="button"
        title={`${archetype} build · Lv ${level}`}
        aria-label="Build info"
        style={{
          width: 22,
          height: 22,
          padding: 0,
          background: "var(--sc-steel)",
          color: "var(--sc-parchment)",
          border: "1px solid var(--sc-steel-deep)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontSize: 14,
          fontStyle: "italic",
          borderRadius: 2,
        }}
      >
        i
      </button>
    </div>
  );
}

/* ─────────────────────────── Sums ────────────────────────────────── */

function sumEquipmentStat(
  equipment: EquipmentSlots,
  key: keyof Item["statBonuses"],
): number {
  let total = 0;
  for (const item of Object.values(equipment)) {
    if (item) total += (item as Item).statBonuses[key] || 0;
  }
  return total;
}

/* ─────────────────────── Recent Fights ────────────────────────── */

/**
 * Spec: design_v2/specs/character_v2_measurements.md  §Section 6 (68-73)
 *   [68] Heading "Recent fights" Poppins 36/400 parchment, tracking -0.36
 *   [69-70][72] WIN: badge 60×22 Poppins 10/700 parchment on victory-green,
 *               opponent Poppins 13/700 parchment, score JetBrains Mono 13/700
 *               victory-green, result Poppins 11/400 muted right-aligned
 *   [71][73] LOSS: badge fill blood, score blood-red
 */
function RecentFights() {
  const { state } = useGame();
  const account = useCurrentAccount();
  const { fightHistory } = state;

  useEffect(() => {
    if (!state.socket.authenticated) return;
    state.socket.send({ type: "get_fight_history" });
  }, [state.socket]);

  const heading = (
    <h2
      style={{
        margin: "0 0 12px",
        fontFamily: "var(--font-ui)",
        fontSize: 36,
        fontWeight: 400,
        lineHeight: 1.15,
        color: "var(--sc-parchment)",
        letterSpacing: "-0.36px",
      }}
    >
      Recent fights
    </h2>
  );

  if (!fightHistory.length) {
    return (
      <div
        style={{
          background: "var(--sc-panel)",
          border: "1px solid var(--sc-rim)",
          borderRadius: "var(--r-card)",
          padding: 20,
          boxShadow: "var(--sh-plate), var(--rim-top), var(--rim-bottom)",
        }}
      >
        {heading}
        <p
          style={{
            color: "var(--sc-muted)",
            fontSize: 13,
            textAlign: "center",
            padding: "20px 0",
            fontStyle: "italic",
            margin: 0,
          }}
        >
          No fights yet — head to the Arena and pick a queue.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--sc-panel)",
        border: "1px solid var(--sc-rim)",
        borderRadius: "var(--r-card)",
        padding: 20,
        boxShadow: "var(--sh-plate), var(--rim-top), var(--rim-bottom)",
      }}
    >
      {heading}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {fightHistory.slice(0, 8).map((fight, i) => {
          const won = fight.winner === account?.address;
          const isA = fight.playerA.walletAddress === account?.address;
          const opponent = isA ? fight.playerB : fight.playerA;
          const isLast = i === Math.min(7, fightHistory.length - 1);
          const badgeBg = won ? "var(--sc-victory)" : "var(--sc-blood)";
          const scoreColor = won ? "var(--sc-victory)" : "var(--sc-blood)";
          // Derive a +/- delta if we ever stash one on the fight record;
          // until then surface turn count as a stable per-row metric.
          const scoreText = (fight as unknown as { eloDelta?: number }).eloDelta
            ? `${(fight as unknown as { eloDelta: number }).eloDelta > 0 ? "+" : ""}${
                (fight as unknown as { eloDelta: number }).eloDelta
              }`
            : `${fight.turns}t`;
          return (
            <div
              key={fight.id}
              style={{
                display: "grid",
                gridTemplateColumns: "60px 1fr auto auto",
                alignItems: "center",
                gap: 16,
                padding: "10px 12px",
                borderBottom: isLast ? "none" : "1px solid var(--sc-rim)",
                background: "transparent",
                fontFamily: "var(--font-ui)",
              }}
            >
              {/* §[69]/[71] WIN / LOSS pill — 60×22, parchment on green/blood. */}
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontWeight: 700,
                  fontSize: 10,
                  letterSpacing: "1.4px",
                  textTransform: "uppercase",
                  color: "var(--sc-parchment)",
                  background: badgeBg,
                  border: `1px solid ${badgeBg}`,
                  width: 60,
                  height: 22,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--r-pill)",
                }}
              >
                {won ? "Win" : "Loss"}
              </span>
              {/* §[69] opponent — Poppins 13/700 parchment. */}
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--sc-parchment)",
                }}
              >
                vs {opponent.name}
              </span>
              {/* §[69] score — JetBrains Mono 13/700 coloured. */}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 13,
                  color: scoreColor,
                  minWidth: 60,
                  textAlign: "right",
                }}
              >
                {scoreText}
              </span>
              {/* §[69] result note — Poppins 11/400 muted right-aligned. */}
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  fontWeight: 400,
                  color: "var(--sc-muted)",
                  minWidth: 120,
                  textAlign: "right",
                }}
              >
                {fight.wagerAmount
                  ? `Wager ${fight.wagerAmount} SUI`
                  : `${fight.type[0].toUpperCase()}${fight.type.slice(1)} fight`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────── Equipment Frame ───────────────────────── */

/**
 * EquipmentFrame — ported one-to-one from the live Claude Design
 * `CharacterScreen.jsx` React source.  Architecture spec lives at
 * `design_v2/specs/character_equipment_frame_extracted.md`.
 *
 * Critical:  the center column is `1fr` — NOT a fixed pixel width.
 * Fixed widths there were the root cause of the prior misalignment.
 *
 * Tweak defaults (from `App.jsx` `TWEAK_DEFAULTS`, ported verbatim):
 *   bigSlotW      96   — every main slot width
 *   bigSlotH     108   — main slot height (vertical rectangle)
 *   ringSlotSize  44   — Ring 1 / Ring 2 / Ring 3 square
 *   beltSlotH     56   — Belt slot height (same width as bigSlotW)
 *   colGap         8   — gap between left / center / right columns
 *   slotGap        6   — vertical gap within a column
 *   framePad      12   — frame inner padding
 */
export const TWEAK_DEFAULTS = {
  bigSlotW: 96,
  bigSlotH: 108,
  ringSlotSize: 44,
  beltSlotH: 56,
  colGap: 8,
  slotGap: 6,
  framePad: 12,
  statRowPad: 4,
} as const;

function EquipmentFrame({
  eq,
  dirtySlots,
  portrait,
  onSlot,
  onPortrait,
  player,
  hp,
}: {
  eq: EquipmentSlots;
  dirtySlots: Set<keyof EquipmentSlots>;
  portrait: NftCandidate | null;
  onSlot: (slot: keyof EquipmentSlots) => void;
  onPortrait: () => void;
  player: { name: string; level: number; archetype: string };
  hp: { current: number; max: number };
}) {
  const {
    bigSlotW,
    bigSlotH,
    ringSlotSize,
    beltSlotH,
    colGap,
    slotGap,
    framePad,
  } = TWEAK_DEFAULTS;

  const bigSize = { w: bigSlotW, h: bigSlotH };

  // v5.1 — Lock the off-hand slot when a two-handed weapon is equipped.
  // Mirrors the chain rule (equipment.move::equip_offhand asserts the
  // current weapon is not two-handed → EWeaponIsTwoHanded=7) so the user
  // is prevented from staging an illegal pending state in the first
  // place rather than seeing a save-time abort. `isTwoHanded` reads
  // chain `Item.slot_type` directly — no name allowlist.
  const offhandLocked = eq.weapon != null && isTwoHanded(eq.weapon);

  return (
    <div style={{ width: "100%", maxWidth: 520 }}>
      <FrameTitle
        name={player.name}
        level={player.level}
        archetype={player.archetype}
      />
      <div
        style={{
          background: "var(--sc-panel)",
          border: "2px solid var(--sc-bronze-deep)",
          boxShadow:
            "0 0 0 1px var(--sc-rim), inset 0 1px 0 rgba(255,255,255,.04), inset 0 -2px 0 rgba(0,0,0,.55)",
          padding: framePad,
          // Spec-critical grid template: 96px 8px 1fr 8px 96px.
          // Center is `1fr` so the portrait + ornament stretch to
          // fill the leftover width. Don't replace the 1fr with a
          // fixed pixel value or the doll collapses.
          display: "grid",
          gridTemplateColumns: `${bigSlotW}px ${colGap}px 1fr ${colGap}px ${bigSlotW}px`,
          alignItems: "stretch",
          boxSizing: "border-box",
        }}
      >
        {/* LEFT COLUMN — Helmet · Shoulders* · Weapon · Chest · Belt(h:56) */}
        <div
          style={{
            gridColumn: 1,
            display: "flex",
            flexDirection: "column",
            gap: slotGap,
          }}
        >
          <SlotTile
            slot="helmet"
            item={eq.helmet}
            size={bigSize}
            isDirty={dirtySlots.has("helmet")}
            onClick={() => onSlot("helmet")}
            emptyLabel="Helmet"
          />
          <SlotTile
            slot="bracelets"
            item={eq.bracelets}
            size={bigSize}
            isDirty={dirtySlots.has("bracelets")}
            onClick={() => onSlot("bracelets")}
            emptyLabel="Bracelets"
          />
          <SlotTile
            slot="weapon"
            item={eq.weapon}
            size={bigSize}
            isDirty={dirtySlots.has("weapon")}
            onClick={() => onSlot("weapon")}
            emptyLabel="Weapon"
          />
          <SlotTile
            slot="chest"
            item={eq.chest}
            size={bigSize}
            isDirty={dirtySlots.has("chest")}
            onClick={() => onSlot("chest")}
            emptyLabel="Chest"
          />
          <SlotTile
            slot="belt"
            item={eq.belt}
            size={{ w: bigSlotW, h: beltSlotH }}
            isDirty={dirtySlots.has("belt")}
            onClick={() => onSlot("belt")}
            emptyLabel="Belt"
          />
        </div>

        {/* CENTER COLUMN — HpBar(22) · PortraitFrame(flex:1) · Ornament(56) */}
        <div
          style={{
            gridColumn: 3,
            display: "flex",
            flexDirection: "column",
            gap: slotGap,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <HpBar current={hp.current} max={hp.max} />
          <PortraitFrame portrait={portrait} onClick={onPortrait} />
          <TribalOrnament height={56} />
        </div>

        {/* RIGHT COLUMN — Necklace · [Ring1 Ring2 Ring3*] · Gloves · Off-hand · Pants* + Boots */}
        <div
          style={{
            gridColumn: 5,
            display: "flex",
            flexDirection: "column",
            gap: slotGap,
          }}
        >
          <SlotTile
            slot="necklace"
            item={eq.necklace}
            size={bigSize}
            isDirty={dirtySlots.has("necklace")}
            onClick={() => onSlot("necklace")}
            emptyLabel="Necklace"
          />
          {/* Ring row — 3 × 44²; spec says these are 44-square,
              not flex-distributed across the column. Center the row
              horizontally inside the 96-wide track. */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: slotGap,
              width: bigSlotW,
              height: ringSlotSize,
            }}
          >
            <SlotTile
              slot="ring1"
              item={eq.ring1}
              size={ringSlotSize}
              isDirty={dirtySlots.has("ring1")}
              onClick={() => onSlot("ring1")}
            />
            <SlotTile
              slot="ring2"
              item={eq.ring2}
              size={ringSlotSize}
              isDirty={dirtySlots.has("ring2")}
              onClick={() => onSlot("ring2")}
            />
            <SlotTile
              slot="ring3"
              item={eq.ring3}
              size={ringSlotSize}
              isDirty={dirtySlots.has("ring3")}
              onClick={() => onSlot("ring3")}
            />
          </div>
          <SlotTile
            slot="gloves"
            item={eq.gloves}
            size={bigSize}
            isDirty={dirtySlots.has("gloves")}
            onClick={() => onSlot("gloves")}
            emptyLabel="Gloves"
          />
          <SlotTile
            slot="offhand"
            item={eq.offhand}
            size={bigSize}
            isDirty={dirtySlots.has("offhand")}
            onClick={() => onSlot("offhand")}
            emptyLabel="Off-hand"
            disabled={offhandLocked}
            disabledReason="Two-handed weapon equipped — off-hand unavailable."
          />
          <SlotTile
            slot="pants"
            item={eq.pants}
            size={bigSize}
            isDirty={dirtySlots.has("pants")}
            onClick={() => onSlot("pants")}
            emptyLabel="Pants"
          />
          <SlotTile
            slot="boots"
            item={eq.boots}
            size={bigSize}
            isDirty={dirtySlots.has("boots")}
            onClick={() => onSlot("boots")}
            emptyLabel="Boots"
          />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Center Info card ───────────────────────
 *
 * Single tall card sitting between the EquipmentFrame and the
 * Inventory, matching the Claude Design target screenshot:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [ARCHETYPE]                       [ + N PTS ]│
 *   │ Ponke_the_Brawler                            │  ← Slackey 52px name
 *   │ [Lv 14] [2134 ELO] 47w · 21l · 69%           │
 *   │ ────────────────────────────────────────────  │
 *   │ PRIMARY ATTRIBUTES                            │
 *   │   STR ▇▇▇▇▇▇▇▇▇▇▇▇▇▇                    14   │
 *   │   DEX ▇▇▇                                 8   │
 *   │   INT ▇▇▇▇▇▇▇▇▇▇                         10   │
 *   │   END ▇▇▇▇▇▇▇▇▇▇▇▇                       12   │
 *   │ COMBAT STATS                                  │
 *   │ ┌─ HP ─┐ ┌─ ATK ─┐ ┌─ CRIT ─┐ ┌─ CRIT × ─┐    │
 *   │ │ 240  │ │  38   │ │  18%   │ │  1.75x   │    │
 *   │ ├─EVADE┤ ├─ARMOR─┤ ├──DEF───┤ ├──LV──────┤    │
 *   │ │  9%  │ │  22   │ │  31    │ │  14      │    │
 *   │ └──────┘ └───────┘ └────────┘ └──────────┘    │
 *   │ LV 14 → 15                  4,820 / 7,200 XP  │
 *   │ ████████████████░░░░░░░░░░░░                  │
 *   └──────────────────────────────────────────────┘
 */

interface CenterInfoCardProps {
  character: Character;
  derived: ReturnType<typeof computeDerivedStats>;
  archetype: string;
  unallocatedPoints: number;
  onAllocateClick: () => void;
  saveControls?: ReactNode;
  /** v5.1 (2026-05-28 PM) — LIVE pending equipment slice. Was previously
   * read off of `character.equipment` which is only refreshed when the
   * server pushes a new character payload (initial load + post-save).
   * Equip/unequip dispatches update `state.pendingEquipment` immediately;
   * threading that here makes the PRIMARY ATTRIBUTES bonus numbers
   * reactive to staged changes — preview before Save Loadout, no refresh
   * required. `derived` (COMBAT STATS grid) was already reactive via the
   * parent's useMemo. */
  equipment: EquipmentSlots;
}

const ARCHETYPE_TONE: Record<string, "blood" | "steel" | "bronze" | "default"> = {
  Crit: "blood",
  Evasion: "steel",
  Tank: "bronze",
  Hybrid: "default",
};

/**
 * Spec: design_v2/specs/character_v2_measurements.md  §Section 4 (elements 31-58)
 *   Card BG --sc-panel-2, padding 20/24/56/24
 *   [31] BRUISER pill Poppins 10/700 parchment on blood, 71×22, padding 3/9, tracking 1.4
 *   [32] +N PTS button Poppins 11/700 parchment on panel-2, 80×33, padding 6/12, gap 8
 *   [33] Character name Slackey 36/400 bronze, margin-top 6
 *   [34][35] LV / ELO bronze pills, page-black text
 *   [36] Record Poppins 12/600 parchment-dim
 *   [37] "PRIMARY ATTRIBUTES" Poppins 10/700 muted, tracking 1
 *   [38-47] STR/DEX/INT/END rows — label Poppins 12/800 semantic-coloured,
 *           bar 5px tall, value JetBrains Mono 12/700 semantic-coloured
 *   [48] "COMBAT STATS" Poppins 10/700 muted
 *   [49-56] 4×2 grid — HP/ATK blood, CRIT/CRIT× grape, EVADE/ARMOR muted,
 *           DEF blood, LV parchment.  Cell value JetBrains Mono 16/700.
 *   [57] XP labels Poppins 10/700 muted
 *   [58] XP bar 8 px striped gold gradient
 */

const STAT_COLORS: Record<"STR" | "DEX" | "INT" | "END", string> = {
  STR: "var(--sc-blood)",
  DEX: "var(--sc-steel)",
  INT: "var(--sc-grape)",
  END: "var(--sc-bronze)",
};

// v5.1 — receives `equipment` so the PRIMARY ATTRIBUTES bonuses recompute
// reactively from staged equip/unequip changes (see prop comment above).
function CenterInfoCard({
  character,
  derived,
  archetype,
  unallocatedPoints,
  onAllocateClick,
  saveControls,
  equipment,
}: CenterInfoCardProps) {
  const xpInLevel = getXpInCurrentLevel(character.level, character.xp);
  const xpSpan = getXpSpanForLevel(character.level);
  const xpProgress = getXpProgress(character.level, character.xp);
  const isMaxLevel = character.level >= MAX_LEVEL;
  const winRate =
    character.wins + character.losses > 0
      ? Math.round((character.wins / (character.wins + character.losses)) * 100)
      : 0;

  // v5.1 — reactive bonus sum from pending equipment (passed from parent).
  // Previous code read `character.equipment` which only updates on server
  // sync; equip/unequip dispatches now reflect immediately in the bars.
  const strBonus = sumEquipmentStat(equipment, "strengthBonus");
  const dexBonus = sumEquipmentStat(equipment, "dexterityBonus");
  const intBonus = sumEquipmentStat(equipment, "intuitionBonus");
  const endBonus = sumEquipmentStat(equipment, "enduranceBonus");

  const statRows: Array<{
    label: "STR" | "DEX" | "INT" | "END";
    base: number;
    bonus: number;
    color: string;
  }> = [
    { label: "STR", base: character.stats.strength, bonus: strBonus, color: STAT_COLORS.STR },
    { label: "DEX", base: character.stats.dexterity, bonus: dexBonus, color: STAT_COLORS.DEX },
    { label: "INT", base: character.stats.intuition, bonus: intBonus, color: STAT_COLORS.INT },
    { label: "END", base: character.stats.endurance, bonus: endBonus, color: STAT_COLORS.END },
  ];

  // Spec §[49]-[56] — 4 cells per row, two rows, semantic-coloured.
  const combatGrid: Array<[string, string | number, string]> = [
    ["HP", derived.maxHp, "var(--sc-blood)"],
    ["ATK", derived.attackPower, "var(--sc-blood)"],
    ["CRIT", `${derived.critChance}%`, "var(--sc-grape)"],
    ["CRIT ×", `${derived.critMultiplier}x`, "var(--sc-grape)"],
    ["EVADE", `${derived.evasionChance}%`, "var(--sc-parchment)"],
    ["ARMOR", derived.armor, "var(--sc-parchment)"],
    ["DEF", derived.defense, "var(--sc-blood)"],
    ["LV", character.level, "var(--sc-parchment)"],
  ];

  // Archetype label classified onto the BRUISER-pill colour family.
  // Anything that doesn't map to a known archetype falls back to blood.
  const archetypePillFill =
    ARCHETYPE_TONE[archetype] === "steel"
      ? "var(--sc-steel)"
      : ARCHETYPE_TONE[archetype] === "bronze"
        ? "var(--sc-bronze)"
        : "var(--sc-blood)";

  return (
    <div
      style={{
        background: "var(--sc-panel-2)",
        border: "1px solid var(--sc-rim)",
        borderRadius: "var(--r-card)",
        boxShadow: "var(--sh-plate-lg), var(--rim-top), var(--rim-bottom)",
        padding: "20px 24px 56px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        minWidth: 0,
      }}
    >
      {/* §[31] BRUISER class pill · §[32] +N PTS button */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color: "var(--sc-parchment)",
            background: archetypePillFill,
            padding: "3px 9px",
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            lineHeight: 1,
            borderRadius: "var(--r-pill)",
          }}
        >
          {archetype}
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {unallocatedPoints > 0 && (
            <button
              type="button"
              onClick={onAllocateClick}
              style={{
                fontFamily: "var(--font-ui)",
                fontWeight: 700,
                fontSize: 11,
                color: "var(--sc-parchment)",
                background: "var(--sc-panel-2)",
                border: "1px solid var(--sc-rim-2)",
                padding: "6px 12px",
                height: 33,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                cursor: "pointer",
                borderRadius: 2,
                boxShadow: "var(--sh-plate-sm)",
                whiteSpace: "nowrap",
              }}
            >
              + {unallocatedPoints} pts
            </button>
          )}
          {saveControls}
        </div>
      </div>

      {/* §[33] Slackey character name — bronze, 36/400, margin-top 6. */}
      <h2
        style={{
          margin: "6px 0 0",
          fontFamily: "var(--font-display)",
          fontSize: 36,
          fontWeight: 400,
          lineHeight: 1.0,
          color: "var(--sc-bronze)",
          letterSpacing: "0.01em",
          wordBreak: "break-word",
        }}
      >
        {character.name}
      </h2>

      {/* §[34][35][36] LV + ELO bronze pills + record. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color: "var(--sc-page)",
            background: "var(--sc-bronze)",
            padding: "3px 9px",
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            lineHeight: 1,
            borderRadius: 0,
          }}
        >
          LV {character.level}
        </span>
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color: "var(--sc-page)",
            background: "var(--sc-bronze)",
            padding: "3px 9px",
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            lineHeight: 1,
            borderRadius: 0,
          }}
        >
          {character.rating} ELO
        </span>
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--sc-parchment-dim)",
            letterSpacing: 0,
          }}
        >
          {character.wins}W · {character.losses}L · {winRate}%
        </span>
      </div>

      {/* §[37]-[47] Primary attributes — semantic-coloured rows, 5 px bar. */}
      <div>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: "1px",
            textTransform: "uppercase",
            color: "var(--sc-muted)",
            margin: "8px 0 10px",
          }}
        >
          Primary Attributes
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {statRows.map((row) => {
            const total = row.base + row.bonus;
            return (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    width: 48,
                    color: row.color,
                    fontWeight: 800,
                    fontSize: 12,
                    letterSpacing: "0.96px",
                    textTransform: "uppercase",
                  }}
                >
                  {row.label}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 5,
                    background: "rgba(10, 13, 18, 0.6)",
                    borderRadius: 1,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (total / 20) * 100)}%`,
                      height: "100%",
                      background: row.color,
                      transition: "width var(--d-slow) var(--ease-out)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    fontSize: 12,
                    color: row.color,
                    minWidth: 56,
                    textAlign: "right",
                  }}
                >
                  {row.bonus > 0 ? (
                    <>
                      {row.base}
                      <span
                        style={{
                          color: "var(--sc-victory)",
                          marginLeft: 4,
                          fontSize: 11,
                        }}
                      >
                        +{row.bonus}
                      </span>
                    </>
                  ) : (
                    row.base
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* §[48]-[56] Combat stats — 4×2 grid, semantic-coloured values. */}
      <div>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: "1px",
            textTransform: "uppercase",
            color: "var(--sc-muted)",
            margin: "8px 0 10px",
          }}
        >
          Combat Stats
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 6,
          }}
        >
          {combatGrid.map(([label, value, color]) => (
            <div
              key={label}
              style={{
                background: "var(--sc-page)",
                border: "1px solid var(--sc-rim-2)",
                borderRadius: 2,
                padding: "8px 10px",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--sc-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 16,
                  color,
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* §[57][58] XP bar — Poppins 10/700 muted labels, 8 px striped gold. */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-ui)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "var(--sc-muted)",
            marginBottom: 4,
          }}
        >
          <span>
            Lv {character.level}
            {isMaxLevel ? " MAX" : ` → ${character.level + 1}`}
          </span>
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {isMaxLevel
              ? `${character.xp.toLocaleString()} XP`
              : `${xpInLevel.toLocaleString()} / ${xpSpan.toLocaleString()} XP`}
          </span>
        </div>
        <div
          style={{
            position: "relative",
            height: 8,
            background: "var(--sc-page)",
            border: "1px solid var(--sc-rim-2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${xpProgress * 100}%`,
              height: "100%",
              background:
                "linear-gradient(90deg, var(--sc-bronze-deep) 0%, var(--sc-bronze-hot) 50%, var(--sc-bronze-deep) 100%)",
              transition: "width var(--d-slow) var(--ease-out)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              pointerEvents: "none",
            }}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                style={{
                  flex: 1,
                  borderRight: i < 4 ? "1px solid rgba(0,0,0,.45)" : "none",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Stats column (legacy, kept for back-compat) ── */

function StatsColumn({
  character,
  derived,
  archetype,
  archetypeColor,
  unallocatedPoints,
  onAllocateClick,
  saveControls,
  characterEloDelta,
  equipment,
}: {
  character: Character;
  derived: ReturnType<typeof computeDerivedStats>;
  archetype: string;
  archetypeColor: string;
  unallocatedPoints: number;
  onAllocateClick: () => void;
  saveControls?: ReactNode;
  characterEloDelta?: string;
  /** v5.1 — Same bug-fix as CenterInfoCard above. Required: pass the
   * reactive pending equipment slice from the parent so the
   * PRIMARY ATTRIBUTES bars reflect staged equip/unequip immediately.
   * StatsColumn is currently unused (kept for back-compat) but the
   * shape-fix is applied so reinstating it doesn't reintroduce the bug. */
  equipment: EquipmentSlots;
}) {
  const winRate =
    character.wins + character.losses > 0
      ? Math.round((character.wins / (character.wins + character.losses)) * 100)
      : 0;
  const xpInLevel = getXpInCurrentLevel(character.level, character.xp);
  const xpSpan = getXpSpanForLevel(character.level);
  const xpProgress = getXpProgress(character.level, character.xp);
  const isMaxLevel = character.level >= MAX_LEVEL;

  const strBonus = sumEquipmentStat(equipment, "strengthBonus");
  const dexBonus = sumEquipmentStat(equipment, "dexterityBonus");
  const intBonus = sumEquipmentStat(equipment, "intuitionBonus");
  const endBonus = sumEquipmentStat(equipment, "enduranceBonus");

  const statRows: Array<{
    label: string;
    base: number;
    bonus: number;
    color: string;
  }> = [
    { label: "STR", base: character.stats.strength, bonus: strBonus, color: "var(--stat-str)" },
    { label: "DEX", base: character.stats.dexterity, bonus: dexBonus, color: "var(--stat-dex)" },
    { label: "INT", base: character.stats.intuition, bonus: intBonus, color: "var(--stat-int)" },
    { label: "END", base: character.stats.endurance, bonus: endBonus, color: "var(--stat-end)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 260 }}>
      {/* Header card — archetype + name in Slackey + Lv/ELO + allocate */}
      <div
        style={{
          background: "var(--sc-panel)",
          border: "1px solid var(--sc-rim)",
          borderRadius: "var(--r-card)",
          padding: 16,
          boxShadow: "var(--sh-plate), var(--rim-top), var(--rim-bottom)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <Stamp tone="blood">{archetype}</Stamp>
            <h2
              style={{
                margin: "8px 0 0",
                fontFamily: "var(--font-display)",
                fontSize: 28,
                lineHeight: 1.05,
                color: "var(--sc-bronze)",
                letterSpacing: "0.01em",
              }}
            >
              {character.name}
            </h2>
            <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Stamp tone="bronze">Lv {character.level}</Stamp>
              <Stamp tone="default" outline>
                {character.rating} ELO
              </Stamp>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--fg-3)",
                  fontWeight: 700,
                }}
              >
                {character.wins}W · {character.losses}L · {winRate}%
              </span>
            </div>
          </div>
          {unallocatedPoints > 0 && (
            <BronzeButton size="sm" onClick={onAllocateClick}>
              + {unallocatedPoints} pts
            </BronzeButton>
          )}
        </div>
        {saveControls && (
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {saveControls}
          </div>
        )}
      </div>

      {/* Primary Attributes */}
      <div
        style={{
          background: "var(--sc-panel)",
          border: "1px solid var(--sc-rim)",
          borderRadius: "var(--r-card)",
          padding: 16,
          boxShadow: "var(--sh-plate), var(--rim-top), var(--rim-bottom)",
        }}
      >
        <SectionLabel>Primary Attributes</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {statRows.map((row) => {
            const total = row.base + row.bonus;
            return (
              <div
                key={row.label}
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 11,
                    letterSpacing: ".10em",
                    textTransform: "uppercase",
                    color: row.color,
                    width: 40,
                  }}
                >
                  {row.label}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 7,
                    background: "var(--sc-page)",
                    border: "1px solid var(--sc-rim-2)",
                    borderRadius: 1,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (total / 20) * 100)}%`,
                      height: "100%",
                      background: row.color,
                      transition: "width var(--d-slow) var(--ease-out)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 800,
                    fontSize: 14,
                    color: row.color,
                    minWidth: 36,
                    textAlign: "right",
                  }}
                >
                  {row.bonus > 0 ? (
                    <>
                      {row.base}
                      <span style={{ color: "var(--rarity-uncommon)", marginLeft: 4, fontSize: 11 }}>
                        +{row.bonus}
                      </span>
                    </>
                  ) : (
                    row.base
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Combat Stats */}
      <div
        style={{
          background: "var(--sc-panel)",
          border: "1px solid var(--sc-rim)",
          borderRadius: "var(--r-card)",
          padding: 16,
          boxShadow: "var(--sh-plate), var(--rim-top), var(--rim-bottom)",
        }}
      >
        <SectionLabel>Combat Stats</SectionLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 6,
          }}
        >
          {(
            [
              ["HP", derived.maxHp, "var(--stat-hp)"],
              ["ATK", derived.attackPower, "var(--sc-blood)"],
              ["Crit", `${derived.critChance}%`, "var(--stat-int)"],
              ["Crit ×", `${derived.critMultiplier}x`, "var(--stat-int)"],
              ["Evade", `${derived.evasionChance}%`, "var(--stat-dex)"],
              ["Armor", derived.armor, "var(--sc-steel)"],
              ["Def", derived.defense, "var(--sc-bronze)"],
              ["Lv", character.level, "var(--sc-parchment)"],
            ] as const
          ).map(([l, v, c]) => (
            <div
              key={l as string}
              style={{
                background: "var(--sc-page)",
                border: "1px solid var(--sc-rim-2)",
                borderRadius: 2,
                padding: "8px 10px",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--fg-3)",
                }}
              >
                {l}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 800,
                  fontSize: 18,
                  color: c as string,
                  marginTop: 2,
                }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".10em",
              textTransform: "uppercase",
              color: "var(--fg-3)",
              marginBottom: 4,
            }}
          >
            <span>
              Lv {character.level}
              {isMaxLevel ? " MAX" : ` → ${character.level + 1}`}
            </span>
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {isMaxLevel
                ? `${character.xp.toLocaleString()} XP`
                : `${xpInLevel.toLocaleString()} / ${xpSpan.toLocaleString()} XP`}
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: "var(--sc-page)",
              border: "1px solid var(--sc-rim-2)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                width: `${xpProgress * 100}%`,
                height: "100%",
                background:
                  "linear-gradient(90deg, var(--sc-bronze-deep) 0%, var(--sc-bronze-hot) 50%, var(--sc-bronze-deep) 100%)",
                transition: "width var(--d-slow) var(--ease-out)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                pointerEvents: "none",
              }}
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  style={{
                    flex: 1,
                    borderRight:
                      i < 4 ? "1px solid rgba(0,0,0,.45)" : "none",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Suppress unused archetypeColor — keeping prop for future use */}
      <span style={{ display: "none" }} aria-hidden>
        {archetypeColor}
        {characterEloDelta}
      </span>
    </div>
  );
}

/* ─────────────────────── Main component ──────────────────────────── */

export function CharacterProfile({
  character,
  compact,
  extras,
}: {
  character: Character;
  /** Legacy prop — Phase 2 ignores it; the layout adapts via viewport. */
  compact?: boolean;
  /** Optional trailing content (e.g. ResetCharacterButton) rendered
   *  after the inventory column on the small viewport stack. */
  extras?: ReactNode;
}) {
  void compact;
  const { state, dispatch } = useGame();
  const account = useCurrentAccount();
  const bp = useBreakpoint();
  const {
    stageEquip,
    stageUnequip,
    stageDiscard,
    saveLoadout,
    signing,
    isDirty,
    dirtySlots,
  } = useEquipmentActions();
  const [showAllocate, setShowAllocate] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<keyof EquipmentSlots | null>(null);

  const [portrait, setPortrait] = useState<NftCandidate | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPortrait(readPortrait(window.localStorage, account?.address ?? null));
  }, [account?.address]);

  function commitPortrait(item: NftCandidate | null) {
    setPortrait(item);
    if (typeof window !== "undefined") {
      writePortrait(window.localStorage, account?.address ?? null, item);
    }
  }

  useEffect(() => {
    if (state.pendingStatAllocate) {
      setShowAllocate(true);
      dispatch({ type: "SET_PENDING_STAT_ALLOCATE", pending: false });
    }
  }, [state.pendingStatAllocate, dispatch]);

  const inFight = state.fight !== null;
  const saveDisabled = signing || inFight || !isDirty;
  const saveTooltip = inFight
    ? "Locked — Save is disabled during an active fight"
    : signing
      ? "Saving…"
      : !isDirty
        ? "No unsaved changes"
        : `Save ${dirtySlots.size} slot change(s) on-chain`;

  const unallocatedPoints = effectiveUnallocatedPoints(
    character.unallocatedPoints,
    state.onChainCharacter?.unallocatedPoints,
  );
  const characterObjectId = state.onChainCharacter?.objectId;

  const eq: EquipmentSlots = state.pendingEquipment;
  const selectedItem = selectedSlot ? eq[selectedSlot] : null;

  const equippedPendingIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of Object.values(state.pendingEquipment)) {
      if (item) set.add(item.id);
    }
    return set;
  }, [state.pendingEquipment]);

  const effectiveLevel = Math.min(
    character.level,
    state.onChainCharacter?.level ?? character.level,
  );

  const pickerEntries = useMemo(() => {
    if (!selectedSlot) return [];
    return buildSlotPickerEntries(
      selectedSlot,
      state.inventory,
      state.onChainItems,
      equippedPendingIds,
      effectiveLevel,
      eq,
    );
  }, [
    selectedSlot,
    state.inventory,
    state.onChainItems,
    equippedPendingIds,
    effectiveLevel,
    eq,
  ]);

  function handleEquip(item: Item) {
    if (!selectedSlot) return;
    const currentItem = eq[selectedSlot] || null;
    stageEquip(item, selectedSlot, currentItem);
    setSelectedSlot(null);
  }
  function handleUnequip() {
    if (!selectedSlot) return;
    stageUnequip(selectedSlot);
    setSelectedSlot(null);
  }

  const derived = useMemo(
    () => computeDerivedStats(character.stats, eq, undefined, character.level),
    [character.stats, eq, character.level],
  );
  const archetype = getArchetype(character.stats);
  const archetypeColor = getArchetypeColor(archetype);

  // Save / Discard inline controls — rendered into the stat-column
  // header card so the Save action sits near the character identity.
  const saveControls = isDirty ? (
    <>
      <button
        type="button"
        onClick={() => void saveLoadout()}
        disabled={saveDisabled}
        title={saveTooltip}
        style={{
          fontFamily: "var(--font-ui)",
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: "var(--ls-button)",
          textTransform: "uppercase",
          padding: "7px 14px",
          border: `2px solid ${saveDisabled ? "var(--sc-rim-2)" : "var(--sc-bronze-deep)"}`,
          borderRadius: "var(--r-button)",
          background: saveDisabled ? "var(--sc-panel-2)" : "var(--sc-bronze)",
          color: saveDisabled ? "var(--fg-3)" : "var(--sc-page)",
          boxShadow: saveDisabled ? "none" : "var(--sh-plate-sm)",
          cursor: saveDisabled ? "not-allowed" : "pointer",
          opacity: saveDisabled ? 0.6 : 1,
        }}
      >
        {signing ? "Saving…" : `Save Loadout (${dirtySlots.size})`}
      </button>
      <button
        type="button"
        onClick={stageDiscard}
        disabled={signing}
        title="Discard staged changes, revert to last saved"
        style={{
          fontFamily: "var(--font-ui)",
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: "var(--ls-button)",
          textTransform: "uppercase",
          padding: "7px 12px",
          border: "1px solid var(--sc-rim-2)",
          borderRadius: "var(--r-button)",
          background: "var(--sc-page)",
          color: "var(--fg-2)",
          cursor: signing ? "not-allowed" : "pointer",
          opacity: signing ? 0.6 : 1,
        }}
      >
        Discard
      </button>
    </>
  ) : null;

  // Responsive layout regimes — drive both column ratios and the
  // EquipmentFrame scale factor from a single decision so the doll
  // never overflows its column.
  //
  //   xl (≥ 1440) — 3-col 36/42/22 layout. EquipmentFrame now uses the
  //                 extracted TWEAK_DEFAULTS (96/108/1fr grid) and keeps
  //                 a 520px max-width — it no longer needs a scale prop.
  //   lg (≥ 1024) — 2-col Equipment+Stats; Inventory + Recent Fights below
  //   md / sm     — single column stack
  const isXl = bpGte("xl", bp);
  const isLg = bpGte("lg", bp);

  const outerCols = isXl
    ? "36% 42% 22%"
    : isLg
      ? "minmax(0, 1fr) minmax(0, 1fr)"
      : "1fr";

  return (
    <>
      <ScreenLayout>
        <TopBanner
          title="Loadout"
          subtitle={
            <>
              Slot in your gear. The chain commits when you{" "}
              <strong style={{ color: "var(--sc-page)" }}>Save Loadout</strong>.
            </>
          }
          pill="onChain"
          tone="bronze"
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: outerCols,
            gap: 24,
            alignItems: "start",
          }}
        >
          {/* LEFT — Equipment Frame (36% at xl). Pixel-spec values
              live in TWEAK_DEFAULTS inside EquipmentFrame (96/108/1fr). */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <EquipmentFrame
              eq={eq}
              dirtySlots={dirtySlots}
              portrait={portrait}
              onSlot={(s) => setSelectedSlot(s)}
              onPortrait={() => setPickerOpen(true)}
              player={{ name: character.name, level: character.level, archetype }}
              hp={{ current: derived.maxHp, max: derived.maxHp }}
            />
          </div>

          {/* CENTER — Consolidated Center Info card (42% at xl).
              Combines header + Primary Attributes + Combat Stats +
              XP into one tall panel per the Claude Design target. */}
          <CenterInfoCard
            character={character}
            derived={derived}
            archetype={archetype}
            unallocatedPoints={unallocatedPoints}
            onAllocateClick={() => setShowAllocate(true)}
            saveControls={saveControls}
            equipment={eq}
          />

          {/* RIGHT — Inventory (22% at xl, hides at lg/md/sm and
              re-renders below). */}
          {isXl && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Inventory />
              {extras}
            </div>
          )}
        </div>

        {/* Recent Fights — full-width row below the 3-col grid. */}
        <RecentFights />

        {/* Below-fold inventory at lg/md/sm. */}
        {!isXl && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Inventory />
            {extras}
          </div>
        )}
      </ScreenLayout>

      {/* Modals — verbatim from prior pass */}
      {showAllocate && (
        <StatAllocateModal
          character={{ ...character, unallocatedPoints }}
          characterObjectId={characterObjectId}
          onClose={() => setShowAllocate(false)}
        />
      )}

      {selectedSlot && selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          onClose={() => setSelectedSlot(null)}
          actions={
            <button
              onClick={handleUnequip}
              style={{
                width: "100%",
                padding: "10px 14px",
                fontFamily: "var(--font-ui)",
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: "var(--ls-button)",
                textTransform: "uppercase",
                background: "var(--sc-blood)",
                color: "var(--sc-parchment)",
                border: "2px solid var(--sc-blood-deep)",
                borderRadius: "var(--r-button)",
                cursor: "pointer",
                boxShadow: "var(--sh-plate-sm)",
              }}
            >
              Unequip
            </button>
          }
        />
      )}

      {selectedSlot && !selectedItem && (
        <Modal
          open
          onClose={() => setSelectedSlot(null)}
          title={`${EQUIPMENT_SLOT_LABELS[selectedSlot]} — Choose Item`}
          wide
        >
          {pickerEntries.length === 0 ? (
            <p
              style={{
                color: "var(--fg-3)",
                fontSize: 13,
                textAlign: "center",
                padding: "16px 0",
                fontStyle: "italic",
                margin: 0,
              }}
            >
              No compatible items in inventory.
            </p>
          ) : (
            <div
              className="scroll-plate"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxHeight: 420,
                overflowY: "auto",
              }}
            >
              {pickerEntries.map(({ item, locked, lockedReason }) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onClick={locked ? undefined : () => handleEquip(item)}
                  locked={locked}
                  lockedReason={lockedReason}
                />
              ))}
            </div>
          )}
        </Modal>
      )}

      {pickerOpen && (
        <NftPortraitPicker
          current={portrait}
          onPick={commitPortrait}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Tailwind JIT pin */}
      <span style={{ display: "none" }} aria-hidden>
        {Object.values(RARITY_COLORS).join(" ")}
      </span>
    </>
  );
}
