"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGame } from "@/hooks/useGameStore";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useDAppKit, useCurrentClient } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  buildCreateWagerTx,
  buildRequestAcceptWagerTx,
  buildApproveChallengerTx,
  buildDeclineChallengerTx,
  buildWithdrawChallengeTx,
  buildCancelExpiredChallengeTx,
  buildCancelWagerTx,
} from "@/lib/sui-contracts";
import { registerWagerWithServer, deriveHttpBaseUrl } from "@/lib/wager-register";
import { parseWagerInput, MIN_STAKE_SUI } from "@/lib/wager-input";
import { canAcceptWager, canAcceptWagerWithBalance } from "@/lib/wager-accept-gate";
import { assertTxSucceeded, extractTxDigest, humanizeChainError } from "@/lib/tx-result";
import { ARENA_ABORT_CODES } from "@/lib/arena-aborts";
import { simulateWagerTx } from "@/lib/wager-preflight";
import {
  WAGER_STATUS,
  CHALLENGE_TIMEOUT_MS,
  inLevelBracket,
  levelBracketBlockedReason,
  formatTimeoutMin,
} from "@/lib/wager-constants";
import { verifyServerHasCharacter } from "@/lib/character-presence-check";
import { computeBusyState, decideMatchmakingRender } from "@/lib/busy-state";
import type { FightType, WagerLobbyEntry } from "@/types/game";
import { ScreenLayout, TopBanner, SectionHeader } from "@/components/v2/layout";
import { BronzeButton, SecondaryButton, Stamp } from "@/components/v2";

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

/** v5.2 — viewer's relationship to a wager. Drives which buttons render. */
type ViewerRole =
  | "creator"           // viewer wallet === entry.creatorWallet
  | "pendingChallenger" // viewer wallet === entry.pendingChallenger.wallet
  | "stranger";         // anyone else

function classifyViewer(entry: WagerLobbyEntry, viewerWallet: string): ViewerRole {
  if (entry.creatorWallet === viewerWallet) return "creator";
  if (entry.pendingChallenger?.wallet === viewerWallet) return "pendingChallenger";
  return "stranger";
}

