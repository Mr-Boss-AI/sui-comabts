"use client";

import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { dAppKit } from "@/config/dapp-kit";
import GameProvider from "./game-provider";
import { GameScreen } from "@/components/layout/game-screen";

export default function ClientApp() {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <GameProvider>
        <GameScreen />
      </GameProvider>
    </DAppKitProvider>
  );
}
