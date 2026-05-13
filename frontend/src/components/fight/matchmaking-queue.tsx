"use client";

import { useState, useCallback, useEffect } from "react";
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
import { canAcceptWager } from "@/lib/wager-accept-gate";
import { computeBusyState, decideMatchmakingRender } from "@/lib/busy-state";
import type { FightType, WagerLobbyEntry } from "@/types/game";

function suiFromMist(stakeMist: string): string {
  try {
    const mist = BigInt(stakeMist);
    const whole = mist / 1_000_000_000n;
    const frac = mist % 1_000_000_000n;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
    return `${whole.toString()}.${fracStr}`;
  } catch {
    return "0.1";
  }
}

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

function WagerLobbyCard({
  entry,
  isOwn,
  onAccept,
  onCancel,
  signing,
  disableAccept = false,
  disableReason,
}: {
  entry: WagerLobbyEntry;
  isOwn: boolean;
  onAccept: () => void;
  onCancel: () => void;
  signing: boolean;
  /** When true, the Accept button is hard-disabled regardless of `signing`.
   *  Set by the parent when the caller has their own open wager — closes the
   *  silent-accept bug (2026-05-04, see lib/wager-accept-gate.ts header). */
  disableAccept?: boolean;
  /** Tooltip shown on hover of the disabled Accept button. */
  disableReason?: string;
}) {
  const archetype = getArchetypeLabel(entry.creatorStats);
  const color = getArchetypeColor(archetype);
  const acceptBlocked = disableAccept || signing;

  return (
    <div
      className="p-3 transition-all"
      style={{
        border: isOwn
          ? "2px solid var(--sc-bronze)"
          : "1px solid var(--sc-rim-2)",
        borderLeft: isOwn ? "3px solid var(--sc-bronze)" : "1px solid var(--sc-rim-2)",
        background: isOwn ? "rgba(200,154,63,0.08)" : "var(--sc-panel-2)",
        borderRadius: "var(--r-card)",
        boxShadow: isOwn ? "var(--sh-plate-sm)" : "var(--rim-top), var(--rim-bottom)",
        fontFamily: "var(--font-ui)",
      }}
    >
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
            <Button
              size="sm"
              onClick={onAccept}
              disabled={acceptBlocked}
              title={disableAccept ? disableReason : undefined}
            >
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

  // Bucket 3 — when a wager challenge lands, the game-provider sets
  // `prefilledWagerTarget` and switches to the Arena. Pre-fill the
  // stake input + lock selectedType to wager so the user can sign
  // create_wager immediately.
  useEffect(() => {
    const prefill = state.prefilledWagerTarget;
    if (!prefill) return;
    setSelectedType("wager");
    if (prefill.stakeMist) {
      setWagerInput(suiFromMist(prefill.stakeMist));
    }
  }, [state.prefilledWagerTarget]);
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

  // Cross-mode busy state — gates Friendly/Ranked/Wager-create simultaneously
  // (Fix 1 of Bucket 2 close-out, 2026-05-04). The render-slot predicate
  // (Bucket 2 polish, same date) translates the busy kind into which UI
  // sections to mount: when the player has an open wager, only the lobby
  // surfaces (with their wager + Cancel button); when idle, the full
  // selector + create + browse flow. The server-side gate stays as
  // defense in depth — every queue/wager handler in `handleQueueFight`
  // re-validates regardless of what the client renders.
  const busy = computeBusyState({
    callerWallet: walletAddress || null,
    ownLobbyEntry: ownLobbyEntry ?? null,
    activeFight: state.fight,
    fightQueue,
    pendingWagerAccept: state.pendingWagerAccept,
  });
  const slots = decideMatchmakingRender({
    busyKind: busy.kind,
    selectedFightType: selectedType,
  });

  const handleQueue = useCallback(async () => {
    // Note: we no longer include an onChainEquipment payload. Per D3-strict
    // (LOADOUT_DESIGN.md), the server re-reads DOFs at fight start via
    // fight-room.ts::createFight — any client-sent equipment claim is
    // ignored and could only lie. The hook's Save Loadout flow puts the
    // truth on-chain in DOFs; the server reads those.

    // Cross-mode busy gate (Fix 1 of Bucket 2 close-out, 2026-05-04).
    // Defence-in-depth against any keyboard / dev-tools / programmatic
    // path that bypasses the disabled button. Same shape as the
    // `canAcceptWager` gate in `handleAcceptWager` (Fix A silent-accept).
    const busyNow = computeBusyState({
      callerWallet: walletAddress || null,
      ownLobbyEntry: state.wagerLobby.find((e) => e.creatorWallet === walletAddress) ?? null,
      activeFight: state.fight,
      fightQueue: state.fightQueue,
      pendingWagerAccept: state.pendingWagerAccept,
    });
    if (busyNow.busy) {
      console.warn("[Queue] Busy gate refused:", busyNow.kind, busyNow.reason);
      dispatch({ type: "SET_ERROR", message: busyNow.reason ?? "Cannot queue right now." });
      return;
    }

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
          // Bucket 3 — clear the prefilled-target banner once we've
          // committed the wager. The challenge handshake is done.
          if (state.prefilledWagerTarget) {
            dispatch({ type: "SET_PREFILLED_WAGER_TARGET", target: null });
          }
        } else if (regResult.kind === "recovered") {
          console.warn("[Wager] WS ACK timed out — recovered via adopt-wager:", wagerMatchId);
          if (state.prefilledWagerTarget) {
            dispatch({ type: "SET_PREFILLED_WAGER_TARGET", target: null });
          }
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
  }, [
    selectedType,
    wagerAmount,
    state.socket,
    state.wagerLobby,
    state.fight,
    state.fightQueue,
    state.pendingWagerAccept,
    walletAddress,
    parsedWager,
    dAppKit,
    dispatch,
  ]);

  const handleCancel = useCallback(() => {
    state.socket.send({ type: "cancel_queue" });
  }, [state.socket]);

  const handleAcceptWager = useCallback(async (entry: WagerLobbyEntry) => {
    // Defence in depth — the Accept button is already disabled in the
    // render path when the caller has their own open wager (Fix A,
    // 2026-05-04). This catches any keyboard / programmatic / dev-tools
    // override BEFORE we sign and lock SUI on chain.
    //
    // Without this guard, the chain `accept_wager` succeeds (it has no
    // "no own open wager" check) and the wager flips to STATUS_ACTIVE.
    // The server's WS check then rejects the follow-up message but the
    // chain state is already mutated — `cancel_wager` aborts with
    // `EMatchNotWaiting (1)`. See lib/wager-accept-gate.ts header for
    // the full chain-evidenced trace.
    const gate = canAcceptWager({
      callerWallet: walletAddress,
      targetWagerId: entry.wagerMatchId,
      lobby: wagerLobby,
    });
    if (!gate.allow) {
      console.warn(
        "[Wager] Accept gate refused:",
        gate.reason,
        gate.ownWagerId ? `(own=${gate.ownWagerId})` : "",
      );
      dispatch({ type: "SET_ERROR", message: gate.reason ?? "Cannot accept this wager." });
      return;
    }
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
  }, [dAppKit, state.socket, dispatch, walletAddress, wagerLobby]);

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
        {/* Fight type selector — hidden when the player is busy in
            another mode (Bucket 2 polish, 2026-05-04). The active state
            (open wager, queue panel, fight) is self-explanatory and
            cluttering the UI with greyed-out cards adds noise without
            information. */}
        {slots.showFightTypes && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
            }}
          >
            {FIGHT_TYPES.map(({ type, label, desc, minLevel }) => {
              const locked = level < minLevel;
              const active = selectedType === type;
              // Tone-coded per fight type: friendly = steel-blue,
              // ranked = bronze, wager = blood-red. Matches the
              // design-tool ArenaScreen reference.
              const tone =
                type === "friendly"
                  ? { active: "var(--sc-steel)", bg: "rgba(109,143,163,0.18)" }
                  : type === "wager"
                    ? { active: "var(--sc-blood)", bg: "rgba(181,61,44,0.16)" }
                    : { active: "var(--sc-bronze)", bg: "rgba(200,154,63,0.18)" };
              return (
                <button
                  key={type}
                  disabled={locked || signing}
                  onClick={() => setSelectedType(type)}
                  style={{
                    textAlign: "left",
                    padding: 14,
                    border: `2px solid ${active ? tone.active : "var(--sc-rim-2)"}`,
                    background: active ? tone.bg : "var(--sc-panel-2)",
                    color: "var(--sc-parchment)",
                    borderRadius: "var(--r-card)",
                    boxShadow: active ? "var(--sh-plate-sm)" : "var(--rim-top), var(--rim-bottom)",
                    cursor: locked ? "not-allowed" : "pointer",
                    opacity: locked ? 0.4 : 1,
                    fontFamily: "var(--font-ui)",
                    transition: "all var(--d-fast)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 18,
                        color: active ? tone.active : "var(--sc-parchment)",
                      }}
                    >
                      {label}
                    </span>
                    {locked && (
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          color: "var(--fg-3)",
                        }}
                      >
                        Lv.{minLevel}+
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      color: "var(--fg-3)",
                      lineHeight: 1.4,
                    }}
                  >
                    {desc}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Wager UI — driven by `slots.showWagerCreate` /
            `slots.showWagerLobby` (Bucket 2 polish, 2026-05-04). When
            the player has an open wager (`busy.kind === "ownWager"`),
            only the lobby surfaces — fight-type cards + create form
            stay hidden until they Cancel out. */}
        {(slots.showWagerCreate || slots.showWagerLobby) && (
          <div className="space-y-3 mt-2">
            {/* Create wager form — hidden once the player has their own
                wager open (their own wager renders in the lobby below
                with a Cancel button). */}
            {slots.showWagerCreate && !ownLobbyEntry && (
              <div
                className="p-3"
                style={{
                  background: "var(--sc-panel-2)",
                  border: "1px solid var(--sc-rim)",
                  borderLeft: "3px solid var(--sc-blood)",
                  borderRadius: "var(--r-card)",
                  boxShadow: "var(--rim-top), var(--rim-bottom)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {state.prefilledWagerTarget && (
                  <div
                    className="px-3 py-2"
                    style={{
                      background: "rgba(200,154,63,0.12)",
                      borderLeft: "3px solid var(--sc-bronze)",
                      borderRadius: "var(--r-sm)",
                      fontSize: 11,
                      color: "var(--sc-parchment)",
                    }}
                  >
                    <div style={{ fontWeight: 800, marginBottom: 2 }}>
                      Challenge ready —{" "}
                      <span style={{ color: "var(--sc-bronze)" }}>
                        {state.prefilledWagerTarget.name}
                      </span>{" "}
                      accepted your wager challenge.
                    </div>
                    <div style={{ color: "var(--fg-2)" }}>
                      Sign the create_wager transaction below to lock the SUI
                      escrow. They'll see your wager appear in their lobby and
                      can sign accept_wager to start the fight.
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: ".10em",
                      textTransform: "uppercase",
                      color: "var(--sc-bronze)",
                    }}
                  >
                    Stake
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={wagerInput}
                    placeholder={`${MIN_STAKE_SUI} min`}
                    onChange={(e) => setWagerInput(e.target.value)}
                    aria-invalid={!parsedWager.ok}
                    style={{
                      width: 96,
                      padding: "7px 10px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      fontWeight: 700,
                      background: "var(--sc-page)",
                      border: `1px solid ${parsedWager.ok ? "var(--sc-rim-2)" : "var(--sc-blood)"}`,
                      borderRadius: "var(--r-sm)",
                      color: "var(--sc-parchment)",
                      outline: "none",
                      boxShadow: "var(--rim-top), var(--rim-bottom)",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 800,
                      fontSize: 13,
                      color: "var(--sc-bronze)",
                    }}
                  >
                    SUI
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--fg-3)" }}>
                  Wallet balance:{" "}
                  <span style={{ color: "var(--sc-bronze)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                    {balance.sui.toFixed(3)} SUI
                  </span>
                  {balance.error ? (
                    <span style={{ color: "var(--sc-blood)", marginLeft: 8 }}>
                      ({balance.error})
                    </span>
                  ) : null}
                </p>
                {parsedWager.ok ? (
                  <p style={{ margin: 0, fontSize: 11, color: "var(--fg-3)", lineHeight: 1.5 }}>
                    Your wallet will lock {parsedWager.amount} SUI in on-chain escrow.
                    Winner gets 95%. 5% platform fee.
                  </p>
                ) : (
                  <p style={{ margin: 0, fontSize: 11, color: "var(--sc-blood)", fontWeight: 600 }}>
                    {parsedWager.reason}
                  </p>
                )}
                {parsedWager.ok && insufficientFunds && (
                  <p style={{ margin: 0, fontSize: 11, color: "var(--sc-blood)", fontWeight: 600 }}>
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

            {/* Open wagers list — surfaces both the player's own wager
                (with Cancel button, in `ownWager` busy state) and
                browseable other-player wagers (in idle state). */}
            {slots.showWagerLobby && (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: "var(--ls-stamp)",
                      textTransform: "uppercase",
                      color: "var(--sc-bronze)",
                    }}
                  >
                    Open Wagers
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      fontSize: 11,
                      color: "var(--fg-3)",
                    }}
                  >
                    {wagerLobby.length}
                  </span>
                </div>
                {wagerLobby.length === 0 ? (
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--fg-3)",
                      textAlign: "center",
                      padding: "20px 0",
                      fontStyle: "italic",
                    }}
                  >
                    No open wagers. Create one to challenge others.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {wagerLobby.map((entry) => {
                      const isOwn = entry.creatorWallet === walletAddress;
                      // Accept gate (Fix A silent-accept + Fix 1 cross-mode):
                      //   - own wager → Cancel only, no Accept
                      //   - busy in any mode → Accept disabled
                      // ownWager keeps its specific reason; other busy
                      // kinds get the generic busy reason.
                      const disableAccept = !isOwn && busy.busy;
                      const disableReason =
                        disableAccept
                          ? busy.kind === "ownWager"
                            ? "Cancel your own open wager first before accepting another."
                            : (busy.reason ?? "You are busy in another mode.")
                          : undefined;
                      return (
                        <WagerLobbyCard
                          key={entry.wagerMatchId}
                          entry={entry}
                          isOwn={isOwn}
                          onAccept={() => handleAcceptWager(entry)}
                          onCancel={() => handleCancelWager(entry)}
                          signing={signing}
                          disableAccept={disableAccept}
                          disableReason={disableReason}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Non-wager: Enter Queue button — only visible in idle state
            with a non-wager fight type selected (Bucket 2 polish). */}
        {slots.showEnterQueueButton && (
          <Button
            onClick={handleQueue}
            className="w-full"
            disabled={signing}
          >
            Enter Queue
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
