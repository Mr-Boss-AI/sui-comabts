import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { CONFIG } from '../config';

const network = (CONFIG.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

/**
 * Verify a Wallet-Standard `signPersonalMessage` signature against an
 * expected wallet address.
 *
 * Always injects the shared `SuiJsonRpcClient`. The client is mandatory
 * for zkLogin signatures (Enoki + Slush web wallet's Google/Twitch
 * sign-in flow): `ZkLoginPublicIdentifier.verifyPersonalMessage` calls
 * `client.core.verifyZkLoginSignature(...)` which proxies to the
 * fullnode RPC to validate the on-chain JWK + ZK proof. Without it the
 * verifier throws "A Sui Client (GRPC, GraphQL, or JSON RPC) is
 * required to verify zkLogin signatures" — silently breaking sign-in
 * for every zkLogin-derived account while plain Ed25519 wallets keep
 * working (which is exactly how this regression slipped through the
 * Phase A QA gauntlet's static checks).
 *
 * Ed25519, Secp256k1, Secp256r1, MultiSig, and Passkey signatures
 * verify locally and ignore the injected client, so it's safe to pass
 * unconditionally — there's no separate code path needed per scheme.
 *
 * The returned `PublicKey` is unused at the call site today; the
 * function throws on any verification failure (bad signature, wrong
 * address, network error reaching the zkLogin RPC). The caller wraps
 * this in try/catch and maps the thrown message into the WS error
 * frame sent back to the client.
 */
export async function verifyAuthSignature(
  message: Uint8Array,
  signature: string,
  address: string,
): Promise<void> {
  await verifyPersonalMessageSignature(message, signature, {
    address,
    client,
  });
}

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
