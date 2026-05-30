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
  const { state, dispatch } = useGame();
  const account = useCurrentAccount();
  const kiosk = useKiosk(state.onChainRefreshTrigger);
  const { listings } = useMarketplace();
  const { createKiosk, delistItem, retrieveFromKiosk, withdrawAllProfits, signing } = useMarketplaceActions();
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
      kiosk.refresh();
      return;
    }
    // createKiosk's pre-flight may detect an existing cap and refuse — that's
    // not an error from the user's perspective, just a no-op. Surface the
    // message so they know to wait for the refresh instead of clicking again.
    if (result.error) dispatch({ type: "SET_ERROR", message: result.error });
  }

  async function handleDelist(listing: MarketplaceListing) {
    // Always operate on the kiosk that holds the listing — the server stamps
    // kioskId per listing, and the cap is looked up from the wallet's owned
    // set. This is the orphan-kiosk-safe path: a wallet with two kiosks
    // delists from whichever kiosk the buyer would have purchased from.
    const cap = kiosk.capForKiosk(listing.kioskId);
    if (!cap) return;
    await delistItem(listing.item.id, listing.kioskId, cap);
    kiosk.refresh();
  }

  async function handleRetrieveStuck(item: Item) {
    // Items stamped by `fetchKioskItems` carry their containing kioskId.
    // Falling back to the primary cap is only safe when the wallet owns
    // exactly one kiosk — orphan-bug repair requires the per-item id.
    const kioskId = item.kioskId ?? kiosk.kioskId;
    if (!kioskId) return;
    const cap = kiosk.capForKiosk(kioskId) ?? kiosk.capId;
    if (!cap) return;
    await retrieveFromKiosk(item.id, kioskId, cap);
    kiosk.refresh();
  }

  async function handleWithdraw() {
    // Aggregate withdraw across every kiosk the wallet owns. The UI's
    // Profits number is the sum across kiosks; a single signature has to
    // clear all of them. `withdrawAllProfits` only includes kiosks with
    // a non-zero balance so the PTB stays minimal.
    const withProfits = kiosk.kiosks.filter((k) => k.profitsMist > 0n);
    if (withProfits.length === 0) return;
    await withdrawAllProfits(
      withProfits.map((k) => ({ kioskId: k.kioskId, capId: k.capId })),
    );
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 18,
                color: "var(--sc-bronze)",
              }}
            >
              My Kiosk
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--fg-3)",
              }}
            >
              {kiosk.listingCount} listed &middot; {kiosk.itemCount} total
            </span>
          </div>
        </CardHeader>
        <CardBody style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Profits + withdraw */}
          <div
            style={{
              padding: "10px 12px",
              background: "var(--sc-panel-2)",
              border: "1px solid var(--sc-rim)",
              borderLeft: "3px solid var(--rarity-uncommon)",
              borderRadius: "var(--r-card)",
              boxShadow: "var(--rim-top), var(--rim-bottom)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: "var(--ls-stamp)",
                    textTransform: "uppercase",
                    color: "var(--fg-3)",
                  }}
                >
                  Profits
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 800,
                    fontSize: 16,
                    color: "var(--rarity-uncommon)",
                    marginTop: 2,
                  }}
                >
                  {kiosk.profitsSui.toFixed(6).replace(/\.?0+$/, "")} SUI
                </div>
              </div>
              <Button
                size="sm"
                variant="primary"
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: "var(--ls-stamp)",
                textTransform: "uppercase",
                color: "var(--sc-bronze)",
                borderBottom: "1px solid var(--sc-rim)",
                paddingBottom: 4,
              }}
            >
              My Listings ({myListings.length})
            </div>
            {myListings.length === 0 ? (
              <p style={{ fontSize: 11, color: "var(--fg-3)", textAlign: "center", padding: "8px 0", fontStyle: "italic" }}>
                Nothing for sale yet.
              </p>
            ) : (
              <div
                className="scroll-plate"
                style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}
              >
                {myListings.map((listing) => (
                  <div
                    key={listing.id}
                    style={{
                      background: "var(--sc-panel-2)",
                      border: "1px solid var(--sc-rim)",
                      borderRadius: "var(--r-card)",
                      padding: 8,
                      boxShadow: "var(--rim-top), var(--rim-bottom)",
                    }}
                  >
                    <ItemCard item={{ ...listing.item, kioskListed: true }} compact />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 6,
                        paddingTop: 6,
                        borderTop: "1px solid var(--sc-rim)",
                      }}
                    >
                      <span
                        style={{
                          color: "var(--sc-bronze)",
                          fontWeight: 800,
                          fontSize: 13,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
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
                        onClick={() => handleRetrieveStuck(item)}
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
