import { Transaction } from "@mysten/sui/transactions";
import type { EquipmentSlots } from "@/types/game";
import {
  EQUIPMENT_SLOT_KEYS,
  isOnChainItem,
  toChainSlot,
} from "@/lib/loadout";
import { CALL_PACKAGE, SUI_CLOCK } from "@/lib/sui-contracts";

// Upper-bound gas for a save. Worst case = 10 slots * (unequip + equip) = 20
// moveCalls at ~5M MIST each = 100M MIST on-chain compute; add headroom for
// reference counting, object loads, and any future bump_loadout_version call.
// 150M MIST (0.15 SUI) stays well inside the default 500M budget but tells
// the wallet plugin an explicit ceiling so the fee preview is accurate.
const SAVE_LOADOUT_GAS_BUDGET = BigInt(150_000_000);

export interface BuildSaveLoadoutResult {
  tx: Transaction;
  /** Slots that emitted chain calls. UI uses this for progress/confirmation
   *  copy ("Saving 3 changes…") and for the commit event. */
  changedSlots: Array<keyof EquipmentSlots>;
  /** Slots that are dirty but skipped because the pending item is a legacy
   *  server-only NPC item (no 0x… id — can't participate in a PTB). Callers
   *  should route these through the legacy WS equip_item / unequip_item path
   *  either before or after the save, not inside the PTB. */
  skippedNonChainSlots: Array<keyof EquipmentSlots>;
}

/**
 * Build the one-signature "Save Loadout" PTB. For every slot where committed
 * differs from pending AND both sides are representable on-chain (null or
 * 0x… NFT id), we emit an `unequip_<slot>_v2` followed (if pending has an
 * item) by `equip_<slot>_v2`. Slots where pending == committed are skipped.
 *
 * Atomic on chain: Sui commits the whole PTB or none of it, so "Save" is
 * all-or-nothing from the user's perspective. On failure the signer's
 * caller catches, nothing on chain changes, and local `pending` is
 * preserved so the user can fix and retry.
 *
 * Slot order matches `EQUIPMENT_SLOT_KEYS` so PTB diffs are diff-friendly
 * across saves and easier to compare when debugging on-chain effects.
 */
export function buildSaveLoadoutTx(
  characterObjectId: string,
  committed: EquipmentSlots,
  pending: EquipmentSlots,
): BuildSaveLoadoutResult {
  const tx = new Transaction();
  const changedSlots: Array<keyof EquipmentSlots> = [];
  const skippedNonChainSlots: Array<keyof EquipmentSlots> = [];

  for (const slot of EQUIPMENT_SLOT_KEYS) {
    const committedItem = committed[slot];
    const pendingItem = pending[slot];
    const committedId = committedItem?.id ?? null;
    const pendingId = pendingItem?.id ?? null;

    if (committedId === pendingId) continue;

    // An NPC / server-only item in the slot can't participate in this PTB
    // because the chain can't reference it. Flag and skip — the staging hook
    // is responsible for having already reconciled such slots via WS.
    const committedOk = committedItem == null || isOnChainItem(committedItem);
    const pendingOk = pendingItem == null || isOnChainItem(pendingItem);
    if (!committedOk || !pendingOk) {
      skippedNonChainSlots.push(slot);
      continue;
    }

    const chainSlot = toChainSlot(slot);

    // If the committed slot is filled, unequip first. The v2 function returns
    // the item NFT to the character's owner; we don't need to capture the
    // result handle — the owner becomes the sender implicitly.
    if (committedItem) {
      tx.moveCall({
        target: `${CALL_PACKAGE}::equipment::unequip_${chainSlot}_v2`,
        arguments: [
          tx.object(characterObjectId),
          tx.object(SUI_CLOCK),
        ],
      });
    }

    // If pending wants an item in the slot, equip it after the (optional)
    // unequip. Both moveCalls run inside the same PTB so owner + fight-lock
    // checks fire against the same chain state they'll commit to.
    if (pendingItem) {
      tx.moveCall({
        target: `${CALL_PACKAGE}::equipment::equip_${chainSlot}_v2`,
        arguments: [
          tx.object(characterObjectId),
          tx.object(pendingItem.id),
          tx.object(SUI_CLOCK),
        ],
      });
    }

    changedSlots.push(slot);
  }

  tx.setGasBudget(SAVE_LOADOUT_GAS_BUDGET);
  return { tx, changedSlots, skippedNonChainSlots };
}
