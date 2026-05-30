import type { HTMLAttributes } from "react";

/**
 * Phase 2 v2 Forged Metal — card primitive.
 *
 * Default = "forged plate": gunmetal fill, 1px steel rim, 3px radius,
 * flat plate shadow, rim-top + rim-bottom inset highlights. Hype panels
 * use `glow` for the bronze rim + sharp corners.
 */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
}

export function Card({ className = "", glow, style, children, ...props }: CardProps) {
  return (
    <div
      className={className}
      style={{
        background: "var(--sc-panel)",
        border: glow ? "2px solid var(--sc-bronze)" : "1px solid var(--sc-rim)",
        borderRadius: glow ? "var(--r-sharp)" : "var(--r-card)",
        boxShadow: glow
          ? "var(--sh-plate-lg), var(--rim-top), var(--rim-bottom)"
          : "var(--sh-plate), var(--rim-top), var(--rim-bottom)",
        color: "var(--sc-parchment)",
        fontFamily: "var(--font-ui)",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = "", style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      style={{
        borderBottom: "1px solid var(--sc-rim)",
        padding: "10px 14px",
        background: "var(--sc-panel-2)",
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        ...style,
      }}
      {...props}
    />
  );
}

export function CardBody({ className = "", style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      style={{
        padding: 16,
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        ...style,
      }}
      {...props}
    />
  );
}
