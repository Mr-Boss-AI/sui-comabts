"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { RarityBadge } from "@/components/ui/badge";
import { useGame } from "@/hooks/useGameStore";
import type { FightState, LootBoxResult } from "@/types/game";

interface FightResultModalProps {
  fight: FightState;
  loot: LootBoxResult;
  myAddress: string;
  onClose: () => void;
}

export function FightResultModal({
  fight,
  loot,
  myAddress,
  onClose,
}: FightResultModalProps) {
  const won = fight.winner === myAddress;

  return (
    <Modal open onClose={onClose} title={won ? "Victory!" : "Defeat"}>
      <div className="text-center space-y-4">
        <div
          className={`text-5xl font-black ${won ? "text-emerald-400" : "text-red-400"}`}
        >
          {won ? "YOU WIN" : "YOU LOSE"}
        </div>

        <div className="text-zinc-400 text-sm">
          {fight.playerA.name} vs {fight.playerB.name} — {fight.log?.length ?? 0}{" "}
          turns
        </div>

        <div className="border-t border-zinc-800 pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">XP Gained</span>
            <span className="text-blue-400 font-bold">+{loot.xpGained}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Rating</span>
            <span
              className={`font-bold ${loot.ratingChange >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {loot.ratingChange >= 0 ? "+" : ""}
              {loot.ratingChange}
            </span>
          </div>
          {fight.wagerAmount && fight.wagerAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Wager</span>
              <span
                className={`font-bold ${won ? "text-emerald-400" : "text-red-400"}`}
              >
                {won ? "+" : "-"}
                {fight.wagerAmount} SUI
              </span>
            </div>
          )}
        </div>

        {loot.item && (
          <div className="border-t border-zinc-800 pt-4">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
              Loot Drop!
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 flex items-center gap-3">
              <div className="text-2xl">
                {loot.item.rarity >= 4 ? "✦" : loot.item.rarity >= 3 ? "◆" : "•"}
              </div>
              <div className="text-left">
                <div className="font-semibold">{loot.item.name}</div>
                <RarityBadge rarity={loot.item.rarity} />
              </div>
            </div>
          </div>
        )}

        <Button onClick={onClose} className="w-full">
          Continue
        </Button>
      </div>
    </Modal>
  );
}
