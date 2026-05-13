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

        // Re-fetch on-chain character for updated unallocated_points.
        // BUG E fix (2026-05-02 retest #2): pass the server-pinned id so
        // multi-character wallets read the canonical NFT.
        if (client) {
          const nft = await fetchCharacterNFT(
            client,
            character.walletAddress,
            character.onChainObjectId ?? null,
          );
          if (nft) dispatch({ type: "SET_ONCHAIN_CHARACTER", data: nft });
        }

        // BUG B fix (2026-05-02 retest): chain TX succeeded — reflect the
        // new stats locally NOW so the user sees the right numbers
        // regardless of what happens with the WS sync below. Pre-fix the
        // WS allocate_points could land while the socket was mid-reconnect
        // (auth-pending), the server rejected it with "Not authenticated",
        // and the user saw a red error toast even though the chain
        // accepted the allocation.
        dispatch({ type: "LOCAL_ALLOCATE", ...alloc });
      }

      // Best-effort server sync. If the WS is mid-reconnect, the server
      // will reject this with "Not authenticated" — game-provider's
      // error handler suppresses that specific toast (see BUG B fix).
      // Server reconciles its in-memory stats on next chain re-read
      // (acceptAuthenticatedSession's DOF hydration + onChainCharacter
      // fetch triggered by get_character).
      state.socket.send({
        type: "allocate_points",
        ...alloc,
      });

      onClose();
    } catch (err: any) {
      console.error("[Stats] allocate_points chain tx failed:", err);
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
    strength: "var(--stat-str)",
    dexterity: "var(--stat-dex)",
    intuition: "var(--stat-int)",
    endurance: "var(--stat-end)",
  };

  return (
    <Modal open onClose={onClose} title={`Allocate ${available} Stat Points`}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          fontFamily: "var(--font-ui)",
          color: "var(--sc-parchment)",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--fg-2)",
            fontFamily: "var(--font-ui)",
          }}
        >
          Remaining:{" "}
          <span
            style={{
              color: "var(--sc-bronze)",
              fontWeight: 800,
              fontFamily: "var(--font-mono)",
              fontSize: 14,
            }}
          >
            {remaining}
          </span>
        </p>
        {stats.map((stat) => (
          <div
            key={stat}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 10px",
              background: "var(--sc-panel-2)",
              border: "1px solid var(--sc-rim)",
              borderLeft: `3px solid ${colors[stat]}`,
              borderRadius: "var(--r-card)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 13,
                  color: colors[stat],
                  letterSpacing: "0.02em",
                }}
              >
                {labels[stat]}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--fg-3)",
                }}
              >
                {character.stats[stat]} + {alloc[stat]}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => adjust(stat, -1)}
                disabled={alloc[stat] <= 0 || signing}
                style={{
                  width: 28,
                  height: 28,
                  background: "var(--sc-page)",
                  color: "var(--sc-parchment)",
                  border: `1px solid ${alloc[stat] > 0 ? "var(--sc-bronze)" : "var(--sc-rim-2)"}`,
                  borderRadius: "var(--r-sm)",
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: alloc[stat] > 0 ? "pointer" : "not-allowed",
                  opacity: alloc[stat] > 0 ? 1 : 0.3,
                  fontFamily: "var(--font-mono)",
                }}
              >
                −
              </button>
              <span
                style={{
                  width: 32,
                  textAlign: "center",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 800,
                  fontSize: 16,
                  color: alloc[stat] > 0 ? "var(--sc-bronze)" : "var(--sc-parchment)",
                }}
              >
                {alloc[stat]}
              </span>
              <button
                onClick={() => adjust(stat, 1)}
                disabled={remaining <= 0 || signing}
                style={{
                  width: 28,
                  height: 28,
                  background: remaining > 0 ? "var(--sc-bronze)" : "var(--sc-panel-2)",
                  color: remaining > 0 ? "var(--sc-page)" : "var(--fg-3)",
                  border: `1px solid ${remaining > 0 ? "var(--sc-bronze-deep)" : "var(--sc-rim-2)"}`,
                  borderRadius: "var(--r-sm)",
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: remaining > 0 ? "pointer" : "not-allowed",
                  opacity: remaining > 0 ? 1 : 0.3,
                  fontFamily: "var(--font-mono)",
                  boxShadow: remaining > 0 ? "var(--sh-plate-sm)" : "none",
                }}
              >
                +
              </button>
            </div>
          </div>
        ))}
        {characterObjectId && (
          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: "var(--fg-3)",
              lineHeight: 1.45,
            }}
          >
            This will open your wallet to sign the transaction on-chain.
          </p>
        )}
        {awaitingChain && (
          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: "var(--sc-bronze)",
              padding: "8px 10px",
              background: "rgba(200,154,63,.10)",
              borderLeft: "3px solid var(--sc-bronze)",
              borderRadius: "var(--r-sm)",
              lineHeight: 1.45,
            }}
          >
            Chain state is catching up after your last fight. A few of your
            new points haven&apos;t landed on chain yet — they&apos;ll appear
            here in 5–10 seconds.
          </p>
        )}
        <Button
          onClick={handleAllocate}
          disabled={used === 0 || signing}
          style={{ width: "100%" }}
        >
          {signing ? "Signing transaction…" : "Allocate Points"}
        </Button>
      </div>
    </Modal>
  );
}
