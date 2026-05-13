import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";

/**
 * Phase 2 v2 Forged Metal — button primitive.
 *
 * Variants drop the v1 emerald/amber pastel set in favour of the
 * metal palette:
 *   primary   → bronze fill, dark page text, hard rim. Use for the
 *               main affirmative action on a surface ("Save", "Enter
 *               Queue", "Set as Portrait", "Lock In").
 *   gold      → alias for primary (legacy callers pass variant="gold")
 *   danger    → blood-red fill, parchment text. "Forfeit", "Delete",
 *               "Surrender", "Unequip".
 *   secondary → gunmetal fill, parchment text, steel rim. Neutral
 *               actions ("Cancel", "Discard", "Close").
 *   ghost     → transparent + parchment text + on-hover rim. Inline
 *               or icon-only.
 *
 * Hard 3px radius, 2px rim, flat plate shadow. Hover lifts -1/-1 +
 * shadow grows; press depresses +2/+2 + shadow shrinks. No gradient
 * backgrounds, no soft drop shadows, no rounded-lg.
 *
 * Drop-in compatible: every existing consumer keeps working through
 * the same prop surface; only the visual rendering changes.
 */

type Variant = "primary" | "gold" | "danger" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANT_STYLES: Record<Variant, CSSProperties> = {
  primary: {
    background: "var(--sc-bronze)",
    color: "var(--sc-page)",
    borderColor: "var(--sc-bronze-deep)",
  },
  // legacy alias — earlier code passes variant="gold"; same look
  gold: {
    background: "var(--sc-bronze)",
    color: "var(--sc-page)",
    borderColor: "var(--sc-bronze-deep)",
  },
  danger: {
    background: "var(--sc-blood)",
    color: "var(--sc-parchment)",
    borderColor: "var(--sc-blood-deep)",
  },
  secondary: {
    background: "var(--sc-panel-2)",
    color: "var(--sc-parchment)",
    borderColor: "var(--sc-rim-2)",
  },
  ghost: {
    background: "transparent",
    color: "var(--sc-parchment)",
    borderColor: "transparent",
    boxShadow: "none",
  },
};

const VARIANT_HOVER: Record<Variant, string> = {
  primary: "var(--sc-bronze-hot)",
  gold: "var(--sc-bronze-hot)",
  danger: "#c8462f",
  secondary: "var(--sc-panel-3)",
  ghost: "var(--sc-panel-2)",
};

const SIZE_STYLES: Record<Size, CSSProperties> = {
  sm: { padding: "5px 12px", fontSize: 11 },
  md: { padding: "9px 18px", fontSize: 13 },
  lg: { padding: "13px 28px", fontSize: 15 },
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      className = "",
      disabled,
      style,
      onMouseEnter,
      onMouseLeave,
      ...props
    },
    ref,
  ) => {
    const base = VARIANT_STYLES[variant];
    const sizes = SIZE_STYLES[size];
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`v2-btn ${className}`}
        style={{
          fontFamily: "var(--font-ui)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "var(--ls-button)",
          border: `2px solid ${base.borderColor}`,
          borderRadius: "var(--r-button)",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          whiteSpace: "nowrap",
          boxShadow:
            variant === "ghost"
              ? "none"
              : disabled
                ? "none"
                : "var(--sh-plate-sm)",
          opacity: disabled ? 0.4 : 1,
          transition:
            "transform var(--d-base) var(--ease-pop), box-shadow var(--d-base) var(--ease-pop), background var(--d-fast) linear, color var(--d-fast) linear, border-color var(--d-fast) linear",
          ...base,
          ...sizes,
          ...style,
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.background = VARIANT_HOVER[variant];
            if (variant === "ghost") {
              e.currentTarget.style.borderColor = "var(--sc-rim-2)";
            }
          }
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background =
            VARIANT_STYLES[variant].background as string;
          if (variant === "ghost") {
            e.currentTarget.style.borderColor = "transparent";
          }
          onMouseLeave?.(e);
        }}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
