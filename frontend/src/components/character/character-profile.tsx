"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useGame } from "@/hooks/useGameStore";
import { computeDerivedStats, getArchetype, getArchetypeColor } from "@/lib/combat";
import { getXpForNextLevel, getXpProgress } from "@/types/game";
import type { Character, EquipmentSlots, Item } from "@/types/game";
import { StatAllocateModal } from "./stat-allocate-modal";
import { RARITY_COLORS, SLOT_TO_ITEM_TYPE, EQUIPMENT_SLOT_LABELS } from "@/types/game";
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

function EquipSlot({ slot, item, onClick }: { slot: keyof EquipmentSlots; item: Item | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-11 h-11 rounded-sm flex items-center justify-center transition-all overflow-hidden cursor-pointer
        border-2 ${item
          ? `${RARITY_COLORS[item.rarity].replace("text-", "border-").replace("400", "700")} bg-zinc-900/80 hover:brightness-125 hover:scale-110`
          : "border-zinc-700/40 bg-zinc-900/40 hover:border-zinc-500 hover:bg-zinc-800/60"
        }
        shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-1px_0_rgba(0,0,0,0.3)]`}
      title={item ? `${item.name} (click to manage)` : `${EQUIPMENT_SLOT_LABELS[slot]} (click to equip)`}
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
  );
}

export function CharacterProfile({ character, compact }: { character: Character; compact?: boolean }) {
  const { state, dispatch } = useGame();
  const [showAllocate, setShowAllocate] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<keyof EquipmentSlots | null>(null);

  // Merge server equipment with locally-equipped on-chain items
  const eq: EquipmentSlots = useMemo(() => {
    const merged = { ...character.equipment };
    for (const [slot, item] of Object.entries(state.onChainEquipped)) {
      if (item) merged[slot as keyof EquipmentSlots] = item;
    }
    return merged;
  }, [character.equipment, state.onChainEquipped]);

  const onChainIds = new Set(state.onChainItems.map((i) => i.id));
  const selectedItem = selectedSlot ? eq[selectedSlot] : null;

  const equippable = selectedSlot
    ? [...state.inventory, ...state.onChainItems].filter((item) =>
        SLOT_TO_ITEM_TYPE[selectedSlot].includes(item.itemType) &&
        item.levelReq <= character.level
      )
    : [];

  function handleEquip(item: Item) {
    if (!selectedSlot) return;
    if (onChainIds.has(item.id)) {
      dispatch({ type: "EQUIP_ONCHAIN_ITEM", item, slot: selectedSlot });
    } else {
      state.socket.send({ type: "equip_item", itemId: item.id, slot: selectedSlot });
    }
    setSelectedSlot(null);
  }

  function handleUnequip() {
    if (!selectedSlot) return;
    if (state.onChainEquipped[selectedSlot]) {
      dispatch({ type: "UNEQUIP_ONCHAIN_ITEM", slot: selectedSlot });
    } else {
      state.socket.send({ type: "unequip_item", slot: selectedSlot });
    }
    setSelectedSlot(null);
  }

  const derived = useMemo(
    () => computeDerivedStats(character.stats, eq, undefined, character.level),
    [character.stats, eq, character.level]
  );
  const archetype = getArchetype(character.stats);
  const xpNext = getXpForNextLevel(character.level);
  const xpProgress = getXpProgress(character.level, character.xp);
  const winRate = character.wins + character.losses > 0
    ? Math.round((character.wins / (character.wins + character.losses)) * 100) : 0;

  // Compute equipment bonuses per stat
  const strBonus = sumEquipmentStat(eq, "strengthBonus");
  const dexBonus = sumEquipmentStat(eq, "dexterityBonus");
  const intBonus = sumEquipmentStat(eq, "intuitionBonus");
  const endBonus = sumEquipmentStat(eq, "enduranceBonus");

  const statRows: [string, number, number, string][] = [
    ["STR", character.stats.strength, strBonus, "text-red-400"],
    ["DEX", character.stats.dexterity, dexBonus, "text-cyan-400"],
    ["INT", character.stats.intuition, intBonus, "text-purple-400"],
    ["END", character.stats.endurance, endBonus, "text-amber-400"],
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
          <Badge variant="warning">{character.rating} ELO</Badge>
        </div>

        <div className="flex flex-col lg:flex-row">
          {/* Left: Equipment doll - dark framed panel */}
          <div className="flex flex-col items-center border-b lg:border-b-0 lg:border-r border-amber-900/15 bg-[#08080a] p-3">
            {/* Framed doll area with inner border */}
            <div className="relative w-44 h-52 rounded border border-zinc-800/60 bg-gradient-to-b from-zinc-900/20 to-black/40 p-1"
              style={{ boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)" }}>
              {/* Helmet - top center */}
              <div className="absolute top-1 left-1/2 -translate-x-1/2">
                <EquipSlot slot="helmet" item={eq.helmet} onClick={() => setSelectedSlot("helmet")} />
              </div>
              {/* Weapon - left */}
              <div className="absolute top-12 left-1">
                <EquipSlot slot="weapon" item={eq.weapon} onClick={() => setSelectedSlot("weapon")} />
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
                <EquipSlot slot="offhand" item={eq.offhand} onClick={() => setSelectedSlot("offhand")} />
              </div>
              {/* Chest - below silhouette */}
              <div className="absolute top-[88px] left-1/2 -translate-x-1/2">
                <EquipSlot slot="chest" item={eq.chest} onClick={() => setSelectedSlot("chest")} />
              </div>
              {/* Gloves - bottom left */}
              <div className="absolute bottom-1 left-1">
                <EquipSlot slot="gloves" item={eq.gloves} onClick={() => setSelectedSlot("gloves")} />
              </div>
              {/* Boots - bottom right */}
              <div className="absolute bottom-1 right-1">
                <EquipSlot slot="boots" item={eq.boots} onClick={() => setSelectedSlot("boots")} />
              </div>
            </div>
            {/* Accessory row */}
            <div className="flex gap-1 mt-2">
              <EquipSlot slot="belt" item={eq.belt} onClick={() => setSelectedSlot("belt")} />
              <EquipSlot slot="ring1" item={eq.ring1} onClick={() => setSelectedSlot("ring1")} />
              <EquipSlot slot="ring2" item={eq.ring2} onClick={() => setSelectedSlot("ring2")} />
              <EquipSlot slot="necklace" item={eq.necklace} onClick={() => setSelectedSlot("necklace")} />
            </div>
          </div>

          {/* Right: Stats panel */}
          <div className="flex-1 p-3 space-y-3 bg-[#0a0a0d]">
            {/* Attributes with base + bonus */}
            <div>
              <h3 className="text-[10px] text-amber-700/80 uppercase tracking-widest mb-2 font-bold border-b border-amber-900/15 pb-1">Primary Attributes</h3>
              <div className="space-y-1.5 text-sm">
                {statRows.map(([label, base, bonus, color]) => {
                  const total = base + bonus;
                  return (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-zinc-500 w-10 text-xs font-bold">{label}</span>
                      <div className="flex-1 mx-2 h-1 bg-zinc-900 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color.replace("text-", "bg-")} opacity-70`} style={{ width: `${Math.min(100, (total / 20) * 100)}%` }} />
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
              {character.unallocatedPoints > 0 && (
                <button onClick={() => setShowAllocate(true)} className="mt-2 text-xs text-amber-400 hover:text-amber-300 font-bold">
                  +{character.unallocatedPoints} points to allocate
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

            {/* XP bar */}
            <div>
              <div className="flex justify-between text-[10px] text-zinc-600 mb-1">
                <span>Level {character.level}{character.level < 8 ? ` \u2192 ${character.level + 1}` : " MAX"}</span>
                <span>{character.xp} / {xpNext ?? "MAX"} XP</span>
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
      {showAllocate && <StatAllocateModal character={character} onClose={() => setShowAllocate(false)} />}

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

      {/* Empty slot clicked — show compatible items from inventory */}
      {selectedSlot && !selectedItem && (
        <Modal
          open
          onClose={() => setSelectedSlot(null)}
          title={`${EQUIPMENT_SLOT_LABELS[selectedSlot]} — Choose Item`}
          wide
        >
          {equippable.length === 0 ? (
            <p className="text-zinc-400 text-sm text-center py-4">
              No compatible items in inventory
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {equippable.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onClick={() => handleEquip(item)}
                />
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
