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
        <CardHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 20,
                  color: "var(--sc-bronze)",
                  letterSpacing: "0.01em",
                }}
              >
                Marketplace
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 11,
                  color: "var(--fg-3)",
                }}
              >
                {filtered.length} listings
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {[
                {
                  value: filterType,
                  onChange: (v: string) =>
                    setFilterType(v === "all" ? "all" : (Number(v) as ItemType)),
                  options: [["all", "All Types"], ...Object.entries(ITEM_TYPE_LABELS)] as [string, string][],
                },
                {
                  value: filterRarity,
                  onChange: (v: string) =>
                    setFilterRarity(v === "all" ? "all" : (Number(v) as Rarity)),
                  options: [["all", "All Rarities"], ...Object.entries(RARITY_LABELS)] as [string, string][],
                },
                {
                  value: sortBy,
                  onChange: (v: string) => setSortBy(v as SortKey),
                  options: [
                    ["newest", "Newest first"],
                    ["price_asc", "Price: Low → High"],
                    ["price_desc", "Price: High → Low"],
                  ] as [string, string][],
                },
              ].map((s, i) => (
                <select
                  key={i}
                  value={s.value}
                  onChange={(e) => s.onChange(e.target.value)}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 11,
                    padding: "5px 9px",
                    background: "var(--sc-panel-2)",
                    color: "var(--sc-parchment)",
                    border: "1px solid var(--sc-rim-2)",
                    borderRadius: "var(--r-sm)",
                    outline: "none",
                    boxShadow: "var(--rim-top)",
                    cursor: "pointer",
                  }}
                >
                  {s.options.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <p
              style={{
                color: "var(--fg-3)",
                fontSize: 13,
                textAlign: "center",
                padding: "40px 0",
                fontStyle: "italic",
              }}
            >
              {listings.length === 0
                ? "No items listed yet. Be the first — open My Kiosk on the right."
                : "No listings match these filters."}
            </p>
          ) : (
            <div
              className="scroll-plate"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 8,
                maxHeight: 640,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {filtered.map((listing) => (
                <button
                  key={listing.id}
                  type="button"
                  onClick={() => setSelected(listing)}
                  style={{
                    textAlign: "left",
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      background: "var(--sc-panel)",
                      border: "1px solid var(--sc-rim)",
                      borderRadius: "var(--r-card)",
                      boxShadow: "var(--rim-top), var(--rim-bottom)",
                      transition: "border-color var(--d-fast), transform var(--d-fast)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--sc-bronze)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--sc-rim)";
                      e.currentTarget.style.transform = "";
                    }}
                  >
                    <ItemCard item={listing.item} compact />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        borderTop: "1px solid var(--sc-rim)",
                        background: "var(--sc-panel-2)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--sc-steel)",
                          fontFamily: "var(--font-mono)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        by {listing.sellerName}
                      </span>
                      <span
                        style={{
                          color: "var(--sc-bronze)",
                          fontFamily: "var(--font-mono)",
                          fontWeight: 800,
                          fontSize: 13,
                        }}
                      >
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
