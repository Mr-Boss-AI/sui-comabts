import { CONFIG } from '../config';

const RPC_URL = CONFIG.SUI_NETWORK === 'mainnet'
  ? 'https://fullnode.mainnet.sui.io:443'
  : 'https://fullnode.testnet.sui.io:443';

interface OwnedObjectResponse {
  data: Array<{ data?: { objectId: string } }>;
  hasNextPage: boolean;
  nextCursor?: string | null;
}

/**
 * Get all Item NFT object IDs owned by a wallet address via JSON-RPC.
 */
export async function getOwnedItemIds(walletAddress: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | null | undefined = undefined;
  let hasNext = true;

  while (hasNext) {
    const body: Record<string, unknown> = {
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getOwnedObjects',
      params: [
        walletAddress,
        {
          filter: { StructType: `${process.env.SUI_PACKAGE_ID}::item::Item` },
          options: { showContent: false },
        },
        cursor,
        50, // limit
      ],
    };

    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json() as { result: OwnedObjectResponse };
    const result = json.result;

    for (const obj of result.data) {
      if (obj.data?.objectId) {
        ids.add(obj.data.objectId);
      }
    }

    hasNext = result.hasNextPage;
    cursor = result.nextCursor;
  }

  return ids;
}

/**
 * Verify equipped items are still owned by the wallet.
 * Removes any equipped items that the wallet no longer owns.
 * Returns the list of removed slot names (for logging).
 */
export async function verifyEquipmentOwnership(
  walletAddress: string,
  equipment: Record<string, any>,
): Promise<string[]> {
  try {
    const ownedIds = await getOwnedItemIds(walletAddress);
    const removedSlots: string[] = [];

    for (const [slot, item] of Object.entries(equipment)) {
      if (!item) continue;
      // On-chain items have hex object IDs starting with 0x
      if (item.id && item.id.startsWith('0x') && !ownedIds.has(item.id)) {
        equipment[slot] = null;
        removedSlots.push(slot);
      }
    }

    return removedSlots;
  } catch (err) {
    console.error('[Sui] Failed to verify equipment ownership:', err);
    return []; // Don't remove items on RPC failure
  }
}
