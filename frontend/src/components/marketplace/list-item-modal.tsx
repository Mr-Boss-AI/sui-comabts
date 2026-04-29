"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ItemCard } from "@/components/items/item-card";
import { useGame } from "@/hooks/useGameStore";
import { useMarketplaceActions, suiToMist } from "@/hooks/useMarketplaceActions";
import type { Item } from "@/types/game";

const LISTING_FEE_SUI = 0.01;

interface ListItemModalProps {
  item: Item;
  kioskId: string;
  capId: string;
  onClose: () => void;
  onListed?: () => void;
}

/**
 * Modal that turns one inventory NFT into a Kiosk listing in a single tx.
 * The chain charges a flat 0.01 SUI listing fee (LISTING_FEE_MIST in
 * marketplace.move) routed to TREASURY; we surface that here so the seller
 * isn't surprised.
 *
 * Validation:
 *   - Price must be > 0 (chain aborts EInvalidPrice otherwise).
 *   - Item must not be in a Kiosk already (caller's responsibility — we hide
 *     the entry point in inventory if `inKiosk` is set).
 *   - Item must be an on-chain NFT (0x... ID, length >= 42). NPC items can't
 *     be listed.
 */
export function ListItemModal({ item, kioskId, capId, onClose, onListed }: ListItemModalProps) {
  const { dispatch } = useGame();
  const { listItem, signing } = useMarketplaceActions();
  const [priceText, setPriceText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const priceSui = Number(priceText);
  const priceValid = Number.isFinite(priceSui) && priceSui > 0;
  const priceMist = priceValid ? suiToMist(priceSui) : BigInt(0);
  const totalCostSui = priceValid ? priceSui + LISTING_FEE_SUI : LISTING_FEE_SUI;

  async function handleSubmit() {
    setError(null);
    if (!priceValid) {
      setError("Enter a price greater than 0");
      return;
    }
    const result = await listItem(item, priceSui, kioskId, capId);
    if (!result.ok) {
      setError(result.error || "List failed");
      return;
    }
    dispatch({ type: "SET_ERROR", message: `Listed ${item.name} for ${priceSui} SUI` });
    onListed?.();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="List on Marketplace">
      <div className="space-y-4">
        <ItemCard item={item} />

        <div>
          <label className="block text-xs text-zinc-400 mb-1">Price (SUI)</label>
          <input
            type="number"
            min="0"
            step="0.001"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            placeholder="e.g. 0.5"
            disabled={signing}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-50"
          />
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-500">Listing fee</span>
            <span className="text-zinc-300">{LISTING_FEE_SUI} SUI</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Sale price</span>
            <span className="text-zinc-300">
              {priceValid ? priceSui.toFixed(4).replace(/\.?0+$/, "") : "—"} SUI
            </span>
          </div>
          <div className="flex justify-between border-t border-zinc-800 pt-1.5 mt-1.5">
            <span className="text-zinc-400 font-semibold">You pay now</span>
            <span className="text-amber-400 font-bold">
              {totalCostSui.toFixed(4).replace(/\.?0+$/, "")} SUI
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">You receive on sale</span>
            <span className="text-emerald-400">
              {priceValid ? priceSui.toFixed(4).replace(/\.?0+$/, "") : "—"} SUI
            </span>
          </div>
          <p className="text-[10px] text-zinc-600 pt-1">
            Buyer also pays a 2.5% royalty on top of the price (separate Coin&lt;SUI&gt;).
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded px-2 py-1.5">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={signing} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!priceValid || signing} className="flex-1">
            {signing ? "Signing…" : "List for Sale"}
          </Button>
        </div>

        <p className="text-[10px] text-zinc-600 text-center">
          Item ID: <code>{item.id.slice(0, 10)}…{item.id.slice(-6)}</code>
          {priceMist > BigInt(0) && (
            <> &middot; {priceMist.toString()} MIST</>
          )}
        </p>
      </div>
    </Modal>
  );
}
