"use client";

/**
 * Landing page — wallet-disconnected hero (v5.3 grey-stone / evil
 * medieval redesign).
 *
 *   ┌─ iron hero (black, blood-moon glow) ─────────────────────────┐
 *   │ LEFT                                RIGHT                    │
 *   │ pill · kicker                       blood moon + the two     │
 *   │ Sui Combats (blackletter)           warrior figures          │
 *   │ "Sell thy soul to the arena."                                │
 *   │ [ENTER THE PIT] [WATCH THE SLAUGHTER ▾]                      │
 *   │ stamps                                                       │
 *   └──────────────────────────────────────────────────────────────┘
 *   ✠ ornament divider
 *   Four rites. Then damnation.   (I · II · III · IV iron plaques)
 *   inscription band (quote over the Pit gate)
 *   footer
 *
 * "Enter the Pit" fires the dapp-kit ConnectButton living in the
 * Navbar (the web component owns its own modal). "Watch the Slaughter"
 * flips guest spectator mode.
 */

import type { CSSProperties } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useGame } from "@/hooks/useGameStore";
import { Wordmark } from "@/components/v2/wordmark";
import { DangerButton, GhostButton, Stamp } from "@/components/v2";
import { useBreakpoint, bpGte } from "@/components/v2/layout";

const RITES: Array<{ n: string; title: string; body: string }> = [
  {
    n: "I",
    title: "Summon thy champion",
    body: "Mint a soul-bound fighter. Every wound, every victory and every defeat is carved into the chain — forever.",
  },
  {
    n: "II",
    title: "Arm the damned",
    body: "Cursed blades, shields and rings from the black market. No rarity — only level and steel. Build as thou wilt.",
  },
  {
    n: "III",
    title: "Spill blood for silver",
    body: "Strike and guard five zones, twenty heartbeats per exchange. Wager true SUI — the victor claims the purse.",
  },
  {
    n: "IV",
    title: "Raise a banner of war",
    body: "Swear to a guild, gather thy brothers and march on a rival hall. Ten against ten. Every blade pays its stake.",
  },
];

/** Triggers the existing dapp-kit ConnectButton living in the Navbar
 *  so the hero CTA fires the same wallet-connect modal. */
function clickNavbarConnect() {
  if (typeof document === "undefined") return;
  const btn = document.querySelector(
    "mysten-dapp-kit-connect-button button, mysten-dapp-kit-connect-button",
  ) as HTMLElement | null;
  if (btn) btn.click();
}

const ornament: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  color: "var(--sc-blood)",
  fontSize: 18,
};
const rule: CSSProperties = { flex: 1, height: 1, background: "currentColor", opacity: 0.55 };

