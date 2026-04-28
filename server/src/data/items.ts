// v5 is NFT-only — the legacy NPC shop catalog has been removed.
// Items now exist exclusively as on-chain NFTs minted via item::mint_item_admin
// (see scripts/mint-v5-catalog.ts) and traded through the Kiosk marketplace.
//
// These stubs preserve the existing call sites so the server compiles; they
// uniformly return "shop unavailable" so any straggling client request gets a
// clean rejection instead of stale data.
import type { Item } from '../types';

export function getShopCatalog(): Item[] {
  return [];
}

export function getPurchasableItems(): Item[] {
  return [];
}

export function getShopItemById(_itemId: string): Item | undefined {
  return undefined;
}

export function purchaseShopItem(_itemId: string): { item: Item | null; error?: string } {
  return { item: null, error: 'NPC shop is unavailable in v5 — items are NFT-only via the marketplace.' };
}

export function getShopItemPrice(_itemId: string): number {
  return 0;
}
