import { useRef, useState } from "react";

interface TaskProgressSliderProps {
  value: number;
  disabled?: boolean;
  compact?: boolean;
  onCommit: (next: number) => void;
  className?: string;
}

function getProgressTone(pct: number): {
  bar: string;
  dot: string;
  text: string;
} {
  if (pct >= 80) {
    return {
      bar: "bg-emerald-500",
      dot: "border-emerald-600 bg-white",
      text: "text-emerald-700",
    };
  }
  if (pct >= 40) {
    return {
      bar: "bg-blue-500",
      dot: "border-blue-600 bg-white",
      text: "text-blue-700",
    };
  }
  if (pct > 0) {
    return {
      bar: "bg-amber-500",
      dot: "border-amber-600 bg-white",
      text: "text-amber-700",
    };
  }
  return {
    bar: "bg-slate-300",
    dot: "border-slate-400 bg-white",
    text: "text-slate-500",
  };
}

export function TaskProgressSlider({
  value,
  disabled = false,
  compact = false,
  onCommit,
  className = "",
}: TaskProgressSliderProps) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value || 0)));
  const [draggingValue, setDraggingValue] = useState<number | null>(null);
  const lastCommittedRef = useRef<number>(safeValue);

  const displayValue = draggingValue ?? safeValue;
  const tone = getProgressTone(displayValue);

  const commitIfChanged = (rawNext?: number) => {
    const next = Math.max(0, Math.min(100, Math.round(rawNext ?? displayValue)));
    setDraggingValue(null);
    if (next !== safeValue || next !== lastCommittedRef.current) {
      lastCommittedRef.current = next;
      onCommit(next);
    }
  };

  if (disabled) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex items-center gap-2 ${compact ? "w-28" : "w-36"} ${className}`}
        title={`当前进度 ${safeValue}%`}
      >
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${tone.bar}`}
            style={{ width: `${safeValue}%` }}
          />
        </div>
        <span className={`lw-nums w-8 text-right font-mono text-[11px] font-semibold ${tone.text}`}>
          {safeValue}%
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={`group flex items-center gap-2 select-none ${compact ? "w-28" : "w-36"} ${className}`}
      title={`拖动设置进度（当前 ${displayValue}%）`}
    >
      <div className="relative flex h-4 flex-1 items-center">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
          <div
            className={`h-full rounded-full transition-[background-color] ${tone.bar}`}
            style={{ width: `${displayValue}%` }}
          />
        </div>
        <div
          className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-xs transition-transform group-hover:scale-110 ${tone.dot}`}
          style={{ left: `${displayValue}%` }}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label="任务进度百分比"
          value={displayValue}
          onChange={(e) => {
            setDraggingValue(Number(e.target.value));
          }}
          onPointerUp={() => commitIfChanged()}
          onMouseUp={() => commitIfChanged()}
          onTouchEnd={() => commitIfChanged()}
          onBlur={() => {
            if (draggingValue !== null) {
              commitIfChanged(draggingValue);
            }
          }}
          onKeyUp={(e) => {
            if (
              e.key === "ArrowLeft" ||
              e.key === "ArrowRight" ||
              e.key === "ArrowUp" ||
              e.key === "ArrowDown" ||
              e.key === "Home" ||
              e.key === "End"
            ) {
              commitIfChanged(Number(e.currentTarget.value));
            }
          }}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
      <span className={`lw-nums w-8 text-right font-mono text-[11px] font-semibold ${tone.text}`}>
        {displayValue}%
      </span>
    </div>
  );
}
