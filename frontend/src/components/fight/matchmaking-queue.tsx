"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useGame } from "@/hooks/useGameStore";
import type { FightType } from "@/types/game";

const FIGHT_TYPES: { type: FightType; label: string; desc: string; minLevel: number }[] = [
  { type: "friendly", label: "Friendly", desc: "No stakes, just practice", minLevel: 1 },
  { type: "ranked", label: "Ranked", desc: "ELO rating on the line", minLevel: 1 },
  { type: "wager", label: "Wager", desc: "Stake SUI on the outcome", minLevel: 1 },
];

export function MatchmakingQueue() {
  const { state } = useGame();
  const { fightQueue, character } = state;
  const [wagerAmount, setWagerAmount] = useState(10);
  const [selectedType, setSelectedType] = useState<FightType>("friendly");

  const level = character?.level ?? 1;

  function handleQueue() {
    // Include on-chain equipped items so the server can apply their stats in combat
    const onChainEquipment: Record<string, unknown> = {};
    for (const [slot, item] of Object.entries(state.onChainEquipped)) {
      if (item) onChainEquipment[slot] = item;
    }

    state.socket.send({
      type: "queue_fight",
      fightType: selectedType,
      wagerAmount: selectedType === "wager" ? wagerAmount : undefined,
      onChainEquipment: Object.keys(onChainEquipment).length > 0 ? onChainEquipment : undefined,
    });
  }

  function handleCancel() {
    state.socket.send({ type: "cancel_queue" });
  }

  if (fightQueue) {
    return (
      <Card glow>
        <CardBody className="text-center space-y-4 py-8">
          <div className="relative mx-auto w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-emerald-500/30 animate-ping" />
            <div className="absolute inset-2 rounded-full border-2 border-emerald-500 animate-spin" style={{ borderTopColor: "transparent" }} />
          </div>
          <div>
            <div className="text-lg font-semibold">Finding opponent...</div>
            <div className="text-sm text-zinc-400 mt-1">
              Queued for {fightQueue} fight
            </div>
          </div>
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">Find a Fight</span>
      </CardHeader>
      <CardBody className="space-y-3">
        {FIGHT_TYPES.map(({ type, label, desc, minLevel }) => {
          const locked = level < minLevel;
          return (
            <button
              key={type}
              disabled={locked}
              onClick={() => setSelectedType(type)}
              className={`w-full text-left rounded-lg border p-3 transition-all ${
                selectedType === type
                  ? "border-emerald-600 bg-emerald-900/20"
                  : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
              } ${locked ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{label}</span>
                {locked && (
                  <span className="text-xs text-zinc-500">Lv.{minLevel}+</span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
            </button>
          );
        })}

        {selectedType === "wager" && (
          <div className="flex items-center gap-2 mt-2">
            <label className="text-sm text-zinc-400">Wager (SUI):</label>
            <input
              type="number"
              min={1}
              value={wagerAmount}
              onChange={(e) => setWagerAmount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-24 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
            />
          </div>
        )}

        <Button onClick={handleQueue} className="w-full">
          Enter Queue
        </Button>
      </CardBody>
    </Card>
  );
}
