"use client";

import { useState } from "react";
import { useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import { useGame } from "@/hooks/useGameStore";
import {
  buildEquipTx,
  buildUnequipTx,
  buildSwapEquipmentTx,
  type EquipSlotKey,
} from "@/lib/sui-contracts";
import type { EquipmentSlots, Item } from "@/types/game";

// Frontend slot names use camelCase (ring1/ring2); Move contract uses snake_case.
function toChainSlot(slot: keyof EquipmentSlots): EquipSlotKey {
  if (slot === "ring1") return "ring_1";
  if (slot === "ring2") return "ring_2";
  return slot as EquipSlotKey;
}

// Maps equipment.move abort codes to user-facing strings.
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
 *
 * Shapes recognized:
 *   1. Pre-execution input validation: "Object X is owned by object Y.
 *      Objects owned by other objects cannot be used as input arguments"
 *   2. MoveAbort: "MoveAbort in Nth command, abort code: K,
 *      in '<pkg>::<module>::<fn>' (instruction I)"
 */
function humanizeChainError(errStr: string): string | null {
  if (!errStr) return null;

  // Pre-execution: item is attached as a DOF to a parent object, can't be passed as a tx input
  if (errStr.includes("owned by object") && errStr.includes("cannot be used as input")) {
    return (
      "This item is already equipped on-chain (attached as a dynamic object field). " +
      "Click the equipped slot to manage it, or refresh to sync inventory."
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

  // Last-resort: bare abort code
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
 *
 * Note: many wallets throw the abort directly (e.g. Sui Chrome extension throws
 * TRPCClientError with the MoveAbort message). Those errors bypass this function
 * and land in the caller's catch block — `humanizeChainError` is run there too.
 */
function assertTxSucceeded(result: unknown): void {
  const r = result as any;
  const txData = r?.Transaction || r;
  const status = txData?.effects?.status || r?.effects?.status;

  // Success paths
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
 * Shared equip/unequip logic used by every UI surface (character doll, inventory
 * tab, equipment grid). Having ONE implementation prevents the class of bug where
 * some UI components locally dispatch EQUIP_ONCHAIN_ITEM without signing a real
 * wallet tx, which caused "equipped items appearing on-chain empty."
 *
 * Returns `{ equip, unequip, signing }`:
 *   - `equip(item, slot, currentSlotItem?)` — signs equip (or swap PTB if slot is full
 *     with another on-chain item). Returns true on success.
 *   - `unequip(slot)` — signs unequip. Auto-heals stale local state on ESlotEmpty.
 *     Returns true on success.
 *   - `signing` — true while a wallet tx is in flight.
 *
 * Legacy server-only items (NPC shop from pre-v4) fall through to the WebSocket
 * equip_item/unequip_item path, preserving backward compat.
 */
export function useEquipmentActions() {
  const { state, dispatch } = useGame();
  const dAppKit = useDAppKit();
  const [signing, setSigning] = useState(false);

  const characterObjectId = state.onChainCharacter?.objectId;
  const onChainIds = new Set(state.onChainItems.map((i) => i.id));

  async function equip(
    item: Item,
    slot: keyof EquipmentSlots,
    currentSlotItem: Item | null = null,
  ): Promise<boolean> {
    // Server-only item path (no on-chain presence yet — legacy NPC shop)
    if (!onChainIds.has(item.id)) {
      state.socket.send({ type: "equip_item", itemId: item.id, slot });
      return true;
    }

    // On-chain item path — needs a real wallet-signed tx
    if (!characterObjectId) {
      dispatch({
        type: "SET_ERROR",
        message: "On-chain character not found. Refresh, or re-create your character.",
      });
      return false;
    }

    setSigning(true);
    try {
      const chainSlot = toChainSlot(slot);
      // If the slot is currently occupied by another on-chain item, use the swap
      // PTB so only one wallet prompt appears (unequip + equip in one tx).
      const shouldSwap = !!(currentSlotItem && onChainIds.has(currentSlotItem.id));
      const tx = shouldSwap
        ? buildSwapEquipmentTx(chainSlot, characterObjectId, item.id)
        : buildEquipTx(chainSlot, characterObjectId, item.id);

      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result);

      // Optimistic local update so UI reflects change immediately;
      // the chain re-fetch (scheduled below) reconciles against truth.
      dispatch({ type: "EQUIP_ONCHAIN_ITEM", item, slot });
      setTimeout(() => dispatch({ type: "BUMP_ONCHAIN_REFRESH" }), 1000);
      return true;
    } catch (err: any) {
      // Wallet extensions (e.g. Sui Chrome) throw TRPCClientError with the raw
      // MoveAbort message before signAndExecuteTransaction returns. Humanize here
      // so the user sees "Character level too low..." instead of a raw stack.
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw);
      console.warn("[Equip] rejected:", humanized || raw);
      dispatch({ type: "SET_ERROR", message: humanized || raw || "Equip transaction rejected" });
      return false;
    } finally {
      setSigning(false);
    }
  }

  async function unequip(slot: keyof EquipmentSlots): Promise<boolean> {
    const currentItem = state.onChainEquipped[slot];

    // No on-chain item in this slot → server-only unequip path
    if (!currentItem) {
      state.socket.send({ type: "unequip_item", slot });
      return true;
    }

    if (!characterObjectId) {
      dispatch({
        type: "SET_ERROR",
        message: "On-chain character not found. Refresh to continue.",
      });
      return false;
    }

    setSigning(true);
    try {
      const chainSlot = toChainSlot(slot);
      const tx = buildUnequipTx(chainSlot, characterObjectId);

      const signer = new CurrentAccountSigner(dAppKit as any);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      assertTxSucceeded(result);

      dispatch({ type: "UNEQUIP_ONCHAIN_ITEM", slot });
      setTimeout(() => dispatch({ type: "BUMP_ONCHAIN_REFRESH" }), 1000);
      return true;
    } catch (err: any) {
      const raw = String(err?.message || "");
      const humanized = humanizeChainError(raw);
      console.warn("[Unequip] rejected:", humanized || raw);

      // ESlotEmpty (abort 2) = chain slot is empty but local state thought it wasn't.
      // Auto-heal: clear the stale entry so UI reflects chain truth. Happens when a
      // previous "pretend equip" (pre-Phase-0.5) left the local state ahead.
      if (raw.includes("abort code: 2") || raw.includes("abort code 2") || (humanized && humanized.includes("Slot is empty"))) {
        dispatch({ type: "UNEQUIP_ONCHAIN_ITEM", slot });
        dispatch({
          type: "SET_ERROR",
          message: "Slot was actually empty on-chain — state synced. Equip fresh to re-attach.",
        });
      } else {
        dispatch({ type: "SET_ERROR", message: humanized || raw || "Unequip transaction rejected" });
      }
      return false;
    } finally {
      setSigning(false);
    }
  }

  return { equip, unequip, signing };
}
