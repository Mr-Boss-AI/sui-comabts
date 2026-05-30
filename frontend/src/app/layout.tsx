import type { Metadata } from "next";
import { Slackey, Poppins, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "../styles/design-tokens-v2.css";

/**
 * Phase 2 — Forged Metal design system.
 *
 * Three families do all the work:
 *   - Slackey      → display only (wordmark, splash text: FIGHT!/WIN!/KO!)
 *   - Poppins      → every UI text from 64px hero down to 10px stat pill
 *   - JetBrains Mono → tabular numerics (HP, prices, timers)
 *
 * Loaded via next/font/google so the bytes ship in the same build
 * pipeline as the rest of the app. The CSS variables --font-display-src,
 * --font-ui-src, --font-mono-src are consumed by design-tokens-v2.css
 * which re-exports them as --font-display, --font-ui, --font-mono —
 * the names every component already references.
 */
const display = Slackey({
  variable: "--font-display-src",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const ui = Poppins({
  variable: "--font-ui-src",
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-src",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SUI Combats",
  description:
    "A blockchain PvP social arena — connect wallets, create NFT characters, gear up, and fight on Sui",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${ui.variable} ${mono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col"
        style={{
          background: "var(--bg-page)",
          color: "var(--sc-parchment)",
          fontFamily: "var(--font-ui)",
        }}
      >
        {children}
      </body>
    </html>
  );
}
