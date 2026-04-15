interface StatBarProps {
  label: string;
  value: number;
  max?: number;
  color?: string;
  suffix?: string;
}

export function StatBar({ label, value, max = 100, color = "bg-emerald-500", suffix = "" }: StatBarProps) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-zinc-400 w-20 shrink-0">{label}</span>
      <div className="flex-1 bg-zinc-800 h-2 rounded-full overflow-hidden">
        <div
          className={`${color} h-2 rounded-full transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-zinc-300 w-16 text-right font-mono text-xs">
        {typeof value === "number" ? value.toFixed(1) : value}{suffix}
      </span>
    </div>
  );
}
