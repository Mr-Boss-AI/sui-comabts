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

export function MarketplaceBrowser() {
  const { state } = useGame();
  const account = useCurrentAccount();
  const { marketplaceListings, inventory } = state;
  const [selectedListing, setSelectedListing] = useState<MarketplaceListing | null>(null);
  const [filterType, setFilterType] = useState<ItemType | "all">("all");
  const [filterRarity, setFilterRarity] = useState<Rarity | "all">("all");
  const [showSellModal, setShowSellModal] = useState(false);
  const [sellItemId, setSellItemId] = useState("");
  const [sellPrice, setSellPrice] = useState(100);
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

  const myListings = marketplaceListings.filter(
    (l) => l.seller === account?.address
  );

  function handleBuy(listing: MarketplaceListing) {
    state.socket.send({ type: "buy_listing", listingId: listing.id });
    setSelectedListing(null);
  }

  function handleDelist(listingId: string) {
    state.socket.send({ type: "delist_item", listingId });
  }

  function handleList() {
    if (!sellItemId || sellPrice < 1) return;
    state.socket.send({
      type: "list_item",
      itemId: sellItemId,
      price: sellPrice,
    });
    setShowSellModal(false);
    setSellItemId("");
  }

  return (
    <>
      <div className="space-y-4">
        {/* Controls */}
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
          <div className="flex-1" />
          <Button size="sm" variant="gold" onClick={() => setShowSellModal(true)}>
            Sell Item
          </Button>
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
                No listings found
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

        {/* My Listings */}
        {myListings.length > 0 && (
          <Card>
            <CardHeader>
              <span className="font-semibold">My Listings</span>
            </CardHeader>
            <CardBody>
              <div className="space-y-2">
                {myListings.map((listing) => (
                  <div
                    key={listing.id}
                    className="flex items-center justify-between bg-zinc-800/50 rounded-lg p-2"
                  >
                    <div>
                      <span className={`text-sm ${RARITY_COLORS[listing.item.rarity]}`}>
                        {listing.item.name}
                      </span>
                      <span className="text-xs text-amber-400 ml-2">
                        {listing.price} SUI
                      </span>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelist(listing.id)}
                    >
                      Delist
                    </Button>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Buy Modal */}
      {selectedListing && (
        <Modal
          open
          onClose={() => setSelectedListing(null)}
          title="Buy Item"
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
              2.5% royalty included in price
            </p>
            <Button
              onClick={() => handleBuy(selectedListing)}
              disabled={selectedListing.seller === account?.address}
              className="w-full"
            >
              {selectedListing.seller === account?.address
                ? "This is your listing"
                : "Buy Now"}
            </Button>
          </div>
        </Modal>
      )}

      {/* Sell Modal */}
      {showSellModal && (
        <Modal
          open
          onClose={() => setShowSellModal(false)}
          title="Sell Item"
          wide
        >
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Select an item from your inventory to list on the marketplace.
            </p>
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {inventory.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  selected={sellItemId === item.id}
                  onClick={() => setSellItemId(item.id)}
                />
              ))}
            </div>
            {sellItemId && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-zinc-400">Price (SUI):</label>
                <input
                  type="number"
                  min={1}
                  value={sellPrice}
                  onChange={(e) => setSellPrice(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-32 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100"
                />
              </div>
            )}
            <Button
              onClick={handleList}
              disabled={!sellItemId || sellPrice < 1}
              className="w-full"
            >
              List for Sale
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
