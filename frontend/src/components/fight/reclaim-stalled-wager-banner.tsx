"use client";

/**
 * v5.2 — Referee-liveness escape hatch UI.
 *
 * Shows a banner over an active wager fight when:
 *   (a) FightState carries `wagerMatchId` AND `wagerAcceptedAtMs`
 *   (b) elapsed since accept >= WAGER_RESOLUTION_TIMEOUT_MS (30 min)
 *   (c) viewer is a participant
 *
 * Clicking "Reclaim Stalled Wager" builds + signs
 * `arena::reclaim_stalled_wager` — both stakes refund to their original
 * depositors, no winner declared. Same shape as settle_tie but invoked
 * by a participant.
 *
 * The 30-min clock gate prevents mid-fight abuse: a losing player can't
 * call this to escape a loss — the chain assertion `EWagerNotStalled (19)`
 * fires on any pre-timeout attempt. The frontend hides the button before
 * the timeout to make this obvious.
 *
 * If the server doesn't populate `wagerAcceptedAtMs` (older wire), this
 * banner stays hidden — graceful degrade. Once the server includes the
 * field in `fight_start`, the banner activates automatically.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useGame } from "@/hooks/useGameStore";
import { useDAppKit, useCurrentClient } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { buildReclaimStalledWagerTx } from "@/lib/sui-contracts";
import { simulateWagerTx } from "@/lib/wager-preflight";
import {
  assertTxSucceeded,
  extractTxDigest,
  humanizeChainError,
} from "@/lib/tx-result";
import { ARENA_ABORT_CODES } from "@/lib/arena-aborts";
import {
  WAGER_RESOLUTION_TIMEOUT_MS,
  formatTimeoutMin,
  computeReclaimEligibility,
} from "@/lib/wager-constants";

export function ReclaimStalledWagerBanner() {
  const { state, dispatch } = useGame();
  const dAppKit = useDAppKit();
  const client = useCurrentClient() as SuiGrpcClient | null;
  const [signing, setSigning] = useState(false);
  // Re-render every 30s so (a) the elapsed counter copy stays fresh
  // and (b) the boundary-cross (29m59s → 30m00s) flips the eligibility
  // gate without waiting for an unrelated state change.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const fight = state.fight;
  const viewerWallet = state.character?.walletAddress ?? "";

  // Pure eligibility decision — lives in lib/wager-constants so the
  // unit test (scripts/qa-reclaim-eligibility.ts) drives every branch
  // with deterministic clock injection. `tick` in the dep array forces
  // a fresh Date.now() read on the 30s timer.
  const eligibility = useMemo(
    () => computeReclaimEligibility(fight, viewerWallet, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fight, viewerWallet, tick],
  );

  if (!eligibility.show) return null;

  const handleReclaim = async () => {
    setSigning(true);
    try {
      const tx = buildReclaimStalledWagerTx(eligibility.wagerMatchId);
      const preflight = await simulateWagerTx(
        client,
        tx,
        viewerWallet,
        "reclaim_stalled_wager",
      );
      if (!preflight.ok) {
        dispatch({ type: "SET_ERROR", message: preflight.message });
        return;
      }
      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result, "reclaim_stalled_wager", ARENA_ABORT_CODES);
      const digest = extractTxDigest(result);

      state.socket.send({
        type: "wager_reclaimed",
        wagerMatchId: eligibility.wagerMatchId,
        ...(digest ? { txDigest: digest } : {}),
      });
    } catch (err: any) {
      console.error("[Wager] reclaim_stalled_wager failed:", err);
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw, ARENA_ABORT_CODES);
      dispatch({
        type: "SET_ERROR",
        message: humanized || raw || "Reclaim transaction rejected",
      });
    } finally {
      setSigning(false);
    }
  };

  const elapsedMin = Math.floor(eligibility.elapsedMs / 60_000);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        margin: "12px 0",
        padding: "12px 16px",
        background: "rgba(184,40,32,0.10)",
        border: "1px solid var(--sc-blood-deep)",
        borderLeft: "3px solid var(--sc-blood)",
        borderRadius: "var(--r-card)",
        fontFamily: "var(--font-ui)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }} aria-hidden>⚠️</span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            color: "var(--sc-parchment)",
          }}
        >
          Referee unresponsive
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>
          {elapsedMin} min since accept
        </span>
      </div>
      <p style={{ fontSize: 13, color: "var(--fg-2)", margin: 0 }}>
        The fight hasn't been settled in {formatTimeoutMin(WAGER_RESOLUTION_TIMEOUT_MS)} —
        well past any normal duration. You can reclaim your stake on-chain.
        Both players get their original stakes back; no winner is declared,
        no platform fee.
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          variant="danger"
          size="sm"
          onClick={handleReclaim}
          disabled={signing}
          title="Reclaims the on-chain escrow for both participants. No winner declared."
        >
          {signing ? "Signing…" : "Reclaim Stalled Wager"}
        </Button>
      </div>
    </div>
  );
}
