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

const RARITY_BORDER_HEX: Record<Rarity, string> = {
  1: "var(--rarity-common)",
  2: "var(--rarity-uncommon)",
  3: "var(--rarity-rare)",
  4: "var(--rarity-epic)",
  5: "var(--rarity-legendary)",
};

/* ─────────────────────────── slot tile ─────────────────────────────── */

interface SlotTileProps {
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
}

function SlotTile({
  slot,
  item,
  future,
  futureLabel,
  size,
  isDirty,
  onClick,
  emptyLabel,
}: SlotTileProps) {
  const w = typeof size === "number" ? size : size.w;
  const h = typeof size === "number" ? size : size.h;
  const rarityColor = item ? RARITY_BORDER_HEX[item.rarity] : null;
  const title = future
    ? `${futureLabel ?? "Slot"} — unlocks in v5.1 contract bundle`
    : item
      ? `${item.name} (click to manage)`
      : slot
        ? `${EQUIPMENT_SLOT_LABELS[slot]} (click to equip)`
        : "Empty slot";
  return (
    <button
      type="button"
      onClick={future ? undefined : onClick}
      title={title}
      aria-label={title}
      style={{
        width: w,
        height: h,
        padding: 0,
        cursor: future ? "not-allowed" : "pointer",
        background: future ? "var(--sc-page)" : "var(--sc-panel-2)",
        border: `2px solid ${rarityColor ?? "var(--sc-rim-2)"}`,
        borderRadius: 2,
        opacity: future ? 0.35 : 1,
        boxShadow: isDirty
          ? "0 0 0 1px var(--sc-bronze), var(--rim-top), var(--rim-bottom), var(--sh-plate-sm)"
          : "var(--rim-top), var(--rim-bottom), var(--sh-plate-sm)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition:
          "transform var(--d-base) var(--ease-pop), border-color var(--d-fast), box-shadow var(--d-fast)",
        fontFamily: "var(--font-ui)",
        color: "var(--fg-3)",
      }}
      onMouseEnter={(e) => {
        if (future) return;
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
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              padding: 0,
              filter: "drop-shadow(0 2px 3px rgba(0,0,0,.55))",
            }}
          />
        ) : (
          <SlotGlyph size={Math.min(w, h) * 0.42} color={rarityColor ?? "var(--sc-ash)"} />
        )
      ) : (
        <SlotGlyph
          size={Math.min(w, h) * 0.36}
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
            fontFamily: "var(--font-ui)",
            fontSize: 9,
            fontWeight: 700,
            color: "var(--fg-3)",
            letterSpacing: ".10em",
            textTransform: "uppercase",
            textAlign: "center",
            lineHeight: 1,
            opacity: 0.55,
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
      <path
        d="M12 3 L12 21 M3 12 L21 12"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.55}
      />
    </svg>
  );
}

/* ─────────────────────────── HP bar ───────────────────────────────── */

function HpBar({
  current,
  max,
  width,
  height = 40,
}: {
  current: number;
  max: number;
  width: number;
  height?: number;
}) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        background: "var(--sc-page)",
        border: "2px solid var(--sc-bronze)",
        boxShadow: "var(--rim-top), inset 0 -2px 0 rgba(0,0,0,.55)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${pct}%`,
          background:
            "linear-gradient(180deg, #7ba84a 0%, #5a8a3a 50%, #3f6b29 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 0 rgba(0,0,0,.45)",
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
          fontFamily: "var(--font-display)",
          fontSize: 22,
          color: "var(--sc-parchment)",
          textShadow: "0 0 4px rgba(0,0,0,.9), 2px 2px 0 #000",
          letterSpacing: "0.02em",
          pointerEvents: "none",
        }}
      >
        {current.toLocaleString()} / {max.toLocaleString()}
      </div>
    </div>
  );
}

/* ──────────────────────── Portrait Frame ──────────────────────────── */

