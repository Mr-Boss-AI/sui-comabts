"use client";

import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OnlinePlayer, FightType } from "@/types/game";

const STATUS_COLORS: Record<OnlinePlayer["status"], string> = {
  online: "bg-emerald-500",
  in_fight: "bg-red-500",
  in_marketplace: "bg-amber-500",
  idle: "bg-zinc-500",
};

const STATUS_LABELS: Record<OnlinePlayer["status"], string> = {
  online: "Online",
  in_fight: "In Fight",
  in_marketplace: "Shopping",
  idle: "Idle",
};

export function PlayerList() {
  const { state } = useGame();
  const account = useCurrentAccount();
  const { onlinePlayers } = state;

  function handleChallenge(player: OnlinePlayer) {
    state.socket.send({
      type: "challenge_player",
      targetAddress: player.walletAddress,
      fightType: "friendly" as FightType,
    });
  }

  function handleSpectate(player: OnlinePlayer) {
    if (player.fightId) {
      state.socket.send({ type: "spectate_fight", fightId: player.fightId });
    }
  }

  const others = onlinePlayers.filter(
    (p) => p.walletAddress !== account?.address
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          Online ({onlinePlayers.length})
        </span>
      </div>
      {others.length === 0 && (
        <p className="text-zinc-600 text-sm text-center py-4">
          No other players online
        </p>
      )}
      {others.map((player) => (
        <div
          key={player.walletAddress}
          className="flex items-center justify-between rounded-lg bg-zinc-900/50 px-3 py-2 hover:bg-zinc-800/50 transition-colors group"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[player.status]}`} />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{player.name}</div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-zinc-500">Lv.{player.level}</span>
                <span className="text-xs text-zinc-500">·</span>
                <span className="text-xs text-amber-400">{player.rating}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {player.status === "online" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleChallenge(player)}
              >
                Fight
              </Button>
            )}
            {player.status === "in_fight" && player.fightId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSpectate(player)}
              >
                Watch
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
