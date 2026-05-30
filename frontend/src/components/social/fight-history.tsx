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
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            color: "var(--sc-bronze)",
          }}
        >
          Fight History
        </span>
      </CardHeader>
      <CardBody>
        {fightHistory.length === 0 ? (
          <p
            style={{
              color: "var(--fg-3)",
              fontSize: 12,
              textAlign: "center",
              padding: "24px 0",
              fontStyle: "italic",
              margin: 0,
            }}
          >
            No fights yet
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {fightHistory.map((fight) => {
              const won = fight.winner === account?.address;
              const isA = fight.playerA.walletAddress === account?.address;
              const opponent = isA ? fight.playerB : fight.playerA;
              return (
                <div
                  key={fight.id}
                  style={{
                    background: "var(--sc-panel-2)",
                    border: "1px solid var(--sc-rim)",
                    borderLeft: `3px solid ${won ? "var(--rarity-uncommon)" : "var(--sc-blood)"}`,
                    padding: "8px 12px",
                    borderRadius: "var(--r-card)",
                    boxShadow: "var(--rim-top), var(--rim-bottom)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge variant={won ? "success" : "danger"}>
                        {won ? "WIN" : "LOSS"}
                      </Badge>
                      <span style={{ fontSize: 13 }}>
                        vs{" "}
                        <span style={{ fontWeight: 700, color: "var(--sc-parchment)" }}>
                          {opponent.name}
                        </span>
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 11,
                        color: "var(--fg-3)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      <span>{fight.type}</span>
                      <span>{fight.turns} turns</span>
                      {fight.wagerAmount && (
                        <span style={{ color: "var(--sc-bronze)", fontWeight: 700 }}>
                          {fight.wagerAmount} SUI
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--fg-3)",
                      marginTop: 4,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {new Date(fight.timestamp).toLocaleDateString()}{" "}
                    {new Date(fight.timestamp).toLocaleTimeString()}
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
