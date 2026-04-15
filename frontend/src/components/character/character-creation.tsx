"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatBar } from "@/components/ui/stat-bar";
import { useGame } from "@/hooks/useGameStore";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner, type DAppKit } from "@mysten/dapp-kit-core";
import { computeDerivedStats, getArchetype, getArchetypeColor } from "@/lib/combat";
import { buildMintCharacterTx } from "@/lib/sui-contracts";
import type { CharacterStats, EquipmentSlots } from "@/types/game";

const TOTAL_POINTS = 20;
const MIN_STAT = 3;
const MAX_STAT = 14;

const emptyEquipment: EquipmentSlots = {
  weapon: null, offhand: null, helmet: null, chest: null, gloves: null,
  boots: null, belt: null, ring1: null, ring2: null, necklace: null,
};

const STAT_DESCRIPTIONS: Record<keyof CharacterStats, string> = {
  strength: "Raw power. Increases attack damage and anti-evasion.",
  dexterity: "Agility. Increases evasion chance and some attack.",
  intuition: "Critical eye. Increases crit chance and crit damage.",
  endurance: "Toughness. Increases HP, defense, and anti-crit.",
};

const STAT_COLORS: Record<keyof CharacterStats, string> = {
  strength: "bg-red-500",
  dexterity: "bg-cyan-500",
  intuition: "bg-purple-500",
  endurance: "bg-amber-500",
};

export function CharacterCreation() {
  const { state } = useGame();
  const dAppKit = useDAppKit() as unknown as DAppKit;
  const [name, setName] = useState("");
  const [stats, setStats] = useState<CharacterStats>({
    strength: 5,
    dexterity: 5,
    intuition: 5,
    endurance: 5,  // 20 total, min 3 each
  });
  const [submitting, setSubmitting] = useState(false);
  const [mintStatus, setMintStatus] = useState("");
  const [error, setError] = useState("");

  const pointsUsed = stats.strength + stats.dexterity + stats.intuition + stats.endurance;
  const pointsLeft = TOTAL_POINTS - pointsUsed;

  const derived = useMemo(
    () => computeDerivedStats(stats, emptyEquipment, undefined, 1),
    [stats]
  );

  const archetype = useMemo(() => getArchetype(stats), [stats]);

  function adjustStat(stat: keyof CharacterStats, delta: number) {
    setStats((prev) => {
      const newVal = prev[stat] + delta;
      if (newVal < MIN_STAT || newVal > MAX_STAT) return prev;
      const newStats = { ...prev, [stat]: newVal };
      const total = newStats.strength + newStats.dexterity + newStats.intuition + newStats.endurance;
      if (total > TOTAL_POINTS) return prev;
      return newStats;
    });
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (name.trim().length < 2 || name.trim().length > 20) {
      setError("Name must be 2-20 characters");
      return;
    }
    if (pointsLeft !== 0) {
      setError(`Allocate all ${TOTAL_POINTS} points`);
      return;
    }
    setError("");
    setSubmitting(true);

    // Step 1: Mint soulbound Character NFT on-chain
    try {
      setMintStatus("Minting character on Sui...");
      const tx = buildMintCharacterTx(
        name.trim(),
        stats.strength,
        stats.dexterity,
        stats.intuition,
        stats.endurance,
      );
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setError(`On-chain mint failed: ${msg}`);
      setSubmitting(false);
      setMintStatus("");
      return;
    }

    // Step 2: Create character on game server
    setMintStatus("Setting up game character...");
    state.socket.send({
      type: "create_character",
      name: name.trim(),
      ...stats,
    });
    // Reset submitting after timeout (server will respond with character_created)
    setTimeout(() => {
      setSubmitting(false);
      setMintStatus("");
    }, 5000);
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-4 max-w-2xl mx-auto w-full gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">Create Your Fighter</h1>
        <p className="text-zinc-400">
          Distribute {TOTAL_POINTS} stat points to define your build
        </p>
      </div>

      <Card className="w-full">
        <CardHeader>
          <label className="text-sm text-zinc-400">Fighter Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="Enter a name..."
            className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-zinc-400">
              Points remaining:{" "}
              <span className={pointsLeft === 0 ? "text-emerald-400" : "text-amber-400"}>
                {pointsLeft}
              </span>
            </span>
            <span className={`text-sm font-bold ${getArchetypeColor(archetype)}`}>
              {archetype} Build
            </span>
          </div>

          {(Object.keys(stats) as (keyof CharacterStats)[]).map((stat) => (
            <div key={stat} className="space-y-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => adjustStat(stat, -1)}
                  disabled={stats[stat] <= MIN_STAT}
                  className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30 font-bold text-lg flex items-center justify-center"
                >
                  -
                </button>
                <div className="flex-1">
                  <StatBar
                    label={stat.charAt(0).toUpperCase() + stat.slice(1, 3).toUpperCase()}
                    value={stats[stat]}
                    max={MAX_STAT}
                    color={STAT_COLORS[stat]}
                  />
                </div>
                <button
                  onClick={() => adjustStat(stat, 1)}
                  disabled={stats[stat] >= MAX_STAT || pointsLeft <= 0}
                  className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30 font-bold text-lg flex items-center justify-center"
                >
                  +
                </button>
              </div>
              <p className="text-xs text-zinc-500 ml-10">{STAT_DESCRIPTIONS[stat]}</p>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card className="w-full">
        <CardHeader>
          <span className="font-semibold text-sm">Combat Preview</span>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">HP</span>
              <span className="text-red-400 font-mono">{derived.maxHp}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Attack</span>
              <span className="text-orange-400 font-mono">{derived.attackPower}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Crit %</span>
              <span className="text-purple-400 font-mono">{derived.critChance}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Crit Multi</span>
              <span className="text-purple-400 font-mono">{derived.critMultiplier}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Evasion</span>
              <span className="text-cyan-400 font-mono">{derived.evasionChance}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Defense</span>
              <span className="text-amber-400 font-mono">{derived.defense}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <Button
        size="lg"
        onClick={handleSubmit}
        disabled={pointsLeft !== 0 || !name.trim() || submitting}
        className="w-full"
      >
        {submitting ? (mintStatus || "Creating...") : "Create Fighter"}
      </Button>
    </div>
  );
}
