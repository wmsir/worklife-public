import { Calendar, AlertCircle } from "lucide-react";
import { getRelativeDateMeta, isValidYmd } from "../lib/date";
import type { CnDayInfo } from "../lib/types";

interface DateBadgeProps {
  date: string | null | undefined;
  done?: boolean;
  variant?: "pill" | "subtle" | "inline";
  showIcon?: boolean;
  showWeekday?: boolean;
  showRelative?: boolean;
  emptyLabel?: string;
  className?: string;
}

const TONE_PILL: Record<string, string> = {
  overdue: "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80",
  today: "bg-blue-50 text-blue-700 ring-1 ring-blue-200/80",
  tomorrow: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/80",
  soon: "bg-amber-50/90 text-amber-800 ring-1 ring-amber-200/80",
  future: "bg-slate-100/90 text-slate-600 ring-1 ring-slate-200/70",
  done: "bg-slate-100/70 text-slate-400",
  empty: "bg-slate-100/80 text-slate-500",
};

const TONE_SUBTLE: Record<string, string> = {
  overdue: "bg-rose-50/70 text-rose-700",
  today: "bg-blue-50/80 text-blue-700",
  tomorrow: "bg-indigo-50/80 text-indigo-700",
  soon: "bg-amber-50/80 text-amber-800",
  future: "bg-slate-100 text-slate-600",
  done: "bg-slate-100 text-slate-400",
  empty: "bg-slate-100 text-slate-500",
};

const TONE_INLINE: Record<string, string> = {
  overdue: "text-rose-600 font-medium",
  today: "text-blue-600 font-medium",
  tomorrow: "text-indigo-600",
  soon: "text-amber-700",
  future: "text-slate-500",
  done: "text-slate-400",
  empty: "text-slate-400",
};

export function DateBadge({
  date,
  done = false,
  variant = "pill",
  showIcon = true,
  showWeekday = false,
  showRelative = true,
  emptyLabel = "收集箱",
  className = "",
}: DateBadgeProps) {
  const meta = getRelativeDateMeta(date, { done });
  const text = !meta.valid
    ? emptyLabel
    : showRelative
      ? showWeekday && (meta.tone === "today" || meta.tone === "tomorrow" || meta.tone === "future" || meta.tone === "done")
        ? `${meta.label} ${meta.weekday}`
        : meta.label
      : showWeekday
        ? `${meta.raw.slice(5)} ${meta.weekday}`
        : meta.raw;

  const toneCls =
    variant === "inline"
      ? TONE_INLINE[meta.tone]
      : variant === "subtle"
        ? TONE_SUBTLE[meta.tone]
        : TONE_PILL[meta.tone];

  const shapeCls =
    variant === "inline"
      ? "inline-flex items-center gap-1 text-[11px]"
      : "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium";

  const IconComp = meta.tone === "overdue" ? AlertCircle : Calendar;

  return (
    <span
      className={`lw-nums whitespace-nowrap ${shapeCls} ${toneCls} ${className}`}
      title={meta.valid ? `${meta.fullZh} (${meta.raw})` : emptyLabel}
    >
      {showIcon && (
        <IconComp className="h-3 w-3 shrink-0 opacity-80" aria-hidden="true" />
      )}
      <span>{text}</span>
    </span>
  );
}

interface CalendarDateTileProps {
  date: string;
  size?: "sm" | "md" | "lg";
  cnInfo?: CnDayInfo | null;
  className?: string;
}

/**
 * Refined tear-off desk-calendar leaf showing month header + tabular day numeral.
 */
export function CalendarDateTile({
  date,
  size = "md",
  cnInfo,
  className = "",
}: CalendarDateTileProps) {
  const valid = isValidYmd(date);
  const monthNum = valid ? Number(date.slice(5, 7)) : new Date().getMonth() + 1;
  const dayNum = valid ? Number(date.slice(8, 10)) : new Date().getDate();

  const ribbonTone =
    cnInfo?.day_type === "holiday"
      ? "bg-rose-600 text-white"
      : cnInfo?.day_type === "in_lieu"
        ? "bg-amber-500 text-white"
        : cnInfo?.day_type === "weekend"
          ? "bg-emerald-600 text-white"
          : "bg-blue-600 text-white";

  const dims =
    size === "lg"
      ? { wrap: "h-14 w-14 rounded-xl", top: "h-5 text-[10px]", num: "text-2xl" }
      : size === "sm"
        ? { wrap: "h-10 w-10 rounded-lg", top: "h-3.5 text-[9px]", num: "text-base" }
        : { wrap: "h-12 w-12 rounded-xl", top: "h-4 text-[10px]", num: "text-xl" };

  return (
    <div
      className={`lw-nums flex shrink-0 flex-col overflow-hidden border border-slate-200/90 bg-white shadow-2xs select-none ${dims.wrap} ${className}`}
      aria-hidden="true"
    >
      <div
        className={`flex items-center justify-center font-semibold tracking-wide ${ribbonTone} ${dims.top}`}
      >
        {monthNum}月
      </div>
      <div className="flex flex-1 items-center justify-center font-bold leading-none text-slate-900">
        <span className={dims.num}>{dayNum}</span>
      </div>
    </div>
  );
}
