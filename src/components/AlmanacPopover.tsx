import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { addDaysYmd } from "../lib/date";
import { getLunarAlmanac } from "../lib/lunar";
import type { CnDayInfo } from "../lib/types";

interface Props {
  today: string;
  todayCnInfo: CnDayInfo | null;
}

export function AlmanacPopover({ today, todayCnInfo }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [inspectDate, setInspectDate] = useState(today);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInspectDate(today);
  }, [today]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const todayAlmanac = useMemo(() => getLunarAlmanac(today), [today]);
  const inspectAlmanac = useMemo(() => getLunarAlmanac(inspectDate), [inspectDate]);

  const copySummary = async () => {
    const festivalOrTerm =
      inspectAlmanac.lunarFestival || inspectAlmanac.solarTerm
        ? ` · ${[inspectAlmanac.lunarFestival, inspectAlmanac.solarTerm].filter(Boolean).join("/")}`
        : "";
    const text = `${inspectAlmanac.gregorianFull} ${inspectAlmanac.weekdayLong}（${inspectAlmanac.zodiacLabel} 农历${inspectAlmanac.lunarDateText}${festivalOrTerm} · 第${inspectAlmanac.weekOfYear}周）`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制完整日期与生肖黄历信息");
    } catch (e) {
      toast.error(`复制失败: ${String(e)}`);
    }
  };

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="点击查看完整公历年月日、生肖年份、农历、二十四节气与年度进度"
        className="lw-nums hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200/90 bg-slate-50/90 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50/70 hover:text-blue-700 @[820px]:inline-flex"
      >
        <Calendar className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden="true" />
        <span className="font-medium whitespace-nowrap">
          {todayAlmanac.gregorianFull} {todayAlmanac.weekdayShort}
        </span>
        <span className="hidden items-center gap-1 whitespace-nowrap text-slate-500 @[1120px]:inline-flex">
          <span className="text-slate-300">·</span>
          <span>{todayAlmanac.zodiacEmoji}</span>
          <span>
            {todayAlmanac.zodiacLabel} {todayAlmanac.lunarDateText}
          </span>
          {(todayAlmanac.lunarFestival || todayAlmanac.solarTerm) && (
            <span className="rounded bg-amber-100 px-1 py-0 text-[10px] font-medium text-amber-800">
              {todayAlmanac.lunarFestival || todayAlmanac.solarTerm}
            </span>
          )}
        </span>
        {todayCnInfo && (
          <span
            className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0 text-[10px] font-medium ${
              todayCnInfo.day_type === "holiday"
                ? "bg-rose-100 text-rose-700"
                : todayCnInfo.day_type === "in_lieu"
                  ? "bg-amber-100 text-amber-800"
                  : todayCnInfo.is_workday
                    ? "bg-blue-100/80 text-blue-700"
                    : "bg-emerald-100/80 text-emerald-700"
            }`}
          >
            {todayCnInfo.day_type === "holiday"
              ? todayCnInfo.holiday_name || "休"
              : todayCnInfo.day_type === "in_lieu"
                ? "调休班"
                : todayCnInfo.is_workday
                  ? "班"
                  : "休"}
          </span>
        )}
      </button>

      {open && (
        <div className="lw-popover-panel absolute left-0 z-50 mt-2 w-88 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:w-96">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="前一天"
                onClick={() => setInspectDate((d) => addDaysYmd(d, -1))}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                title="前一天"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                type="date"
                value={inspectDate}
                onChange={(e) => {
                  if (e.target.value) setInspectDate(e.target.value);
                }}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
              <button
                type="button"
                aria-label="后一天"
                onClick={() => setInspectDate((d) => addDaysYmd(d, 1))}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                title="后一天"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {inspectDate !== today && (
              <button
                type="button"
                onClick={() => setInspectDate(today)}
                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
              >
                <RotateCcw className="h-3 w-3" />
                <span>回今日</span>
              </button>
            )}
          </div>

          <div className="mt-3 rounded-xl bg-gradient-to-br from-slate-50 to-blue-50/60 p-3.5 ring-1 ring-slate-200/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="lw-nums text-base font-bold text-slate-900">
                {inspectAlmanac.gregorianFull} {inspectAlmanac.weekdayLong}
              </div>
              {inspectDate === today && todayCnInfo && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    todayCnInfo.day_type === "holiday"
                      ? "bg-rose-100 text-rose-700"
                      : todayCnInfo.day_type === "in_lieu"
                        ? "bg-amber-100 text-amber-800"
                        : todayCnInfo.is_workday
                          ? "bg-blue-100 text-blue-700"
                          : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {todayCnInfo.label}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/80 px-2.5 py-0.5 font-semibold text-amber-900">
                <span>{inspectAlmanac.zodiacEmoji}</span>
                <span>
                  {inspectAlmanac.ganZhiYear}年 · 生肖{inspectAlmanac.zodiac}（
                  {inspectAlmanac.zodiacLabel}）
                </span>
              </span>
              <span className="rounded-full bg-white px-2.5 py-0.5 font-medium text-slate-700 ring-1 ring-slate-200/80">
                农历{inspectAlmanac.lunarDateText}
              </span>
              {inspectAlmanac.lunarFestival && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700">
                  🎊 {inspectAlmanac.lunarFestival}
                </span>
              )}
              {inspectAlmanac.solarTerm && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                  🌿 {inspectAlmanac.solarTerm}
                </span>
              )}
            </div>
          </div>

          <div className="lw-nums mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
              <div className="text-[11px] text-slate-400">二十四节气</div>
              <div className="mt-0.5 font-medium text-slate-800">
                {inspectAlmanac.solarTerm
                  ? `今日「${inspectAlmanac.solarTerm}」`
                  : `距「${inspectAlmanac.nextSolarTerm.name}」${inspectAlmanac.nextSolarTerm.daysAway} 天`}
              </div>
              {!inspectAlmanac.solarTerm && (
                <div className="text-[10px] text-slate-400">
                  {inspectAlmanac.nextSolarTerm.date}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
              <div className="text-[11px] text-slate-400">周次与季度</div>
              <div className="mt-0.5 font-medium text-slate-800">
                第 {inspectAlmanac.weekOfYear} 周 · {inspectAlmanac.year} Q
                {inspectAlmanac.quarter}
              </div>
              <div className="text-[10px] text-slate-400">
                公历{inspectAlmanac.year}年 · 农历{inspectAlmanac.lunarYear}年
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>当年进度</span>
                <span className="font-semibold text-blue-600">
                  {inspectAlmanac.yearProgressPct}%
                </span>
              </div>
              <div className="mt-0.5 font-medium text-slate-800">
                第 {inspectAlmanac.dayOfYear} / {inspectAlmanac.daysInYear} 天
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-blue-600"
                  style={{ width: `${inspectAlmanac.yearProgressPct}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
              <div className="text-[11px] text-slate-400">周末与月末</div>
              <div className="mt-0.5 font-medium text-slate-800">
                {inspectAlmanac.daysUntilWeekend === 0
                  ? "正值周末 🎉"
                  : `距周六还有 ${inspectAlmanac.daysUntilWeekend} 天`}
              </div>
              <div className="text-[10px] text-slate-400">
                {inspectAlmanac.daysLeftInMonth === 0
                  ? "今天是本月最后一天"
                  : `距月末还有 ${inspectAlmanac.daysLeftInMonth} 天`}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
            <button
              type="button"
              onClick={copySummary}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Copy className="h-3.5 w-3.5 text-slate-500" />
              <span>复制完整日期信息</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/calendar");
              }}
              className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <span>打开全景月历</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
