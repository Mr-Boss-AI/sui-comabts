"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useGame } from "@/hooks/useGameStore";
import { useEquipmentActions } from "@/hooks/useEquipmentActions";
import { computeDerivedStats, getArchetype, getArchetypeColor } from "@/lib/combat";
import { effectiveUnallocatedPoints } from "@/lib/stat-points";
import { buildSlotPickerEntries } from "@/lib/equipment-picker";
import { MAX_LEVEL, getXpInCurrentLevel, getXpProgress, getXpSpanForLevel } from "@/types/game";
import type { Character, EquipmentSlots, Item } from "@/types/game";
import { StatAllocateModal } from "./stat-allocate-modal";
import { RARITY_COLORS, EQUIPMENT_SLOT_LABELS } from "@/types/game";
import { ItemDetailModal } from "@/components/items/item-detail-modal";
import { ItemCard } from "@/components/items/item-card";
import { Modal } from "@/components/ui/modal";

const SLOT_ICONS: Record<keyof EquipmentSlots, string> = {
  weapon: "\u2694", offhand: "\ud83d\udee1", helmet: "\u26d1", chest: "\ud83c\udfbd",
  gloves: "\ud83e\udde4", boots: "\ud83d\udc62", belt: "\u26d3", ring1: "\ud83d\udc8d", ring2: "\ud83d\udc8d", necklace: "\ud83d\udcbf",
};

function sumEquipmentStat(equipment: EquipmentSlots, key: keyof Item["statBonuses"]): number {
  let total = 0;
  for (const item of Object.values(equipment)) {
    if (item) total += (item as Item).statBonuses[key] || 0;
  }
  return total;
}

function EquipSlot({
  slot,
  item,
  onClick,
  isDirty,
}: {
  slot: keyof EquipmentSlots;
  item: Item | null;
  onClick: () => void;
  isDirty?: boolean;
}) {
  // Dirty slots get an amber ring + a corner dot; both survive next to the
  // rarity-color border by riding on an outer wrapper. This is the "staged
  // but not saved" signal — the Save Loadout button commits them.
  const innerBorder = item
    ? `${RARITY_COLORS[item.rarity].replace("text-", "border-").replace("400", "700")} bg-zinc-900/80 hover:brightness-125 hover:scale-110`
    : "border-zinc-700/40 bg-zinc-900/40 hover:border-zinc-500 hover:bg-zinc-800/60";
  return (
    <div className={`relative ${isDirty ? "ring-2 ring-amber-400/70 ring-offset-1 ring-offset-black rounded-sm" : ""}`}>
      <button
        type="button"
        onClick={onClick}
        className={`w-11 h-11 rounded-sm flex items-center justify-center transition-all overflow-hidden cursor-pointer
          border-2 ${innerBorder}
          shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-1px_0_rgba(0,0,0,0.3)]`}
        title={
          isDirty
            ? `${item?.name ?? EQUIPMENT_SLOT_LABELS[slot]} (staged — click Save Loadout to commit)`
            : item
              ? `${item.name} (click to manage)`
              : `${EQUIPMENT_SLOT_LABELS[slot]} (click to equip)`
        }
      >
        {item ? (
          item.imageUrl ? (
            <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <span className={`text-sm ${RARITY_COLORS[item.rarity]}`}>
              {SLOT_ICONS[slot]}
            </span>
          )
        ) : (
          <span className="text-zinc-700 text-sm">{SLOT_ICONS[slot]}</span>
        )}
      </button>
      {isDirty && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]"
        />
      )}
    </div>
  );
}

