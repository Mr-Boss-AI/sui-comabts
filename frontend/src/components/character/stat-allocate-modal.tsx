"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useGame } from "@/hooks/useGameStore";
import { useDAppKit, useCurrentClient } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import { buildAllocateStatsTx, fetchCharacterNFT } from "@/lib/sui-contracts";
import { effectiveUnallocatedPoints, isAwaitingChainCatchup } from "@/lib/stat-points";
import type { Character, CharacterStats } from "@/types/game";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

export function StatAllocateModal({
  character,
  characterObjectId,
  onClose,
}: {
  character: Character;
  characterObjectId?: string;
  onClose: () => void;
}) {
  const { state, dispatch } = useGame();
  const dAppKit = useDAppKit();
  const client = useCurrentClient() as SuiGrpcClient | null;
  // BUG 1 (live test 2026-05-02): chain is the contract's source of truth
  // for allocate_points; the server value can be ahead during the
  // post-fight treasury-queue window. Clamp to min(server, chain) so the
  // modal never offers points the chain can't accept.
  const available = effectiveUnallocatedPoints(
    character.unallocatedPoints,
    state.onChainCharacter?.unallocatedPoints,
  );
  const awaitingChain = isAwaitingChainCatchup(
    character.unallocatedPoints,
    state.onChainCharacter?.unallocatedPoints,
  );
  const [alloc, setAlloc] = useState<CharacterStats>({
    strength: 0,
    dexterity: 0,
    intuition: 0,
    endurance: 0,
  });
  const [signing, setSigning] = useState(false);

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

  async function handleAllocate() {
    if (used === 0) return;
    setSigning(true);
    try {
      // If on-chain character exists, sign wallet tx first
      if (characterObjectId) {
        const tx = buildAllocateStatsTx(
          characterObjectId,
          alloc.strength,
          alloc.dexterity,
          alloc.intuition,
          alloc.endurance,
        );
        const signer = new CurrentAccountSigner(dAppKit as any);
        await signer.signAndExecuteTransaction({ transaction: tx });

        // Re-fetch on-chain character for updated unallocated_points
        if (client) {
          const nft = await fetchCharacterNFT(client, character.walletAddress);
          if (nft) dispatch({ type: "SET_ONCHAIN_CHARACTER", data: nft });
        }
      }

      // Always update server-side stats
      state.socket.send({
        type: "allocate_points",
        ...alloc,
      });

      onClose();
    } catch (err: any) {
      console.error("[Stats] allocate_points failed:", err);
      dispatch({ type: "SET_ERROR", message: err?.message || "Stat allocation failed" });
    } finally {
      setSigning(false);
    }
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
                disabled={alloc[stat] <= 0 || signing}
                className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-sm font-bold"
              >
                -
              </button>
              <span className="w-6 text-center font-mono">{alloc[stat]}</span>
              <button
                onClick={() => adjust(stat, 1)}
                disabled={remaining <= 0 || signing}
                className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-sm font-bold"
              >
                +
              </button>
            </div>
          </div>
        ))}
        {characterObjectId && (
          <p className="text-xs text-zinc-500">
            This will open your wallet to sign the transaction on-chain.
          </p>
        )}
        {awaitingChain && (
          <p className="text-xs text-amber-400">
            Chain state is catching up after your last fight. A few of your
            new points haven&apos;t landed on chain yet — they&apos;ll appear
            here in 5–10 seconds.
          </p>
        )}
        <Button onClick={handleAllocate} disabled={used === 0 || signing} className="w-full">
          {signing ? "Signing transaction..." : "Allocate Points"}
        </Button>
      </div>
    </Modal>
  );
}
