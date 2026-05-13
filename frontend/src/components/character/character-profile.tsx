"use client";

/**
 * Character screen — Phase 2 redesign.
 *
 * Reference: design_v2/character_layout_reference.jpeg (hand-mocked by
 * the user). Replaces the v1 doll silhouette with a combats.ru-style
 * border frame — 10 canonical equipment slots tucked tight around a
 * tall central NFT portrait, plus three ghosted v5.1-future slots
 * (Bracers / Ring 3 / Pants) reserved in-grid so the contract upgrade
 * can light them up without restructure.
 *
 * Slot map (matching reference image):
 *   LEFT column  (top → bottom):  Helmet · Gloves · Weapon · Chest
 *   RIGHT column (top → bottom):  Necklace · [Ring1 Ring2 Ring3*] · Bracers* · Off-hand · Pants*
 *   BOTTOM row   (left → right):  Belt · TribalOrnament · Boots
 *   *  = v5.1 future slot — rendered as ghosted placeholder.
 *
 * Functionality preserved verbatim from v1:
 *   - useEquipmentActions (stage/unstage/save/discard)
 *   - StatAllocateModal modal-controller boolean + pendingStatAllocate bridge
 *   - ItemDetailModal + ItemCard picker modals
 *   - Dirty-slot rings + corner dots
 *   - 2H Path A locks via buildSlotPickerEntries
 *   - effectiveUnallocatedPoints chain-clamp (BUG 1, 2026-05-02)
 *
 * New functionality (Phase 2):
 *   - NFT portrait picker — cosmetic only, localStorage-persisted per wallet
 *   - HP bar across top of frame
 *   - Title bar: crest + name + level + info icon (above frame)
 *
 * Visual rules (Forged Metal design system):
 *   - All colors via CSS vars from design-tokens-v2.css
 *   - Hard borders + flat plate shadows; no gradients on chrome
 *   - Rarity-coloured 2px slot borders when filled
 *   - Bronze double-rim frame; gunmetal slot fill
 */

import { useEffect, useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Badge } from "@/components/ui/badge";
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

/* Map Tailwind rarity tokens (existing `text-purple-400` family) into
 * the v2 metal rarity ramp. The rest of the codebase still uses the
 * Tailwind colors; this keeps the slot border rarity colors visually
 * consistent with the rest of the v2 system. */
const RARITY_BORDER_HEX: Record<Rarity, string> = {
  1: "var(--rarity-common)",
  2: "var(--rarity-uncommon)",
  3: "var(--rarity-rare)",
  4: "var(--rarity-epic)",
  5: "var(--rarity-legendary)",
};

/* ─────────────────────────── slot tile ─────────────────────────────── */

interface SlotTileProps {
  /** Canonical slot key, OR null for v5.1-future placeholders. */
  slot: keyof EquipmentSlots | null;
  item: Item | null;
  /** When true, this slot is reserved for a v5.1 contract slot and
   *  renders ghosted + non-interactive with a "v5.1" badge. */
  future?: boolean;
  /** Future-slot label (for tooltip + future-slot ghost text). */
  futureLabel?: string;
  /** Pixel dimensions — the grid sizes individual tiles for the
   *  rectangular body-armor pieces vs square rings. */
  w: number;
  h: number;
  isDirty?: boolean;
  onClick?: () => void;
  /** Optional slot-name label for empty active slots — appears as a
   *  faint stamp in the bottom-left so first-time players know what
   *  goes where. */
  emptyLabel?: string;
}

