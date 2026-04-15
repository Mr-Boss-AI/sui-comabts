import type { Rarity } from "@/types/game";
import { RARITY_LABELS, RARITY_COLORS } from "@/types/game";

const variantClasses = {
  default: "bg-zinc-800 text-zinc-300",
  success: "bg-emerald-900/50 text-emerald-400 border border-emerald-800",
  warning: "bg-amber-900/50 text-amber-400 border border-amber-800",
  danger: "bg-red-900/50 text-red-400 border border-red-800",
  info: "bg-blue-900/50 text-blue-400 border border-blue-800",
} as const;

interface BadgeProps {
  variant?: keyof typeof variantClasses;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "default", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export function RarityBadge({ rarity }: { rarity: Rarity }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${RARITY_COLORS[rarity]}`}
    >
      {RARITY_LABELS[rarity]}
    </span>
  );
}
