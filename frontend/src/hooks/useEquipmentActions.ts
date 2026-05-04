"use client";

import { useMemo, useState } from "react";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import { useGame } from "@/hooks/useGameStore";
import { buildSaveLoadoutTx } from "@/lib/loadout-tx";
import {
  computeDirtySlots,
  isOnChainItem,
  EMPTY_EQUIPMENT,
} from "@/lib/loadout";
import { evaluateTwoHandedConflict } from "@/lib/two-handed-weapons";
import type { EquipmentSlots, Item } from "@/types/game";

// Maps equipment.move abort codes to user-facing strings. These codes are
// defined in contracts/sources/equipment.move — keep this table in sync with
// the Move constants if they ever renumber.
const EQUIPMENT_ABORT_CODES: Record<number, string> = {
  0: "Wrong item type for this slot",
  1: "Slot already occupied",
  2: "Slot is empty — nothing to unequip",
  3: "Character level too low for this item",
  4: "Not your character",
  5: "Character is locked in an active fight",
  6: "Deprecated function (v1)",
};

/**
 * Parses a raw error string (from any source — result.effects.status.error,
 * FailedTransaction.error, or a thrown Error.message) and produces a human
 * message. Returns null if the string doesn't look like a Sui/Move error;
 * callers should fall back to the raw string in that case.
 */
