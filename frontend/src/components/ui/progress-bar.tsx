interface ProgressBarProps {
  value: number; // 0-1
  max?: number;
  color?: string;
  bgColor?: string;
  height?: string;
  label?: string;
  showValue?: boolean;
  currentValue?: number;
  maxValue?: number;
}

export function ProgressBar({
  value,
  color = "bg-emerald-500",
  bgColor = "bg-zinc-800",
  height = "h-2",
  label,
  showValue,
  currentValue,
  maxValue,
}: ProgressBarProps) {
  const pct = Math.min(1, Math.max(0, value)) * 100;
  return (
    <div>
      {(label || showValue) && (
        <div className="flex justify-between text-xs text-zinc-400 mb-1">
          {label && <span>{label}</span>}
          {showValue && currentValue !== undefined && maxValue !== undefined && (
            <span>
              {currentValue} / {maxValue}
            </span>
          )}
        </div>
      )}
      <div className={`${bgColor} ${height} rounded-full overflow-hidden`}>
        <div
          className={`${color} ${height} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
