"use client";

import { useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ItemCard } from "@/components/items/item-card";
import { useMarketplace } from "@/hooks/useMarketplace";
import {
  ITEM_TYPE_LABELS,
  RARITY_LABELS,
  type ItemType,
  type MarketplaceListing,
  type Rarity,
} from "@/types/game";
import { BuyListingModal } from "./buy-listing-modal";

type SortKey = "newest" | "price_asc" | "price_desc";

/**
 * Public marketplace browse view. Pulls from the server's listing index
 * (cold-synced + reactive via the gRPC checkpoint subscription). Mine listings
 * are filtered out — those live in the MyKioskPanel where the user can delist.
 */
export function MarketplaceBrowser() {
  const account = useCurrentAccount();
  const { listings } = useMarketplace();
  const [filterType, setFilterType] = useState<ItemType | "all">("all");
  const [filterRarity, setFilterRarity] = useState<Rarity | "all">("all");
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<MarketplaceListing | null>(null);

  const myWallet = account?.address?.toLowerCase() ?? "";

  const filtered = useMemo(() => {
    let out = listings.filter((l) => l.seller.toLowerCase() !== myWallet);
    if (filterType !== "all") out = out.filter((l) => l.item.itemType === filterType);
    if (filterRarity !== "all") out = out.filter((l) => l.item.rarity === filterRarity);
    out = [...out].sort((a, b) => {
      if (sortBy === "price_asc") return a.price - b.price;
      if (sortBy === "price_desc") return b.price - a.price;
      return b.listedAt - a.listedAt;
    });
    return out;
  }, [listings, myWallet, filterType, filterRarity, sortBy]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200">
              Marketplace ({filtered.length} listings)
            </span>
          </div>
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
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300"
            >
              <option value="newest">Newest first</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-12">
              {listings.length === 0
                ? "No items listed yet. Be the first — open My Kiosk on the right."
                : "No listings match these filters."}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[640px] overflow-y-auto scrollbar-thin pr-1">
              {filtered.map((listing) => (
                <button
                  key={listing.id}
                  type="button"
                  onClick={() => setSelected(listing)}
                  className="text-left"
                >
                  <div className="rounded border border-zinc-800/60 bg-[#0e0e12] hover:border-amber-700/60 hover:bg-zinc-900/60 transition-colors">
                    <ItemCard item={listing.item} compact />
                    <div className="flex items-center justify-between px-2.5 pb-2 pt-1 border-t border-zinc-800/60">
                      <span className="text-[10px] text-zinc-500 truncate">
                        by {listing.sellerName}
                      </span>
                      <span className="text-amber-400 font-bold text-sm">
                        {listing.price.toFixed(4).replace(/\.?0+$/, "")} SUI
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {selected && (
        <BuyListingModal
          listing={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
