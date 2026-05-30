"use client";

/**
 * Landing page — wallet-disconnected hero.
 *
 * Matches the Claude Design target in
 * `design_v2/screenshopts/landing_page_target.png`:
 *
 *   ┌─ Navbar: Wordmark (navbar) ......... CONNECT WALLET ────┐
 *   │                                                          │
 *   │  ┌─ Hero (gunmetal canvas, side-by-side) ──────────────┐ │
 *   │  │ LEFT 55%                       RIGHT 45%            │ │
 *   │  │ TESTNET · LIVE pill            ┌─ Floating cards ─┐ │ │
 *   │  │ SUI                            │  Whisperwind     │ │ │
 *   │  │ COMBATS  (hero wordmark)       │  ┌─Dancer'sAegis │ │ │
 *   │  │                                │  │ ┌─Pendant ──┐ │ │ │
 *   │  │ Mint a fighter…tagline         │  │ │ of Wrath  │ │ │ │
 *   │  │ 95/5 split on every wager.     │  │ └───────────┘ │ │ │
 *   │  │                                │  └────────────── │ │ │
 *   │  │ [CONNECT WALLET] [WATCH FIGHT] └──────────────────┘ │ │
 *   │  │ [Walrus] [MIT] [Move v5]                            │ │
 *   │  └──────────────────────────────────────────────────────┘ │
 *   │  ─── bronze divider ───                                   │
 *   │  Three steps. Then chaos.                                 │
 *   │  ┌─ 01 ─┐ ┌─ 02 ─┐ ┌─ 03 ─┐                              │
 *   │  Mint   Gear    Lock-in                                  │
 *   │  Footer: Wordmark (small) ... built on Sui · …          │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The CONNECT WALLET button triggers the dapp-kit modal via the
 * existing top-right ConnectButton in the Navbar. The hero CTA
 * dispatches a click on that button (querySelector — the dapp-kit
 * web-component encapsulates its own connect modal).
 */

import { useEffect, useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useGame } from "@/hooks/useGameStore";
import { Wordmark } from "@/components/v2/wordmark";
import {
  BronzeButton,
  DangerButton,
  GhostButton,
  Stamp,
} from "@/components/v2";
import { ListingCard, useBreakpoint, bpGte } from "@/components/v2/layout";

/* ────────────────── featured NFT cards ──────────────────
 * Three hand-picked legendaries from
 * `deployment.testnet-v5.json::nft_catalog_v5_1`. Used purely for
 * landing decoration — when a wallet connects, the real Inventory
 * + Marketplace take over. */

const FEATURED: Array<{
  name: string;
  slotLabel: string;
  rarity: number;
  statSummary: string;
  priceSui: number;
  imageUrl: string;
  rotate: number;
  offsetX: number;
  offsetY: number;
  zIndex: number;
}> = [
  {
    name: "Whisperwind Amulet",
    slotLabel: "Necklace",
    rarity: 5,
    statSummary: "INT +6",
    priceSui: 0.3,
    imageUrl:
      "https://gateway.pinata.cloud/ipfs/bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i/Whisperwind_Amulet.png",
    rotate: -4,
    offsetX: 120,
    offsetY: 0,
    zIndex: 1,
  },
  {
    name: "Dancer's Aegis",
    slotLabel: "Off-hand",
    rarity: 4,
    statSummary: "DEX +4 / END +2",
    priceSui: 0.17,
    imageUrl:
      "https://gateway.pinata.cloud/ipfs/bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i/Dancers_Aegis.png",
    rotate: 5,
    offsetX: 60,
    offsetY: 40,
    zIndex: 2,
  },
  {
    name: "Pendant of Wrath",
    slotLabel: "Necklace",
    rarity: 5,
    statSummary: "STR +5 / END +3",
    priceSui: 0.3,
    imageUrl:
      "https://gateway.pinata.cloud/ipfs/bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i/Pendant_of_Wrath.png",
    rotate: -2,
    offsetX: 0,
    offsetY: 80,
    zIndex: 3,
  },
];