function humanizeChainError(errStr: string): string | null {
  if (!errStr) return null;

  // Pre-execution: item is attached as a DOF to a parent object, can't be
  // passed as a tx input. Happens when local state thinks an item is free
  // but on-chain it is still equipped.
  if (errStr.includes("owned by object") && errStr.includes("cannot be used as input")) {
    return (
      "An item in the loadout is already equipped on-chain under a different slot. " +
      "Refresh inventory and stage again."
    );
  }

  // Full MoveAbort with module + function + instruction
  const moveAbortMatch = errStr.match(
    /abort code[:\s]+(\d+)[^']*'[^']*::([^:']+)::([^']+)'(?:\s*\(instruction (\d+)\))?/
  );
  if (moveAbortMatch) {
    const [, codeStr, module, fn, instr] = moveAbortMatch;
    const code = Number(codeStr);
    const humanMsg = EQUIPMENT_ABORT_CODES[code] || `Abort code ${code}`;
    const location = instr ? `${module}::${fn}:${instr}` : `${module}::${fn}`;
    return `${humanMsg} (at ${location})`;
  }

  const bareCodeMatch = errStr.match(/abort code[:\s]+(\d+)/i);
  if (bareCodeMatch) {
    const code = Number(bareCodeMatch[1]);
    return EQUIPMENT_ABORT_CODES[code] || `Abort code ${code}`;
  }

  return null;
}

/**
 * Inspects a signAndExecuteTransaction result. Throws a human-readable Error
 * if the tx aborted in a path where the SDK resolves the promise instead of
 * throwing (some wallets return FailedTransaction objects). Silent on success.
 */
function assertTxSucceeded(result: unknown): void {
  const r = result as any;
  const txData = r?.Transaction || r;
  const status = txData?.effects?.status || r?.effects?.status;

  if (status && (status.status === "success" || status === "success")) return;
  if (r?.$kind === "Transaction" && !r?.FailedTransaction) return;

  const errStr: string =
    (status && typeof status.error === "string" && status.error) ||
    (typeof r?.FailedTransaction?.error === "string" && r.FailedTransaction.error) ||
    (typeof r?.error === "string" && r.error) ||
    (typeof r?.message === "string" && r.message) ||
    "";

  console.error("[Tx] Aborted. Raw result:", r);
  const humanized = humanizeChainError(errStr);
  throw new Error(humanized || errStr || "Transaction aborted on-chain (see console for raw result)");
}

/**
 * Staging-first equipment hook. Per LOADOUT_DESIGN.md D1=PTB-of-primitives,
 * D3=strict, D4=pending-inactive-during-fight. UI consumers call `stageEquip`
 * / `stageUnequip` to mutate the local `pendingEquipment` slice only; no
 * wallet popups fire until the player clicks Save, at which point `saveLoadout`
 * builds one PTB for all dirty slots, signs once, and on success rebases
 * `committedEquipment := pending`.
 *
 * Legacy server-only NPC items (non-0x ids) can't live on chain and therefore
 * can't enter the PTB. Those paths fall through to the WebSocket
 * `equip_item` / `unequip_item` handlers immediately — same ergonomics as
 * pre-Phase-0.5. All new items introduced by Phase 0.5+ are on-chain NFTs,
 * so this fallthrough only matters for characters still carrying pre-v4 NPC
 * drops.
 */
export function useEquipmentActions() {
  const { state, dispatch } = useGame();
  const dAppKit = useDAppKit();
  const [signing, setSigning] = useState(false);

  const characterObjectId = state.onChainCharacter?.objectId;
  const committed = state.committedEquipment ?? EMPTY_EQUIPMENT;
  const pending = state.pendingEquipment ?? EMPTY_EQUIPMENT;

  // Recomputed on every render — cheap over 10 slots and always reflects the
  // latest dispatch. UI surfaces read this to decide Save-button visibility
  // and to paint dirty-slot indicators.
  const dirtySlots = useMemo(
    () => computeDirtySlots(committed, pending),
    [committed, pending],
  );
  const isDirty = dirtySlots.size > 0;

  function stageEquip(
    item: Item,
    slot: keyof EquipmentSlots,
    _currentSlotItem: Item | null = null,
  ): void {
    // Two-handed weapon gate (Bug 2 Path A, 2026-05-04). The picker
    // already greys out conflicting candidates with a locked + reason
    // UX — this is defence in depth against keyboard / programmatic
    // paths that bypass the disabled card. Same shape as the
    // canAcceptWager guard in handleAcceptWager (Fix A, silent-accept).
    const twoHanded = evaluateTwoHandedConflict({
      slot,
      candidate: item,
      pending,
    });
    if (twoHanded.conflict) {
      dispatch({
        type: "SET_ERROR",
        message: twoHanded.reason ?? "Two-handed conflict — adjust your loadout first.",
      });
      return;
    }

    // Server-only NPC item — no chain representation, no staging. Send the
    // legacy WS message immediately so the server + UI reflect the change.
    if (!isOnChainItem(item)) {
      state.socket.send({ type: "equip_item", itemId: item.id, slot });
      return;
    }

    // On-chain item → stage locally. The actual chain tx fires in saveLoadout.
    dispatch({ type: "STAGE_EQUIP", item, slot });
  }

  function stageUnequip(slot: keyof EquipmentSlots): void {
    const pendingItem = pending[slot];
    const committedItem = committed[slot];

    // On-chain item in either pending OR committed → stage locally. Consulting
    // committed matters because pending can lag (first-load race, or a
    // server-side character refresh that bypassed the pending rebase). In
    // both cases committed is the chain-truth baseline — if it has the NFT,
    // we need to unequip via PTB, not via the legacy WS path.
    const onChainPending = pendingItem && isOnChainItem(pendingItem);
    const onChainCommitted = committedItem && isOnChainItem(committedItem);
    if (onChainPending || onChainCommitted) {
      dispatch({ type: "STAGE_UNEQUIP", slot });
      return;
    }

    // No on-chain item in either slice → legacy server-only path. Either the
    // slot holds an NPC item (no chain presence) or it's already empty; in
    // both cases the server's WS handler is the owner of the slot state.
    state.socket.send({ type: "unequip_item", slot });
  }

  function stageDiscard(): void {
    dispatch({ type: "STAGE_DISCARD" });
  }

  /**
   * Commit all dirty slots to chain in one atomic PTB + one wallet popup.
   * On success the reducer rebases committed := pending so `isDirty` goes
   * false. On failure the pending state is preserved — the user can fix and
   * retry without re-staging.
   */
  async function saveLoadout(): Promise<boolean> {
    if (!isDirty) return true;

    if (!characterObjectId) {
      dispatch({
        type: "SET_ERROR",
        message: "On-chain character not found. Refresh, or re-create your character.",
      });
      return false;
    }

    const { tx, changedSlots, skippedNonChainSlots } = buildSaveLoadoutTx(
      characterObjectId,
      committed,
      pending,
    );

    // If the only dirty slots are NPC-item slots there is nothing to sign —
    // those were already reconciled via WS at the time of staging (or will
    // be shortly). No-op but surface it so the UX doesn't pretend a save ran.
    if (changedSlots.length === 0) {
      if (skippedNonChainSlots.length > 0) {
        dispatch({
          type: "SET_ERROR",
          message: "No on-chain changes to save — NPC items sync via server.",
        });
      }
      return true;
    }

    setSigning(true);
    try {
      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result);

      // PTB committed atomically on chain → pending IS chain truth. Rebase
      // committed to pending so `isDirty` clears. A subsequent server-driven
      // DOF re-hydration (handleAuth) will reconcile if anything drifts.
      dispatch({ type: "COMMIT_SAVED", committed: pending });

      // Give fullnode indexing a beat to propagate before refreshing owned
      // items (so the just-equipped NFTs drop out of wallet listings). The
      // 1s delay mirrors the legacy single-equip flow — we'll replace this
      // with a poll-until-converged helper as part of mainnet prep.
      setTimeout(() => dispatch({ type: "BUMP_ONCHAIN_REFRESH" }), 1000);

      console.log(
        `[Loadout] Saved ${changedSlots.length} slot(s):`,
        changedSlots.join(", "),
      );
      return true;
    } catch (err: any) {
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw);
      console.warn("[Loadout] save rejected:", humanized || raw);
      dispatch({
        type: "SET_ERROR",
        message: humanized || raw || "Save loadout transaction rejected",
      });
      return false;
    } finally {
      setSigning(false);
    }
  }

  return {
    stageEquip,
    stageUnequip,
    stageDiscard,
    saveLoadout,
    signing,
    isDirty,
    dirtySlots,
  };
}
