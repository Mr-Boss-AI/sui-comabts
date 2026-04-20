"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { ZoneSelector } from "./zone-selector";
import { HpBar } from "./hp-bar";
import { DamageLog } from "./damage-log";
import { TurnTimer } from "./turn-timer";
import { FightResultModal } from "./fight-result-modal";
import { ITEM_TYPES, RARITY_COLORS, type Zone, type EquipmentSlots, type Item } from "@/types/game";

function FighterDisplay({ name, level, equipment }: { name: string; level: number; equipment: EquipmentSlots }) {
  const slots: { key: keyof EquipmentSlots; icon: string; pos: string }[] = [
    { key: "helmet", icon: "\u26D1", pos: "top-0 left-1/2 -translate-x-1/2" },
    { key: "weapon", icon: "\u2694", pos: "top-8 left-0" },
    { key: "offhand", icon: "\uD83D\uDEE1", pos: "top-8 right-0" },
    { key: "chest", icon: "\uD83C\uDFBD", pos: "top-[72px] left-1/2 -translate-x-1/2" },
    { key: "gloves", icon: "\uD83E\uDDE4", pos: "bottom-4 left-0" },
    { key: "boots", icon: "\uD83D\uDC62", pos: "bottom-4 right-0" },
  ];

  return (
    <div className="flex flex-col items-center">
      <div className="text-sm font-bold text-zinc-300 mb-2">{name} <span className="text-zinc-600">Lv.{level}</span></div>
      <div className="relative w-32 h-40">
        {/* Character silhouette */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <svg viewBox="0 0 60 90" className="w-16 h-24 text-zinc-700">
            <ellipse cx="30" cy="15" rx="12" ry="14" fill="currentColor"/>
            <path d="M15 32 Q15 28 30 28 Q45 28 45 32 L48 60 Q48 65 40 68 L38 85 Q38 88 32 88 L28 88 Q22 88 22 85 L20 68 Q12 65 12 60 Z" fill="currentColor"/>
          </svg>
        </div>
        {/* Equipment slots */}
        {slots.map(({ key, icon, pos }) => {
          const item = equipment[key];
          const imageUrl = item?.imageUrl;
          return (
            <div
              key={key}
              className={`absolute ${pos} w-8 h-8 rounded border flex items-center justify-center overflow-hidden ${
                item
                  ? `border-zinc-600 bg-zinc-800/90 ${RARITY_COLORS[item.rarity]}`
                  : "border-zinc-800/50 bg-zinc-900/30 text-zinc-800"
              }`}
              title={item?.name || key}
            >
              {item && imageUrl ? (
                <img src={imageUrl} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm">{icon}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FightArena() {
  const { state, dispatch } = useGame();
  const account = useCurrentAccount();
  const { fight, lootResult, onChainEquipped } = state;
  const myAddress = account?.address;

  const [attackZones, setAttackZones] = useState<Zone[]>([]);
  const [blockZones, setBlockZones] = useState<Zone[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const character = state.character;

  // Merge server equipment with on-chain equipped items for display
  const meEquip: EquipmentSlots = useMemo(() => {
    const base = character?.equipment || ({} as EquipmentSlots);
    const merged = { ...base };
    for (const [slot, item] of Object.entries(onChainEquipped)) {
      if (item) merged[slot as keyof EquipmentSlots] = item;
    }
    return merged;
  }, [character?.equipment, onChainEquipped]);

  const hasShield = meEquip.offhand?.itemType === ITEM_TYPES.SHIELD;
  const hasDualWield = meEquip.offhand?.itemType === ITEM_TYPES.WEAPON;
  const maxAttacks = hasDualWield ? 2 : 1;
  const maxBlocks = hasShield ? 3 : hasDualWield ? 1 : 2;

  useEffect(() => {
    setAttackZones([]);
    setBlockZones([]);
    setSubmitted(false);
  }, [fight?.turn]);

  const handleAttackToggle = useCallback((zone: Zone) => {
    setAttackZones((prev) => {
      if (prev.includes(zone)) return prev.filter((z) => z !== zone);
      if (prev.length >= maxAttacks) return [...prev.slice(1), zone];
      return [...prev, zone];
    });
  }, [maxAttacks]);

  const handleBlockPairSelect = useCallback((zones: Zone[]) => {
    setBlockZones(zones);
  }, []);

  const submitAction = useCallback(() => {
    if (attackZones.length !== maxAttacks || blockZones.length !== maxBlocks) return;
    // Diagnostic log — if the damage log shows different zones than what
    // was sent, we compare this console output (client truth) against the
    // server-side `[Fight] action` log (server truth). If both match but
    // the damage log differs, the bug is in the display; if they differ,
    // the bug is in the WS transport or client state.
    console.log("[fight_action send]", { attackZones, blockZones });
    state.socket.send({ type: "fight_action", attackZones, blockZones });
    setSubmitted(true);
  }, [attackZones, blockZones, maxAttacks, maxBlocks, state.socket]);

  if (!fight || !myAddress) return null;

  const isPlayerA = fight.playerA.walletAddress === myAddress;
  const me = isPlayerA ? fight.playerA : fight.playerB;
  const opponent = isPlayerA ? fight.playerB : fight.playerA;
  const opponentEquip = (opponent.equipment || {}) as EquipmentSlots;
  const isFinished = fight.status === "finished";
  const canSubmit = !submitted && attackZones.length === maxAttacks && blockZones.length === maxBlocks;

  return (
    <div className="flex flex-col max-w-5xl mx-auto w-full p-4 gap-3 flex-1">
      {/* Top: HP bars + timer */}
      <div className="flex items-start justify-between gap-4">
        <HpBar name={me.name} current={me.currentHp} max={me.maxHp} isLeft level={me.level} />
        <div className="flex flex-col items-center shrink-0">
          {fight.turnDeadline && !isFinished && <TurnTimer deadline={fight.turnDeadline} />}
          <div className="text-xs text-zinc-600 mt-1 font-bold">TURN {fight.turn}</div>
          {fight.wagerAmount && fight.wagerAmount > 0 && (
            <div className="text-xs text-amber-400 mt-0.5">{fight.wagerAmount} SUI</div>
          )}
        </div>
        <HpBar name={opponent.name} current={opponent.currentHp} max={opponent.maxHp} isLeft={false} level={opponent.level} />
      </div>

      {/* Middle: fighters + combat log */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left fighter */}
        <div className="hidden md:flex flex-col items-center justify-center">
          <FighterDisplay name={me.name} level={me.level} equipment={meEquip} />
        </div>

        {/* Center: combat log */}
        <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden flex flex-col min-h-[200px]">
          <div className="px-3 py-2 border-b border-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-wider">Battle Log</div>
          <div className="flex-1 p-3 overflow-y-auto scrollbar-thin">
            <DamageLog log={fight.log || []} fight={fight} myAddress={myAddress} />
          </div>
        </div>

        {/* Right fighter */}
        <div className="hidden md:flex flex-col items-center justify-center">
          <FighterDisplay name={opponent.name} level={opponent.level} equipment={opponentEquip} />
        </div>
      </div>

      {/* Bottom: zone selector + lock in */}
      {!isFinished && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <ZoneSelector
              selectedAttack={attackZones}
              selectedBlock={blockZones}
              maxAttacks={maxAttacks}
              maxBlocks={maxBlocks}
              onAttackToggle={handleAttackToggle}
              onBlockPairSelect={handleBlockPairSelect}
              shieldMode={hasShield}
              dualWieldMode={hasDualWield}
              disabled={submitted || isFinished}
            />

            <div className="flex flex-col items-center gap-2">
              {submitted ? (
                <div className="text-center py-4 px-8 rounded-xl bg-emerald-900/30 border-2 border-emerald-600/50">
                  <div className="text-emerald-400 font-bold text-lg">LOCKED IN</div>
                  <div className="text-emerald-500/80 text-sm mt-1">Waiting...</div>
                </div>
              ) : (
                <button
                  onClick={submitAction}
                  disabled={!canSubmit}
                  className={`py-4 px-10 rounded-xl font-bold text-lg transition-all ${
                    canSubmit
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/50 active:scale-95"
                      : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                  }`}
                >
                  {canSubmit ? "LOCK IN" : "Select zones"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fight result modal */}
      {isFinished && (
        <FightResultModal
          fight={fight}
          loot={lootResult ?? { xpGained: 0, ratingChange: 0 }}
          myAddress={myAddress}
          onClose={() => {
            dispatch({ type: "SET_FIGHT", fight: null });
            dispatch({ type: "SET_LOOT_RESULT", loot: null });
          }}
        />
      )}
    </div>
  );
}
