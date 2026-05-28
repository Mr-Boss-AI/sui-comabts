"use client";

/**
 * MiniEquipmentFrame — read-only equipment doll for the Player Profile
 * modal. ~80% scale of the main Character page EquipmentFrame, same
 * architecture (combats.ru border arrangement, 1fr center column,
 * tall-rectangle slots), but with no click handlers, no portrait picker,
 * no save flow.
 *
 * Reuses the canonical primitives from `character-profile.tsx`:
 *   - SlotTile (omit onClick to mark as read-only)
 *   - HpBar
 *   - PortraitFrame (omit onClick; override empty-state copy)
 *   - TribalOrnament
 *
 * Architecture (extracted from character_equipment_frame_extracted.md
 * at ~80% scale):
 *   bigSlotW  76   (was 96)
 *   bigSlotH  86   (was 108)
 *   ringSlot  35   (was 44)
 *   beltSlotH 44   (was 56)
 *   colGap     6   (was 8)
 *   slotGap    5   (was 6)
 *   framePad  10   (was 12)
 *
 * Grid template — center column stays `1fr` so the portrait stretches.
 * (Fixed-pixel center was the diagnosed root cause of the previous
 * Character-page misalignment; we don't reintroduce it here.)
 *
 * Portrait fetching status: the chosen NFT portrait is currently
 * localStorage-only (see `lib/nft-portrait.ts`) — it doesn't round-trip
 * through the server payload, and `PlayerProfileWire` carries no
 * `portraitNftId`. We expose a `portraitImageUrl?` prop reserved for the
 * future server-side hookup; until then we render the read-only
 * empty state ("No portrait set").
 */

import type { EquipmentSlots } from "@/types/game";
import {
  SlotTile,
  HpBar,
  PortraitFrame,
  TribalOrnament,
} from "@/components/character/character-profile";

/** Default scale of the main-page TWEAK_DEFAULTS. 0.8 ≈ 80%. */
export const MINI_FRAME_TWEAKS = {
  bigSlotW: 76,
  bigSlotH: 86,
  ringSlotSize: 35,
  beltSlotH: 44,
  colGap: 6,
  slotGap: 5,
  framePad: 10,
} as const;

export interface MiniEquipmentFrameProps {
  /** Player's equipped items. Same shape as the main character. */
  equipment: EquipmentSlots;
  /** Current HP — defaults to maxHp for read-only display. */
  currentHp: number;
  /** Computed maxHp from derived stats. */
  maxHp: number;
  /** Resolved portrait image URL (server-side hookup, future). When
   *  omitted the frame renders the "No portrait set" empty state. */
  portraitImageUrl?: string;
  /** Optional portrait name for tooltip / aria when imageUrl is set. */
  portraitName?: string;
  /**
   * Skip rendering the in-frame HP bar — used by the Phase 3 fight-room
   * layout, which renders HP separately in the top row of the arena
   * grid. The center column still keeps PortraitFrame + ornament, just
   * without the duplicate health gauge above them.
   */
  hideHpBar?: boolean;
}

export function MiniEquipmentFrame({
  equipment,
  currentHp,
  maxHp,
  portraitImageUrl,
  portraitName,
  hideHpBar,
}: MiniEquipmentFrameProps) {
  const {
    bigSlotW,
    bigSlotH,
    ringSlotSize,
    beltSlotH,
    colGap,
    slotGap,
    framePad,
  } = MINI_FRAME_TWEAKS;

  const bigSize = { w: bigSlotW, h: bigSlotH };

  // Wrap the resolved url in the NftCandidate shape PortraitFrame
  // expects, so we can reuse the same primitive in both interactive
  // (main page) and read-only (this) modes.
  const portrait = portraitImageUrl
    ? {
        objectId: "",
        name: portraitName ?? "Portrait",
        imageUrl: portraitImageUrl,
        typeTag: "",
      }
    : null;

  return (
    <div
      style={{
        background: "var(--sc-panel)",
        border: "2px solid var(--sc-bronze-deep)",
        boxShadow:
          "0 0 0 1px var(--sc-rim), inset 0 1px 0 rgba(255,255,255,.04), inset 0 -2px 0 rgba(0,0,0,.55)",
        padding: framePad,
        // Same template as the main frame — center column is `1fr`.
        display: "grid",
        gridTemplateColumns: `${bigSlotW}px ${colGap}px 1fr ${colGap}px ${bigSlotW}px`,
        alignItems: "stretch",
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      {/* LEFT — Helmet · Shoulders* · Weapon · Chest · Belt(44) */}
      <div
        style={{
          gridColumn: 1,
          display: "flex",
          flexDirection: "column",
          gap: slotGap,
        }}
      >
        <SlotTile slot="helmet" item={equipment.helmet} size={bigSize} emptyLabel="Helmet" />
        <SlotTile slot="bracelets" item={equipment.bracelets} size={bigSize} emptyLabel="Bracelets" />
        <SlotTile slot="weapon" item={equipment.weapon} size={bigSize} emptyLabel="Weapon" />
        <SlotTile slot="chest" item={equipment.chest} size={bigSize} emptyLabel="Chest" />
        <SlotTile
          slot="belt"
          item={equipment.belt}
          size={{ w: bigSlotW, h: beltSlotH }}
          emptyLabel="Belt"
        />
      </div>

      {/* CENTER — HpBar(22) · PortraitFrame(flex:1, read-only) · Ornament(36) */}
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
        {!hideHpBar && <HpBar current={currentHp} max={maxHp} />}
        <PortraitFrame
          portrait={portrait}
          emptyTitle="No portrait set"
          emptySubtitle=""
          hidePlusIcon
        />
        <TribalOrnament height={36} />
      </div>

      {/* RIGHT — Necklace · [Ring1 Ring2 Ring3*] · Gloves · Off-hand · Pants* · Boots */}
      <div
        style={{
          gridColumn: 5,
          display: "flex",
          flexDirection: "column",
          gap: slotGap,
        }}
      >
        <SlotTile slot="necklace" item={equipment.necklace} size={bigSize} emptyLabel="Necklace" />
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: slotGap,
            width: bigSlotW,
            height: ringSlotSize,
          }}
        >
          <SlotTile slot="ring1" item={equipment.ring1} size={ringSlotSize} />
          <SlotTile slot="ring2" item={equipment.ring2} size={ringSlotSize} />
          <SlotTile slot="ring3" item={equipment.ring3} size={ringSlotSize} />
        </div>
        <SlotTile slot="gloves" item={equipment.gloves} size={bigSize} emptyLabel="Gloves" />
        <SlotTile slot="offhand" item={equipment.offhand} size={bigSize} emptyLabel="Off-hand" />
        <SlotTile slot="pants" item={equipment.pants} size={bigSize} emptyLabel="Pants" />
        <SlotTile slot="boots" item={equipment.boots} size={bigSize} emptyLabel="Boots" />
      </div>
    </div>
  );
}
