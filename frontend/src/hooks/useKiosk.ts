"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

/**
 * Discovers the user's personal Kiosk by walking their owned KioskOwnerCap.
 * Each marketplace user has at most one — `marketplace.move::create_player_kiosk`
 * mints exactly one Cap per call. The Cap stores the Kiosk's object ID in its
 * `for` field, which we read to navigate back to the Kiosk shared object.
 *
 * We re-fetch on `refreshKey` bumps so the UI can reactively pick up a freshly
 * created kiosk without a page reload.
 */
export interface KioskState {
  /** True after the first fetch resolves. False during initial loading. */
  loaded: boolean;
  /** Kiosk shared-object ID, null if user has no kiosk yet. */
  kioskId: string | null;
  /** KioskOwnerCap object ID. Required to list / delist / withdraw. */
  capId: string | null;
  /** Profits balance (SUI) currently sitting inside the Kiosk. */
  profitsSui: number;
  /** Number of items currently listed in the user's kiosk (chain truth). */
  listingCount: number;
  /** Number of items physically in the kiosk (listed + unlisted). */
  itemCount: number;
}

const EMPTY_STATE: KioskState = {
  loaded: false,
  kioskId: null,
  capId: null,
  profitsSui: 0,
  listingCount: 0,
  itemCount: 0,
};

/**
 * Hook returning the current user's Kiosk metadata. Calling `refresh()` (or
 * incrementing the global `state.onChainRefreshTrigger`) re-runs the chain
 * lookup. Returns `EMPTY_STATE` while not connected.
 */
export function useKiosk(refreshKey: number): KioskState & { refresh: () => void } {
  const account = useCurrentAccount();
  const client = useCurrentClient() as SuiGrpcClient | null;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<KioskState>(EMPTY_STATE);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const wallet = account?.address;
    if (!wallet || !client) {
      setState(EMPTY_STATE);
      return;
    }

    (async () => {
      try {
        // Walk all KioskOwnerCaps the user owns. There may be multiple from
        // failed setup retries; we always pick the FIRST one we see — Kiosk
        // creation is idempotent from the user's perspective and the second
        // cap is dead weight.
        const { objects: caps } = await client.listOwnedObjects({
          owner: wallet,
          type: "0x2::kiosk::KioskOwnerCap",
          include: { json: true },
        });

        if (cancelled) return;

        if (caps.length === 0) {
          setState({ ...EMPTY_STATE, loaded: true });
          return;
        }

        const cap = caps[0];
        const capJson = cap.json as Record<string, unknown> | null;
        const kioskId = String(capJson?.for ?? "");
        if (!kioskId) {
          setState({ ...EMPTY_STATE, loaded: true });
          return;
        }

        // Fetch the Kiosk shared object to read .profits and .item_count.
        const { object: kiosk } = await client.getObject({
          objectId: kioskId,
          include: { json: true },
        });
        const kJson = kiosk.json as Record<string, unknown> | null;
        const profitsMist = BigInt(String(kJson?.profits ?? "0"));
        const itemCount = Number(kJson?.item_count ?? 0);

        // Listing count: enumerate dynamic fields and count Listing entries.
        // kiosk::Listing<T> is a special DF wrapper around the listed item ID.
        // The DF type name contains "::kiosk::Listing".
        let listingCount = 0;
        let dfCursor: string | undefined = undefined;
        let hasNext = true;
        while (hasNext) {
          const res: Awaited<ReturnType<typeof client.listDynamicFields>> =
            await client.listDynamicFields({
              parentId: kioskId,
              cursor: dfCursor,
              limit: 50,
            });
          for (const field of res.dynamicFields) {
            if (field.name?.type?.includes("::kiosk::Listing")) listingCount++;
          }
          hasNext = res.hasNextPage;
          dfCursor = res.cursor ?? undefined;
        }

        if (cancelled) return;

        setState({
          loaded: true,
          kioskId,
          capId: String(cap.objectId),
          profitsSui: Number(profitsMist) / 1_000_000_000,
          listingCount,
          itemCount,
        });
      } catch (err) {
        if (!cancelled) {
          console.warn("[useKiosk] discovery failed:", err);
          setState({ ...EMPTY_STATE, loaded: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.address, client, tick, refreshKey]);

  return { ...state, refresh };
}
