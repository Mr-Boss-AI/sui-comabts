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
import { classifyStageEquip } from "@/lib/two-handed-weapons";
import { assertTxSucceeded, humanizeChainError } from "@/lib/tx-result";
import { EQUIPMENT_ABORT_CODES } from "@/lib/equipment-aborts";
import type { EquipmentSlots, Item } from "@/types/game";

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
    // Two-handed weapon gate. The picker layer normally prevents
    // conflicting attempts (offhand row stripped for 2H weapons in the
    // inventory panel; locked rows in the slot picker; disabled
    // offhand SlotTile when a 2H is equipped). This branch is
    // defence-in-depth for keyboard / programmatic paths AND the place
    // where the educational popup is wired.
    //
    // The classifier returns one of three outcomes:
    //   - auto_clear: equipping a 2H over an occupied off-hand — silently
    //     stage the off-hand clear + toast notice (correct user action,
    //     no popup)
    //   - block_and_explain: an off-hand attempt that conflicts with a
    //     2H weapon — refuse the stage AND open the educational modal
    //     so the player learns the rule
    //   - ok: no concern, proceed
    const decision = classifyStageEquip({ slot, candidate: item, pending });
    if (decision === "auto_clear") {
      // Stage the off-hand clear FIRST so the subsequent STAGE_EQUIP
      // sees a consistent pending state.
      dispatch({ type: "STAGE_UNEQUIP", slot: "offhand" });
      dispatch({
        type: "SET_ERROR",
        message: "Off-hand removed — two-handed weapon equipped.",
      });
    } else if (decision === "block_and_explain") {
      // Fire the educational center modal. Self-extinguishing — players
      // who learn the rule (unequip first, then equip) never reach
      // this branch again.
      dispatch({ type: "SHOW_TWO_HANDED_CONFLICT_MODAL" });
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

    const {
      tx,
      changedSlots,
      skippedNonChainSlots,
      reconciledPending,
      offhandAutoCleared,
    } = buildSaveLoadoutTx(characterObjectId, committed, pending);

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
      assertTxSucceeded(result, "save_loadout", EQUIPMENT_ABORT_CODES);

      // PTB committed atomically on chain → reconciledPending IS chain
      // truth (not the original pending — buildSaveLoadoutTx may have
      // auto-cleared the offhand to satisfy the 2H invariant). Rebase
      // committed to it so `isDirty` clears and the UI reflects what
      // actually shipped to chain. A subsequent server-driven DOF
      // re-hydration (handleAuth) will reconcile if anything drifts.
      dispatch({ type: "COMMIT_SAVED", committed: reconciledPending });

      // Non-blocking notice if the build dropped the offhand to honour
      // the 2H rule. We surface it via SET_ERROR (the toast channel) but
      // word it as a notice rather than a failure — the save succeeded.
      if (offhandAutoCleared) {
        dispatch({
          type: "SET_ERROR",
          message: "Off-hand removed — two-handed weapon equipped.",
        });
      }

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
      // dapp-kit 2.16 throws Error directly on MoveAbort (rather than
      // resolving with $kind=FailedTransaction), so assertTxSucceeded —
      // which holds the EQUIPMENT_ABORT_CODES map — never runs for those
      // aborts. Re-humanizing here MUST pass the map too, otherwise the
      // codes-6/7/8/9 friendly strings would only show on the
      // never-taken FailedTransaction path. Verified empirically
      // 2026-05-29: SDK threw "abort code: 6 … 'equipment::equip_weapon'"
      // and the catch is the only humanizer that actually fires.
      const humanized = humanizeChainError(raw, EQUIPMENT_ABORT_CODES);
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
