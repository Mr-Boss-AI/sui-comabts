"use client";

/**
 * Wordmark — chunky red + yellow comic-outline "SUI COMBATS".
 *
 * Two size variants per the Claude Design target screenshots in
 * `design_v2/screenshopts/landing_page_target.png` (hero) and
 * `design_v2/screenshopts/character_loadout_target.png` (navbar):
 *
 *   size="navbar" — inline, single row, ~22-26px cap height.
 *                   Used by Navbar + Footer.
 *   size="hero"   — stacked, massive (~140-220px), the Landing
 *                   page focal element.
 *
 * Visual recipe (pinned in qa-wordmark.ts):
 *   - Slackey display font
 *   - "SUI" fill = --wordmark-red  (deep red), thick black hard
 *     outline via -webkit-text-stroke
 *   - "COMBATS" fill = --wordmark-yellow (warm bronze yellow),
 *     thick black outline + red drop-shadow offset 2-3px DR
 *   - Hard edges only — no soft glow, no gradient on the chrome
 *
 * Tokens live in design-tokens-v2.css. The wordmark intentionally
 * uses brighter / more saturated reds and yellows than the rest of
 * the chrome's metal palette — it's the loud meme-coin badge for
 * the brand, not a chrome surface.
 */

import type { CSSProperties } from "react";

export type WordmarkSize = "navbar" | "hero" | "footer";

interface WordmarkProps {
  size?: WordmarkSize;
  /** Optional click handler — pass `(e) => onNavigate(...)` when
   *  using the wordmark as a home link. */
  onClick?: () => void;
  /** Override the inline style root. Merged after the variant style. */
  style?: CSSProperties;
  className?: string;
}

/**
 * Size config — every variant gives explicit font-size + stroke
 * thickness + drop-shadow offsets so we never depend on inherited
 * `em` scaling for the comic-outline thickness.
 */
const VARIANTS: Record<
  WordmarkSize,
  {
    layout: "inline" | "stacked";
    suiSize: number;
    combatsSize: number;
    strokeWidth: number;
    shadowOffset: number;
    gap: number;
  }
> = {
  navbar: {
    layout: "inline",
    suiSize: 38,
    combatsSize: 38,
    strokeWidth: 1.8,
    shadowOffset: 2,
    gap: 5,
  },
  footer: {
    layout: "inline",
    suiSize: 18,
    combatsSize: 18,
    strokeWidth: 1.2,
    shadowOffset: 1.5,
    gap: 3,
  },
  hero: {
    layout: "stacked",
    suiSize: 168,
    combatsSize: 132,
    strokeWidth: 5,
    shadowOffset: 6,
    gap: 0,
  },
};

export function Wordmark({
  size = "navbar",
  onClick,
  style,
  className,
}: WordmarkProps) {
  const v = VARIANTS[size];
  const Tag = (onClick ? "button" : "div") as "button" | "div";

  const sui: CSSProperties = {
    fontFamily: "var(--font-display)",
    fontSize: v.suiSize,
    lineHeight: 0.95,
    color: "var(--wordmark-red)",
    WebkitTextStroke: `${v.strokeWidth}px var(--wordmark-ink)`,
    textShadow: "none",
    letterSpacing: "0.01em",
    display: "block",
    fontWeight: 400,
    paintOrder: "stroke fill",
  };

  const combats: CSSProperties = {
    fontFamily: "var(--font-display)",
    fontSize: v.combatsSize,
    lineHeight: 0.95,
    color: "var(--wordmark-yellow)",
    WebkitTextStroke: `${v.strokeWidth}px var(--wordmark-ink)`,
    /* Drop shadow: red offset down-right gives the "two-tone print"
     * comic effect. Two stacked shadows so the lower one reads at
     * larger sizes too. */
    textShadow: `${v.shadowOffset}px ${v.shadowOffset}px 0 var(--wordmark-red), ${v.shadowOffset * 2}px ${v.shadowOffset * 2}px 0 var(--wordmark-ink)`,
    letterSpacing: "0.01em",
    display: "block",
    fontWeight: 400,
    paintOrder: "stroke fill",
  };

  return (
    <Tag
      onClick={onClick}
      className={className}
      style={{
        display: v.layout === "inline" ? "inline-flex" : "inline-flex",
        flexDirection: v.layout === "inline" ? "row" : "column",
        alignItems: v.layout === "inline" ? "baseline" : "flex-start",
        gap: v.gap,
        background: "transparent",
        border: 0,
        padding: 0,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        ...style,
      }}
      aria-label="SUI Combats"
    >
      <span style={sui}>SUI</span>
      <span style={combats}>COMBATS</span>
    </Tag>
  );
}
