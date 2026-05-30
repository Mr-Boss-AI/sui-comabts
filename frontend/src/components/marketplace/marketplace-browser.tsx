"use client";

/**
 * Phase 2 layout sweep — Market screen composition.
 *
 * Matches design_v2/screenshopts/Screenshot from 2026-05-13 14-01-11.png:
 *
 *   TopBanner "Market" + "ON CHAIN" pill
 *   3-column layout:
 *     LEFT  — filter sidebar (search + rarity chips + slot chips)
 *     CENTER — Slackey "N listings" + sort chips, 3-col ListingCard grid
 *     RIGHT — Your Kiosk panel (List an Item + My Listings rows)
 */

import { useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useMarketplace } from "@/hooks/useMarketplace";
import {
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  RARITY_LABELS,
  type ItemType,
  type MarketplaceListing,
  type Rarity,
} from "@/types/game";
import { BuyListingModal } from "./buy-listing-modal";
import { MyKioskPanel } from "./my-kiosk-panel";
import {
  ListingCard,
  ScreenLayout,
  ThreeColumn,
  TopBanner,
  SectionHeader,
  bpGte,
  useBreakpoint,
} from "@/components/v2/layout";
import { V2Chip, V2Input, SectionLabel } from "@/components/v2";

type SortKey = "newest" | "price_asc" | "price_desc";

const SLOT_TYPE_FILTERS: Array<{ key: ItemType; label: string }> = [
  { key: ITEM_TYPES.WEAPON, label: "Weapon" },
  { key: ITEM_TYPES.SHIELD, label: "Off-hand" },
  { key: ITEM_TYPES.HELMET, label: "Helmet" },
  { key: ITEM_TYPES.CHEST, label: "Chest" },
  { key: ITEM_TYPES.GLOVES, label: "Gloves" },
  { key: ITEM_TYPES.BOOTS, label: "Boots" },
  { key: ITEM_TYPES.RING, label: "Ring" },
  { key: ITEM_TYPES.NECKLACE, label: "Necklace" },
];

/* The summary text shown on each listing tile — short, mono, capitalised. */
function statSummary(item: MarketplaceListing["item"]): string {
  const parts: string[] = [];
  const sb = item.statBonuses;
  if (sb.strengthBonus) parts.push(`STR +${sb.strengthBonus}`);
  if (sb.dexterityBonus) parts.push(`DEX +${sb.dexterityBonus}`);
  if (sb.intuitionBonus) parts.push(`INT +${sb.intuitionBonus}`);
  if (sb.enduranceBonus) parts.push(`END +${sb.enduranceBonus}`);
  return parts.slice(0, 2).join(" / ");
}

/* Two-handed names list (mirrors lib/two-handed-weapons.ts but kept
 * inline so the marketplace browser doesn't pull a tax for a single
 * read). Used to flag the "2H" stamp on weapon cards. */
const TWO_HANDED_HINT = /\bmaul\b|greatsword|two[- ]handed/i;

