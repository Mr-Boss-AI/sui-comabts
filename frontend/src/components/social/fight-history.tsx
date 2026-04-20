"use client";

import { useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function FightHistory() {
  const { state } = useGame();
  const account = useCurrentAccount();
  const { fightHistory } = state;

  useEffect(() => {
    // Wait for the WS to finish auth before requesting history — on first
    // mount the socket is still CONNECTING and the send() would drop with a
    // console error. state.socket re-memoizes on authenticated flip, so this
    // effect re-runs once auth lands.
    if (!state.socket.authenticated) return;
    state.socket.send({ type: "get_fight_history" });
  }, [state.socket]);

  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">Fight History</span>
      </CardHeader>
      <CardBody>
        {fightHistory.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-8">
            No fights yet
          </p>
        ) : (
          <div className="space-y-2">
            {fightHistory.map((fight) => {
              const won = fight.winner === account?.address;
              const isA = fight.playerA.walletAddress === account?.address;
              const opponent = isA ? fight.playerB : fight.playerA;
              return (
                <div
                  key={fight.id}
                  className={`rounded-lg border p-3 ${
                    won ? "border-emerald-900/50 bg-emerald-900/10" : "border-red-900/50 bg-red-900/10"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={won ? "success" : "danger"}>
                        {won ? "WIN" : "LOSS"}
                      </Badge>
                      <span className="text-sm">
                        vs <span className="font-medium">{opponent.name}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span>{fight.type}</span>
                      <span>{fight.turns} turns</span>
                      {fight.wagerAmount && (
                        <span className="text-amber-400">
                          {fight.wagerAmount} SUI
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {new Date(fight.timestamp).toLocaleDateString()} {new Date(fight.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
