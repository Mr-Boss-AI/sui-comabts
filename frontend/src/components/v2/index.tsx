"use client";

/**
 * Phase 2 v2 Forged Metal — shared primitives.
 *
 * Single import surface for every new screen + retrofit. Each
 * primitive is a thin styled span/div/button reading from
 * design-tokens-v2.css; no Tailwind dependence, no third-party deps.
 *
 *   import { RimFrame, SlotTile, BronzeButton, DangerButton, Stamp,
 *            DisplayTitle, V2Input, V2Chip, V2Tab, ToneDivider }
 *     from "@/components/v2";
 */

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { forwardRef } from "react";

/* ──────────────────────────── RimFrame ──────────────────────────────
 * The canonical bronze-rim card. Used for hype panels, NFT portrait
 * frame, modal bodies, and any surface that needs the "forged plate"
 * read. Two tones — `bronze` (heavy bronze rim) and `steel` (default).
 * `padless` disables the inner padding so screens can compose their
 * own grid inside.
 */
export interface RimFrameProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "bronze" | "blood" | "steel";
  padless?: boolean;
}
export function RimFrame({
  tone = "steel",
  padless,
  className = "",
  style,
  children,
  ...rest
}: RimFrameProps) {
  const border =
    tone === "bronze"
      ? "2px solid var(--sc-bronze)"
      : tone === "blood"
        ? "2px solid var(--sc-blood)"
        : "1px solid var(--sc-rim)";
  const radius = tone === "steel" ? "var(--r-card)" : "var(--r-sharp)";
  const shadow =
    tone === "blood"
      ? "4px 4px 0 0 var(--sc-blood-deep), var(--rim-top), var(--rim-bottom)"
      : "var(--sh-plate-lg), var(--rim-top), var(--rim-bottom)";
  return (
    <div
      className={className}
      style={{
        background: "var(--sc-panel)",
        border,
        borderRadius: radius,
        boxShadow: shadow,
        color: "var(--sc-parchment)",
        fontFamily: "var(--font-ui)",
        padding: padless ? 0 : 16,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ──────────────────────────── DisplayTitle ─────────────────────────
 * Slackey-faced label used for screen titles, modal titles, splash text.
 * Bronze fill by default — pass color via style for variants.
 */
export interface DisplayTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  size?: "sm" | "md" | "lg" | "xl";
}
const DISPLAY_SIZE: Record<NonNullable<DisplayTitleProps["size"]>, number> = {
  sm: 18,
  md: 24,
  lg: 32,
  xl: 48,
};
export function DisplayTitle({
  size = "md",
  className = "",
  style,
  children,
  ...rest
}: DisplayTitleProps) {
  return (
    <h2
      className={className}
      style={{
        fontFamily: "var(--font-display)",
        fontSize: DISPLAY_SIZE[size],
        lineHeight: 1.05,
        color: "var(--sc-bronze)",
        letterSpacing: "0.01em",
        margin: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </h2>
  );
}

/* ──────────────────────────── Stamp ────────────────────────────────
 * Tiny pill used for category, level, ELO, status. Eight tones to
 * cover the rarity ramp + the action accents.
 */
export type StampTone =
  | "default"
  | "bronze"
  | "blood"
  | "steel"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "common";
const STAMP_STYLES: Record<StampTone, CSSProperties> = {
  default: {
    background: "var(--sc-panel-2)",
    color: "var(--fg-2)",
    border: "1px solid var(--sc-rim-2)",
  },
  bronze: {
    background: "var(--sc-bronze)",
    color: "var(--sc-page)",
    border: "1px solid var(--sc-bronze-deep)",
  },
  blood: {
    background: "var(--sc-blood)",
    color: "var(--sc-parchment)",
    border: "1px solid var(--sc-blood-deep)",
  },
  steel: {
    background: "var(--sc-steel-low)",
    color: "var(--sc-steel)",
    border: "1px solid var(--sc-steel-deep)",
  },
  uncommon: {
    background: "var(--rarity-uncommon)",
    color: "var(--sc-parchment)",
    border: "1px solid var(--rarity-uncommon)",
  },
  rare: {
    background: "var(--rarity-rare)",
    color: "var(--sc-parchment)",
    border: "1px solid var(--rarity-rare)",
  },
  epic: {
    background: "var(--rarity-epic)",
    color: "var(--sc-parchment)",
    border: "1px solid var(--rarity-epic)",
  },
  legendary: {
    background: "var(--rarity-legendary)",
    color: "var(--sc-page)",
    border: "1px solid var(--rarity-legendary)",
  },
  common: {
    background: "var(--rarity-common)",
    color: "var(--sc-page)",
    border: "1px solid var(--rarity-common)",
  },
};
export interface StampProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StampTone;
  outline?: boolean;
}
export function Stamp({
  tone = "default",
  outline,
  className = "",
  style,
  children,
  ...rest
}: StampProps) {
  const base = STAMP_STYLES[tone];
  const finalStyle: CSSProperties = outline
    ? {
        background: "transparent",
        color: "var(--fg-2)",
        border: "1px solid var(--sc-rim-2)",
      }
    : base;
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "var(--ls-stamp)",
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: "var(--r-pill)",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...finalStyle,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}

/* ──────────────────────────── Buttons ──────────────────────────────
 * Variant pills atop the unified ui/button.tsx primitive. These re-export
 * with sensible defaults so screens can just write <BronzeButton>.
 */
type BtnBaseProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md" | "lg";
};
const SIZE_STYLES: Record<NonNullable<BtnBaseProps["size"]>, CSSProperties> = {
  sm: { padding: "5px 12px", fontSize: 11 },
  md: { padding: "9px 18px", fontSize: 13 },
  lg: { padding: "13px 28px", fontSize: 15 },
};

function makeBtn(
  background: string,
  color: string,
  borderColor: string,
  hoverBg: string,
): React.ForwardRefExoticComponent<
  BtnBaseProps & React.RefAttributes<HTMLButtonElement>
> {
  const Comp = forwardRef<HTMLButtonElement, BtnBaseProps>(
    (
      { size = "md", className = "", style, disabled, onMouseEnter, onMouseLeave, ...rest },
      ref,
    ) => (
      <button
        ref={ref}
        disabled={disabled}
        className={className}
        style={{
          fontFamily: "var(--font-ui)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "var(--ls-button)",
          border: `2px solid ${borderColor}`,
          borderRadius: "var(--r-button)",
          background,
          color,
          boxShadow: disabled ? "none" : "var(--sh-plate-sm)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          whiteSpace: "nowrap",
          transition:
            "transform var(--d-base) var(--ease-pop), box-shadow var(--d-base) var(--ease-pop), background var(--d-fast) linear",
          ...SIZE_STYLES[size],
          ...style,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = hoverBg;
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = background;
          onMouseLeave?.(e);
        }}
        {...rest}
      />
    ),
  );
  Comp.displayName = "V2Button";
  return Comp;
}

export const BronzeButton = makeBtn(
  "var(--sc-bronze)",
  "var(--sc-page)",
  "var(--sc-bronze-deep)",
  "var(--sc-bronze-hot)",
);
export const DangerButton = makeBtn(
  "var(--sc-blood)",
  "var(--sc-parchment)",
  "var(--sc-blood-deep)",
  "#c8462f",
);
export const SteelButton = makeBtn(
  "var(--sc-steel-low)",
  "var(--sc-steel)",
  "var(--sc-steel-deep)",
  "#2b3a45",
);
export const SecondaryButton = makeBtn(
  "var(--sc-panel-2)",
  "var(--sc-parchment)",
  "var(--sc-rim-2)",
  "var(--sc-panel-3)",
);
export function GhostButton({
  size = "md",
  className = "",
  style,
  children,
  ...rest
}: BtnBaseProps) {
  return (
    <button
      className={className}
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "var(--ls-button)",
        background: "transparent",
        color: "var(--sc-parchment)",
        border: "2px solid transparent",
        borderRadius: "var(--r-button)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        whiteSpace: "nowrap",
        transition:
          "border-color var(--d-fast) linear, background var(--d-fast) linear",
        ...SIZE_STYLES[size],
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--sc-rim-2)";
        e.currentTarget.style.background = "var(--sc-panel-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "transparent";
        e.currentTarget.style.background = "transparent";
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────── V2Input ──────────────────────────────
 * Forged-plate text input with bronze focus rim.
 */
export const V2Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className = "", style, ...rest }, ref) => (
  <input
    ref={ref}
    className={className}
    style={{
      fontFamily: "var(--font-ui)",
      fontSize: 13,
      padding: "9px 12px",
      border: "1px solid var(--sc-rim-2)",
      borderRadius: "var(--r-sm)",
      background: "var(--sc-page)",
      color: "var(--sc-parchment)",
      outline: "none",
      boxShadow: "var(--rim-top), var(--rim-bottom)",
      transition: "border-color var(--d-fast), box-shadow var(--d-fast)",
      ...style,
    }}
    onFocus={(e) => {
      e.currentTarget.style.borderColor = "var(--sc-bronze)";
      e.currentTarget.style.boxShadow =
        "0 0 0 1px var(--sc-bronze), var(--rim-top)";
    }}
    onBlur={(e) => {
      e.currentTarget.style.borderColor = "var(--sc-rim-2)";
      e.currentTarget.style.boxShadow = "var(--rim-top), var(--rim-bottom)";
    }}
    {...rest}
  />
));
V2Input.displayName = "V2Input";

/* ──────────────────────────── V2Chip ───────────────────────────────
 * Filter chip / tab pill. `active` controls the bronze-fill state.
 * `tone` lets specific filter groups colour-code (build classifier etc.)
 */
export interface V2ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: "bronze" | "steel" | "blood";
  count?: number | string;
}
export function V2Chip({
  active,
  tone = "bronze",
  count,
  className = "",
  style,
  children,
  ...rest
}: V2ChipProps) {
  const activeBg =
    tone === "blood"
      ? "rgba(181,61,44,0.35)"
      : tone === "steel"
        ? "rgba(109,143,163,0.25)"
        : "rgba(200,154,63,0.30)";
  const activeBorder =
    tone === "blood"
      ? "var(--sc-blood)"
      : tone === "steel"
        ? "var(--sc-steel)"
        : "var(--sc-bronze)";
  const activeText =
    tone === "blood"
      ? "var(--sc-blood)"
      : tone === "steel"
        ? "var(--sc-steel)"
        : "var(--sc-bronze)";
  return (
    <button
      type="button"
      className={className}
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: ".04em",
        padding: "4px 10px",
        border: `1px solid ${active ? activeBorder : "var(--sc-rim-2)"}`,
        borderRadius: "var(--r-card)",
        background: active ? activeBg : "var(--sc-panel-2)",
        color: active ? activeText : "var(--fg-2)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        transition: "all var(--d-fast)",
        ...style,
      }}
      {...rest}
    >
      {children}
      {count !== undefined && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 10,
            color: active ? activeText : "var(--fg-3)",
            opacity: 0.85,
          }}
        >
          · {count}
        </span>
      )}
    </button>
  );
}