function PortraitFrame({
  portrait,
  onClick,
  width,
  height,
}: {
  portrait: NftCandidate | null;
  onClick: () => void;
  width: number;
  height: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        portrait
          ? `${portrait.name} — click to change`
          : "Click to set a portrait NFT"
      }
      style={{
        width,
        height,
        // 3:4 portrait ratio — explicit pixel height feeds this in,
        // CSS aspectRatio belt-and-suspenders so the frame stays
        // locked at vertical 3:4 if it ever resizes via flex/grid.
        aspectRatio: "3 / 4",
        padding: 0,
        cursor: "pointer",
        overflow: "hidden",
        background: portrait ? "var(--sc-page)" : "#080a0e",
        border: "2px solid var(--sc-bronze)",
        borderRadius: 0,
        boxShadow:
          "inset 0 0 0 1px rgba(0,0,0,.4), inset 0 2px 4px rgba(0,0,0,.6), var(--sh-plate-lg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        position: "relative",
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        transition: "border-color var(--d-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--sc-bronze-hot)";
      }}
      onMouseLeave={(e) => {
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
                fontSize: 48,
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
              color: "var(--sc-bronze)",
              background: "rgba(10,13,18,.85)",
              padding: "3px 10px",
              border: "1px solid var(--sc-bronze)",
            }}
          >
            Portrait
          </span>
        </>
      ) : (
        <>
          <div
            style={{
              width: 80,
              height: 80,
              border: "2px solid var(--sc-bronze)",
              color: "var(--sc-bronze)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.6,
              fontSize: 44,
              fontWeight: 300,
              lineHeight: 1,
            }}
            aria-hidden
          >
            +
          </div>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: ".18em",
              textTransform: "uppercase",
              color: "var(--sc-ash)",
              textAlign: "center",
            }}
          >
            Place your NFT here
          </div>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              color: "var(--sc-ash-2)",
              textAlign: "center",
              maxWidth: 280,
              lineHeight: 1.45,
              marginTop: -6,
            }}
          >
            Click to choose a portrait —<br />
            cosmetic only
          </div>
        </>
      )}
    </button>
  );
}

/* ──────────────────────── Tribal ornament ────────────────────────── */

