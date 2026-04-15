"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export function Leaderboard() {
  const { state } = useGame();
  const { leaderboard, socket } = state;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (socket.connected) {
      socket.send({ type: "get_leaderboard" });
      setLoaded(true);
    }
  }, [socket.connected]);

  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">Hall of Fame — Top Fighters</span>
      </CardHeader>
      <CardBody>
        {leaderboard.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-8">
            {loaded ? "No fighters yet — win a battle to claim your spot!" : "Loading leaderboard..."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                  <th className="py-2 text-left w-12">#</th>
                  <th className="py-2 text-left">Name</th>
                  <th className="py-2 text-right">Level</th>
                  <th className="py-2 text-right">Rating</th>
                  <th className="py-2 text-right">W</th>
                  <th className="py-2 text-right">L</th>
                  <th className="py-2 text-right">Win%</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((entry) => {
                  const winRate =
                    entry.wins + entry.losses > 0
                      ? Math.round(
                          (entry.wins / (entry.wins + entry.losses)) * 100
                        )
                      : 0;
                  return (
                    <tr
                      key={`${entry.walletAddress}-${entry.rank}`}
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                    >
                      <td className="py-2">
                        <span
                          className={
                            entry.rank === 1
                              ? "text-amber-400 font-bold"
                              : entry.rank === 2
                                ? "text-zinc-300 font-bold"
                                : entry.rank === 3
                                  ? "text-amber-600 font-bold"
                                  : "text-zinc-500"
                          }
                        >
                          {entry.rank}
                        </span>
                      </td>
                      <td className="py-2 font-medium">{entry.name}</td>
                      <td className="py-2 text-right text-zinc-400">
                        {entry.level}
                      </td>
                      <td className="py-2 text-right text-amber-400 font-mono">
                        {entry.rating}
                      </td>
                      <td className="py-2 text-right text-emerald-400">
                        {entry.wins}
                      </td>
                      <td className="py-2 text-right text-red-400">
                        {entry.losses}
                      </td>
                      <td className="py-2 text-right text-zinc-300">
                        {winRate}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
