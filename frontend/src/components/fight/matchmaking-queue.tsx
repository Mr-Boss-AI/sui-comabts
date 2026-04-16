"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useGame } from "@/hooks/useGameStore";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import { buildCreateWagerTx, buildAcceptWagerTx } from "@/lib/sui-contracts";
import type { FightType } from "@/types/game";

const FIGHT_TYPES: { type: FightType; label: string; desc: string; minLevel: number }[] = [
  { type: "friendly", label: "Friendly", desc: "No stakes, just practice", minLevel: 1 },
  { type: "ranked", label: "Ranked", desc: "ELO rating on the line", minLevel: 1 },
  { type: "wager", label: "Wager", desc: "Stake real SUI on the outcome", minLevel: 1 },
];

export function MatchmakingQueue() {
  const { state, dispatch } = useGame();
  const { fightQueue, character, pendingWagerAccept } = state;
  const [wagerAmount, setWagerAmount] = useState(0.1);
  const [selectedType, setSelectedType] = useState<FightType>("friendly");
  const [signing, setSigning] = useState(false);
  const dAppKit = useDAppKit();

  const level = character?.level ?? 1;

  const handleQueue = useCallback(async () => {
    // Include on-chain equipped items so the server can apply their stats in combat
    const onChainEquipment: Record<string, unknown> = {};
    for (const [slot, item] of Object.entries(state.onChainEquipped)) {
      if (item) onChainEquipment[slot] = item;
    }

    if (selectedType === "wager") {
      // Sign create_wager on-chain first
      setSigning(true);
      try {
        const stakeAmountMist = BigInt(Math.round(wagerAmount * 1_000_000_000));
        const tx = buildCreateWagerTx(stakeAmountMist);

        const signer = new CurrentAccountSigner(dAppKit as any);
        const result = await signer.signAndExecuteTransaction({ transaction: tx });

        // Extract the WagerMatch object ID from created objects
        const resultAny = result as any;
        const createdObjects = resultAny.effects?.created || resultAny.objectChanges?.filter((c: any) => c.type === "created") || [];
        const sharedObj = createdObjects.find((o: any) =>
          o.owner === "Shared" || o.owner?.Shared || o.objectType?.includes("WagerMatch")
        );
        const wagerMatchId = sharedObj?.reference?.objectId || sharedObj?.objectId;

        if (!wagerMatchId) {
          dispatch({ type: "SET_ERROR", message: "Could not find WagerMatch object in transaction result. Check explorer." });
          setSigning(false);
          return;
        }

        console.log("[Wager] Created on-chain escrow:", wagerMatchId);

        state.socket.send({
          type: "queue_fight",
          fightType: "wager",
          wagerAmount,
          wagerMatchId,
          onChainEquipment: Object.keys(onChainEquipment).length > 0 ? onChainEquipment : undefined,
        });
      } catch (err: any) {
        console.error("[Wager] create_wager failed:", err);
        dispatch({ type: "SET_ERROR", message: err?.message || "Wallet transaction rejected" });
      } finally {
        setSigning(false);
      }
      return;
    }

    // Non-wager: queue normally
    state.socket.send({
      type: "queue_fight",
      fightType: selectedType,
      wagerAmount: undefined,
      onChainEquipment: Object.keys(onChainEquipment).length > 0 ? onChainEquipment : undefined,
    });
  }, [selectedType, wagerAmount, state.onChainEquipped, state.socket, dAppKit, dispatch]);

  const handleCancel = useCallback(() => {
    state.socket.send({ type: "cancel_queue" });
  }, [state.socket]);

  // Handle incoming wager accept request (Player B flow)
  const handleAcceptWager = useCallback(async () => {
    if (!pendingWagerAccept) return;
    setSigning(true);
    try {
      const stakeAmountMist = BigInt(Math.round(pendingWagerAccept.stakeAmount * 1_000_000_000));
      const tx = buildAcceptWagerTx(pendingWagerAccept.wagerMatchId, stakeAmountMist);

      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      const resultAny = result as any;
      const digest = resultAny.digest || resultAny.effects?.transactionDigest;

      state.socket.send({
        type: "wager_accepted",
        wagerMatchId: pendingWagerAccept.wagerMatchId,
        txDigest: digest,
      });

      dispatch({ type: "SET_PENDING_WAGER_ACCEPT", payload: null });
    } catch (err: any) {
      console.error("[Wager] accept_wager failed:", err);
      dispatch({ type: "SET_ERROR", message: err?.message || "Wallet transaction rejected" });
    } finally {
      setSigning(false);
    }
  }, [pendingWagerAccept, dAppKit, state.socket, dispatch]);

  const handleDeclineWager = useCallback(() => {
    dispatch({ type: "SET_PENDING_WAGER_ACCEPT", payload: null });
    // Server will timeout and handle cleanup
  }, [dispatch]);

  // Show wager accept prompt (Player B)
  if (pendingWagerAccept) {
    return (
      <Card glow>
        <CardBody className="text-center space-y-4 py-6">
          <div className="text-lg font-bold text-amber-400">Wager Challenge!</div>
          <div className="text-sm text-zinc-300">
            <span className="font-semibold">{pendingWagerAccept.opponentName}</span> wants to fight for{" "}
            <span className="text-amber-400 font-bold">{pendingWagerAccept.stakeAmount} SUI</span>
          </div>
          <p className="text-xs text-zinc-500">
            Your wallet will prompt you to stake {pendingWagerAccept.stakeAmount} SUI into on-chain escrow.
            Winner takes 95%, 5% platform fee.
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={handleAcceptWager} disabled={signing}>
              {signing ? "Signing..." : "Accept & Stake SUI"}
            </Button>
            <Button variant="secondary" onClick={handleDeclineWager} disabled={signing}>
              Decline
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  // Show queue status
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
              disabled={locked || signing}
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
          <div className="space-y-2 mt-2">
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-400">Stake (SUI):</label>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={wagerAmount}
                onChange={(e) => setWagerAmount(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                className="w-24 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
              />
            </div>
            <p className="text-xs text-zinc-500">
              Your wallet will sign a transaction to lock {wagerAmount} SUI in on-chain escrow.
              Winner gets 95%. 5% platform fee.
            </p>
          </div>
        )}

        <Button onClick={handleQueue} className="w-full" disabled={signing}>
          {signing ? "Signing transaction..." : selectedType === "wager" ? "Stake SUI & Enter Queue" : "Enter Queue"}
        </Button>
      </CardBody>
    </Card>
  );
}
