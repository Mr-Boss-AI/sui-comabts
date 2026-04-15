"use client";

import { useGame } from "@/hooks/useGameStore";
import { HpBar } from "./hp-bar";
import { DamageLog } from "./damage-log";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function SpectateView() {
  const { state, dispatch } = useGame();
  const fight = state.spectatingFight;

  if (!fight) return null;

  return (
    <div className="max-w-3xl mx-auto w-full p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="warning">SPECTATING</Badge>
          <span className="text-sm text-zinc-400">Turn {fight.turn}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            state.socket.send({ type: "stop_spectating" });
            dispatch({ type: "SET_SPECTATING", fight: null });
          }}
        >
          Leave
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <HpBar
          name={fight.playerA.name}
          current={fight.playerA.currentHp}
          max={fight.playerA.maxHp}
          isLeft
          level={fight.playerA.level}
        />
        <div className="text-zinc-500 text-2xl font-bold">VS</div>
        <HpBar
          name={fight.playerB.name}
          current={fight.playerB.currentHp}
          max={fight.playerB.maxHp}
          isLeft={false}
          level={fight.playerB.level}
        />
      </div>

      <Card>
        <CardHeader>
          <span className="font-semibold text-sm">Combat Log</span>
        </CardHeader>
        <CardBody>
          <DamageLog
            log={fight.log || []}
            fight={fight}
            myAddress=""
          />
        </CardBody>
      </Card>

      {fight.status === "finished" && fight.winner && (
        <div className="text-center py-4">
          <div className="text-2xl font-bold text-emerald-400">
            {fight.playerA.walletAddress === fight.winner
              ? fight.playerA.name
              : fight.playerB.name}{" "}
            Wins!
          </div>
        </div>
      )}
    </div>
  );
}
