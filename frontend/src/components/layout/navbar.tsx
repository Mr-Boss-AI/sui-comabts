"use client";

import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useGame } from "@/hooks/useGameStore";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { Badge } from "@/components/ui/badge";
import { isSoundEnabled, toggleSound } from "@/lib/sounds";
import { useState } from "react";

function formatSui(sui: number): string {
  if (sui === 0) return "0";
  if (sui < 0.01) return sui.toFixed(4);
  if (sui < 1) return sui.toFixed(3);
  return sui.toFixed(2);
}

export function Navbar() {
  const account = useCurrentAccount();
  const { state } = useGame();
  const { character } = state;
  const balance = useWalletBalance();
  const [sound, setSound] = useState(isSoundEnabled());

  return (
    <nav className="border-b border-amber-900/20 bg-[#08080a] sticky top-0 z-40 shadow-lg shadow-black/50">
      <div className="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-lg font-black tracking-tight">
            SUI<span className="text-emerald-400">Combats</span>
          </span>
          {character && (
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="text-zinc-400">{character.name}</span>
              <Badge variant="info">Lv.{character.level}</Badge>
              <Badge variant="warning">{character.rating}</Badge>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {account && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-zinc-900 border border-zinc-700 text-amber-300"
              title={
                balance.error
                  ? `Balance fetch failed: ${balance.error}`
                  : `${balance.mist.toString()} MIST`
              }
            >
              <span className="text-zinc-500">SUI</span>
              <span className="font-mono">
                {balance.error ? "—" : formatSui(balance.sui)}
              </span>
            </span>
          )}
          <button
            onClick={() => setSound(toggleSound())}
            className="text-zinc-500 hover:text-zinc-300 text-sm"
            title={sound ? "Mute sounds" : "Enable sounds"}
          >
            {sound ? "♪" : "♪̸"}
          </button>
          {state.socket.connected ? (
            <div className="w-2 h-2 rounded-full bg-emerald-500" title="Connected" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-red-500" title="Disconnected" />
          )}
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