function Ornament({ glyph = "✠" }: { glyph?: string }) {
  return (
    <div style={ornament} aria-hidden>
      <span style={rule} />
      <span>{glyph}</span>
      <span style={rule} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */

export function LandingPage() {
  const account = useCurrentAccount();
  const { dispatch } = useGame();
  const bp = useBreakpoint();
  const wide = bpGte("lg", bp);
  const ritesCols = bpGte("lg", bp) ? 4 : bpGte("md", bp) ? 2 : 1;

  // game-screen never renders the landing with a wallet connected;
  // belt + braces.
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
      {/* ── Iron hero ─────────────────────────────────────────── */}
      <section
        className="theme-iron"
        style={{
          background:
            "radial-gradient(ellipse 55% 70% at 72% 58%, rgba(139,17,17,.55) 0%, rgba(90,10,10,.25) 45%, transparent 75%), linear-gradient(180deg, #151413 0%, #0b0a09 100%)",
          borderBottom: "3px solid #0e0e0e",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            maxWidth: 1440,
            margin: "0 auto",
            padding: wide ? "56px 32px 0" : "36px 16px 0",
            display: "grid",
            gridTemplateColumns: wide ? "55% 45%" : "1fr",
            gap: wide ? 24 : 8,
            alignItems: "end",
          }}
        >
          {/* LEFT — the call */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: wide ? 64 : 8 }}>
            <Stamp tone="blood" style={{ alignSelf: "flex-start" }}>
              Testnet · The gates stand open
            </Stamp>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.32em",
                textTransform: "uppercase",
                color: "#c42222",
              }}
            >
              A game of blood, steel &amp; silver
            </div>
            <Wordmark size="hero" />
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: wide ? 30 : 22,
                lineHeight: 1.2,
                color: "var(--sc-parchment)",
                letterSpacing: "0.02em",
              }}
            >
              Sell thy soul to the arena.
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: 19,
                lineHeight: 1.55,
                color: "var(--fg-2)",
                maxWidth: 560,
              }}
            >
              Summon a champion, bind cursed steel to its flesh and wager
              true SUI in blood-sworn duels. Raise a guild and march it to
              war. The victor takes the purse — the Pit keeps but one coin
              in twenty.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
              <DangerButton size="lg" onClick={clickNavbarConnect}>
                Enter the Pit
              </DangerButton>
              <GhostButton
                size="lg"
                onClick={() => {
                  // Guest spectator flag: game-screen renders
                  // <SpectatorLanding /> for `!account && spectatorMode`.
                  dispatch({ type: "SET_SPECTATOR_MODE", enabled: true });
                }}
              >
                Watch the Slaughter ▾
              </GhostButton>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              <Stamp tone="default" outline>Forged on Sui</Stamp>
              <Stamp tone="default" outline>Move contracts</Stamp>
              <Stamp tone="default" outline>Open source · MIT</Stamp>
            </div>
          </div>

          {/* RIGHT — blood moon + the two warriors */}
          <div
            aria-hidden
            style={{
              position: "relative",
              height: wide ? 560 : 340,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                position: "absolute",
                width: wide ? 400 : 240,
                height: wide ? 400 : 240,
                borderRadius: "50%",
                top: wide ? 40 : 20,
                left: "50%",
                transform: "translateX(-50%)",
                background: "radial-gradient(circle at 45% 40%, #b31d1d 0%, #7a0e0e 55%, #3d0606 100%)",
                boxShadow: "0 0 80px 20px rgba(139,17,17,.45)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- static export, local asset */}
            <img
              src="/v53/figures/figure-male.png"
              alt=""
              style={{ position: "relative", height: wide ? 520 : 310, marginRight: wide ? -40 : -24, zIndex: 1 }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- static export, local asset */}
            <img
              src="/v53/figures/figure-female.png"
              alt=""
              style={{ position: "relative", height: wide ? 500 : 298, zIndex: 2 }}
            />
          </div>
        </div>
      </section>

      {/* ── The four rites ───────────────────────────────────── */}
      <section
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          width: "100%",
          padding: wide ? "48px 32px" : "36px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <Ornament />
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: wide ? 42 : 28,
            lineHeight: 1.1,
            textAlign: "center",
            color: "var(--sc-parchment)",
          }}
        >
          Four rites. Then damnation.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${ritesCols}, 1fr)`, gap: 18 }}>
          {RITES.map((r) => (
            <div
              key={r.n}
              className="theme-iron"
              style={{
                border: "2px solid",
                borderColor: "#4a4946 #0e0e0e #0e0e0e #4a4946",
                boxShadow: "0 0 0 1px #0e0e0e, 0 6px 16px rgba(0,0,0,.35)",
                padding: "22px 22px 26px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                minHeight: 210,
              }}
            >
              <div
                style={{
                  // Cinzel numerals — blackletter "I" reads as "J".
                  fontFamily: "var(--font-display)",
                  fontWeight: 900,
                  fontSize: 48,
                  lineHeight: 1,
                  color: "#c42222",
                  textShadow: "2px 2px 0 #000",
                }}
              >
                {r.n}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 20,
                  lineHeight: 1.15,
                  color: "var(--sc-parchment)",
                }}
              >
                {r.title}
              </div>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "var(--fg-2)" }}>{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Inscription band ─────────────────────────────────── */}
      <section className="theme-iron" style={{ borderTop: "3px solid #0e0e0e", borderBottom: "3px solid #0e0e0e" }}>
        <div
          style={{
            maxWidth: 900,
            margin: "0 auto",
            padding: wide ? "44px 32px" : "32px 16px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-gothic)",
              fontSize: wide ? 34 : 24,
              lineHeight: 1.3,
              color: "var(--sc-parchment)",
            }}
          >
            “Here the weak are buried — and the strong are merely buried later.”
          </p>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 12,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#c42222",
            }}
          >
            Carved above the gate of the Pit
          </span>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          width: "100%",
          padding: wide ? "20px 32px 32px" : "20px 16px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <Wordmark size="footer" />
        <span style={{ fontSize: 15, color: "var(--fg-1)", letterSpacing: "0.02em" }}>
          Forged on Sui · 95/5 on every wager · MIT licensed
        </span>
      </footer>
    </div>
  );
}
