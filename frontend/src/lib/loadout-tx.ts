import { Transaction } from "@mysten/sui/transactions";
import type { EquipmentSlots } from "@/types/game";
import {
  EQUIPMENT_SLOT_KEYS,
  isOnChainItem,
  toChainSlot,
} from "@/lib/loadout";
import { CALL_PACKAGE, SUI_CLOCK } from "@/lib/sui-contracts";

// Worst case = 10 slots * (unequip + equip) + 1 save_loadout = 21 moveCalls
// at ~5M MIST each. 150M MIST (0.15 SUI) leaves headroom.
const SAVE_LOADOUT_GAS_BUDGET = BigInt(150_000_000);

export interface BuildSaveLoadoutResult {
  tx: Transaction;
  /** Slots that emitted chain calls. UI uses this for progress copy. */
  changedSlots: Array<keyof EquipmentSlots>;
  /** Slots dirty but skipped because the pending item isn't on-chain. */
  skippedNonChainSlots: Array<keyof EquipmentSlots>;
}

/**
 * Build the one-signature "Save Loadout" PTB. For every dirty slot we emit
 * `unequip_<slot>` followed (if pending has an item) by `equip_<slot>`. The
 * final command is `save_loadout` which bumps the on-chain `loadout_version`
 * counter and emits a `LoadoutSaved` event — useful for indexers and a cheap
 * extra anti-cheat signal that the player committed the change deliberately.
 *
 * Atomic on chain: Sui commits the whole PTB or none of it. On failure the
 * signer's caller catches and `pending` is preserved for retry.
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

    const committedOk = committedItem == null || isOnChainItem(committedItem);
    const pendingOk = pendingItem == null || isOnChainItem(pendingItem);
    if (!committedOk || !pendingOk) {
      skippedNonChainSlots.push(slot);
      continue;
    }

    const chainSlot = toChainSlot(slot);

    if (committedItem) {
      tx.moveCall({
        target: `${CALL_PACKAGE}::equipment::unequip_${chainSlot}`,
        arguments: [
          tx.object(characterObjectId),
          tx.object(SUI_CLOCK),
        ],
      });
    }

    if (pendingItem) {
      tx.moveCall({
        target: `${CALL_PACKAGE}::equipment::equip_${chainSlot}`,
        arguments: [
          tx.object(characterObjectId),
          tx.object(pendingItem.id),
          tx.object(SUI_CLOCK),
        ],
      });
    }

    changedSlots.push(slot);
  }

  // Final command: bump loadout_version + emit LoadoutSaved. Only attached when
  // there's at least one slot change — we don't want a no-op tx if the user
  // somehow clicks Save without dirty slots.
  if (changedSlots.length > 0) {
    tx.moveCall({
      target: `${CALL_PACKAGE}::equipment::save_loadout`,
      arguments: [tx.object(characterObjectId)],
    });
  }

  tx.setGasBudget(SAVE_LOADOUT_GAS_BUDGET);
  return { tx, changedSlots, skippedNonChainSlots };
}
