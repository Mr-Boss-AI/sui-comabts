"use client";

/**
 * Guest spectator landing — wallet-disconnected fight picker.
 *
 * Bug 2 fix (2026-05-18). Disconnected users who click "Watch a Fight"
 * on the landing screen land here. We:
 *   1. Send `spectate_fight` with no fightId — server replies with the
 *      live active-fights list (see PRE_AUTH_TYPES in handler.ts; this
 *      endpoint is whitelisted pre-auth so a guest WS works).
 *   2. Render the list. Each row clicks into a `spectate_fight`
 *      attach with the chosen fightId, which routes the user into
 *      <SpectateView /> via state.spectatingFight.
 *   3. Auto-refresh the picker every 5s while no fight is being
 *      watched, so a guest sees a fight start in near-real-time. The
 *      server also pushes `spectate_update` with `activeFights` when
 *      explicit picks are made; this is just a polling fallback.
 *
 * The "Back" button flips spectatorMode back off, which routes the
 * user back to the <LandingPage /> wallet-connect hero.
 */

import { useEffect } from "react";
import { useGame } from "@/hooks/useGameStore";
import { Navbar } from "@/components/layout/navbar";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const REFRESH_INTERVAL_MS = 5_000;

export function SpectatorLanding() {
  const { state, dispatch } = useGame();
  const { activeSpectateFights, socket } = state;

  // Pull the list on mount and on a 5s loop. socket.send queues until
  // the guest WS opens, so the first tick may arrive after a small
  // delay — we don't gate the render on `socket.connected` because the
  // picker shows an "Searching for fights…" placeholder anyway.
  useEffect(() => {
    socket.send({ type: "spectate_fight" } as never);
    const handle = setInterval(() => {
      socket.send({ type: "spectate_fight" } as never);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [socket]);

  function pickFight(fightId: string) {
    socket.send({ type: "spectate_fight", fightId } as never);
  }

  function goBack() {
    // Clear the flag — game-screen will route back to <LandingPage />.
    // The guest WS closes when useGameSocket's effect re-runs with
    // both walletAddress and guestMode falsy.
    dispatch({ type: "SET_SPECTATOR_MODE", enabled: false });
  }

  return (
    <div className="flex flex-col flex-1">
      <Navbar />
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          width: "100%",
          padding: "32px 24px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          color: "var(--sc-parchment)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: 36,
                lineHeight: 1.1,
              }}
            >
              Watch a Fight
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)" }}>
              No wallet needed — read-only spectator stream over the
              same WS as the players.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={goBack}>
            ← Back
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                Active fights
              </span>
              <Badge variant={socket.connected ? "success" : "warning"}>
                {socket.connected ? "LIVE" : "Connecting…"}
              </Badge>
            </div>
          </CardHeader>
          <CardBody>
            {activeSpectateFights.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 8px",
                  color: "var(--fg-3)",
                  fontSize: 13,
                }}
              >
                {socket.connected
                  ? "No fights underway right now. We'll auto-refresh every few seconds."
                  : "Opening spectator socket…"}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeSpectateFights.map((f) => (
                  <button
                    key={f.fightId}
                    type="button"
                    onClick={() => pickFight(f.fightId)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 14px",
                      background: "var(--sc-panel-2)",
                      border: "1px solid var(--sc-rim)",
                      borderRadius: 4,
                      cursor: "pointer",
                      color: "var(--sc-parchment)",
                      fontFamily: "var(--font-ui)",
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>
                      {f.playerA.name}{" "}
                      <span style={{ color: "var(--fg-3)" }}>
                        Lv{f.playerA.level}
                      </span>{" "}
                      <span style={{ color: "var(--fg-3)" }}>vs</span>{" "}
                      {f.playerB.name}{" "}
                      <span style={{ color: "var(--fg-3)" }}>
                        Lv{f.playerB.level}
                      </span>
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        color: "var(--fg-3)",
                      }}
                    >
                      turn {f.turn} · {f.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
