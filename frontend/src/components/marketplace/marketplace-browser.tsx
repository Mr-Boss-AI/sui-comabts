"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ItemCard } from "@/components/items/item-card";
import { Modal } from "@/components/ui/modal";
import {
  RARITY_COLORS,
  ITEM_TYPE_LABELS,
  RARITY_LABELS,
  type MarketplaceListing,
  type ItemType,
  type Rarity,
} from "@/types/game";

// MARKETPLACE — v5.1 deferred wiring.
// v5.0 ships the contracts (`marketplace.move`) end-to-end with the 2.5%
// royalty rule attached to the TransferPolicy<Item>. The frontend builders
// `buildCreateKioskTx`, `buildListItemTx`, `buildBuyItemTx`, `buildDelistItemTx`
// all live in `lib/sui-contracts.ts` ready to wire. The full UI (cross-player
// kiosk discovery, on-chain ItemListed event subscription, kiosk metadata
// caching) ships in v5.1 alongside the meme-coin visual redesign per
// DESIGN_BRIEF.md. For v5.0 QA, this view stays read-only with a banner.
export function MarketplaceBrowser() {
  const { state } = useGame();
  const account = useCurrentAccount();
  const { marketplaceListings, inventory } = state;
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [filterType, setFilterType] = useState<ItemType | "all">("all");
  const [filterRarity, setFilterRarity] = useState<Rarity | "all">("all");
  const [sortBy, setSortBy] = useState<"price_asc" | "price_desc" | "newest">("newest");

  useEffect(() => {
    state.socket.send({ type: "get_marketplace" });
  }, [state.socket]);

  const filtered = marketplaceListings
    .filter((l) => {
      if (filterType !== "all" && l.item.itemType !== filterType) return false;
      if (filterRarity !== "all" && l.item.rarity !== filterRarity) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "price_asc") return a.price - b.price;
      if (sortBy === "price_desc") return b.price - a.price;
      return b.listedAt - a.listedAt;
    });

  return (
    <>
      <div className="space-y-4">
        {/* v5.1 banner — UI wiring deferred but contracts are live */}
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <span className="font-semibold">Marketplace launching v5.1.</span>{" "}
          The on-chain Kiosk + 2.5% royalty rule is deployed and tested today.
          Cross-player browse / buy / list UI wires up alongside the visual
          redesign — contracts won&rsquo;t change.
        </div>

        {/* Controls (read-only preview) */}
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={filterType}
            onChange={(e) =>
              setFilterType(e.target.value === "all" ? "all" : (Number(e.target.value) as ItemType))
            }
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300"
          >
            <option value="all">All Types</option>
            {Object.entries(ITEM_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={filterRarity}
            onChange={(e) =>
              setFilterRarity(e.target.value === "all" ? "all" : (Number(e.target.value) as Rarity))
            }
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300"
          >
            <option value="all">All Rarities</option>
            {Object.entries(RARITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300"
          >
            <option value="newest">Newest</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
          </select>
        </div>

        {/* Listings */}
        <Card>
          <CardHeader>
            <span className="font-semibold">
              Marketplace ({filtered.length} listings)
            </span>
          </CardHeader>
          <CardBody>
            {filtered.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center py-8">
                No listings yet. (Marketplace activates in v5.1.)
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {filtered.map((listing) => (
                  <div key={listing.id} className="relative">
                    <ItemCard
                      item={listing.item}
                      showPrice
                      onClick={() => setSelectedListing(listing)}
                    />
                    <div className="text-xs text-zinc-500 px-3 pb-1">
                      by {listing.sellerName}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {selectedListing && (
        <Modal
          open
          onClose={() => setSelectedListing(null)}
          title="Buy Item (preview)"
        >
          <div className="space-y-4">
            <ItemCard item={selectedListing.item} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Seller</span>
              <span>{selectedListing.sellerName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Price</span>
              <span className="text-amber-400 font-bold text-lg">
                {selectedListing.price} SUI
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              2.5% royalty added on top at checkout (paid as a separate Coin&lt;SUI&gt;).
            </p>
            <Button disabled className="w-full">
              Marketplace v5.1 — coming soon
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
