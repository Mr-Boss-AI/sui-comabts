import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { CONFIG } from '../config';

const network = (CONFIG.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

/**
 * Get all Item NFT object IDs owned by a wallet, paginated.
 */
export async function getOwnedItemIds(walletAddress: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | null | undefined = undefined;

  while (true) {
    const page = await client.getOwnedObjects({
      owner: walletAddress,
      filter: { StructType: `${CONFIG.SUI_PACKAGE_ID}::item::Item` },
      options: { showContent: false },
      cursor,
      limit: 50,
    });

    for (const obj of page.data) {
      if (obj.data?.objectId) ids.add(obj.data.objectId);
    }

    if (!page.hasNextPage || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return ids;
}

/**
 * Drop equipment slots whose on-chain Item is no longer in the wallet.
 * Returns the slot names cleared.
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
      if (item.id && item.id.startsWith('0x') && !ownedIds.has(item.id)) {
        equipment[slot] = null;
        removedSlots.push(slot);
      }
    }

    return removedSlots;
  } catch (err) {
    console.error('[Sui] Failed to verify equipment ownership:', err);
    return [];
  }
}
