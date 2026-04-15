"use client";

import { useRef, useEffect } from "react";
import type { TurnResult, HitResult, FightState } from "@/types/game";
import { ZONE_LABELS } from "@/types/game";

interface DamageLogProps {
  log: TurnResult[];
  fight: FightState;
  myAddress: string;
}

export function DamageLog({ log, fight, myAddress }: DamageLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log]);

  if (log.length === 0) {
    return (
      <div className="text-zinc-600 text-sm text-center py-4">
        Waiting for combat...
      </div>
    );
  }

  const isPlayerA = fight.playerA.walletAddress === myAddress;

  return (
    <div
      ref={scrollRef}
      className="space-y-3 overflow-y-auto max-h-[400px] pr-2 scrollbar-thin"
    >
      {log.map((turn) => {
        // My attacks hit the opponent (playerB.hits if I'm A, playerA.hits if I'm B)
        const myHits = isPlayerA ? turn.playerB.hits : turn.playerA.hits;
        const oppHits = isPlayerA ? turn.playerA.hits : turn.playerB.hits;
        const myActions = isPlayerA ? turn.playerA.actions : turn.playerB.actions;
        const oppActions = isPlayerA ? turn.playerB.actions : turn.playerA.actions;

        return (
          <div
            key={turn.turn}
            className="border-l-2 border-zinc-700 pl-3 py-1"
          >
            <div className="text-xs text-zinc-500 font-bold mb-1">
              ── Turn {turn.turn} ──
            </div>

            {/* My attacks */}
            {myHits.map((hit, i) => (
              <div key={`my-${i}`} className={`text-sm ${getHitStyle(hit, true)}`}>
                {formatMyAttack(hit)}
              </div>
            ))}

            {/* Opponent attacks */}
            {oppHits.map((hit, i) => (
              <div key={`opp-${i}`} className={`text-sm ${getHitStyle(hit, false)}`}>
                {formatOppAttack(hit)}
              </div>
            ))}

            {/* HP summary after turn */}
            <div className="text-xs text-zinc-500 mt-1 font-mono">
              Your HP: {getHpAfterTurn(turn, isPlayerA)} | Opponent HP: {getHpAfterTurn(turn, !isPlayerA)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatMyAttack(hit: HitResult): string {
  const zone = ZONE_LABELS[hit.zone];
  if (hit.blocked) return `You attacked ${zone} → BLOCKED`;
  if (hit.dodged) return `You attacked ${zone} → DODGED`;
  if (hit.crit) return `You attacked ${zone} → CRIT! ${hit.damage.toFixed(1)} damage`;
  return `You attacked ${zone} → HIT for ${hit.damage.toFixed(1)} damage`;
}

function formatOppAttack(hit: HitResult): string {
  const zone = ZONE_LABELS[hit.zone];
  if (hit.blocked) return `Opponent attacked ${zone} → YOU BLOCKED`;
  if (hit.dodged) return `Opponent attacked ${zone} → YOU DODGED`;
  if (hit.crit) return `Opponent attacked ${zone} → CRIT! ${hit.damage.toFixed(1)} damage`;
  return `Opponent attacked ${zone} → HIT for ${hit.damage.toFixed(1)} damage`;
}

function getHitStyle(hit: HitResult, isMyAttack: boolean): string {
  if (hit.blocked) return isMyAttack ? "text-zinc-500" : "text-blue-400";
  if (hit.dodged) return isMyAttack ? "text-zinc-500" : "text-cyan-400";
  if (hit.crit) return isMyAttack ? "text-red-400 font-bold" : "text-red-500 font-bold";
  return isMyAttack ? "text-emerald-400" : "text-orange-400";
}

function getHpAfterTurn(turn: TurnResult, isA: boolean): string {
  const hp = isA ? turn.playerA.hpAfter : turn.playerB.hpAfter;
  if (hp === undefined || hp === null) return "?";
  return `${Math.round(hp)}`;
}
