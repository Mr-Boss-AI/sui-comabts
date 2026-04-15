"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useGame } from "@/hooks/useGameStore";
import type { Character, CharacterStats } from "@/types/game";

export function StatAllocateModal({
  character,
  onClose,
}: {
  character: Character;
  onClose: () => void;
}) {
  const { state } = useGame();
  const available = character.unallocatedPoints;
  const [alloc, setAlloc] = useState<CharacterStats>({
    strength: 0,
    dexterity: 0,
    intuition: 0,
    endurance: 0,
  });

  const used = alloc.strength + alloc.dexterity + alloc.intuition + alloc.endurance;
  const remaining = available - used;

  function adjust(stat: keyof CharacterStats, delta: number) {
    setAlloc((prev) => {
      const newVal = prev[stat] + delta;
      if (newVal < 0) return prev;
      const newAlloc = { ...prev, [stat]: newVal };
      const total =
        newAlloc.strength + newAlloc.dexterity + newAlloc.intuition + newAlloc.endurance;
      if (total > available) return prev;
      return newAlloc;
    });
  }

  function handleAllocate() {
    if (used === 0) return;
    state.socket.send({
      type: "allocate_points",
      ...alloc,
    });
    onClose();
  }

  const stats: (keyof CharacterStats)[] = ["strength", "dexterity", "intuition", "endurance"];
  const labels: Record<keyof CharacterStats, string> = {
    strength: "Strength",
    dexterity: "Dexterity",
    intuition: "Intuition",
    endurance: "Endurance",
  };
  const colors: Record<keyof CharacterStats, string> = {
    strength: "text-red-400",
    dexterity: "text-cyan-400",
    intuition: "text-purple-400",
    endurance: "text-amber-400",
  };

  return (
    <Modal open onClose={onClose} title={`Allocate ${available} Stat Points`}>
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          Remaining: <span className="text-amber-400 font-bold">{remaining}</span>
        </p>
        {stats.map((stat) => (
          <div key={stat} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`font-medium ${colors[stat]}`}>{labels[stat]}</span>
              <span className="text-xs text-zinc-500">
                ({character.stats[stat]} + {alloc[stat]})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => adjust(stat, -1)}
                disabled={alloc[stat] <= 0}
                className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-sm font-bold"
              >
                -
              </button>
              <span className="w-6 text-center font-mono">{alloc[stat]}</span>
              <button
                onClick={() => adjust(stat, 1)}
                disabled={remaining <= 0}
                className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-sm font-bold"
              >
                +
              </button>
            </div>
          </div>
        ))}
        <Button onClick={handleAllocate} disabled={used === 0} className="w-full">
          Allocate Points
        </Button>
      </div>
    </Modal>
  );
}