function SlotTile({
  slot,
  item,
  future,
  futureLabel,
  w,
  h,
  isDirty,
  onClick,
  emptyLabel,
}: SlotTileProps) {
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              padding: 4,
              filter: "drop-shadow(0 2px 2px rgba(0,0,0,.5))",
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
            bottom: 2,
            right: 3,
            fontFamily: "var(--font-mono)",
            fontSize: 8,
            fontWeight: 700,
            color: "var(--sc-bronze)",
            letterSpacing: ".06em",
            background: "rgba(10,13,18,.85)",
            padding: "1px 4px",
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
            bottom: 3,
            left: 4,
            right: 4,
            fontFamily: "var(--font-ui)",
            fontSize: 8,
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
            width: 9,
            height: 9,
            borderRadius: 999,
            background: "var(--sc-bronze)",
            boxShadow: "0 0 6px var(--sc-bronze-hot)",
          }}
        />
      )}
    </button>
  );
}

/* Empty-slot glyph — a faint cross/diamond. Pure SVG so it scales with
 * the tile size. */
function SlotGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3 L12 21 M3 12 L21 12"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        opacity={0.6}
      />
    </svg>
  );
}

/* ─────────────────────────── HP bar ───────────────────────────────── */

function HpBar({ current, max }: { current: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  return (
    <div
      style={{
        position: "relative",
        height: 26,
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
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 13,
          color: "var(--sc-parchment)",
          textShadow: "0 0 4px rgba(0,0,0,.9), 1px 1px 0 #000",
          letterSpacing: "0.06em",
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
}: {
  portrait: NftCandidate | null;
  onClick: () => void;
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
        flex: 1,
        minHeight: 0,
        width: "100%",
        padding: 0,
        cursor: "pointer",
        overflow: "hidden",
        background: portrait ? "var(--sc-page)" : "#080a0e",
        border: "2px solid var(--sc-bronze)",
        borderRadius: 0,
        boxShadow:
          "inset 0 0 0 1px rgba(0,0,0,.4), inset 0 2px 4px rgba(0,0,0,.6), var(--sh-plate-sm)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
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
            // eslint-disable-next-line @next/next/no-img-element
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
              left: 6,
              top: 6,
              fontFamily: "var(--font-ui)",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--sc-bronze)",
              background: "rgba(10,13,18,.85)",
              padding: "3px 8px",
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
              width: 64,
              height: 64,
              border: "2px solid var(--sc-bronze)",
              color: "var(--sc-bronze)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.6,
              fontSize: 32,
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
              fontSize: 14,
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
              fontSize: 11,
              color: "var(--sc-ash-2)",
              textAlign: "center",
              maxWidth: 220,
              lineHeight: 1.45,
              marginTop: -8,
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

function TribalOrnament() {
  return (
    <div
      style={{
        flex: 1,
        height: "100%",
        minHeight: 56,
        background: "var(--sc-panel-3)",
        border: "1px solid var(--sc-rim-2)",
        boxShadow: "var(--rim-top), inset 0 -1px 0 rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
      aria-hidden
    >
      <svg
        viewBox="0 0 360 60"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        fill="none"
      >
        <g
          stroke="var(--sc-rim-2)"
          strokeWidth={1.5}
          strokeLinecap="round"
        >
          {/* Left flourish */}
          <path d="M40 30 Q 80 8 130 22 Q 160 30 170 30" />
          <path d="M40 30 Q 80 52 130 38 Q 160 30 170 30" />
          <path d="M70 12 L 60 24 M 90 18 L 78 28 M 50 18 L 62 30" />
          {/* Right flourish (mirrored) */}
          <path d="M320 30 Q 280 8 230 22 Q 200 30 190 30" />
          <path d="M320 30 Q 280 52 230 38 Q 200 30 190 30" />
          <path d="M290 12 L 300 24 M 270 18 L 282 28 M 310 18 L 298 30" />
        </g>
        <g stroke="var(--sc-bronze)" strokeWidth={1.5} fill="none">
          <circle cx="180" cy="30" r="14" />
          <circle cx="180" cy="30" r="9" />
        </g>
        <text
          x="180"
          y="34"
          textAnchor="middle"
          fontFamily="var(--font-display)"
          fontSize="13"
          fill="var(--sc-bronze)"
          letterSpacing="1"
        >
          SUI
        </text>
      </svg>
    </div>
  );
}

/* ──────────────────────── Title bar ──────────────────────────────── */

function TitleBar({
  name,
  level,
  archetype,
  archetypeColor,
}: {
  name: string;
  level: number;
  archetype: string;
  archetypeColor: string;
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
          fontSize: 28,
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
          fontSize: 13,
          fontStyle: "italic",
          borderRadius: 2,
        }}
      >
        i
      </button>
      <span
        className={archetypeColor}
        style={{
          fontFamily: "var(--font-ui)",
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: ".10em",
          textTransform: "uppercase",
          marginLeft: 4,
        }}
      >
        {archetype}
      </span>
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

/* ─────────────────────── Main component ──────────────────────────── */

export function CharacterProfile({
  character,
}: {
  character: Character;
  /** Compact mode (legacy prop kept for back-compat — Phase 2 ignores it,
   *  the layout now adapts via container width). */
  compact?: boolean;
}) {
  const { state, dispatch } = useGame();
  const account = useCurrentAccount();
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
  const [selectedSlot, setSelectedSlot] = useState<keyof EquipmentSlots | null>(
    null,
  );

  // Portrait state — local React + persisted via localStorage in
  // lib/nft-portrait.ts. Re-read whenever the connected wallet changes
  // so swapping wallets in the same browser picks up that wallet's
  // saved choice instead of leaking the prior wallet's portrait.
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

  // Bridge from LevelUpModal "Allocate Stat Points" CTA → this
  // component's existing modal-controller boolean (Fix 3, 2026-05-04).
  useEffect(() => {
    if (state.pendingStatAllocate) {
      setShowAllocate(true);
      dispatch({ type: "SET_PENDING_STAT_ALLOCATE", pending: false });
    }
  }, [state.pendingStatAllocate, dispatch]);

  // Saving is blocked during an active fight (the on-chain fight-lock
  // DOF would abort the save PTB anyway — this pre-empts the wallet
  // popup).
  const inFight = state.fight !== null;
  const saveDisabled = signing || inFight || !isDirty;
  const saveTooltip = inFight
    ? "Locked — Save is disabled during an active fight"
    : signing
      ? "Saving…"
      : !isDirty
        ? "No unsaved changes"
        : `Save ${dirtySlots.size} slot change(s) on-chain`;

  // BUG 1 (live test 2026-05-02): the modal's "+N to allocate" must
  // reflect chain truth, not the server's optimistic post-fight value,
  // otherwise clicking Allocate stages a tx that aborts with
  // ENotEnoughPoints. The helper takes min(server, chain) when chain
  // has been hydrated.
  const unallocatedPoints = effectiveUnallocatedPoints(
    character.unallocatedPoints,
    state.onChainCharacter?.unallocatedPoints,
  );
  const characterObjectId = state.onChainCharacter?.objectId;

  // Display pendingEquipment (what the user WANTS). Committed is the
  // chain truth; combat uses committed (D4 — fight-room.ts re-reads
  // DOFs). The doll slots show pending so staged changes are visible
  // immediately without waiting for a Save Loadout tx.
  const eq: EquipmentSlots = state.pendingEquipment;
  const selectedItem = selectedSlot ? eq[selectedSlot] : null;

  // Items already slotted in pending — hidden from the picker.
  const equippedPendingIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of Object.values(state.pendingEquipment)) {
      if (item) set.add(item.id);
    }
    return set;
  }, [state.pendingEquipment]);

  // Effective equip level = min(server.level, onChain.level). Server
  // level can be ahead of chain (pre-revert test-XP drift). Used by
  // buildSlotPickerEntries to flag locked items.
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
  const xpInLevel = getXpInCurrentLevel(character.level, character.xp);
  const xpSpan = getXpSpanForLevel(character.level);
  const xpProgress = getXpProgress(character.level, character.xp);
  const isMaxLevel = character.level >= MAX_LEVEL;
  const winRate =
    character.wins + character.losses > 0
      ? Math.round((character.wins / (character.wins + character.losses)) * 100)
      : 0;

  // Equipment bonuses per stat
  const strBonus = sumEquipmentStat(eq, "strengthBonus");
  const dexBonus = sumEquipmentStat(eq, "dexterityBonus");
  const intBonus = sumEquipmentStat(eq, "intuitionBonus");
  const endBonus = sumEquipmentStat(eq, "enduranceBonus");

  // Tailwind v4's JIT scanner doesn't evaluate runtime string ops like
  // `color.replace("text-", "bg-")` — carry the literal bg-* token
  // alongside the text-* token so STR/DEX/INT/END bars all compile.
  const statRows: [string, number, number, string, string][] = [
    ["STR", character.stats.strength, strBonus, "text-red-400", "bg-red-400"],
    ["DEX", character.stats.dexterity, dexBonus, "text-cyan-400", "bg-cyan-400"],
    ["INT", character.stats.intuition, intBonus, "text-purple-400", "bg-purple-400"],
    ["END", character.stats.endurance, endBonus, "text-amber-400", "bg-amber-400"],
  ];

  // Slot dimensions — rectangular for body armor, square-ish for jewelry.
  // Big slot ratio matches the reference image (≈ 1 : 1.13 W:H).
  // The numbers are hand-tuned for a comfortable density on a 1280px
  // viewport; the central portrait fills whatever remains.
  const BIG_W = 88;
  const BIG_H = 100;
  const RING_W = 40;
  const RING_H = 40;
  const BOT_W = 88;
  const BOT_H = 64;
  const COL_GAP = 6;
  const SLOT_GAP = 5;

  // HP derived from combat stats. Server doesn't currently expose
  // current-HP outside a fight; we show full HP on the doll which is
  // the correct out-of-combat reading.
  const hpCurrent = derived.maxHp;
  const hpMax = derived.maxHp;

  return (
    <>
      <div
        style={{
          background: "var(--sc-panel)",
          border: "1px solid var(--sc-rim)",
          boxShadow: "var(--sh-plate-lg), var(--rim-top), var(--rim-bottom)",
          overflow: "hidden",
        }}
      >
        {/* ── Top header — name/level + save/discard + ELO ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderBottom: "1px solid var(--sc-rim)",
            background: "var(--sc-panel-2)",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--font-ui)",
                fontWeight: 800,
                fontSize: 14,
                color: "var(--sc-parchment)",
                letterSpacing: "0.01em",
              }}
            >
              {character.name}
            </h2>
            <Badge variant="info">Lv.{character.level}</Badge>
            <span
              className={archetypeColor}
              style={{
                fontFamily: "var(--font-ui)",
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: ".08em",
                textTransform: "uppercase",
              }}
            >
              {archetype}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isDirty && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void saveLoadout();
                  }}
                  disabled={saveDisabled}
                  title={saveTooltip}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: "var(--ls-button)",
                    textTransform: "uppercase",
                    padding: "6px 12px",
                    border: `2px solid ${saveDisabled ? "var(--sc-rim-2)" : "var(--sc-bronze-deep)"}`,
                    borderRadius: "var(--r-button)",
                    background: saveDisabled
                      ? "var(--sc-panel-2)"
                      : "var(--sc-bronze)",
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
                    padding: "6px 10px",
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
            )}
            <Badge variant="warning">{character.rating} ELO</Badge>
          </div>
        </div>

        {/* ── Title bar with crest + name (display font) ── */}
        <TitleBar
          name={character.name}
          level={character.level}
          archetype={archetype}
          archetypeColor={archetypeColor}
        />

        {/* ── The Forged Frame ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: 18,
            padding: "0 16px 14px",
            alignItems: "start",
          }}
        >
          {/* Equipment frame — left side, fills its column width */}
          <div
            style={{
              background: "var(--sc-panel)",
              border: "2px solid var(--sc-bronze-deep)",
              boxShadow:
                "0 0 0 1px var(--sc-rim) inset, var(--sh-plate-lg)",
              padding: 10,
              display: "grid",
              gridTemplateColumns: `${BIG_W}px 1fr ${BIG_W}px`,
              gridTemplateRows: "auto 1fr auto",
              columnGap: COL_GAP,
              rowGap: SLOT_GAP,
              width: "fit-content",
            }}
          >
            {/* HP bar — spans all 3 cols */}
            <div style={{ gridColumn: "1 / -1" }}>
              <HpBar current={hpCurrent} max={hpMax} />
            </div>

            {/* Left column */}
            <div
              style={{
                gridColumn: 1,
                gridRow: 2,
                display: "flex",
                flexDirection: "column",
                gap: SLOT_GAP,
              }}
            >
              <SlotTile
                slot="helmet"
                item={eq.helmet}
                w={BIG_W}
                h={BIG_H}
                isDirty={dirtySlots.has("helmet")}
                onClick={() => setSelectedSlot("helmet")}
                emptyLabel="Helmet"
              />
              <SlotTile
                slot="gloves"
                item={eq.gloves}
                w={BIG_W}
                h={BIG_H}
                isDirty={dirtySlots.has("gloves")}
                onClick={() => setSelectedSlot("gloves")}
                emptyLabel="Gloves"
              />
              <SlotTile
                slot="weapon"
                item={eq.weapon}
                w={BIG_W}
                h={BIG_H}
                isDirty={dirtySlots.has("weapon")}
                onClick={() => setSelectedSlot("weapon")}
                emptyLabel="Weapon"
              />
              <SlotTile
                slot="chest"
                item={eq.chest}
                w={BIG_W}
                h={BIG_H}
                isDirty={dirtySlots.has("chest")}
                onClick={() => setSelectedSlot("chest")}
                emptyLabel="Chest"
              />
            </div>

            {/* Center column — portrait fills the rest */}
            <div
              style={{
                gridColumn: 2,
                gridRow: 2,
                display: "flex",
                flexDirection: "column",
                minHeight: BIG_H * 4 + SLOT_GAP * 3,
                minWidth: 220,
              }}
            >
              <PortraitFrame
                portrait={portrait}
                onClick={() => setPickerOpen(true)}
              />
            </div>

            {/* Right column */}
            <div
              style={{
                gridColumn: 3,
                gridRow: 2,
                display: "flex",
                flexDirection: "column",
                gap: SLOT_GAP,
              }}
            >
              <SlotTile
                slot="necklace"
                item={eq.necklace}
                w={BIG_W}
                h={BIG_H}
                isDirty={dirtySlots.has("necklace")}
                onClick={() => setSelectedSlot("necklace")}
                emptyLabel="Necklace"
              />
              {/* Ring row — 3 ring slots; ring3 reserved for v5.1. */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: SLOT_GAP,
                  height: RING_H,
                  width: BIG_W,
                }}
              >
                <SlotTile
                  slot="ring1"
                  item={eq.ring1}
                  w={RING_W * 0.65}
                  h={RING_H}
                  isDirty={dirtySlots.has("ring1")}
                  onClick={() => setSelectedSlot("ring1")}
                />
                <SlotTile
                  slot="ring2"
                  item={eq.ring2}
                  w={RING_W * 0.65}
                  h={RING_H}
                  isDirty={dirtySlots.has("ring2")}
                  onClick={() => setSelectedSlot("ring2")}
                />
                <SlotTile
                  slot={null}
                  item={null}
                  future
                  futureLabel="Ring 3"
                  w={RING_W * 0.65}
                  h={RING_H}
                />
              </div>
              {/* v5.1 Bracers — armlet/shoulder armor; today's contract
                  has no slot for these. Layout pre-allocates the space
                  so v5.1 lights up without restructure. */}
              <SlotTile
                slot={null}
                item={null}
                future
                futureLabel="Bracers"
                w={BIG_W}
                h={BIG_H}
              />
              <SlotTile
                slot="offhand"
                item={eq.offhand}
                w={BIG_W}
                h={BIG_H}
                isDirty={dirtySlots.has("offhand")}
                onClick={() => setSelectedSlot("offhand")}
                emptyLabel="Off-hand"
              />
              {/* v5.1 Pants — leg armor placeholder. */}
              <SlotTile
                slot={null}
                item={null}
                future
                futureLabel="Pants"
                w={BIG_W}
                h={BIG_H}
              />
            </div>

            {/* Bottom row: Belt · Ornament · Boots — spans all 3 cols */}
            <div
              style={{
                gridColumn: "1 / -1",
                gridRow: 3,
                display: "flex",
                gap: SLOT_GAP,
                alignItems: "stretch",
                height: BOT_H,
              }}
            >
              <SlotTile
                slot="belt"
                item={eq.belt}
                w={BOT_W}
                h={BOT_H}
                isDirty={dirtySlots.has("belt")}
                onClick={() => setSelectedSlot("belt")}
                emptyLabel="Belt"
              />
              <TribalOrnament />
              <SlotTile
                slot="boots"
                item={eq.boots}
                w={BOT_W}
                h={BOT_H}
                isDirty={dirtySlots.has("boots")}
                onClick={() => setSelectedSlot("boots")}
                emptyLabel="Boots"
              />
            </div>
          </div>

          {/* Stats column — right of the frame */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minWidth: 240,
            }}
          >
            {/* Attributes panel */}
            <div
              style={{
                background: "var(--sc-panel-2)",
                border: "1px solid var(--sc-rim)",
                boxShadow: "var(--rim-top), var(--rim-bottom)",
                padding: 12,
              }}
            >
              <h3
                style={{
                  margin: "0 0 8px",
                  fontFamily: "var(--font-ui)",
                  fontWeight: 800,
                  fontSize: 10,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--sc-bronze)",
                  borderBottom: "1px solid var(--sc-rim)",
                  paddingBottom: 5,
                }}
              >
                Primary Attributes
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {statRows.map(([label, base, bonus, color, barBg]) => {
                  const total = base + bonus;
                  return (
                    <div
                      key={label}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{
                          width: 32,
                          fontWeight: 800,
                          fontSize: 11,
                          letterSpacing: ".06em",
                          color: "var(--fg-3)",
                        }}
                      >
                        {label}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          background: "var(--sc-page)",
                          border: "1px solid var(--sc-rim-2)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          className={barBg}
                          style={{
                            width: `${Math.min(100, (total / 20) * 100)}%`,
                            height: "100%",
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <span
                        className={`font-mono font-bold ${color}`}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontWeight: 700,
                          fontSize: 12,
                          minWidth: 38,
                          textAlign: "right",
                        }}
                      >
                        {total > base ? (
                          <>
                            {base}{" "}
                            <span style={{ color: "var(--rarity-uncommon)" }}>
                              +{bonus}
                            </span>
                          </>
                        ) : (
                          base
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              {unallocatedPoints > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllocate(true)}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    fontFamily: "var(--font-ui)",
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: "var(--ls-button)",
                    textTransform: "uppercase",
                    padding: "6px 10px",
                    border: "2px solid var(--sc-bronze-deep)",
                    borderRadius: "var(--r-button)",
                    background: "var(--sc-bronze)",
                    color: "var(--sc-page)",
                    boxShadow: "var(--sh-plate-sm)",
                    cursor: "pointer",
                    animation: "pulse-bronze-pp 1.6s ease-in-out infinite",
                  }}
                >
                  +{unallocatedPoints} pts to allocate
                </button>
              )}
              <style>{`
                @keyframes pulse-bronze-pp {
                  0%, 100% { box-shadow: var(--sh-plate-sm); }
                  50%     { box-shadow: 0 0 12px var(--sc-bronze-hot), var(--sh-plate-sm); }
                }
              `}</style>
            </div>

            {/* Combat stats panel */}
            <div
              style={{
                background: "var(--sc-panel-2)",
                border: "1px solid var(--sc-rim)",
                boxShadow: "var(--rim-top), var(--rim-bottom)",
                padding: 12,
              }}
            >
              <h3
                style={{
                  margin: "0 0 8px",
                  fontFamily: "var(--font-ui)",
                  fontWeight: 800,
                  fontSize: 10,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--sc-bronze)",
                  borderBottom: "1px solid var(--sc-rim)",
                  paddingBottom: 5,
                }}
              >
                Combat Statistics
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: 4,
                }}
              >
                {(
                  [
                    ["HP", derived.maxHp, "var(--stat-hp)"],
                    ["ATK", derived.attackPower, "var(--sc-blood)"],
                    ["Crit%", `${derived.critChance}%`, "var(--stat-int)"],
                    ["Crit×", `${derived.critMultiplier}x`, "var(--stat-int)"],
                    ["Evade", `${derived.evasionChance}%`, "var(--stat-dex)"],
                    ["Armor", derived.armor, "var(--sc-steel)"],
                    ["Def", derived.defense, "var(--sc-bronze)"],
                    ["Lv", character.level, "var(--sc-parchment)"],
                  ] as const
                ).map(([label, val, color]) => (
                  <div
                    key={label as string}
                    style={{
                      background: "var(--sc-page)",
                      border: "1px solid var(--sc-rim-2)",
                      borderRadius: 2,
                      padding: "4px 7px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                        color: "var(--fg-3)",
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontWeight: 700,
                        fontSize: 13,
                        color: color as string,
                      }}
                    >
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* XP bar */}
            <div
              style={{
                background: "var(--sc-panel-2)",
                border: "1px solid var(--sc-rim)",
                boxShadow: "var(--rim-top), var(--rim-bottom)",
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: ".10em",
                  textTransform: "uppercase",
                  color: "var(--fg-3)",
                  marginBottom: 6,
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
                  borderRadius: 2,
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
              </div>
            </div>

            {/* W / L */}
            <div
              style={{
                background: "var(--sc-panel-2)",
                border: "1px solid var(--sc-rim)",
                boxShadow: "var(--rim-top), var(--rim-bottom)",
                padding: "10px 12px",
                display: "flex",
                gap: 16,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <span>
                <span style={{ color: "var(--fg-3)" }}>W </span>
                <span style={{ color: "var(--rarity-uncommon)" }}>
                  {character.wins}
                </span>
              </span>
              <span>
                <span style={{ color: "var(--fg-3)" }}>L </span>
                <span style={{ color: "var(--sc-blood)" }}>{character.losses}</span>
              </span>
              <span>
                <span style={{ color: "var(--fg-3)" }}>Win% </span>
                <span style={{ color: "var(--sc-parchment)" }}>{winRate}%</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals — unchanged behaviour, kept verbatim from v1 ── */}
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
              className="w-full px-4 py-2 text-sm font-bold rounded bg-red-600/20 text-red-400 border border-red-700/40 hover:bg-red-600/30 hover:border-red-600/60 transition-all"
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
            <p className="text-zinc-400 text-sm text-center py-4">
              No compatible items in inventory
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
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

      {/* RARITY_COLORS is referenced via `RARITY_COLORS[...]` only in the
          ItemDetailModal/ItemCard children. Keep the legacy `RARITY_COLORS`
          symbol used so future Tailwind JIT scans still see the literal
          token chain. (No-op at runtime.) */}
      <span style={{ display: "none" }} aria-hidden>
        {Object.values(RARITY_COLORS).join(" ")}
      </span>
    </>
  );
}
