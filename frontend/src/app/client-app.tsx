"use client";

import { useEffect } from "react";
import { DAppKitProvider, useCurrentAccount } from "@mysten/dapp-kit-react";
import { dAppKit, SESSION_MARKER_STORAGE_KEY } from "@/config/dapp-kit";
import GameProvider from "./game-provider";
import { GameScreen } from "@/components/layout/game-screen";

/**
 * v5.1 (2026-05-28 PM) — Session marker bridge.
 *
 * Sits inside the DAppKitProvider tree so `useCurrentAccount()` is
 * available. Whenever the connected account becomes non-null we write
 * a sessionStorage marker that survives page refresh but clears with
 * the tab. On the next page boot, `frontend/src/config/dapp-kit.ts`
 * reads this marker and only enables dapp-kit's silent autoConnect
 * when it's present.
 *
 * Result:
 *   - First open / fresh tab → no marker → autoConnect=false → wallet
 *     picker shown. No silent Google re-auth.
 *   - Refresh during an active session → marker present → autoConnect
 *     restores the same wallet seamlessly. No re-OAuth.
 *   - Explicit disconnect via ConnectButton dropdown → account becomes
 *     null → marker cleared → next refresh shows the picker.
 *   - Close-and-reopen tab → sessionStorage cleared automatically → picker.
 */
function SessionAutoConnectMarker() {
  const account = useCurrentAccount();
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (account) {
      window.sessionStorage.setItem(SESSION_MARKER_STORAGE_KEY, "1");
    } else {
      window.sessionStorage.removeItem(SESSION_MARKER_STORAGE_KEY);
    }
  }, [account]);
  return null;
}

export default function ClientApp() {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <SessionAutoConnectMarker />
      <GameProvider>
        <GameScreen />
      </GameProvider>
    </DAppKitProvider>
  );
}
