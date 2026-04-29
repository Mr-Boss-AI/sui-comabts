"use client";

import { useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ItemCard } from "@/components/items/item-card";
import { Modal } from "@/components/ui/modal";
import { useGame } from "@/hooks/useGameStore";
import { useKiosk } from "@/hooks/useKiosk";
import { useMarketplaceActions } from "@/hooks/useMarketplaceActions";
import { useMarketplace } from "@/hooks/useMarketplace";
import { ListItemModal } from "./list-item-modal";
import type { Item, MarketplaceListing } from "@/types/game";

/**
 * The "my kiosk" sidebar — collects the seller-side affordances:
 *   - Setup CTA when the wallet has no Kiosk yet
 *   - SUI profits balance + Withdraw button
 *   - List of MY active listings with Delist buttons
 *   - "List a new item" picker that opens the inventory NFT chooser
 *
 * Driven by the `useKiosk` hook (chain-truth Kiosk metadata) and the
 * server-pushed marketplace listing index. The `useGame()`'s
 * `onChainRefreshTrigger` bumps after every tx so the kiosk re-fetches.
 */
export function MyKioskPanel() {
  const { state } = useGame();
  const account = useCurrentAccount();
  const kiosk = useKiosk(state.onChainRefreshTrigger);
  const { listings } = useMarketplace();
  const { createKiosk, delistItem, retrieveFromKiosk, withdrawProfits, signing } = useMarketplaceActions();
  const [picker, setPicker] = useState(false);
  const [selectedToList, setSelectedToList] = useState<Item | null>(null);

  const myWallet = account?.address?.toLowerCase() ?? "";

  // Items the user can list: on-chain NFTs they own that aren't already in
  // a Kiosk and aren't currently equipped (DOFs are excluded by listOwnedObjects
  // anyway — equipped items don't appear in onChainItems).
  const listable = useMemo(() => {
    const equippedIds = new Set<string>();
    for (const item of Object.values(state.pendingEquipment)) if (item) equippedIds.add(item.id);
    for (const item of Object.values(state.committedEquipment)) if (item) equippedIds.add(item.id);
    return state.onChainItems.filter(
      (it) => !it.inKiosk && !equippedIds.has(it.id) && it.id.startsWith("0x"),
    );
  }, [state.onChainItems, state.pendingEquipment, state.committedEquipment]);

  // My active listings: filter the global listing set to those whose seller
  // matches the connected wallet.
  const myListings = useMemo(() => {
    return listings.filter((l) => l.seller.toLowerCase() === myWallet);
  }, [listings, myWallet]);

  // Items physically inside the user's Kiosk that AREN'T currently listed
  // for sale. These are the "stuck" items: a vanilla `kiosk::delist` (pre-
  // atomic-take fix) leaves the Item DOF in the kiosk after removing the
  // Listing DOF. We surface them with a dedicated Retrieve action so any
  // pre-fix delists are recoverable. `inKiosk` and `kioskListed` are
  // stamped chain-side by `fetchKioskItems` so this filter is always true
  // chain-truth, no race with the server's listing index.
  const stuckItems = useMemo(() => {
    return state.onChainItems.filter((it) => it.inKiosk && !it.kioskListed);
  }, [state.onChainItems]);

  async function handleSetupKiosk() {
    const result = await createKiosk();
    if (result.ok) {
      // Force kiosk re-fetch (the BUMP_ONCHAIN_REFRESH inside the action hook
      // already does this; this is just a paranoia call for the local hook).
      kiosk.refresh();
    }
  }

  async function handleDelist(listing: MarketplaceListing) {
    if (!kiosk.kioskId || !kiosk.capId) return;
    await delistItem(listing.item.id, kiosk.kioskId, kiosk.capId);
    kiosk.refresh();
  }

  async function handleRetrieveStuck(itemId: string) {
    if (!kiosk.kioskId || !kiosk.capId) return;
    await retrieveFromKiosk(itemId, kiosk.kioskId, kiosk.capId);
    kiosk.refresh();
  }

  async function handleWithdraw() {
    if (!kiosk.kioskId || !kiosk.capId) return;
    await withdrawProfits(kiosk.kioskId, kiosk.capId);
    kiosk.refresh();
  }

  // ----- Loading shell -----
  if (!kiosk.loaded) {
    return (
      <Card>
        <CardHeader>
          <span className="font-semibold text-zinc-200">My Kiosk</span>
        </CardHeader>
        <CardBody>
          <p className="text-zinc-500 text-sm text-center py-6">Loading kiosk…</p>
        </CardBody>
      </Card>
    );
  }

  // ----- No kiosk yet -----
  if (!kiosk.kioskId) {
    return (
      <Card>
        <CardHeader>
          <span className="font-semibold text-zinc-200">My Kiosk</span>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-zinc-400">
            A Kiosk is a personal vitrine on the Sui Marketplace — it holds the
            items you list for sale and collects SUI from each sale.
          </p>
          <p className="text-xs text-zinc-500">
            One-time setup, gas only (~0.005 SUI). You&apos;ll keep the same
            Kiosk for all future listings.
          </p>
          <Button onClick={handleSetupKiosk} disabled={signing} className="w-full">
            {signing ? "Signing…" : "Create my Kiosk"}
          </Button>
        </CardBody>
      </Card>
    );
  }

  // ----- Kiosk exists -----
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-zinc-200">My Kiosk</span>
            <span className="text-[10px] text-zinc-600">
              {kiosk.listingCount} listed &middot; {kiosk.itemCount} items total
            </span>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          {/* Profits + withdraw */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wide">
                  Profits
                </div>
                <div className="text-emerald-400 font-bold text-base">
                  {kiosk.profitsSui.toFixed(6).replace(/\.?0+$/, "")} SUI
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={kiosk.profitsSui <= 0 || signing}
                onClick={handleWithdraw}
              >
                {signing ? "…" : "Withdraw"}
              </Button>
            </div>
          </div>

          {/* List new item */}
          <Button
            onClick={() => setPicker(true)}
            disabled={listable.length === 0 || signing}
            className="w-full"
          >
            {listable.length === 0 ? "No NFTs to list" : `List an item (${listable.length} available)`}
          </Button>

          {/* My active listings */}
          <div className="space-y-2">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide font-semibold">
              My Listings ({myListings.length})
            </div>
            {myListings.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-2">
                Nothing for sale yet.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto scrollbar-thin">
                {myListings.map((listing) => (
                  <div
                    key={listing.id}
                    className="rounded border border-zinc-800/60 bg-[#0e0e12] p-2"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        {/* Listings are by definition `kioskListed: true` —
                            stamp it so ItemCard renders the amber Listed
                            badge instead of the gray In Kiosk badge. */}
                        <ItemCard item={{ ...listing.item, kioskListed: true }} compact />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-zinc-800/60">
                      <span className="text-amber-400 font-bold text-sm">
                        {listing.price.toFixed(4).replace(/\.?0+$/, "")} SUI
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleDelist(listing)}
                        disabled={signing}
                      >
                        Delist
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stuck items — placed in kiosk but not listed. Provide a one-click
              Retrieve so any pre-atomic-delist leftovers are recoverable. */}
          {stuckItems.length > 0 && (
            <div className="space-y-2 border-t border-amber-900/30 pt-3">
              <div className="text-[10px] text-amber-500/80 uppercase tracking-wide font-semibold">
                Unlisted in Kiosk ({stuckItems.length})
              </div>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                These items are sitting inside your Kiosk but not for sale.
                Pull them back to your wallet to equip or relist.
              </p>
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto scrollbar-thin">
                {stuckItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded border border-zinc-700/40 bg-[#0e0e12] p-2"
                  >
                    <ItemCard item={{ ...item, kioskListed: false }} compact />
                    <div className="flex items-center justify-end mt-1.5 pt-1.5 border-t border-zinc-800/60">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleRetrieveStuck(item.id)}
                        disabled={signing}
                      >
                        {signing ? "…" : "Retrieve"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-zinc-700 text-center">
            Kiosk: <code>{kiosk.kioskId.slice(0, 8)}…{kiosk.kioskId.slice(-4)}</code>
          </p>
        </CardBody>
      </Card>

      {/* Inventory NFT picker for listing */}
      {picker && (
        <Modal open onClose={() => setPicker(false)} title="Choose an item to list" wide>
          {listable.length === 0 ? (
            <p className="text-zinc-500 text-sm text-center py-4">
              You don&apos;t have any unequipped on-chain NFTs to list.
            </p>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto scrollbar-thin">
              {listable.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onClick={() => {
                    setPicker(false);
                    setSelectedToList(item);
                  }}
                />
              ))}
            </div>
          )}
        </Modal>
      )}

      {selectedToList && kiosk.kioskId && kiosk.capId && (
        <ListItemModal
          item={selectedToList}
          kioskId={kiosk.kioskId}
          capId={kiosk.capId}
          onClose={() => setSelectedToList(null)}
          onListed={() => kiosk.refresh()}
        />
      )}
    </>
  );
}
