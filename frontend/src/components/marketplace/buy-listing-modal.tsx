"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ItemCard } from "@/components/items/item-card";
import { useGame } from "@/hooks/useGameStore";
import { useMarketplaceActions } from "@/hooks/useMarketplaceActions";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import type { MarketplaceListing } from "@/types/game";

interface BuyListingModalProps {
  listing: MarketplaceListing;
  onClose: () => void;
  onBought?: () => void;
}

/**
 * Buy-listing modal. Surfaces price + 2.5% royalty + total upfront so there
 * are no surprises. Disables the Buy button when the connected wallet's SUI
 * balance is below `total + a small gas headroom`.
 *
 * The buy_item PTB sends two Coin<SUI> args to chain (price + royalty); the
 * tx builder lives in `lib/sui-contracts.ts::buildBuyItemTx`.
 */
export function BuyListingModal({ listing, onClose, onBought }: BuyListingModalProps) {
  const { dispatch } = useGame();
  const { buyItem, previewRoyalty, signing } = useMarketplaceActions();
  const balance = useWalletBalance();
  const [error, setError] = useState<string | null>(null);

  const preview = previewRoyalty(listing.price);
  // 0.05 SUI gas headroom — gas for a kiosk buy is typically ~5M MIST,
  // 0.05 SUI gives ~10x buffer. Below this we hard-block the Buy button.
  const GAS_HEADROOM_SUI = 0.05;
  const balanceSui = balance.sui;
  const totalNeeded = preview.totalSui + GAS_HEADROOM_SUI;
  const insufficient = !balance.loading && balanceSui < totalNeeded;

  async function handleBuy() {
    setError(null);
    const result = await buyItem(listing as MarketplaceListing & { kioskId: string; priceMist: string });
    if (!result.ok) {
      setError(result.error || "Buy failed");
      return;
    }
    dispatch({ type: "SET_ERROR", message: `Bought ${listing.item.name} for ${listing.price} SUI` });
    onBought?.();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Buy from Marketplace">
      <div className="space-y-4">
        <ItemCard item={listing.item} />

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-500">Seller</span>
            <span className="text-zinc-300">{listing.sellerName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Price</span>
            <span className="text-zinc-300">
              {listing.price.toFixed(4).replace(/\.?0+$/, "")} SUI
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Royalty (2.5%)</span>
            <span className="text-zinc-300">
              {preview.royaltySui.toFixed(6).replace(/\.?0+$/, "")} SUI
            </span>
          </div>
          <div className="flex justify-between border-t border-zinc-800 pt-1.5 mt-1.5">
            <span className="text-zinc-400 font-semibold">Total</span>
            <span className="text-amber-400 font-bold">
              {preview.totalSui.toFixed(6).replace(/\.?0+$/, "")} SUI
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">+ Gas headroom</span>
            <span className="text-zinc-500">~{GAS_HEADROOM_SUI} SUI</span>
          </div>
          <div className="flex justify-between border-t border-zinc-800 pt-1.5 mt-1.5">
            <span className="text-zinc-400">Your balance</span>
            <span className={insufficient ? "text-red-400 font-semibold" : "text-zinc-300"}>
              {balance.loading ? "…" : `${balanceSui.toFixed(4).replace(/\.?0+$/, "")} SUI`}
            </span>
          </div>
        </div>

        {insufficient && (
          <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded px-2 py-1.5">
            Insufficient SUI. Need ~{totalNeeded.toFixed(4)} (price + royalty + gas), have{" "}
            {balanceSui.toFixed(4)}.
          </p>
        )}

        {error && (
          <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={signing} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleBuy}
            disabled={signing || insufficient}
            className="flex-1"
          >
            {signing ? "Signing…" : `Buy for ${preview.totalSui.toFixed(4).replace(/\.?0+$/, "")} SUI`}
          </Button>
        </div>

        <p className="text-[10px] text-zinc-600 text-center">
          Item ID: <code>{listing.item.id.slice(0, 10)}…{listing.item.id.slice(-6)}</code>
        </p>
      </div>
    </Modal>
  );
}
