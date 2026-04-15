import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
}

export function Card({ className = "", glow, children, ...props }: CardProps) {
  return (
    <div
      className={`rounded border border-amber-900/20 bg-[#0c0c0f] shadow-lg shadow-black/40 ${glow ? "shadow-emerald-900/20" : ""} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`border-b border-amber-900/20 px-4 py-2.5 bg-gradient-to-r from-zinc-900/50 via-zinc-900/30 to-zinc-900/50 ${className}`}
      {...props}
    />
  );
}

export function CardBody({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-4 ${className}`} {...props} />;
}