/* ──────────────────────────── V2Tab ────────────────────────────────
 * Town-nav-style tab: hard rectangular, bronze underline accent on
 * active, weight transition on hover. No floating shadows.
 */
export interface V2TabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  subLabel?: string;
}
export function V2Tab({
  active,
  subLabel,
  className = "",
  style,
  children,
  ...rest
}: V2TabProps) {
  return (
    <button
      type="button"
      className={className}
      style={{
        position: "relative",
        background: "transparent",
        border: "none",
        borderBottom: `3px solid ${active ? "var(--sc-bronze)" : "transparent"}`,
        marginBottom: -2,
        padding: "12px 18px",
        fontFamily: "var(--font-ui)",
        fontWeight: active ? 800 : 600,
        fontSize: 13,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        color: active ? "var(--sc-parchment)" : "var(--fg-3)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        transition: "color var(--d-fast), font-weight var(--d-fast)",
        ...style,
      }}
      {...rest}
    >
      <span>{children}</span>
      {subLabel && (
        <span
          style={{
            fontWeight: 500,
            fontSize: 10,
            letterSpacing: "0",
            textTransform: "none",
            color: active ? "var(--fg-3)" : "var(--sc-rim-2)",
          }}
        >
          {subLabel}
        </span>
      )}
    </button>
  );
}

/* ──────────────────────────── Tone divider ────────────────────────── */
export function ToneDivider({
  className = "",
  style,
  bronze,
}: {
  className?: string;
  style?: CSSProperties;
  bronze?: boolean;
}) {
  return (
    <div
      className={className}
      style={{
        height: 1,
        background: bronze ? "var(--sc-bronze)" : "var(--sc-rim)",
        opacity: bronze ? 0.35 : 1,
        width: "100%",
        ...style,
      }}
    />
  );
}

/* ──────────────────────────── Section title ────────────────────────
 * Uppercase weathered-bronze label with bronze underline. Used as
 * panel sub-headers (Attributes / Combat Statistics / etc).
 */
export function SectionLabel({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: 800,
        fontSize: 10,
        letterSpacing: "var(--ls-stamp)",
        textTransform: "uppercase",
        color: "var(--sc-bronze)",
        borderBottom: "1px solid var(--sc-rim)",
        paddingBottom: 4,
        marginBottom: 8,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
