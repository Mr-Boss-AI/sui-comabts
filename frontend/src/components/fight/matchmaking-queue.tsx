"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGame } from "@/hooks/useGameStore";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import { buildCreateWagerTx, buildAcceptWagerTx, buildCancelWagerTx } from "@/lib/sui-contracts";
import { registerWagerWithServer, deriveHttpBaseUrl } from "@/lib/wager-register";
import { parseWagerInput, MIN_STAKE_SUI } from "@/lib/wager-input";
import type { FightType, WagerLobbyEntry } from "@/types/game";

const FIGHT_TYPES: { type: FightType; label: string; desc: string; minLevel: number }[] = [
  { type: "friendly", label: "Friendly", desc: "No stakes, just practice", minLevel: 1 },
  { type: "ranked", label: "Ranked", desc: "ELO rating on the line", minLevel: 1 },
  { type: "wager", label: "Wager", desc: "Stake real SUI on the outcome", minLevel: 1 },
];

function getArchetypeLabel(stats: { strength: number; dexterity: number; intuition: number; endurance: number }): string {
  const max = Math.max(stats.strength, stats.dexterity, stats.intuition, stats.endurance);
  if (max === stats.strength) return "STR";
  if (max === stats.dexterity) return "DEX";
  if (max === stats.intuition) return "INT";
  return "END";
}

function getArchetypeColor(label: string): string {
  switch (label) {
    case "STR": return "text-red-400";
    case "DEX": return "text-cyan-400";
    case "INT": return "text-purple-400";
    case "END": return "text-amber-400";
    default: return "text-zinc-400";
  }
}

