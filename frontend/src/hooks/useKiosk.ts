"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

/**
 * Aggregates every Sui Kiosk owned by the current wallet.
 *
 * Why this is more than a "find my kiosk" lookup: a wallet can end up owning
 * multiple KioskOwnerCaps if `marketplace::create_player_kiosk` is called
 * twice (e.g. duplicate click during a tx-indexing lag, or two tabs racing).
 * The phantom-empty-kiosk incident (May 2026, ShakaLiX) traced to a
 * `caps[0]`-only resolution that flip-flopped between sessions because
 * `listOwnedObjects` returns caps in unstable order — the UI showed the
 * empty Kiosk A while listings + sale profits settled in Kiosk B. By
 * enumerating every cap, fetching every kiosk's metadata, and aggregating
 * profits / listings / items across all of them, this hook reports the
 * wallet's true marketplace surface even when duplicates exist. Repair is
 * automatic: a Withdraw triggered against the aggregated state sweeps
 * every kiosk's profits in one PTB (see `buildWithdrawAllKioskProfitsTx`).
 */
export interface KioskInfo {
  kioskId: string;
  capId: string;
  profitsSui: number;
  profitsMist: bigint;
  listingCount: number;
  itemCount: number;
}

export interface KioskState {
  /** True after the first fetch resolves. False during initial loading. */
  loaded: boolean;
  /** Every Kiosk this wallet currently owns. Empty when none. */
  kiosks: KioskInfo[];
  /** Primary kiosk — first non-empty kiosk (`profits > 0 || itemCount > 0`)
   *  or, lacking any non-empty, the first cap returned by RPC. `null` when
   *  the wallet owns no kiosks. New listings should be written through this
   *  cap so all activity coalesces back onto one kiosk over time. */
  kioskId: string | null;
  capId: string | null;
  /** Aggregate profits across every owned kiosk (SUI display). */
  profitsSui: number;
  /** Aggregate listing count across every owned kiosk. */
  listingCount: number;
  /** Aggregate item count across every owned kiosk. */
  itemCount: number;
  /** Returns the KioskOwnerCap object id for a given kiosk shared-object id,
   *  or `null` if this wallet doesn't own a cap for it. Used to route
   *  Delist / Retrieve / per-kiosk Withdraw to the correct cap when a wallet
   *  owns multiple kiosks (orphan-repair flow). */
  capForKiosk: (kioskId: string) => string | null;
}

const EMPTY_STATE: KioskState = {
  loaded: false,
  kiosks: [],
  kioskId: null,
  capId: null,
  profitsSui: 0,
  listingCount: 0,
  itemCount: 0,
  capForKiosk: () => null,
};

/**
 * Pure aggregation: collapse N kiosks into the panel's single-kiosk view.
 *
 * Primary cap selection rules (tested in qa-kiosk-orphan.ts):
 *   - If any kiosk has profits > 0 OR item_count > 0, pick the FIRST such kiosk.
 *     This is the post-orphan-bug repair contract — a wallet that accidentally
 *     created two kiosks should see the one that actually holds value.
 *   - Otherwise return the first kiosk in input order (stable fallback for
 *     fresh empty wallets where neither has activity yet).
 *   - Empty input → all nulls.
 *
 * Exported for the gauntlet; the hook only consumes it.
 */
export function aggregateKiosks(kiosks: KioskInfo[]): Omit<KioskState, "loaded"> {
  const primary =
    kiosks.find((k) => k.profitsMist > 0n || k.itemCount > 0) ?? kiosks[0] ?? null;
  const capMap = new Map<string, string>(kiosks.map((k) => [k.kioskId, k.capId]));
  return {
    kiosks,
    kioskId: primary?.kioskId ?? null,
    capId: primary?.capId ?? null,
    profitsSui: kiosks.reduce((s, k) => s + k.profitsSui, 0),
    listingCount: kiosks.reduce((s, k) => s + k.listingCount, 0),
    itemCount: kiosks.reduce((s, k) => s + k.itemCount, 0),
    capForKiosk: (id: string) => capMap.get(id) ?? null,
  };
}

async function readKioskInfo(
  client: SuiGrpcClient,
  capObjectId: string,
  capJson: Record<string, unknown> | null,
): Promise<KioskInfo | null> {
  const kioskId = String(capJson?.for ?? "");
  if (!kioskId) return null;

  const { object: kiosk } = await client.getObject({
    objectId: kioskId,
    include: { json: true },
  });
  const kJson = kiosk.json as Record<string, unknown> | null;
  const profitsMist = BigInt(String(kJson?.profits ?? "0"));
  const itemCount = Number(kJson?.item_count ?? 0);

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

  return {
    kioskId,
    capId: capObjectId,
    profitsMist,
    profitsSui: Number(profitsMist) / 1_000_000_000,
    listingCount,
    itemCount,
  };
}

/**
 * Hook returning every kiosk this wallet owns, aggregated. Call `refresh()`
 * (or bump the global `onChainRefreshTrigger`) to re-run discovery. Returns
 * `EMPTY_STATE` while not connected.
 */
export function useKiosk(refreshKey: number): KioskState & { refresh: () => void } {
  const account = useCurrentAccount();
  const client = useCurrentClient() as SuiGrpcClient | null;
  const [tick, setTick] = useState(0);
  const [kiosks, setKiosks] = useState<KioskInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const wallet = account?.address;
    if (!wallet || !client) {
      setKiosks([]);
      setLoaded(false);
      return;
    }

    (async () => {
      try {
        const { objects: caps } = await client.listOwnedObjects({
          owner: wallet,
          type: "0x2::kiosk::KioskOwnerCap",
          include: { json: true },
        });

        if (cancelled) return;

        if (caps.length === 0) {
          setKiosks([]);
          setLoaded(true);
          return;
        }

        const infos = await Promise.all(
          caps.map((cap) =>
            readKioskInfo(
              client,
              String(cap.objectId),
              cap.json as Record<string, unknown> | null,
            ).catch(() => null),
          ),
        );

        if (cancelled) return;
        setKiosks(infos.filter((x): x is KioskInfo => x !== null));
        setLoaded(true);
      } catch (err) {
        if (!cancelled) {
          console.warn("[useKiosk] discovery failed:", err);
          setKiosks([]);
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.address, client, tick, refreshKey]);

  return useMemo(
    () => ({ loaded, ...aggregateKiosks(kiosks), refresh }),
    [kiosks, loaded, refresh],
  );
}
