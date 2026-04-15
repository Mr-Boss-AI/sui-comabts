interface HpBarProps {
  name: string;
  current: number;
  max: number;
  isLeft?: boolean;
  level?: number;
}

export function HpBar({ name, current, max, isLeft = true, level }: HpBarProps) {
  const pct = Math.max(0, (current / max) * 100);
  const hpColor =
    pct > 60 ? "bg-emerald-500" : pct > 30 ? "bg-amber-500" : "bg-red-500";
  const hpGlow =
    pct > 60
      ? "shadow-emerald-500/30"
      : pct > 30
        ? "shadow-amber-500/30"
        : "shadow-red-500/30";

  return (
    <div className={`flex flex-col ${isLeft ? "items-start" : "items-end"}`}>
      <div className={`flex items-baseline gap-2 mb-1 ${isLeft ? "" : "flex-row-reverse"}`}>
        <span className="font-bold text-lg truncate max-w-[140px]">{name}</span>
        {level && (
          <span className="text-xs text-zinc-500">Lv.{level}</span>
        )}
      </div>
      <div className="w-full max-w-[220px]">
        <div className={`bg-zinc-800 h-5 rounded-full overflow-hidden shadow-inner ${hpGlow}`}>
          <div
            className={`${hpColor} h-5 rounded-full transition-all duration-700 ease-out relative`}
            style={{
              width: `${pct}%`,
              float: isLeft ? "left" : "right",
            }}
          >
            <div className="absolute inset-0 bg-white/10 rounded-full" />
          </div>
        </div>
        <div className={`text-sm mt-0.5 font-mono font-bold ${isLeft ? "text-left" : "text-right"} text-zinc-300`}>
          {Math.round(current)} / {max} HP
        </div>
      </div>
    </div>
  );
}