export function CharacterProfile({ character, compact }: { character: Character; compact?: boolean }) {
  const { state, dispatch } = useGame();
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

  // Bridge from `LevelUpModal` "Allocate Stat Points" CTA → this
  // component's existing modal-controller boolean (Fix 3, 2026-05-04).
  // When the level-up modal flips `pendingStatAllocate`, mount the
  // StatAllocateModal automatically and clear the flag so subsequent
  // navigations to the Character area don't re-pop it.
  useEffect(() => {
    if (state.pendingStatAllocate) {
      setShowAllocate(true);
      dispatch({ type: "SET_PENDING_STAT_ALLOCATE", pending: false });
    }
  }, [state.pendingStatAllocate, dispatch]);

  // Saving is blocked while combat is resolving (fight-lock DF on chain would
  // abort the PTB anyway — this pre-empts the wallet popup). Wagered fights
  // matter especially: the chain state during combat is the committed
  // snapshot the server locked in at createFight.
  const inFight = state.fight !== null;
  const saveDisabled = signing || inFight || !isDirty;
  const saveTooltip = inFight
    ? "Locked — Save is disabled during an active fight"
    : signing
      ? "Saving…"
      : !isDirty
        ? "No unsaved changes"
        : `Save ${dirtySlots.size} slot change(s) on-chain`;

  // BUG 1 (live test 2026-05-02): the modal's "+N to allocate" must reflect
  // chain truth, not the server's optimistic post-fight value, otherwise
  // clicking Allocate stages a tx that aborts with ENotEnoughPoints. The
  // helper takes min(server, chain) when chain has been hydrated, falling
  // back to server only when chain is unavailable (in which case the
  // wallet popup never fires anyway).
  const unallocatedPoints = effectiveUnallocatedPoints(
    character.unallocatedPoints,
    state.onChainCharacter?.unallocatedPoints,
  );
  const characterObjectId = state.onChainCharacter?.objectId;

  // Display pendingEquipment (what the user WANTS). Committed is the chain
  // truth; combat uses committed (D4 — fight-room.ts re-reads DOFs). The
  // doll slots show pending so staged changes are visible immediately
  // without waiting for a Save Loadout tx.
  const eq: EquipmentSlots = state.pendingEquipment;

  const selectedItem = selectedSlot ? eq[selectedSlot] : null;

  // Items already slotted in pending — hidden from the picker. Items only
  // in committed (user staged an unequip but hasn't Saved yet) are still
  // available because the save PTB will free them before re-equipping.
  const equippedPendingIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of Object.values(state.pendingEquipment)) {
      if (item) set.add(item.id);
    }
    return set;
  }, [state.pendingEquipment]);

  // Effective equip level = min(server.level, onChain.level).
  // Server level can be ahead of chain (pre-revert test-XP drift). Used by
  // `buildSlotPickerEntries` to flag locked items — the chain would
  // ELevelTooLow them anyway, so the picker greys them out client-side.
  const effectiveLevel = Math.min(
    character.level,
    state.onChainCharacter?.level ?? character.level,
  );

  // The picker shows ALL slot-compatible items the player owns —
  // unlocked items first (by name), locked items after (by level then
  // name). Locked items render dimmed with a "Lv N" badge so the
  // player can see what's waiting for them at the next level instead
  // of the "where did my Epic weapon go?" cliff.
  const pickerEntries = useMemo(() => {
    if (!selectedSlot) return [];
    return buildSlotPickerEntries(
      selectedSlot,
      state.inventory,
      state.onChainItems,
      equippedPendingIds,
      effectiveLevel,
      // Pending loadout — unlocks the 2H conflict check inside the
      // picker (Bug 2 Path A, 2026-05-04). The picker now greys out
      // candidates that would create a two-handed conflict (e.g. trying
      // to add an off-hand while a Skullcrusher Maul is in `weapon`)
      // with the same locked + reason UX as level-locked items.
      eq,
    );
  }, [selectedSlot, state.inventory, state.onChainItems, equippedPendingIds, effectiveLevel, eq]);

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
    [character.stats, eq, character.level]
  );
  const archetype = getArchetype(character.stats);
  // XP is cumulative on chain — display partial-within-level for the bar.
  // At MAX_LEVEL, getXpSpanForLevel returns 0 → hide the denominator.
  const xpInLevel = getXpInCurrentLevel(character.level, character.xp);
  const xpSpan = getXpSpanForLevel(character.level);
  const xpProgress = getXpProgress(character.level, character.xp);
  const isMaxLevel = character.level >= MAX_LEVEL;
  const winRate = character.wins + character.losses > 0
    ? Math.round((character.wins / (character.wins + character.losses)) * 100) : 0;

  // Compute equipment bonuses per stat
  const strBonus = sumEquipmentStat(eq, "strengthBonus");
  const dexBonus = sumEquipmentStat(eq, "dexterityBonus");
  const intBonus = sumEquipmentStat(eq, "intuitionBonus");
  const endBonus = sumEquipmentStat(eq, "enduranceBonus");

  // The bar fill class needs to appear as a literal string somewhere in
  // the source — Tailwind v4's JIT scanner does not evaluate runtime
  // string ops like `color.replace("text-", "bg-")`, so a computed
  // `bg-red-400` is silently absent from the bundle. Carrying the
  // literal `bg-...` token alongside the `text-...` token here is what
  // got STR/DEX/INT bars rendering again (END only worked because
  // `bg-amber-400` happens to appear as a literal elsewhere — e.g. the
  // dirty-equipment-slot dot, opponent-disconnected banner).
  const statRows: [string, number, number, string, string][] = [
    ["STR", character.stats.strength,  strBonus, "text-red-400",    "bg-red-400"],
    ["DEX", character.stats.dexterity, dexBonus, "text-cyan-400",   "bg-cyan-400"],
    ["INT", character.stats.intuition, intBonus, "text-purple-400", "bg-purple-400"],
    ["END", character.stats.endurance, endBonus, "text-amber-400",  "bg-amber-400"],
  ];

  return (
    <>
      <div className="rounded border border-amber-900/20 bg-[#0c0c0f] overflow-hidden shadow-lg shadow-black/50">
        {/* Header - ornamental top bar */}
        <div className="px-4 py-2.5 border-b border-amber-900/20 bg-gradient-to-r from-zinc-900/60 via-zinc-900/40 to-zinc-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-base text-zinc-100">{character.name}</h2>
            <Badge variant="info">Lv.{character.level}</Badge>
            <span className={`text-xs font-semibold ${getArchetypeColor(archetype)}`}>{archetype}</span>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void saveLoadout();
                  }}
                  disabled={saveDisabled}
                  title={saveTooltip}
                  className={`px-3 py-1 text-xs font-bold rounded border transition-all ${
                    saveDisabled
                      ? "bg-zinc-800/60 text-zinc-500 border-zinc-700 cursor-not-allowed"
                      : "bg-amber-500/20 text-amber-300 border-amber-500/60 hover:bg-amber-500/30 hover:border-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.25)]"
                  }`}
                >
                  {signing ? "Saving…" : `Save Loadout (${dirtySlots.size})`}
                </button>
                <button
                  type="button"
                  onClick={stageDiscard}
                  disabled={signing}
                  title="Discard staged changes, revert to last saved"
                  className="px-2.5 py-1 text-xs font-semibold rounded border bg-zinc-900/40 text-zinc-400 border-zinc-700 hover:text-zinc-200 hover:border-zinc-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Discard
                </button>
              </>
            )}
            <Badge variant="warning">{character.rating} ELO</Badge>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row">
          {/* Left: Equipment doll - dark framed panel */}
          <div className="flex flex-col items-center border-b lg:border-b-0 lg:border-r border-amber-900/15 bg-[#08080a] p-3">
            {/* Framed doll area with inner border */}
            <div className="relative w-44 h-52 rounded border border-zinc-800/60 bg-gradient-to-b from-zinc-900/20 to-black/40 p-1"
              style={{ boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)" }}>
              {/* Helmet - top center */}
              <div className="absolute top-1 left-1/2 -translate-x-1/2">
                <EquipSlot slot="helmet" item={eq.helmet} onClick={() => setSelectedSlot("helmet")} isDirty={dirtySlots.has("helmet")} />
              </div>
              {/* Weapon - left */}
              <div className="absolute top-12 left-1">
                <EquipSlot slot="weapon" item={eq.weapon} onClick={() => setSelectedSlot("weapon")} isDirty={dirtySlots.has("weapon")} />
              </div>
              {/* Character silhouette */}
              <div className="absolute top-10 left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none">
                <svg viewBox="0 0 60 90" className="w-16 h-24" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}>
                  <ellipse cx="30" cy="15" rx="12" ry="14" fill="#1a1a1f"/>
                  <path d="M15 32 Q15 28 30 28 Q45 28 45 32 L48 60 Q48 65 40 68 L38 85 Q38 88 32 88 L28 88 Q22 88 22 85 L20 68 Q12 65 12 60 Z" fill="#1a1a1f"/>
                  <ellipse cx="30" cy="15" rx="11" ry="13" fill="none" stroke="#2a2a30" strokeWidth="0.5"/>
                  <path d="M16 32 Q16 29 30 29 Q44 29 44 32 L47 59 Q47 64 40 67 L38 84 Q38 87 32 87 L28 87 Q22 87 22 84 L20 67 Q13 64 13 59 Z" fill="none" stroke="#2a2a30" strokeWidth="0.5"/>
                </svg>
              </div>
              {/* Offhand - right */}
              <div className="absolute top-12 right-1">
                <EquipSlot slot="offhand" item={eq.offhand} onClick={() => setSelectedSlot("offhand")} isDirty={dirtySlots.has("offhand")} />
              </div>
              {/* Chest - below silhouette */}
              <div className="absolute top-[88px] left-1/2 -translate-x-1/2">
                <EquipSlot slot="chest" item={eq.chest} onClick={() => setSelectedSlot("chest")} isDirty={dirtySlots.has("chest")} />
              </div>
              {/* Gloves - bottom left */}
              <div className="absolute bottom-1 left-1">
                <EquipSlot slot="gloves" item={eq.gloves} onClick={() => setSelectedSlot("gloves")} isDirty={dirtySlots.has("gloves")} />
              </div>
              {/* Boots - bottom right */}
              <div className="absolute bottom-1 right-1">
                <EquipSlot slot="boots" item={eq.boots} onClick={() => setSelectedSlot("boots")} isDirty={dirtySlots.has("boots")} />
              </div>
            </div>
            {/* Accessory row */}
            <div className="flex gap-1 mt-2">
              <EquipSlot slot="belt" item={eq.belt} onClick={() => setSelectedSlot("belt")} isDirty={dirtySlots.has("belt")} />
              <EquipSlot slot="ring1" item={eq.ring1} onClick={() => setSelectedSlot("ring1")} isDirty={dirtySlots.has("ring1")} />
              <EquipSlot slot="ring2" item={eq.ring2} onClick={() => setSelectedSlot("ring2")} isDirty={dirtySlots.has("ring2")} />
              <EquipSlot slot="necklace" item={eq.necklace} onClick={() => setSelectedSlot("necklace")} isDirty={dirtySlots.has("necklace")} />
            </div>
          </div>

          {/* Right: Stats panel */}
          <div className="flex-1 p-3 space-y-3 bg-[#0a0a0d]">
            {/* Attributes with base + bonus */}
            <div>
              <h3 className="text-[10px] text-amber-700/80 uppercase tracking-widest mb-2 font-bold border-b border-amber-900/15 pb-1">Primary Attributes</h3>
              <div className="space-y-1.5 text-sm">
                {statRows.map(([label, base, bonus, color, barBg]) => {
                  const total = base + bonus;
                  return (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-zinc-500 w-10 text-xs font-bold">{label}</span>
                      <div className="flex-1 mx-2 h-1 bg-zinc-900 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barBg} opacity-70`} style={{ width: `${Math.min(100, (total / 20) * 100)}%` }} />
                      </div>
                      <span className={`font-mono font-bold text-xs ${color}`}>
                        {total > base ? (
                          <>{base} <span className="text-emerald-500">(+{bonus})</span></>
                        ) : (
                          base
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              {unallocatedPoints > 0 && (
                <button onClick={() => setShowAllocate(true)} className="mt-2 text-xs text-amber-400 hover:text-amber-300 font-bold animate-pulse">
                  +{unallocatedPoints} points to allocate
                </button>
              )}
            </div>

            {/* Combat Stats */}
            <div>
              <h3 className="text-[10px] text-amber-700/80 uppercase tracking-widest mb-2 font-bold border-b border-amber-900/15 pb-1">Combat Statistics</h3>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {[
                  ["HP", derived.maxHp, "text-red-400"],
                  ["ATK", derived.attackPower, "text-orange-400"],
                  ["Crit%", `${derived.critChance}%`, "text-purple-400"],
                  ["Crit x", `${derived.critMultiplier}x`, "text-purple-300"],
                  ["Evasion", `${derived.evasionChance}%`, "text-cyan-400"],
                  ["Armor", derived.armor, "text-zinc-300"],
                  ["Defense", derived.defense, "text-amber-400"],
                ].map(([label, val, color]) => (
                  <div key={label as string} className="flex justify-between bg-black/30 border border-zinc-800/20 rounded px-2 py-1">
                    <span className="text-zinc-600">{label}</span>
                    <span className={`font-mono font-bold ${color}`}>{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* XP bar — chain stores cumulative XP; we render the in-level slice. */}
            <div>
              <div className="flex justify-between text-[10px] text-zinc-600 mb-1">
                <span>Level {character.level}{isMaxLevel ? " MAX" : ` \u2192 ${character.level + 1}`}</span>
                <span>{isMaxLevel ? `${character.xp.toLocaleString()} XP` : `${xpInLevel.toLocaleString()} / ${xpSpan.toLocaleString()} XP`}</span>
              </div>
              <div className="h-1.5 bg-black/40 rounded-full overflow-hidden border border-zinc-800/20">
                <div className="h-full bg-blue-600/80 rounded-full transition-all" style={{ width: `${(xpProgress * 100)}%` }} />
              </div>
            </div>

            {/* Win/Loss */}
            <div className="flex gap-4 text-xs border-t border-amber-900/10 pt-2">
              <span><span className="text-zinc-600">W</span> <span className="text-emerald-400 font-bold">{character.wins}</span></span>
              <span><span className="text-zinc-600">L</span> <span className="text-red-400 font-bold">{character.losses}</span></span>
              <span><span className="text-zinc-600">Win%</span> <span className="text-zinc-300 font-bold">{winRate}%</span></span>
            </div>
          </div>
        </div>
      </div>
      {showAllocate && (
        <StatAllocateModal
          character={{ ...character, unallocatedPoints }}
          characterObjectId={characterObjectId}
          onClose={() => setShowAllocate(false)}
        />
      )}

      {/* Equipped slot clicked — show item details + Unequip */}
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

      {/* Empty slot clicked — show compatible items from inventory.
          Locked items render dimmed with a "Lv N" badge instead of being
          filtered out, so progression motivation stays visible. */}
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
    </>
  );
}
