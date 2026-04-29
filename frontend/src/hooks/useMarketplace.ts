"use client";

import { useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";

/**
 * Pulls the server's marketplace listing index on mount and any time the
 * socket auth state flips. The server's gRPC checkpoint subscription pushes
 * `item_listed` / `item_delisted` / `item_bought` deltas reactively, which
 * GameProvider already wires into the reducer — we only need to ask for the
 * initial snapshot here.
 *
 * Returns `state.marketplaceListings` so consumers don't have to know about
 * the underlying reducer.
 */
export function useMarketplace() {
  const { state } = useGame();

  useEffect(() => {
    if (!state.socket?.authenticated) return;
    state.socket.send({ type: "get_marketplace" });
  }, [state.socket?.authenticated, state.socket]);

  return {
    listings: state.marketplaceListings,
    refresh: () => state.socket.send({ type: "get_marketplace" }),
  };
}
