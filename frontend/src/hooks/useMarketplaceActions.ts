"use client";

import { useCallback, useState } from "react";
import { useDAppKit, useCurrentAccount } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import { useGame } from "@/hooks/useGameStore";
import {
  buildBuyItemTx,
  buildCreateKioskTx,
  buildDelistItemTx,
  buildListItemTx,
  buildTakeFromKioskTx,
  buildWithdrawKioskProfitsTx,
  computeRoyalty,
  TRANSFER_POLICY_ID,
} from "@/lib/sui-contracts";
import type { Item, MarketplaceListing } from "@/types/game";

const SUI_PER_MIST = BigInt(1_000_000_000);

/** SUI (number) → MIST (bigint), rounded down. Defensive — we accept user input. */
export function suiToMist(sui: number): bigint {
  if (!Number.isFinite(sui) || sui <= 0) return BigInt(0);
  // Use 9-decimal string conversion to avoid floating-point drift on round numbers.
  const fixed = sui.toFixed(9);
  const [whole, frac = ""] = fixed.split(".");
  const wholeBig = BigInt(whole) * SUI_PER_MIST;
  const fracBig = BigInt((frac + "000000000").slice(0, 9));
  return wholeBig + fracBig;
}

interface ActionResult {
  ok: boolean;
  digest?: string;
  error?: string;
}

/**
 * Wallet-signing hook for every marketplace mutation. Each action:
 *   1. Builds the PTB locally via `lib/sui-contracts.ts`.
 *   2. Signs + executes via `CurrentAccountSigner` (dapp-kit).
 *   3. On success, bumps `state.onChainRefreshTrigger` so dependent state
 *      (kiosk, owned items) re-fetches; the marketplace listing index is
 *      pushed reactively from the server's gRPC subscription.
 *   4. Returns `{ ok, digest, error }` so the caller can toast either way.
 */
export function useMarketplaceActions() {
  const { state, dispatch } = useGame();
  const dAppKit = useDAppKit();
  const account = useCurrentAccount();
  const [signing, setSigning] = useState(false);

  const sign = useCallback(
    async (build: () => ReturnType<typeof buildCreateKioskTx>): Promise<ActionResult> => {
      if (!account?.address) return { ok: false, error: "Connect a wallet first" };
      setSigning(true);
      try {
        const tx = build();
        const signer = new CurrentAccountSigner(dAppKit as any);
        const result = await signer.signAndExecuteTransaction({ transaction: tx });
        const r = result as any;
        const status = r?.effects?.status;
        if (status && status.status !== "success") {
          throw new Error(status.error || "Tx aborted on-chain");
        }
        const digest: string = r?.digest ?? r?.Transaction?.digest ?? "";
        // Bump triggers a re-fetch of owned items + on-chain character. The
        // marketplace listing index updates via the server's gRPC subscription,
        // pushed back over WS.
        dispatch({ type: "BUMP_ONCHAIN_REFRESH" });
        return { ok: true, digest };
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.warn("[Marketplace] tx failed:", msg);
        return { ok: false, error: msg };
      } finally {
        setSigning(false);
      }
    },
    [account?.address, dAppKit, dispatch],
  );

  const createKiosk = useCallback(async (): Promise<ActionResult> => {
    return sign(() => buildCreateKioskTx());
  }, [sign]);

  const listItem = useCallback(
    async (
      item: Item,
      priceSui: number,
      kioskId: string,
      capId: string,
    ): Promise<ActionResult> => {
      const priceMist = suiToMist(priceSui);
      if (priceMist <= BigInt(0)) {
        return { ok: false, error: "Price must be positive" };
      }
      return sign(() =>
        buildListItemTx(kioskId, capId, item.id, priceMist),
      );
    },
    [sign],
  );

  const delistItem = useCallback(
    async (
      itemId: string,
      kioskId: string,
      capId: string,
    ): Promise<ActionResult> => {
      if (!account?.address) return { ok: false, error: "Connect a wallet first" };
      // Atomic delist + take + transfer-to-self — the seller wants their NFT
      // back in their wallet, not stuck unlisted inside the kiosk.
      return sign(() => buildDelistItemTx(kioskId, capId, itemId, account.address));
    },
    [account?.address, sign],
  );

  /**
   * Pull an unlisted item out of the seller's Kiosk back to their wallet.
   * Migration / recovery path for items already stuck from a pre-fix delist
   * (which left the Item DOF in place). Aborts on chain if the item is still
   * listed — callers should use `delistItem` in that case.
   */
  const retrieveFromKiosk = useCallback(
    async (
      itemId: string,
      kioskId: string,
      capId: string,
    ): Promise<ActionResult> => {
      if (!account?.address) return { ok: false, error: "Connect a wallet first" };
      return sign(() => buildTakeFromKioskTx(kioskId, capId, itemId, account.address));
    },
    [account?.address, sign],
  );

  const buyItem = useCallback(
    async (listing: MarketplaceListing & { kioskId?: string; priceMist?: string }): Promise<ActionResult> => {
      const kioskId = (listing as any).kioskId as string | undefined;
      const priceMistRaw = (listing as any).priceMist as string | undefined;
      if (!kioskId) return { ok: false, error: "Listing missing kioskId" };
      if (!TRANSFER_POLICY_ID) {
        return { ok: false, error: "TransferPolicy not configured (env)" };
      }
      const priceMist = priceMistRaw ? BigInt(priceMistRaw) : suiToMist(listing.price);
      if (priceMist <= BigInt(0)) return { ok: false, error: "Listing has zero price" };
      return sign(() =>
        buildBuyItemTx(kioskId, listing.item.id, priceMist, TRANSFER_POLICY_ID),
      );
    },
    [sign],
  );

  const withdrawProfits = useCallback(
    async (kioskId: string, capId: string): Promise<ActionResult> => {
      if (!account?.address) return { ok: false, error: "Connect a wallet first" };
      return sign(() => buildWithdrawKioskProfitsTx(kioskId, capId, account.address));
    },
    [account?.address, sign],
  );

  return {
    signing,
    createKiosk,
    listItem,
    delistItem,
    retrieveFromKiosk,
    buyItem,
    withdrawProfits,
    /** Pre-compute the royalty (in SUI) for a purchase price (in SUI). */
    previewRoyalty(priceSui: number): { royaltySui: number; totalSui: number; royaltyMist: bigint; priceMist: bigint } {
      const priceMist = suiToMist(priceSui);
      const royaltyMist = computeRoyalty(priceMist);
      return {
        priceMist,
        royaltyMist,
        royaltySui: Number(royaltyMist) / 1_000_000_000,
        totalSui: (Number(priceMist) + Number(royaltyMist)) / 1_000_000_000,
      };
    },
  };
}