const STEPS: Array<{
  n: string;
  title: string;
  body: string;
  bg: string;
  text: string;
  sub: string;
  border: string;
}> = [
  {
    n: "01",
    title: "Mint your fighter",
    body: "One-click character mint. Living NFT — stats, wins, ELO all on chain.",
    bg: "var(--sc-parchment)",
    text: "var(--sc-page)",
    sub: "rgba(10,13,18,0.72)",
    border: "var(--sc-rim-2)",
  },
  {
    n: "02",
    title: "Gear up",
    body: "Buy NFTs on the kiosk marketplace. 2H weapons, dual wield, full doll.",
    bg: "var(--sc-bronze)",
    text: "var(--sc-page)",
    sub: "rgba(10,13,18,0.72)",
    border: "var(--sc-bronze-deep)",
  },
  {
    n: "03",
    title: "Lock in, brawl",
    body: "20s turn timer, 5 zones, server-authoritative resolution. 95/5 settle.",
    bg: "var(--sc-blood)",
    text: "var(--sc-parchment)",
    sub: "rgba(232,226,212,0.78)",
    border: "var(--sc-blood-deep)",
  },
];

/** Triggers the existing dapp-kit ConnectButton living in the Navbar
 *  so our hero CTAs can fire the same wallet-connect modal without
 *  rewiring dapp-kit's web component. */
function clickNavbarConnect() {
  if (typeof document === "undefined") return;
  const btn = document.querySelector(
    "mysten-dapp-kit-connect-button button, mysten-dapp-kit-connect-button",
  ) as HTMLElement | null;
  if (btn) btn.click();
}

/* ════════════════════════════════════════════════════════════════════ */