export function MarketplaceBrowser() {
  const account = useCurrentAccount();
  const { listings } = useMarketplace();
  const bp = useBreakpoint();
  const [filterType, setFilterType] = useState<ItemType | "all">("all");
  const [filterRarity, setFilterRarity] = useState<Rarity | "all">("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<MarketplaceListing | null>(null);

  const myWallet = account?.address?.toLowerCase() ?? "";

  const filtered = useMemo(() => {
    let out = listings.filter((l) => l.seller.toLowerCase() !== myWallet);
    if (filterType !== "all")
      out = out.filter((l) => l.item.itemType === filterType);
    if (filterRarity !== "all")
      out = out.filter((l) => l.item.rarity === filterRarity);
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((l) => l.item.name.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      if (sortBy === "price_asc") return a.price - b.price;
      if (sortBy === "price_desc") return b.price - a.price;
      return b.listedAt - a.listedAt;
    });
    return out;
  }, [listings, myWallet, filterType, filterRarity, sortBy, search]);

  const left = (
    <div
      style={{
        background: "var(--sc-panel)",
        border: "1px solid var(--sc-rim)",
        borderRadius: "var(--r-card)",
        boxShadow: "var(--rim-top), var(--rim-bottom)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <SectionLabel>Search</SectionLabel>
        <V2Input
          placeholder="Maul, ring, hood…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>
      <div>
        <SectionLabel>Rarity</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <V2Chip
            active={filterRarity === "all"}
            tone="bronze"
            onClick={() => setFilterRarity("all")}
            style={{ width: "100%", justifyContent: "flex-start" }}
          >
            All Rarities
          </V2Chip>
          {(Object.entries(RARITY_LABELS) as Array<[string, string]>).map(
            ([k, v]) => (
              <V2Chip
                key={k}
                active={filterRarity === (Number(k) as Rarity)}
                tone="bronze"
                onClick={() => setFilterRarity(Number(k) as Rarity)}
                style={{ width: "100%", justifyContent: "flex-start" }}
              >
                {v}
              </V2Chip>
            ),
          )}
        </div>
      </div>
      <div>
        <SectionLabel>Slot</SectionLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <V2Chip
            active={filterType === "all"}
            tone="steel"
            onClick={() => setFilterType("all")}
          >
            All
          </V2Chip>
          {SLOT_TYPE_FILTERS.map(({ key, label }) => (
            <V2Chip
              key={key}
              active={filterType === key}
              tone="steel"
              onClick={() => setFilterType(key)}
            >
              {label}
            </V2Chip>
          ))}
        </div>
      </div>
    </div>
  );

  const center = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHeader
        title={`${filtered.length} listings`}
        right={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <V2Chip
              active={sortBy === "price_asc"}
              tone="bronze"
              onClick={() => setSortBy("price_asc")}
            >
              Low to High
            </V2Chip>
            <V2Chip
              active={sortBy === "newest"}
              tone="bronze"
              onClick={() => setSortBy("newest")}
            >
              Recent
            </V2Chip>
            <V2Chip
              active={sortBy === "price_desc"}
              tone="bronze"
              onClick={() => setSortBy("price_desc")}
            >
              Rarity
            </V2Chip>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <div
          style={{
            background: "var(--sc-panel)",
            border: "1px solid var(--sc-rim)",
            borderRadius: "var(--r-card)",
            padding: "48px 16px",
            textAlign: "center",
            color: "var(--fg-3)",
            fontFamily: "var(--font-ui)",
            fontStyle: "italic",
          }}
        >
          {listings.length === 0
            ? "No items listed yet. Be the first — open the Your Kiosk panel on the right."
            : "No listings match these filters."}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: bpGte("lg", bp)
              ? "repeat(auto-fill, minmax(220px, 1fr))"
              : "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 14,
          }}
        >
          {filtered.map((listing) => (
            <ListingCard
              key={listing.id}
              imageUrl={listing.item.imageUrl}
              name={listing.item.name}
              slotLabel={ITEM_TYPE_LABELS[listing.item.itemType]}
              rarity={listing.item.rarity}
              statSummary={statSummary(listing.item)}
              priceSui={listing.price}
              twoHanded={TWO_HANDED_HINT.test(listing.item.name)}
              onBuy={() => setSelected(listing)}
              onClick={() => setSelected(listing)}
            />
          ))}
        </div>
      )}
    </div>
  );

  const right = <MyKioskPanel />;

  return (
    <>
      <ScreenLayout>
        <TopBanner
          title="Market"
          subtitle="Kiosk marketplace. 2.5% royalty on every buy. Atomic delist."
          pill="onChain"
          tone="bronze"
        />
        <ThreeColumn
          left={left}
          center={center}
          right={right}
          leftWidth={240}
          rightWidth={300}
        />
      </ScreenLayout>

      {selected && (
        <BuyListingModal listing={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