function timeAgo(timestamp: number): string {
  const secs = Math.floor((Date.now() - timestamp) / 1000);
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

function WagerLobbyCard({ entry, isOwn, onAccept, onCancel, signing }: {
  entry: WagerLobbyEntry;
  isOwn: boolean;
  onAccept: () => void;
  onCancel: () => void;
  signing: boolean;
}) {
  const archetype = getArchetypeLabel(entry.creatorStats);
  const color = getArchetypeColor(archetype);

  return (
    <div className={`rounded-lg border p-3 transition-all ${
      isOwn
        ? "border-amber-700/40 bg-amber-900/10"
        : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-zinc-100 truncate">{entry.creatorName}</span>
            <Badge variant="info">Lv.{entry.creatorLevel}</Badge>
            <span className={`text-xs font-bold ${color}`}>{archetype}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
            <span>{entry.creatorRating} ELO</span>
            <span>S{entry.creatorStats.strength} D{entry.creatorStats.dexterity} I{entry.creatorStats.intuition} E{entry.creatorStats.endurance}</span>
            <span>{timeAgo(entry.createdAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-amber-400 font-bold text-sm">{entry.wagerAmount} SUI</span>
          {isOwn ? (
            <Button variant="danger" size="sm" onClick={onCancel} disabled={signing}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" onClick={onAccept} disabled={signing}>
              {signing ? "Signing..." : "Accept"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MatchmakingQueue() {
  const { state, dispatch } = useGame();
  const { fightQueue, character, wagerLobby } = state;
  // Stake is held as a STRING — the raw user text — so the input is
  // freely editable (clearable, partial like "0.", multi-digit edits)
  // without snap-back. `parseWagerInput` validates on every render
  // for live UX hints, and again on submit (Create Wager) as the
  // authoritative gate. See `frontend/src/lib/wager-input.ts`.
  const [wagerInput, setWagerInput] = useState(String(MIN_STAKE_SUI));
  const [selectedType, setSelectedType] = useState<FightType>("friendly");
  const [signing, setSigning] = useState(false);
  const dAppKit = useDAppKit();
  const balance = useWalletBalance();
  // Reserve a buffer for gas. 0.05 SUI is more than enough headroom for the
  // create_wager tx (typical gas is <0.005 SUI) and prevents the user from
  // staking literally everything and then bricking the next call.
  const GAS_BUFFER_SUI = 0.05;
  const parsedWager = parseWagerInput(wagerInput);
  // Numeric stake for downstream calls — when the input is invalid we
  // still need *some* number for messaging like the lock-escrow line;
  // fall back to the minimum (it's the floor anyway, never overstates).
  const wagerAmount = parsedWager.ok ? parsedWager.amount : MIN_STAKE_SUI;
  const insufficientFunds = wagerAmount + GAS_BUFFER_SUI > balance.sui;

  const level = character?.level ?? 1;
  const walletAddress = character?.walletAddress ?? "";

  // Check if current player has an open wager in the lobby
  const ownLobbyEntry = wagerLobby.find(e => e.creatorWallet === walletAddress);

  const handleQueue = useCallback(async () => {
    // Note: we no longer include an onChainEquipment payload. Per D3-strict
    // (LOADOUT_DESIGN.md), the server re-reads DOFs at fight start via
    // fight-room.ts::createFight — any client-sent equipment claim is
    // ignored and could only lie. The hook's Save Loadout flow puts the
    // truth on-chain in DOFs; the server reads those.
    if (selectedType === "wager") {
      // Authoritative validation gate. The button is disabled when the
      // parsed input is invalid, but a determined user could still get
      // here via keyboard — surface a clear error and bail before
      // signing rather than rounding silently.
      if (!parsedWager.ok) {
        dispatch({ type: "SET_ERROR", message: parsedWager.reason });
        return;
      }
      // Sign create_wager on-chain first
      setSigning(true);
      try {
        const stakeAmountMist = BigInt(Math.round(parsedWager.amount * 1_000_000_000));
        const tx = buildCreateWagerTx(stakeAmountMist);

        const signer = new CurrentAccountSigner(dAppKit as any);
        const result = await signer.signAndExecuteTransaction({ transaction: tx });

        // Unwrap discriminated union: { $kind: 'Transaction', Transaction: { effects } }
        const resultAny = result as any;
        const txData = resultAny.Transaction || resultAny.FailedTransaction || resultAny;

        // v2 SDK uses changedObjects with idOperation/outputOwner
        const changedObjects: any[] = txData.effects?.changedObjects || [];
        const sharedObj = changedObjects.find((o: any) =>
          o.idOperation === "Created" && (o.outputOwner?.$kind === "Shared" || o.outputOwner?.Shared)
        );
        const wagerMatchId = sharedObj?.objectId;

        if (!wagerMatchId) {
          // Sticky: the user just locked real SUI on-chain. If we fail to
          // extract the wager ID, the lobby entry will never get created
          // and the escrow is orphaned until admin recovery. They MUST see
          // this error — a 5s toast is too easy to miss.
          const digest = txData.digest || txData.effects?.transactionDigest || "(unknown)";
          dispatch({
            type: "SET_ERROR",
            sticky: true,
            message:
              `Your ${wagerAmount} SUI was locked on-chain (tx ${digest}) but the app couldn't read the wager ID from the transaction result. ` +
              `The funds are NOT lost — ping the dev to run the admin-adopt-wager endpoint with your tx digest. ` +
              `Do NOT retry or you'll lock a second stake.`,
          });
          console.error("[Wager] wagerMatchId extraction failed. tx data:", txData);
          setSigning(false);
          return;
        }

        console.log("[Wager] Created on-chain escrow:", wagerMatchId);

        // Reliable registration: WS-send-then-ACK with REST fallback. Closes
        // the silent-WS-loss orphan class (live test 2026-05-02 reproduced
        // a stuck 0.8 SUI wager when socket.send returned true but the
        // bytes never reached the server — TCP-level death between
        // readyState check and write). See lib/wager-register.ts.
        const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
        const httpBase = deriveHttpBaseUrl(wsUrl);
        const regResult = await registerWagerWithServer(wagerMatchId, {
          sendQueueFight: () =>
            state.socket.send({
              type: "queue_fight",
              fightType: "wager",
              wagerAmount,
              wagerMatchId,
            }),
          onMessage: (handler) => state.socket.addHandler(handler),
          adoptWager: async (id) => {
            const r = await fetch(`${httpBase}/api/admin/adopt-wager`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ wagerMatchId: id }),
            });
            if (!r.ok) {
              const text = await r.text().catch(() => "");
              return { ok: false, error: `adopt-wager HTTP ${r.status}: ${text || r.statusText}` };
            }
            return { ok: true };
          },
        });

        if (regResult.kind === "ack") {
          console.log("[Wager] Server ACKed lobby entry for", wagerMatchId);
        } else if (regResult.kind === "recovered") {
          console.warn("[Wager] WS ACK timed out — recovered via adopt-wager:", wagerMatchId);
        } else {
          // Both paths failed. The wager IS on chain; the server has no
          // record. Sticky error tells the user EXACTLY what to do (don't
          // retry the create — would lock a second stake) and how to
          // self-recover (cancel the wager from their wallet).
          const digest = txData.digest || txData.effects?.transactionDigest || "(unknown)";
          dispatch({
            type: "SET_ERROR",
            sticky: true,
            message:
              `Your ${wagerAmount} SUI is locked on-chain (tx ${digest}, wager ${wagerMatchId.slice(0, 12)}...) ` +
              `but the game server didn't register the lobby entry, and recovery via adopt-wager also failed: ${regResult.reason}. ` +
              `Do NOT retry creating a wager — you'll lock a second stake. Refresh the page and try again, or ask the dev to run: ` +
              `POST /api/admin/cancel-wager { wagerMatchId: "${wagerMatchId}" } to refund.`,
          });
          console.error("[Wager] register failed both paths:", regResult.reason);
        }
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
    });
  }, [selectedType, wagerAmount, state.socket, dAppKit, dispatch]);

  const handleCancel = useCallback(() => {
    state.socket.send({ type: "cancel_queue" });
  }, [state.socket]);

  const handleAcceptWager = useCallback(async (entry: WagerLobbyEntry) => {
    setSigning(true);
    try {
      const stakeAmountMist = BigInt(Math.round(entry.wagerAmount * 1_000_000_000));
      const tx = buildAcceptWagerTx(entry.wagerMatchId, stakeAmountMist);

      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      const resultAny = result as any;
      const txData = resultAny.Transaction || resultAny.FailedTransaction || resultAny;
      const digest = txData.digest || txData.effects?.transactionDigest;

      state.socket.send({
        type: "wager_accepted",
        wagerMatchId: entry.wagerMatchId,
        txDigest: digest,
      });
    } catch (err: any) {
      console.error("[Wager] accept_wager failed:", err);
      dispatch({ type: "SET_ERROR", message: err?.message || "Wallet transaction rejected" });
    } finally {
      setSigning(false);
    }
  }, [dAppKit, state.socket, dispatch]);

  const handleCancelWager = useCallback(async (entry: WagerLobbyEntry) => {
    setSigning(true);
    try {
      // Cancel on-chain first (player's own cancel)
      const tx = buildCancelWagerTx(entry.wagerMatchId);
      const signer = new CurrentAccountSigner(dAppKit as any);
      await signer.signAndExecuteTransaction({ transaction: tx });

      // Tell server to remove from lobby
      state.socket.send({
        type: "cancel_wager_lobby",
        wagerMatchId: entry.wagerMatchId,
      });
    } catch (err: any) {
      console.error("[Wager] cancel_wager failed:", err);
      dispatch({ type: "SET_ERROR", message: err?.message || "Wallet cancel rejected" });
    } finally {
      setSigning(false);
    }
  }, [dAppKit, state.socket, dispatch]);

  // Show queue status (friendly/ranked only)
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
        {/* Fight type selector */}
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

        {/* Wager lobby */}
        {selectedType === "wager" && (
          <div className="space-y-3 mt-2">
            {/* Create wager form */}
            {!ownLobbyEntry && (
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-zinc-400">Stake (SUI):</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={wagerInput}
                    placeholder={`${MIN_STAKE_SUI} minimum`}
                    onChange={(e) => setWagerInput(e.target.value)}
                    aria-invalid={!parsedWager.ok}
                    className={`w-24 bg-zinc-800 border rounded px-2 py-1 text-sm text-zinc-100 ${
                      parsedWager.ok ? "border-zinc-700" : "border-red-700/60"
                    }`}
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  Wallet balance: <span className="text-amber-300 font-mono">{balance.sui.toFixed(3)} SUI</span>
                  {balance.error ? <span className="text-red-400 ml-2">({balance.error})</span> : null}
                </p>
                {parsedWager.ok ? (
                  <p className="text-xs text-zinc-500">
                    Your wallet will lock {parsedWager.amount} SUI in on-chain escrow.
                    Winner gets 95%. 5% platform fee.
                  </p>
                ) : (
                  <p className="text-xs text-red-400">{parsedWager.reason}</p>
                )}
                {parsedWager.ok && insufficientFunds && (
                  <p className="text-xs text-red-400">
                    Insufficient SUI. Need at least {(wagerAmount + GAS_BUFFER_SUI).toFixed(3)} (stake + ~{GAS_BUFFER_SUI} gas).
                  </p>
                )}
                <Button
                  onClick={handleQueue}
                  className="w-full"
                  disabled={signing || !parsedWager.ok || insufficientFunds}
                >
                  {signing
                    ? "Signing transaction..."
                    : !parsedWager.ok
                      ? "Enter a valid stake"
                      : insufficientFunds
                        ? "Insufficient SUI"
                        : "Create Wager & Lock SUI"}
                </Button>
              </div>
            )}

            {/* Open wagers list */}
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider font-bold mb-2">
                Open Wagers ({wagerLobby.length})
              </div>
              {wagerLobby.length === 0 ? (
                <p className="text-sm text-zinc-600 text-center py-4">
                  No open wagers. Create one to challenge others!
                </p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {wagerLobby.map((entry) => (
                    <WagerLobbyCard
                      key={entry.wagerMatchId}
                      entry={entry}
                      isOwn={entry.creatorWallet === walletAddress}
                      onAccept={() => handleAcceptWager(entry)}
                      onCancel={() => handleCancelWager(entry)}
                      signing={signing}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Non-wager: Enter Queue button */}
        {selectedType !== "wager" && (
          <Button onClick={handleQueue} className="w-full" disabled={signing}>
            Enter Queue
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