function WagerLobbyCard({
  entry,
  viewerWallet,
  viewerLevel,
  onRequestAccept,
  onApprove,
  onDecline,
  onWithdraw,
  onCancelExpiredChallenge,
  onCancel,
  onInspect,
  signing,
  disableAccept = false,
  disableReason,
}: {
  entry: WagerLobbyEntry;
  viewerWallet: string;
  /** Viewer's live character level — used for the ±1 client-side pre-check
   *  on Accept (the chain assertion is the trustless backstop). */
  viewerLevel: number;
  onRequestAccept: () => void;
  onApprove: () => void;
  onDecline: () => void;
  onWithdraw: () => void;
  onCancelExpiredChallenge: () => void;
  onCancel: () => void;
  onInspect?: () => void;
  signing: boolean;
  /** Cross-mode busy gate (Fix A silent-accept + Fix 1 cross-mode). */
  disableAccept?: boolean;
  disableReason?: string;
}) {
  const role = classifyViewer(entry, viewerWallet);
  const isOwn = role === "creator";
  const status = entry.status ?? WAGER_STATUS.WAITING;
  const pending = entry.pendingChallenger;
  const isPending = status === WAGER_STATUS.PENDING_APPROVAL && !!pending;

  // v5.2 — level-bracket pre-check against the snapshot. If v5.1-shape
  // wire is in flight (no snapshot field), use the live creator level.
  const snapshot = entry.playerALevelSnapshot ?? entry.creatorLevel;
  const inBracket = inLevelBracket(viewerLevel, snapshot);
  const bracketBlockedReason = inBracket
    ? undefined
    : levelBracketBlockedReason(viewerLevel, snapshot);

  // v5.2 — challenge expiry: anyone can clear after CHALLENGE_TIMEOUT_MS.
  // Render-time check using server-clock pendingAt; we re-render on lobby
  // updates so the button surfaces close to the actual expiry.
  const elapsedSincePending = isPending && pending
    ? Date.now() - pending.pendingAt
    : 0;
  const challengeExpired = isPending && elapsedSincePending >= CHALLENGE_TIMEOUT_MS;

  const archetype = getArchetypeLabel(entry.creatorStats);
  const color = getArchetypeColor(archetype);
  const inspectable = !!onInspect;

  // Border/background tint per state:
  //   - own + WAITING: bronze frame
  //   - PENDING_APPROVAL: amber accent (signals attention required)
  //   - default: rim
  const isOwnPending = isOwn && isPending;
  const borderColor = isOwnPending
    ? "var(--sc-bronze)"
    : isOwn
      ? "var(--sc-bronze)"
      : isPending
        ? "var(--sc-bronze-deep)"
        : "var(--sc-rim-2)";

  // Compute the action row for this viewer × status combination.
  let actions: React.ReactNode;
  if (isPending && role === "creator") {
    // Creator sees their pending challenger + approve/decline.
    actions = (
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
          disabled={signing}
          title="Approve this challenger and start the fight"
        >
          {signing ? "Signing..." : "Approve"}
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onDecline(); }}
          disabled={signing}
          title="Decline this challenger — they get a refund, wager returns to waiting"
        >
          Decline
        </Button>
      </div>
    );
  } else if (isPending && role === "pendingChallenger") {
    // Challenger sees withdraw + waiting state.
    actions = (
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onWithdraw(); }}
          disabled={signing}
          title="Withdraw your challenge and get your stake back"
        >
          {signing ? "Signing..." : "Withdraw"}
        </Button>
      </div>
    );
  } else if (isPending && role === "stranger" && challengeExpired) {
    // Anyone can clear an expired pending challenge.
    actions = (
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onCancelExpiredChallenge(); }}
          disabled={signing}
          title="The challenger hasn't been approved in 5+ minutes — clear the pending slot"
        >
          Clear expired
        </Button>
      </div>
    );
  } else if (isPending) {
    // Stranger viewing a fresh pending — disabled placeholder.
    actions = (
      <div className="flex items-center gap-2 shrink-0">
        <span style={{ fontSize: 11, color: "var(--fg-3)", fontStyle: "italic" }}>
          Awaiting approval
        </span>
      </div>
    );
  } else if (role === "creator") {
    // Own WAITING — Cancel.
    actions = (
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="danger"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          disabled={signing}
        >
          Cancel
        </Button>
      </div>
    );
  } else {
    // Stranger viewing WAITING — Accept (with bracket + busy gates).
    const blocked = disableAccept || !inBracket || signing;
    const reason = !inBracket
      ? bracketBlockedReason
      : disableAccept
        ? disableReason
        : undefined;
    actions = (
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          onClick={(e) => { e.stopPropagation(); onRequestAccept(); }}
          disabled={blocked}
          title={reason}
        >
          {signing ? "Signing..." : "Accept"}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="p-3 transition-all"
      role={inspectable ? "button" : undefined}
      tabIndex={inspectable ? 0 : undefined}
      onClick={inspectable ? onInspect : undefined}
      onKeyDown={
        inspectable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onInspect?.();
              }
            }
          : undefined
      }
      title={inspectable ? `Inspect ${entry.creatorName}'s build` : undefined}
      style={{
        border: `${isOwn ? 2 : 1}px solid ${borderColor}`,
        borderLeft: isOwn ? "3px solid var(--sc-bronze)" : `1px solid ${borderColor}`,
        background: isOwnPending
          ? "rgba(200,154,63,0.12)"
          : isOwn
            ? "rgba(200,154,63,0.08)"
            : isPending
              ? "rgba(200,154,63,0.05)"
              : "var(--sc-panel-2)",
        borderRadius: "var(--r-card)",
        boxShadow: isOwn ? "var(--sh-plate-sm)" : "var(--rim-top), var(--rim-bottom)",
        fontFamily: "var(--font-ui)",
        cursor: inspectable ? "pointer" : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-zinc-100 truncate">{entry.creatorName}</span>
            <Badge variant="info">Lv.{entry.creatorLevel}</Badge>
            <span className={`text-xs font-bold ${color}`}>{archetype}</span>
            {isPending && (
              <span title="Pending approval — creator must approve or decline">
                <Badge variant="warning">Pending</Badge>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
            <span>{entry.creatorRating} ELO</span>
            <span>S{entry.creatorStats.strength} D{entry.creatorStats.dexterity} I{entry.creatorStats.intuition} E{entry.creatorStats.endurance}</span>
            <span>{timeAgo(entry.createdAt)}</span>
          </div>
          {isPending && pending && (
            // v5.2 — challenger details + countdown for the creator's
            // approve/decline decision.
            <div
              className="mt-2 pt-2 text-xs"
              style={{
                borderTop: "1px dashed var(--sc-rim-2)",
                color: "var(--fg-2)",
              }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--sc-bronze)" }}>Challenger:</span>
                <span className="font-semibold text-zinc-100">{pending.name}</span>
                <Badge variant="info">Lv.{pending.level}</Badge>
                <span style={{ color: "var(--fg-3)" }}>{pending.rating} ELO</span>
              </div>
              <div className="flex items-center gap-3 mt-1" style={{ color: "var(--fg-3)" }}>
                <span>S{pending.stats.strength} D{pending.stats.dexterity} I{pending.stats.intuition} E{pending.stats.endurance}</span>
                <span>
                  {challengeExpired
                    ? `Expired ${formatTimeoutMin(elapsedSincePending - CHALLENGE_TIMEOUT_MS)} ago`
                    : `${formatTimeoutMin(CHALLENGE_TIMEOUT_MS - elapsedSincePending)} to decide`}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-amber-400 font-bold text-sm">{entry.wagerAmount} SUI</span>
          {actions}
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
  const client = useCurrentClient() as SuiGrpcClient | null;
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
        // Bug 6 defence-in-depth (2026-05-19). Mirrors the
        // handleAcceptWager check — verify the server still holds our
        // character record before locking SUI on chain. The 2026-05-18
        // orphan incident (wager 0xd94d…01a2) was exactly this race:
        // server restart, frontend cached character is stale, queue_fight
        // hits a missing-character sendError after the on-chain
        // create_wager already locked the escrow. The auth_ok self-heal
        // catches the common case (reconnect after restart); this catches
        // the "restart mid-form" race.
        const presence = await verifyServerHasCharacter({ socket: state.socket });
        if (!presence.ok) {
          console.warn("[Wager] create_wager presence check failed:", presence.reason);
          dispatch({ type: "BEGIN_SERVER_REHYDRATE" });
          dispatch({
            type: "SET_ERROR",
            message: "Reconnecting your character with the server — try again in a moment.",
          });
          return;
        }

        const stakeAmountMist = BigInt(Math.round(parsedWager.amount * 1_000_000_000));
        // v5.2 — create_wager now takes a &Character ref (snapshots level
        // for the ±1 bracket gate). The chain object id comes from the
        // server-hydrated `onChainCharacter` slice. A missing slice is a
        // hard error: the chain hasn't confirmed the character yet, so
        // signing create_wager would either abort (ENotCharacterOwner=22)
        // or — worse — orphan SUI on chain.
        const characterObjectId = state.onChainCharacter?.objectId;
        if (!characterObjectId) {
          dispatch({
            type: "SET_ERROR",
            message:
              "Your character isn't fully synced with the chain yet — reload and try again in a moment.",
          });
          return;
        }
        const tx = buildCreateWagerTx(stakeAmountMist, characterObjectId);

        // 2026-05-18 pre-flight — catches `EInvalidStake (0)` if the
        // input rounds to zero MIST and surfaces a friendly message
        // before opening the wallet popup. Also catches any future
        // create_wager checks added in v5.1 without needing to update
        // this site.
        const preflight = await simulateWagerTx(
          client,
          tx,
          walletAddress,
          "create_wager",
        );
        if (!preflight.ok) {
          dispatch({ type: "SET_ERROR", message: preflight.message });
          return;
        }

        const signer = new CurrentAccountSigner(dAppKit as any);
        const result = await signer.signAndExecuteTransaction({ transaction: tx });

        // Phase A (2026-05-17) — Bug B branching via the shared
        // `assertTxSucceeded` helper. Now carries the arena-aborts
        // humanizer (2026-05-18) so any unexpected post-sign abort
        // surfaces with the same friendly copy as the pre-flight.
        assertTxSucceeded(result, "create_wager", ARENA_ABORT_CODES);
        const resultAny = result as any;
        const txData = resultAny.Transaction || resultAny;

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
        // dapp-kit 2.16 throws raw MoveAbort strings; humanize via the
        // arena map (same reason as the saveLoadout catch — the
        // assertTxSucceeded path with the map only fires when the SDK
        // resolves with $kind=FailedTransaction, which 2.16 does not).
        const raw = String(err?.message || "");
        const humanized = humanizeChainError(raw, ARENA_ABORT_CODES);
        dispatch({ type: "SET_ERROR", message: humanized || raw || "Wallet transaction rejected" });
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
    client,
    state.prefilledWagerTarget,
    dispatch,
  ]);

  const handleCancel = useCallback(() => {
    state.socket.send({ type: "cancel_queue" });
  }, [state.socket]);

  /** v5.2 — request_accept_wager replaces v5.1's accept_wager. Stake parks
   *  in `challenger_escrow` and status moves WAITING → PENDING_APPROVAL.
   *  The creator then approves (handleApproveChallenger) or declines
   *  (handleDeclineChallenger). The challenger can withdraw_challenge
   *  unilaterally at any point before approval. */
  const handleRequestAccept = useCallback(async (entry: WagerLobbyEntry) => {
    // v5.1 silent-accept defence is still relevant — the chain
    // EAlreadyHasOpenWager (11) covers the silent-accept path now,
    // but the client gate is faster + clearer than a chain abort.
    const lobbyGate = canAcceptWager({
      callerWallet: walletAddress,
      targetWagerId: entry.wagerMatchId,
      lobby: wagerLobby,
    });

    const stakeAmountMist = BigInt(Math.round(entry.wagerAmount * 1_000_000_000));
    const balanceMist =
      balance.loading || balance.error ? null : balance.mist;
    const gate = canAcceptWagerWithBalance({
      lobbyGate,
      stakeMist: stakeAmountMist,
      balanceMist,
    });

    if (!gate.allow) {
      console.warn(
        "[Wager] Request-accept gate refused:",
        gate.reason,
        gate.ownWagerId ? `(own=${gate.ownWagerId})` : "",
      );
      dispatch({ type: "SET_ERROR", message: gate.reason ?? "Cannot accept this wager." });
      return;
    }

    // v5.2 — level-bracket pre-check. Compares the viewer's live level
    // against the wager's snapshot (player_a_level if present, else the
    // creator's current level as a v5.1-shape fallback). A pre-check
    // miss skips the wallet popup entirely.
    const creatorSnapshot = entry.playerALevelSnapshot ?? entry.creatorLevel;
    if (!inLevelBracket(level, creatorSnapshot)) {
      const reason = levelBracketBlockedReason(level, creatorSnapshot);
      console.warn("[Wager] Level-bracket pre-check refused:", reason);
      dispatch({ type: "SET_ERROR", message: reason });
      return;
    }

    setSigning(true);
    try {
      const presence = await verifyServerHasCharacter({ socket: state.socket });
      if (!presence.ok) {
        console.warn("[Wager] Server-character presence check failed:", presence.reason);
        dispatch({ type: "BEGIN_SERVER_REHYDRATE" });
        dispatch({
          type: "SET_ERROR",
          message: "Reconnecting your character with the server — try again in a moment.",
        });
        return;
      }

      // v5.2 — characterObjectId required by request_accept_wager.
      const characterObjectId = state.onChainCharacter?.objectId;
      if (!characterObjectId) {
        dispatch({
          type: "SET_ERROR",
          message:
            "Your character isn't fully synced with the chain yet — reload and try again in a moment.",
        });
        return;
      }

      const tx = buildRequestAcceptWagerTx(
        entry.wagerMatchId,
        characterObjectId,
        stakeAmountMist,
      );
      const preflight = await simulateWagerTx(
        client,
        tx,
        walletAddress,
        "request_accept_wager",
      );
      if (!preflight.ok) {
        // Optimistic removal closes the double-click race (2026-05-18).
        dispatch({
          type: "REMOVE_WAGER_LOBBY_ENTRY",
          wagerMatchId: entry.wagerMatchId,
        });
        dispatch({ type: "SET_ERROR", message: preflight.message });
        return;
      }

      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result, "request_accept_wager", ARENA_ABORT_CODES);
      const digest = extractTxDigest(result);

      // v5.2 — wager stays in lobby but transitions to PENDING_APPROVAL.
      // The server will broadcast `wager_lobby_updated` with the new
      // status + pendingChallenger payload after observing the chain.
      state.socket.send({
        type: "wager_request_accepted",
        wagerMatchId: entry.wagerMatchId,
        ...(digest ? { txDigest: digest } : {}),
      });
    } catch (err: any) {
      console.error("[Wager] request_accept_wager failed:", err);
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw, ARENA_ABORT_CODES);
      dispatch({ type: "SET_ERROR", message: humanized || raw || "Wallet transaction rejected" });
    } finally {
      setSigning(false);
    }
  }, [
    dAppKit,
    client,
    state.socket,
    state.onChainCharacter,
    dispatch,
    walletAddress,
    wagerLobby,
    level,
    balance.error,
    balance.mist,
    balance.loading,
  ]);

  /** v5.2 — Creator approves a pending challenger. Merges challenger
   *  escrow into the main escrow; status PENDING_APPROVAL → ACTIVE.
   *  Server picks up the chain transition and starts the fight. */
  const handleApproveChallenger = useCallback(async (entry: WagerLobbyEntry) => {
    setSigning(true);
    try {
      const tx = buildApproveChallengerTx(entry.wagerMatchId);
      const preflight = await simulateWagerTx(
        client,
        tx,
        walletAddress,
        "approve_challenger",
      );
      if (!preflight.ok) {
        dispatch({ type: "SET_ERROR", message: preflight.message });
        return;
      }
      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result, "approve_challenger", ARENA_ABORT_CODES);
      const digest = extractTxDigest(result);

      // The fight starts on the server's chain-observed ACTIVE transition.
      // Reuse the v5.1 `wager_accepted` WS message — the server's existing
      // `handleWagerAccepted` handler runs the gate + starts the fight.
      state.socket.send({
        type: "wager_accepted",
        wagerMatchId: entry.wagerMatchId,
        ...(digest ? { txDigest: digest } : {}),
      });
    } catch (err: any) {
      console.error("[Wager] approve_challenger failed:", err);
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw, ARENA_ABORT_CODES);
      dispatch({ type: "SET_ERROR", message: humanized || raw || "Wallet transaction rejected" });
    } finally {
      setSigning(false);
    }
  }, [dAppKit, client, state.socket, dispatch, walletAddress]);

  /** v5.2 — Creator declines a pending challenger. Refunds challenger;
   *  wager returns to WAITING (another challenger can request next). */
  const handleDeclineChallenger = useCallback(async (entry: WagerLobbyEntry) => {
    setSigning(true);
    try {
      const tx = buildDeclineChallengerTx(entry.wagerMatchId);
      const preflight = await simulateWagerTx(
        client,
        tx,
        walletAddress,
        "decline_challenger",
      );
      if (!preflight.ok) {
        dispatch({ type: "SET_ERROR", message: preflight.message });
        return;
      }
      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result, "decline_challenger", ARENA_ABORT_CODES);
      const digest = extractTxDigest(result);

      state.socket.send({
        type: "wager_declined",
        wagerMatchId: entry.wagerMatchId,
        ...(digest ? { txDigest: digest } : {}),
      });
    } catch (err: any) {
      console.error("[Wager] decline_challenger failed:", err);
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw, ARENA_ABORT_CODES);
      dispatch({ type: "SET_ERROR", message: humanized || raw || "Wallet decline rejected" });
    } finally {
      setSigning(false);
    }
  }, [dAppKit, client, state.socket, dispatch, walletAddress]);

  /** v5.2 — Challenger self-exits while pending. Refund + return to
   *  WAITING. Doesn't require creator action. */
  const handleWithdrawChallenge = useCallback(async (entry: WagerLobbyEntry) => {
    setSigning(true);
    try {
      const tx = buildWithdrawChallengeTx(entry.wagerMatchId);
      const preflight = await simulateWagerTx(
        client,
        tx,
        walletAddress,
        "withdraw_challenge",
      );
      if (!preflight.ok) {
        dispatch({ type: "SET_ERROR", message: preflight.message });
        return;
      }
      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result, "withdraw_challenge", ARENA_ABORT_CODES);
      const digest = extractTxDigest(result);

      state.socket.send({
        type: "wager_withdrawn",
        wagerMatchId: entry.wagerMatchId,
        ...(digest ? { txDigest: digest } : {}),
      });
    } catch (err: any) {
      console.error("[Wager] withdraw_challenge failed:", err);
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw, ARENA_ABORT_CODES);
      dispatch({ type: "SET_ERROR", message: humanized || raw || "Wallet withdraw rejected" });
    } finally {
      setSigning(false);
    }
  }, [dAppKit, client, state.socket, dispatch, walletAddress]);

  /** v5.2 — Anyone (typically the challenger) can clear a stale pending
   *  challenge after the 5-min CHALLENGE_TIMEOUT_MS. Refunds challenger;
   *  status returns to WAITING. */
  const handleCancelExpiredChallenge = useCallback(async (entry: WagerLobbyEntry) => {
    setSigning(true);
    try {
      const tx = buildCancelExpiredChallengeTx(entry.wagerMatchId);
      const preflight = await simulateWagerTx(
        client,
        tx,
        walletAddress,
        "cancel_expired_challenge",
      );
      if (!preflight.ok) {
        dispatch({ type: "SET_ERROR", message: preflight.message });
        return;
      }
      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result, "cancel_expired_challenge", ARENA_ABORT_CODES);
      const digest = extractTxDigest(result);

      state.socket.send({
        type: "wager_challenge_expired",
        wagerMatchId: entry.wagerMatchId,
        ...(digest ? { txDigest: digest } : {}),
      });
    } catch (err: any) {
      console.error("[Wager] cancel_expired_challenge failed:", err);
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw, ARENA_ABORT_CODES);
      dispatch({ type: "SET_ERROR", message: humanized || raw || "Wallet clear-challenge rejected" });
    } finally {
      setSigning(false);
    }
  }, [dAppKit, client, state.socket, dispatch, walletAddress]);

  const handleCancelWager = useCallback(async (entry: WagerLobbyEntry) => {
    setSigning(true);
    try {
      // Cancel on-chain first (player's own cancel). Same EMatchNotWaiting
      // race as accept_wager applies here — if someone accepted between
      // the lobby render and the cancel click, cancel_wager aborts with
      // code 1 and the user gets the cryptic dapp-kit toast. Pre-flight
      // surfaces "the wager is no longer waiting…" before signing.
      const tx = buildCancelWagerTx(entry.wagerMatchId);
      const preflight = await simulateWagerTx(
        client,
        tx,
        walletAddress,
        "cancel_wager",
      );
      if (!preflight.ok) {
        dispatch({
          type: "REMOVE_WAGER_LOBBY_ENTRY",
          wagerMatchId: entry.wagerMatchId,
        });
        dispatch({ type: "SET_ERROR", message: preflight.message });
        return;
      }
      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result, "cancel_wager", ARENA_ABORT_CODES);

      // Optimistic local removal — same race as the accept path.
      dispatch({
        type: "REMOVE_WAGER_LOBBY_ENTRY",
        wagerMatchId: entry.wagerMatchId,
      });

      // Tell server to remove from lobby (idempotent server-side).
      state.socket.send({
        type: "cancel_wager_lobby",
        wagerMatchId: entry.wagerMatchId,
      });
    } catch (err: any) {
      console.error("[Wager] cancel_wager failed:", err);
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw, ARENA_ABORT_CODES);
      dispatch({ type: "SET_ERROR", message: humanized || raw || "Wallet cancel rejected" });
    } finally {
      setSigning(false);
    }
  }, [dAppKit, client, state.socket, dispatch, walletAddress]);

  // Show queue status (friendly/ranked only) — matches the Claude
  // Design Arena screenshot: gunmetal panel, frog mascot top, Slackey
  // "Looking for fighter…" headline, mono ETA, Cancel + Widen ELO
  // Range action row.
  if (fightQueue) {
    return (
      <ScreenLayout>
        <TopBanner
          title="Arena"
          subtitle="Friendly · Ranked · Wager — pick your queue. Real SUI rides on wagers."
          pill="testnet"
          tone="blood"
        />
        <div>
          <SectionHeader
            title="Queue"
            right={<Stamp tone="bronze">Searching…</Stamp>}
            size="lg"
          />
          <div
            style={{
              background: "var(--sc-panel)",
              border: "1px solid var(--sc-rim)",
              borderRadius: "var(--r-card)",
              boxShadow: "var(--sh-plate-lg), var(--rim-top), var(--rim-bottom)",
              padding: "32px 24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              fontFamily: "var(--font-ui)",
            }}
          >
            <div
              style={{
                fontSize: 80,
                lineHeight: 1,
                filter: "drop-shadow(0 4px 8px rgba(0,0,0,.5))",
                animation: "queue-bob 2.2s ease-in-out infinite",
              }}
              aria-hidden
            >
              🐸
            </div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 36,
                color: "var(--sc-parchment)",
                letterSpacing: "0.01em",
                textAlign: "center",
              }}
            >
              Looking for fighter…
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
                textAlign: "center",
              }}
            >
              Queued for {fightQueue} fight · matchmaking by ELO · ETA &lt; 60s
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <SecondaryButton onClick={handleCancel}>Cancel</SecondaryButton>
              <BronzeButton onClick={handleCancel}>Widen ELO Range</BronzeButton>
            </div>
          </div>
          <style>{`@keyframes queue-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
        </div>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <TopBanner
        title="Arena"
        subtitle="Friendly · Ranked · Wager — pick your queue. Real SUI rides on wagers."
        pill="testnet"
        tone="blood"
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Fight type selector — 3-up chunky tiles. Hidden when the
            player is busy in another mode (Bucket 2 polish). */}
        {slots.showFightTypes && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 16,
            }}
          >
            {FIGHT_TYPES.map(({ type, label, desc, minLevel }) => {
              const locked = level < minLevel;
              const active = selectedType === type;
              // Tone palettes per the Arena screenshot:
              //   friendly → parchment fill, page text, steel accent
              //   ranked   → bronze fill, page text, bronze-deep border
              //   wager    → blood-red fill, parchment text, blood-deep border
              const palette =
                type === "friendly"
                  ? {
                      bg: "var(--sc-parchment)",
                      text: "var(--sc-page)",
                      sub: "rgba(10,13,18,0.65)",
                      border: active ? "var(--sc-steel)" : "var(--sc-rim-2)",
                      shadow: active
                        ? "5px 5px 0 0 var(--sc-steel-deep)"
                        : "3px 3px 0 0 #000",
                      cta: "var(--sc-page)",
                      ctaBg: "var(--sc-parchment)",
                      ctaBorder: "var(--sc-rim-2)",
                    }
                  : type === "ranked"
                    ? {
                        bg: "var(--sc-bronze)",
                        text: "var(--sc-page)",
                        sub: "rgba(10,13,18,0.72)",
                        border: active
                          ? "var(--sc-page)"
                          : "var(--sc-bronze-deep)",
                        shadow: active
                          ? "5px 5px 0 0 var(--sc-bronze-deep)"
                          : "3px 3px 0 0 #000",
                        cta: "var(--sc-bronze)",
                        ctaBg: "var(--sc-page)",
                        ctaBorder: "var(--sc-bronze)",
                      }
                    : {
                        bg: "var(--sc-blood)",
                        text: "var(--sc-parchment)",
                        sub: "rgba(232,226,212,0.75)",
                        border: active
                          ? "var(--sc-parchment)"
                          : "var(--sc-blood-deep)",
                        shadow: active
                          ? "5px 5px 0 0 var(--sc-blood-deep)"
                          : "3px 3px 0 0 #000",
                        cta: "var(--sc-page)",
                        ctaBg: "var(--sc-bronze)",
                        ctaBorder: "var(--sc-bronze-deep)",
                      };
              return (
                <button
                  key={type}
                  disabled={locked || signing}
                  onClick={() => setSelectedType(type)}
                  style={{
                    textAlign: "left",
                    padding: "24px 24px 20px",
                    border: `3px solid ${palette.border}`,
                    background: palette.bg,
                    color: palette.text,
                    borderRadius: "var(--r-sharp)",
                    boxShadow: palette.shadow,
                    cursor: locked ? "not-allowed" : "pointer",
                    opacity: locked ? 0.4 : 1,
                    fontFamily: "var(--font-ui)",
                    minHeight: 260,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 10,
                    transition:
                      "transform var(--d-base) var(--ease-pop), box-shadow var(--d-base) var(--ease-pop)",
                  }}
                  onMouseEnter={(e) => {
                    if (!locked && !active) {
                      e.currentTarget.style.transform = "translate(-1px,-1px)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "";
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 26,
                          lineHeight: 1,
                          fontFamily: "var(--font-display)",
                          color: palette.text,
                          opacity: 0.78,
                        }}
                        aria-hidden
                      >
                        {type === "friendly"
                          ? "⚔"
                          : type === "ranked"
                            ? "♔"
                            : "$"}
                      </span>
                      {active && (
                        <span
                          style={{
                            fontFamily: "var(--font-ui)",
                            fontWeight: 800,
                            fontSize: 9,
                            letterSpacing: "var(--ls-stamp)",
                            textTransform: "uppercase",
                            padding: "3px 9px",
                            background: "var(--sc-page)",
                            color: palette.cta === "var(--sc-page)" ? "var(--sc-bronze)" : palette.cta,
                            border: `1px solid ${palette.cta === "var(--sc-page)" ? "var(--sc-bronze)" : palette.cta}`,
                            borderRadius: "var(--r-pill)",
                          }}
                        >
                          Selected
                        </span>
                      )}
                      {locked && (
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            color: palette.sub,
                            fontWeight: 700,
                          }}
                        >
                          Lv.{minLevel}+
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 52,
                        lineHeight: 1,
                        marginTop: 12,
                        letterSpacing: "-0.01em",
                        color: palette.text,
                      }}
                    >
                      {label}
                    </div>
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontSize: 14,
                        color: palette.sub,
                        lineHeight: 1.45,
                        fontWeight: 500,
                      }}
                    >
                      {desc}
                    </p>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontWeight: 800,
                      fontSize: 12,
                      letterSpacing: "var(--ls-button)",
                      textTransform: "uppercase",
                      padding: "10px 14px",
                      background: palette.ctaBg,
                      color: palette.cta,
                      border: `2px solid ${palette.ctaBorder}`,
                      borderRadius: "var(--r-sharp)",
                      textAlign: "center",
                      boxShadow: "var(--sh-plate-sm)",
                    }}
                  >
                    {type === "friendly"
                      ? "Find a sparring partner"
                      : type === "ranked"
                        ? "Enter Queue ▾"
                        : "Create Wager ▾"}
                  </div>
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
                          viewerWallet={walletAddress}
                          viewerLevel={level}
                          onRequestAccept={() => handleRequestAccept(entry)}
                          onApprove={() => handleApproveChallenger(entry)}
                          onDecline={() => handleDeclineChallenger(entry)}
                          onWithdraw={() => handleWithdrawChallenge(entry)}
                          onCancelExpiredChallenge={() => handleCancelExpiredChallenge(entry)}
                          onCancel={() => handleCancelWager(entry)}
                          onInspect={
                            isOwn
                              ? undefined
                              : () =>
                                  dispatch({
                                    type: "OPEN_PROFILE",
                                    walletAddress: entry.creatorWallet,
                                  })
                          }
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
      </div>
    </ScreenLayout>
  );
}