export function LandingPage() {
  const account = useCurrentAccount();
  const { dispatch } = useGame();
  const bp = useBreakpoint();
  const heroSideBySide = bpGte("lg", bp);
  const stepsStack = !bpGte("md", bp);

  // We never render the landing if a wallet is connected; game-screen
  // handles routing. Belt + braces — short-circuit just in case.
  if (account) return null;

  return (
    <div
      style={{
        background: "var(--sc-page)",
        color: "var(--sc-parchment)",
        minHeight: "calc(100vh - 56px)",
        fontFamily: "var(--font-ui)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          width: "100%",
          padding: "40px 32px 56px",
          display: "grid",
          gridTemplateColumns: heroSideBySide ? "55% 45%" : "1fr",
          gap: heroSideBySide ? 40 : 32,
          alignItems: "center",
          minHeight: heroSideBySide ? 520 : undefined,
        }}
      >
        {/* LEFT — copy */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Stamp tone="blood" style={{ alignSelf: "flex-start" }}>
            Testnet · Live
          </Stamp>
          <Wordmark size="hero" />
          <p
            style={{
              margin: 0,
              fontSize: 16,
              lineHeight: 1.55,
              color: "var(--sc-parchment)",
              maxWidth: 560,
              fontWeight: 500,
            }}
          >
            Mint a fighter. Gear up with NFTs. Lock real SUI on the line and
            brawl through a 5-zone arena.
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              color: "var(--sc-bronze)",
              letterSpacing: "0.01em",
            }}
          >
            <span style={{ color: "var(--sc-parchment)" }}>95/5</span>{" "}
            split on every wager.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
            <DangerButton size="lg" onClick={clickNavbarConnect}>
              Connect Wallet
            </DangerButton>
            <GhostButton
              size="lg"
              onClick={() => {
                // Bug 2 fix (2026-05-18). Pre-fix this dispatched an
                // `sc:nav` custom event nobody listens for — the
                // tavern area is only routable when authenticated and
                // game-screen short-circuits to <LandingPage /> long
                // before any router could see the event. The button
                // appeared "broken".
                //
                // Now: flip the guest spectator flag. game-screen sees
                // `!account && spectatorMode` and renders
                // <SpectatorLanding />, which opens a guest WS (no
                // signin) and lists active fights via the pre-auth
                // `spectate_fight` endpoint.
                dispatch({ type: "SET_SPECTATOR_MODE", enabled: true });
              }}
            >
              Watch a Fight ▾
            </GhostButton>
          </div>
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginTop: 6,
            }}
          >
            <Stamp tone="default" outline>Walrus · Decentralized</Stamp>
            <Stamp tone="default" outline>Open Source · MIT</Stamp>
            <Stamp tone="default" outline>Move v5 Contracts</Stamp>
          </div>
        </div>

        {/* RIGHT — floating NFT cards */}
        <div
          style={{
            position: "relative",
            minHeight: heroSideBySide ? 460 : 360,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-hidden
        >
          {FEATURED.map((card, i) => (
            <FloatingNftCard key={card.name} card={card} index={i} />
          ))}
        </div>
      </section>

      {/* ── Bronze divider ─────────────────────────────────────── */}
      <div
        style={{
          height: 1,
          background: "var(--sc-bronze)",
          opacity: 0.4,
          maxWidth: 1440,
          width: "100%",
          margin: "0 auto",
        }}
        aria-hidden
      />

      {/* ── Three Steps ────────────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          width: "100%",
          padding: "48px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: 44,
            lineHeight: 1.05,
            color: "var(--sc-parchment)",
            letterSpacing: "0.01em",
          }}
        >
          Three steps. Then chaos.
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: stepsStack ? "1fr" : "repeat(3, 1fr)",
            gap: 20,
          }}
        >
          {STEPS.map((s) => (
            <div
              key={s.n}
              style={{
                background: s.bg,
                color: s.text,
                border: `3px solid ${s.border}`,
                borderRadius: 0,
                padding: "22px 22px 24px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                minHeight: 190,
                boxShadow: "5px 5px 0 0 #000",
                fontFamily: "var(--font-ui)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 64,
                  lineHeight: 0.95,
                  color: s.text,
                  letterSpacing: "0.01em",
                  textShadow:
                    s.text === "var(--sc-parchment)"
                      ? "3px 3px 0 rgba(0,0,0,.3)"
                      : "2px 2px 0 rgba(0,0,0,.18)",
                }}
              >
                {s.n}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 22,
                  lineHeight: 1.05,
                  color: s.text,
                  letterSpacing: "0.01em",
                }}
              >
                {s.title}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: s.sub,
                  fontWeight: 500,
                }}
              >
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          width: "100%",
          padding: "20px 32px 32px",
          borderTop: "1px solid var(--sc-rim)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <Wordmark size="footer" />
        <span
          style={{
            fontSize: 11,
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.02em",
          }}
        >
          Built on Sui · 35/35 Move tests · 2241/2241 QA · MIT licensed
        </span>
      </footer>
    </div>
  );
}

/* ────────── floating NFT preview card ────────── */

function FloatingNftCard({
  card,
  index,
}: {
  card: (typeof FEATURED)[number];
  index: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute",
        width: 220,
        transform: `translate(${card.offsetX}px, ${card.offsetY}px) rotate(${card.rotate}deg) ${hover ? "translateY(-4px)" : ""}`,
        zIndex: card.zIndex,
        transition: "transform var(--d-base) var(--ease-pop)",
        filter: `drop-shadow(${(index + 1) * 4}px ${(index + 1) * 4}px 0 rgba(0,0,0,.5))`,
        pointerEvents: "auto",
      }}
    >
      <ListingCard
        imageUrl={card.imageUrl}
        name={card.name}
        slotLabel={card.slotLabel}
        rarity={card.rarity}
        statSummary={card.statSummary}
        priceSui={card.priceSui}
      />
    </div>
  );
}