function TribalOrnament({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{
        width,
        height,
        background: "var(--sc-panel-3)",
        border: "1px solid var(--sc-bronze-deep)",
        boxShadow:
          "var(--rim-top), inset 0 -2px 0 rgba(0,0,0,.55), inset 0 0 0 1px rgba(200,154,63,.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
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

function FrameTitle({
  name,
  level,
  archetype,
}: {
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
        gap: 12,
        padding: "12px 0",
        fontFamily: "var(--font-ui)",
      }}
    >
      <svg
        width={26}
        height={26}
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
          fontSize: 32,
          lineHeight: 1,
          color: "var(--sc-bronze)",
          letterSpacing: "0.02em",
        }}
        title={`${archetype} archetype`}
      >
        {name}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 20,
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
          width: 26,
          height: 26,
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
          fontSize: 16,
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

function RecentFights() {
  const { state } = useGame();
  const account = useCurrentAccount();
  const { fightHistory } = state;

  useEffect(() => {
    if (!state.socket.authenticated) return;
    state.socket.send({ type: "get_fight_history" });
  }, [state.socket]);

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
        <SectionHeader title="Recent fights" />
        <p
          style={{
            color: "var(--fg-3)",
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
      <SectionHeader title="Recent fights" />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {fightHistory.slice(0, 8).map((fight, i) => {
          const won = fight.winner === account?.address;
          const isA = fight.playerA.walletAddress === account?.address;
          const opponent = isA ? fight.playerB : fight.playerA;
          const isLast = i === Math.min(7, fightHistory.length - 1);
          return (
            <div
              key={fight.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto",
                alignItems: "center",
                gap: 16,
                padding: "12px 14px",
                borderBottom: isLast ? "none" : "1px solid var(--sc-rim)",
                background: "transparent",
                fontFamily: "var(--font-ui)",
              }}
            >
              {/* WIN / LOSS stamp */}
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontWeight: 800,
                  fontSize: 11,
                  letterSpacing: "var(--ls-stamp)",
                  textTransform: "uppercase",
                  padding: "5px 12px",
                  background: won ? "var(--rarity-uncommon)" : "var(--sc-blood)",
                  color: "var(--sc-parchment)",
                  border: `1px solid ${
                    won ? "var(--rarity-uncommon)" : "var(--sc-blood-deep)"
                  }`,
                  borderRadius: "var(--r-sm)",
                  minWidth: 56,
                  textAlign: "center",
                }}
              >
                {won ? "Win" : "Loss"}
              </span>
              {/* Opponent name */}
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                vs <span style={{ color: "var(--sc-parchment)" }}>{opponent.name}</span>
              </span>
              {/* Turn count / fight type */}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 12,
                  color: "var(--fg-3)",
                  minWidth: 60,
                  textAlign: "right",
                }}
              >
                {fight.turns} turns
              </span>
              {/* Outcome note */}
              <span
                style={{
                  fontSize: 12,
                  color: fight.wagerAmount
                    ? "var(--sc-bronze)"
                    : "var(--fg-3)",
                  fontFamily: "var(--font-mono)",
                  fontWeight: fight.wagerAmount ? 800 : 600,
                  minWidth: 140,
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
 * The big bronze-rimmed frame. Sized at the 1024px reference width
 * directly — the parent container clamps total content width via
 * `ScreenLayout`'s 1440px max, and the right-side stat column floats
 * next to it at xl viewports.
 *
 * Pixel spec recap (all at 1024px reference):
 *   side col width = 216
 *   center col width = 462
 *   gap = 6
 *   big slot = 216×216
 *   belt = 216×102
 *   3-ring row = 3 × 64 with gaps → fills 216 width
 *   HP bar = 462×40
 *   portrait = 462×462 (square)
 *   ornament = 462×120
 *   frame inner padding = 14
 */

function EquipmentFrame({
  eq,
  dirtySlots,
  portrait,
  onSlot,
  onPortrait,
  player,
  hp,
  scale = 1,
}: {
  eq: EquipmentSlots;
  dirtySlots: Set<keyof EquipmentSlots>;
  portrait: NftCandidate | null;
  onSlot: (slot: keyof EquipmentSlots) => void;
  onPortrait: () => void;
  player: { name: string; level: number; archetype: string };
  hp: { current: number; max: number };
  /** Multiplier applied to every tile + portrait + gap dimension.
   *  1.0 = the canonical 1024px reference (BIG=216, CENTER=462).
   *  0.55 ≈ 498px total frame width — fits the 36% column at
   *  1440px viewport (~520px column inner). Aspect ratios stay
   *  locked because every pixel constant flows through `scale`. */
  scale?: number;
}) {
  // Canonical pixel spec — see file-header doc comment.
  const round = (n: number) => Math.round(n * scale);
  const BIG = round(216);
  const RING = round(64);
  const BELT_H = round(102);
  const CENTER = round(462);
  const GAP = Math.max(4, round(6));
  const PAD = Math.max(8, round(14));
  // Phase 2-fix: NFT portrait is a 3:4 vertical rectangle, not a
  // square — width stays at CENTER, height grows by 4/3 so vertical
  // NFT art shows beautifully and the empty-state plus stack stays
  // visually centered. Belt/Boots row alignment is enforced by the
  // SIDE_ROWS template below.
  const PORTRAIT_W = CENTER;
  const PORTRAIT_H = Math.round(CENTER * 4 / 3);
  // Side columns share one explicit grid-template-rows track list so
  // every row Y-origin is identical on both sides. Row 5 is BIG-tall
  // to give boots its full square; belt anchors top-of-row inside it.
  const SIDE_ROWS = `${BIG}px ${BIG}px ${BIG}px ${BIG}px ${BIG}px`;

  return (
    <div style={{ width: "fit-content", maxWidth: "100%" }}>
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
            "0 0 0 1px var(--sc-rim) inset, var(--sh-plate-lg), var(--rim-top)",
          padding: PAD,
          display: "grid",
          gridTemplateColumns: `${BIG}px ${CENTER}px ${BIG}px`,
          gridTemplateRows: "auto auto auto",
          columnGap: GAP,
          rowGap: GAP,
        }}
      >
        {/* HP bar — spans all 3 cols */}
        <div style={{ gridColumn: "1 / -1" }}>
          <HpBar
            current={hp.current}
            max={hp.max}
            width={BIG + GAP + CENTER + GAP + BIG}
            height={Math.max(22, round(40))}
          />
        </div>

        {/* LEFT COLUMN — explicit grid rows so each row's Y origin
            matches the right column. Belt sits at the top of row 5
            (BIG-tall track) leaving its shorter footprint anchored
            level with the boots top edge on the right. */}
        <div
          style={{
            gridColumn: 1,
            gridRow: 2,
            display: "grid",
            gridTemplateRows: SIDE_ROWS,
            rowGap: GAP,
          }}
        >
          <SlotTile
            slot="helmet"
            item={eq.helmet}
            size={BIG}
            isDirty={dirtySlots.has("helmet")}
            onClick={() => onSlot("helmet")}
            emptyLabel="Helmet"
          />
          <SlotTile
            slot={null}
            item={null}
            future
            futureLabel="Bracers"
            size={BIG}
          />
          <SlotTile
            slot="weapon"
            item={eq.weapon}
            size={BIG}
            isDirty={dirtySlots.has("weapon")}
            onClick={() => onSlot("weapon")}
            emptyLabel="Weapon"
          />
          <SlotTile
            slot="chest"
            item={eq.chest}
            size={BIG}
            isDirty={dirtySlots.has("chest")}
            onClick={() => onSlot("chest")}
            emptyLabel="Chest"
          />
          {/* Belt is shorter than other tiles — anchor it to the top
              of its BIG-tall row track so its top edge is level with
              the boots top edge on the right column. */}
          <div style={{ alignSelf: "start" }}>
            <SlotTile
              slot="belt"
              item={eq.belt}
              size={{ w: BIG, h: BELT_H }}
              isDirty={dirtySlots.has("belt")}
              onClick={() => onSlot("belt")}
              emptyLabel="Belt"
            />
          </div>
        </div>

        {/* CENTER COLUMN — portrait stretches to fill remaining height */}
        <div
          style={{
            gridColumn: 2,
            gridRow: 2,
            display: "flex",
            flexDirection: "column",
            gap: GAP,
            alignItems: "stretch",
          }}
        >
          <PortraitFrame
            portrait={portrait}
            onClick={onPortrait}
            width={PORTRAIT_W}
            height={PORTRAIT_H}
          />
          <TribalOrnament width={CENTER} height={Math.max(60, round(120))} />
          {/* Spacer to push ornament down so the column heights match
              roughly. Left col total = 4*216 + 102 + 4*6 = 990; center
              total so far = 462 + 6 + 120 = 588; ring-row + spacer
              calibration covers the remaining ~402 by making the
              right col absorb. We add a fixed spacer when the right
              column has extra slots beyond the ring row. */}
          <div style={{ flex: 1, minHeight: 4 }} />
        </div>

        {/* RIGHT COLUMN — same explicit grid track as the left so
            every row aligns. Row 2 contains the 3-ring cluster
            (RING-tall) centered vertically inside its BIG-tall row
            so it lines up with bracers (left col row 2). */}
        <div
          style={{
            gridColumn: 3,
            gridRow: 2,
            display: "grid",
            gridTemplateRows: SIDE_ROWS,
            rowGap: GAP,
          }}
        >
          <SlotTile
            slot="necklace"
            item={eq.necklace}
            size={BIG}
            isDirty={dirtySlots.has("necklace")}
            onClick={() => onSlot("necklace")}
            emptyLabel="Necklace"
          />
          {/* Ring cluster — 3 small tiles in a row, BIG wide, RING
              tall. alignSelf: center vertically anchors the 64-tall
              cluster in the middle of the BIG-tall row track so its
              centerline matches bracers on the left. */}
          <div
            style={{
              alignSelf: "center",
              width: BIG,
              height: RING,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: GAP,
            }}
          >
            <SlotTile
              slot="ring1"
              item={eq.ring1}
              size={{ w: (BIG - GAP * 2) / 3, h: RING }}
              isDirty={dirtySlots.has("ring1")}
              onClick={() => onSlot("ring1")}
            />
            <SlotTile
              slot="ring2"
              item={eq.ring2}
              size={{ w: (BIG - GAP * 2) / 3, h: RING }}
              isDirty={dirtySlots.has("ring2")}
              onClick={() => onSlot("ring2")}
            />
            <SlotTile
              slot={null}
              item={null}
              future
              futureLabel="Ring 3"
              size={{ w: (BIG - GAP * 2) / 3, h: RING }}
            />
          </div>
          <SlotTile
            slot="gloves"
            item={eq.gloves}
            size={BIG}
            isDirty={dirtySlots.has("gloves")}
            onClick={() => onSlot("gloves")}
            emptyLabel="Gloves"
          />
          <SlotTile
            slot="offhand"
            item={eq.offhand}
            size={BIG}
            isDirty={dirtySlots.has("offhand")}
            onClick={() => onSlot("offhand")}
            emptyLabel="Off-hand"
          />
          <SlotTile
            slot="boots"
            item={eq.boots}
            size={BIG}
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
}

const ARCHETYPE_TONE: Record<string, "blood" | "steel" | "bronze" | "default"> = {
  Crit: "blood",
  Evasion: "steel",
  Tank: "bronze",
  Hybrid: "default",
};

function CenterInfoCard({
  character,
  derived,
  archetype,
  unallocatedPoints,
  onAllocateClick,
  saveControls,
}: CenterInfoCardProps) {
  const xpInLevel = getXpInCurrentLevel(character.level, character.xp);
  const xpSpan = getXpSpanForLevel(character.level);
  const xpProgress = getXpProgress(character.level, character.xp);
  const isMaxLevel = character.level >= MAX_LEVEL;
  const winRate =
    character.wins + character.losses > 0
      ? Math.round((character.wins / (character.wins + character.losses)) * 100)
      : 0;

  const eq = (character as unknown as { equipment?: EquipmentSlots }).equipment ?? null;
  const strBonus = eq ? sumEquipmentStat(eq, "strengthBonus") : 0;
  const dexBonus = eq ? sumEquipmentStat(eq, "dexterityBonus") : 0;
  const intBonus = eq ? sumEquipmentStat(eq, "intuitionBonus") : 0;
  const endBonus = eq ? sumEquipmentStat(eq, "enduranceBonus") : 0;

  const statRows: Array<{
    label: string;
    base: number;
    bonus: number;
    color: string;
    icon: string;
  }> = [
    { label: "STR", base: character.stats.strength, bonus: strBonus, color: "var(--stat-str)", icon: "⚔" },
    { label: "DEX", base: character.stats.dexterity, bonus: dexBonus, color: "var(--stat-dex)", icon: "⚡" },
    { label: "INT", base: character.stats.intuition, bonus: intBonus, color: "var(--stat-int)", icon: "✦" },
    { label: "END", base: character.stats.endurance, bonus: endBonus, color: "var(--stat-end)", icon: "❖" },
  ];

  const combatGrid: Array<[string, string | number, string]> = [
    ["HP", derived.maxHp, "var(--stat-hp)"],
    ["ATK", derived.attackPower, "var(--sc-blood)"],
    ["CRIT", `${derived.critChance}%`, "var(--stat-int)"],
    ["CRIT ×", `${derived.critMultiplier}x`, "var(--stat-int)"],
    ["EVADE", `${derived.evasionChance}%`, "var(--stat-dex)"],
    ["ARMOR", derived.armor, "var(--sc-steel)"],
    ["DEF", derived.defense, "var(--sc-bronze)"],
    ["LV", character.level, "var(--sc-parchment)"],
  ];

  const archetypeTone = ARCHETYPE_TONE[archetype] ?? "default";

  return (
    <div
      style={{
        background: "var(--sc-panel)",
        border: "1px solid var(--sc-rim)",
        borderRadius: "var(--r-card)",
        boxShadow: "var(--sh-plate-lg), var(--rim-top), var(--rim-bottom)",
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        minWidth: 0,
      }}
    >
      {/* Header row — archetype + "+N pts" / save controls */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Stamp tone={archetypeTone}>{archetype}</Stamp>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {unallocatedPoints > 0 && (
            <BronzeButton size="sm" onClick={onAllocateClick}>
              + {unallocatedPoints} pts
            </BronzeButton>
          )}
          {saveControls}
        </div>
      </div>

      {/* Slackey character name */}
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: 44,
          lineHeight: 1.0,
          color: "var(--sc-bronze)",
          letterSpacing: "0.01em",
          wordBreak: "break-word",
        }}
      >
        {character.name}
      </h2>

      {/* Lv + ELO + W/L summary */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Stamp tone="bronze">Lv {character.level}</Stamp>
        <Stamp tone="default" outline>
          {character.rating} ELO
        </Stamp>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--fg-3)",
            fontWeight: 700,
            letterSpacing: ".02em",
          }}
        >
          {character.wins}w · {character.losses}l · {winRate}%
        </span>
      </div>

      {/* Primary Attributes */}
      <div>
        <SectionLabel>Primary Attributes</SectionLabel>
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
                    gap: 6,
                    width: 72,
                    color: row.color,
                    fontWeight: 800,
                    fontSize: 11,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                  }}
                >
                  <span style={{ fontSize: 12, opacity: 0.85 }}>{row.icon}</span>
                  {row.label}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 8,
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
                    minWidth: 56,
                    textAlign: "right",
                  }}
                >
                  {row.bonus > 0 ? (
                    <>
                      {row.base}
                      <span
                        style={{
                          color: "var(--rarity-uncommon)",
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

      {/* Combat Stats — 4-col grid, 2 rows */}
      <div>
        <SectionLabel>Combat Stats</SectionLabel>
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
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--fg-3)",
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
                  fontWeight: 800,
                  fontSize: 18,
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

      {/* XP bar */}
      <div>
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
}: {
  character: Character;
  derived: ReturnType<typeof computeDerivedStats>;
  archetype: string;
  archetypeColor: string;
  unallocatedPoints: number;
  onAllocateClick: () => void;
  saveControls?: ReactNode;
  characterEloDelta?: string;
}) {
  const winRate =
    character.wins + character.losses > 0
      ? Math.round((character.wins / (character.wins + character.losses)) * 100)
      : 0;
  const xpInLevel = getXpInCurrentLevel(character.level, character.xp);
  const xpSpan = getXpSpanForLevel(character.level);
  const xpProgress = getXpProgress(character.level, character.xp);
  const isMaxLevel = character.level >= MAX_LEVEL;

  const eq = (character as unknown as { equipment?: EquipmentSlots }).equipment ?? null;
  const strBonus = eq ? sumEquipmentStat(eq, "strengthBonus") : 0;
  const dexBonus = eq ? sumEquipmentStat(eq, "dexterityBonus") : 0;
  const intBonus = eq ? sumEquipmentStat(eq, "intuitionBonus") : 0;
  const endBonus = eq ? sumEquipmentStat(eq, "enduranceBonus") : 0;

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
  //   xl (≥ 1440) — 3-col 36/42/22, frame scaled 0.55 (498px wide,
  //                 fits the ~520px column inner)
  //   lg (≥ 1024) — 2-col Equipment+Stats; Inventory + Recent Fights
  //                 stack below. Frame scale 0.6.
  //   md / sm     — single column stack; frame scales down further.
  const isXl = bpGte("xl", bp);
  const isLg = bpGte("lg", bp);
  const frameScale = isXl ? 0.55 : isLg ? 0.6 : bpGte("md", bp) ? 0.7 : 0.8;

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
          {/* LEFT — Equipment Frame (36% at xl). Scale factor keeps
              the canonical pixel spec proportional while fitting the
              narrower column.  */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <EquipmentFrame
              eq={eq}
              dirtySlots={dirtySlots}
              portrait={portrait}
              onSlot={(s) => setSelectedSlot(s)}
              onPortrait={() => setPickerOpen(true)}
              player={{ name: character.name, level: character.level, archetype }}
              hp={{ current: derived.maxHp, max: derived.maxHp }}
              scale={frameScale}
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
