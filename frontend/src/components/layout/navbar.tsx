"use client";

import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useGame } from "@/hooks/useGameStore";
import { Badge } from "@/components/ui/badge";
import { isSoundEnabled, toggleSound } from "@/lib/sounds";
import { useState } from "react";

export function Navbar() {
  const account = useCurrentAccount();
  const { state } = useGame();
  const { character } = state;
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
