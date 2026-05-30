"use client";

import { useEffect, useRef, useState } from "react";
import { useCurrentClient, useCurrentAccount } from "@mysten/dapp-kit-react";

const MIST_PER_SUI = 1_000_000_000;
const POLL_INTERVAL_MS = 10_000;

export interface WalletBalance {
  /** Raw MIST as a bigint. Use `mist` for math, `sui` for UI display. */
  mist: bigint;
  /** SUI value as a JavaScript number (loses precision past 9 decimals). */
  sui: number;
  loading: boolean;
  error: string | null;
}

const EMPTY: WalletBalance = { mist: BigInt(0), sui: 0, loading: false, error: null };

/**
 * Live SUI balance for the currently-connected wallet. Polls every 10s and
 * also exposes an imperative `refresh()` for use right after a tx lands so
 * the UI doesn't lag the chain by a full poll cycle.
 *
 * Returns `EMPTY` when no wallet is connected — components can render that
 * state cleanly without an extra null check.
 */
export function useWalletBalance(): WalletBalance & { refresh: () => void } {
  const client = useCurrentClient();
  const account = useCurrentAccount();
  const owner = account?.address ?? null;

  const [balance, setBalance] = useState<WalletBalance>(EMPTY);
  const refreshKeyRef = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!owner || !client) {
      setBalance(EMPTY);
      return;
    }

    let cancelled = false;

    async function fetchOnce() {
      if (cancelled) return;
      setBalance((prev) => ({ ...prev, loading: true, error: null }));
      try {
        // dapp-kit v2 client (BaseClient): `getBalance` returns
        // `{ balance: { coinType, balance: string, ... } }`. The string is a
        // uint64 in MIST.
        const result = await client.getBalance({ owner: owner!, coinType: "0x2::sui::SUI" });
        if (cancelled) return;
        const raw = result.balance?.balance ?? "0";
        const mist = BigInt(raw);
        const sui = Number(mist) / MIST_PER_SUI;
        setBalance({ mist, sui, loading: false, error: null });
      } catch (err: any) {
        if (cancelled) return;
        setBalance((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || "Balance fetch failed",
        }));
      }
    }

    fetchOnce();
    const handle = setInterval(fetchOnce, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [owner, client, refreshKey]);

  function refresh() {
    refreshKeyRef.current += 1;
    setRefreshKey(refreshKeyRef.current);
  }

  return { ...balance, refresh };
}
