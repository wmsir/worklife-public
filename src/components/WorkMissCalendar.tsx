import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { formatDateZh, formatYmd, todayYmd } from "../lib/date";
import type { MissDayInfo } from "../store/runtimeStore";

interface WorkMissCalendarProps {
  dailyMap: Record<string, number>;
  underMap: Record<string, number>;
  dayInfoMap: Record<string, MissDayInfo>;
  timeWork: number;
  startDate: string;
  endDate: string;
  personName?: string;
  onGoReport?: () => void;
}

const WEEK_HEADERS = ["一", "二", "三", "四", "五", "六", "日"];

function buildMonthCells(ym: string): Array<string | null> {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return [];
  const firstDay = new Date(y, m - 1, 1);
  const lastDate = new Date(y, m, 0).getDate();
  const firstDowMon0 = (firstDay.getDay() + 6) % 7;
  const cells: Array<string | null> = [];
  for (let i = 0; i < firstDowMon0; i += 1) {
    cells.push(null);
  }
  for (let d = 1; d <= lastDate; d += 1) {
    cells.push(formatYmd(new Date(y, m - 1, d)));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

function listCoveredMonths(startDate: string, endDate: string): string[] {
  const fallbackYm = todayYmd().slice(0, 7);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return [fallbackYm];
  }
  const [sy, sm] = startDate.slice(0, 7).split("-").map(Number);
  const [ey, em] = endDate.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  let y = sy;
  let m = sm;
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 24) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return out.length > 0 ? out : [fallbackYm];
}

export function WorkMissCalendar({
  dailyMap,
  underMap,
  dayInfoMap,
  timeWork,
  startDate,
  endDate,
  personName,
  onGoReport,
}: WorkMissCalendarProps) {
  const today = todayYmd();
  const months = useMemo(
    () => listCoveredMonths(startDate, endDate),
    [startDate, endDate],
  );
  const [activeYm, setActiveYm] = useState(() => months[months.length - 1]);
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const firstMiss = Object.keys(underMap).sort()[0];
    return firstMiss || (today >= startDate && today <= endDate ? today : endDate);
  });

  useEffect(() => {
    if (!months.includes(activeYm)) {
      setActiveYm(months[months.length - 1]);
    }
  }, [months, activeYm]);

  useEffect(() => {
    const firstMiss = Object.keys(underMap).sort().find((d) => d.startsWith(activeYm));
    if (firstMiss) {
      setSelectedDay(firstMiss);
    } else if (today.startsWith(activeYm) && today >= startDate && today <= endDate) {
      setSelectedDay(today);
    } else {
      setSelectedDay(`${activeYm}-01`);
    }
  }, [activeYm, underMap, today, startDate, endDate]);

  const cells = useMemo(() => buildMonthCells(activeYm), [activeYm]);

  const monthStats = useMemo(() => {
    let okWorkdays = 0;
    let missDays = 0;
    let partialDays = 0;
    let overtimeDays = 0;
    let hoursSum = 0;

    for (const d of cells) {
      if (!d) continue;
      if (d < startDate || d > endDate) continue;
      const hours = Number(dailyMap[d] ?? 0);
      const info = dayInfoMap[d] ?? {};
      const isWork = info.is_workday ?? true;
      hoursSum += hours;

      if (isWork) {
        if (d > today && hours < timeWork) continue;
        if (d in underMap) {
          if (hours <= 0.001) missDays += 1;
          else partialDays += 1;
        } else {
          okWorkdays += 1;
        }
      } else if (hours > 0) {
        overtimeDays += 1;
      }
    }

    return { okWorkdays, missDays, partialDays, overtimeDays, hoursSum };
  }, [cells, startDate, endDate, dailyMap, dayInfoMap, underMap, today, timeWork]);

  const monthIdx = months.indexOf(activeYm);
  const selectedHours = Number(dailyMap[selectedDay] ?? 0);
  const selectedInfo = dayInfoMap[selectedDay];
  const selectedInRange = selectedDay >= startDate && selectedDay <= endDate;
  const selectedIsWork = selectedInfo?.is_workday ?? true;
  const selectedNeedRepair =
    selectedInRange && selectedIsWork && selectedDay <= today && selectedHours < timeWork;

  return (
    <div className="space-y-3 p-4">
      {/* 顶部月份切换 + 状态统计图例 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50/70 p-1">
            <button
              type="button"
              disabled={monthIdx <= 0}
              onClick={() => monthIdx > 0 && setActiveYm(months[monthIdx - 1])}
              className="rounded-lg p-1 text-gray-500 hover:bg-white hover:text-gray-800 disabled:opacity-30"
              aria-label="上一月"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="inline-flex items-center gap-1 px-2 font-mono text-xs font-semibold text-gray-800">
              <CalendarDays className="h-3.5 w-3.5 text-blue-600" />
              <span>
                {activeYm.slice(0, 4)}年{Number(activeYm.slice(5, 7))}月
              </span>
            </span>
            <button
              type="button"
              disabled={monthIdx < 0 || monthIdx >= months.length - 1}
              onClick={() =>
                monthIdx >= 0 &&
                monthIdx < months.length - 1 &&
                setActiveYm(months[monthIdx + 1])
              }
              className="rounded-lg p-1 text-gray-500 hover:bg-white hover:text-gray-800 disabled:opacity-30"
              aria-label="下一月"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {personName && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
              {personName}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            已达标 {monthStats.okWorkdays} 天
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 font-medium text-rose-700">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            缺报 {monthStats.missDays} 天
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 font-medium text-amber-800">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            不足 {monthStats.partialDays} 天
          </span>
          {monthStats.overtimeDays > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 font-medium text-blue-700">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              加班 {monthStats.overtimeDays} 天
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-mono font-semibold text-slate-700">
            本月合计 {monthStats.hoursSum.toFixed(1)}h
          </span>
        </div>
      </div>

      {/* 星期表头 + 日历格子 */}
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-gray-400">
        {WEEK_HEADERS.map((w, i) => (
          <div key={w} className={i >= 5 ? "text-slate-400" : "text-slate-600"}>
            周{w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, idx) => {
          if (!d) {
            return <div key={`pad-${idx}`} className="h-16 rounded-xl bg-gray-50/40" />;
          }

          const inRange = d >= startDate && d <= endDate;
          const dayNum = Number(d.slice(8, 10));
          const hours = Number(dailyMap[d] ?? 0);
          const info = dayInfoMap[d];
          const isWork = info?.is_workday ?? true;
          const dType = info?.day_type ?? "workday";
          const isFuture = d > today;
          const isToday = d === today;
          const isSelected = d === selectedDay;

          let cardCls = "border-gray-100 bg-gray-50/70 text-gray-400";
          let badgeText = "";
          let subText = "";

          if (!inRange) {
            cardCls = "border-dashed border-gray-200/80 bg-gray-50/40 text-gray-300";
            subText = "区间外";
          } else if (isWork) {
            if (hours >= timeWork) {
              cardCls = "border-emerald-200 bg-emerald-50/85 text-emerald-800 hover:bg-emerald-100/80";
              badgeText = "已报";
              subText = `${hours.toFixed(1)}h`;
            } else if (isFuture) {
              cardCls = "border-dashed border-slate-200 bg-white text-slate-400 hover:bg-slate-50";
              badgeText = dType === "in_lieu" ? "调休班" : "待到";
              subText = hours > 0 ? `${hours.toFixed(1)}h` : "-";
            } else if (hours <= 0.001) {
              cardCls = "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100/80";
              badgeText = isToday ? "今日未报" : "缺报";
              subText = "0.0h";
            } else {
              const gap = Math.max(0, timeWork - hours);
              cardCls = "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100/80";
              badgeText = `差${gap.toFixed(1)}h`;
              subText = `${hours.toFixed(1)}h`;
            }
          } else if (hours > 0) {
            cardCls = "border-blue-200 bg-blue-50/80 text-blue-700 hover:bg-blue-100/70";
            badgeText = "加班";
            subText = `${hours.toFixed(1)}h`;
          } else {
            cardCls = "border-slate-200/70 bg-slate-50/90 text-slate-400 hover:bg-slate-100/80";
            badgeText =
              dType === "holiday" ? info?.holiday_name || "节假日" : "休";
            subText = "休息";
          }

          return (
            <button
              key={d}
              type="button"
              onClick={() => setSelectedDay(d)}
              className={`relative flex h-16 flex-col justify-between rounded-xl border p-1.5 text-left transition ${cardCls} ${
                isToday ? "ring-2 ring-blue-500 ring-offset-1" : ""
              } ${isSelected ? "shadow-sm outline outline-2 outline-slate-800/70" : ""}`}
            >
              <div className="flex w-full items-center justify-between gap-1">
                <span className="font-mono text-xs font-bold leading-none">
                  {dayNum}
                </span>
                {badgeText && (
                  <span className="truncate text-[10px] font-medium leading-none">
                    {badgeText}
                  </span>
                )}
              </div>
              <div className="flex w-full items-end justify-between">
                <span className="font-mono text-[11px] font-semibold leading-none">
                  {subText}
                </span>
                {isToday && (
                  <span className="rounded bg-blue-600 px-1 py-0 text-[9px] font-medium text-white">
                    今天
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 选中日期详情栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-slate-700">
          <span className="font-semibold text-slate-900">
            {formatDateZh(selectedDay, { includeYear: true, showWeekday: true })}
          </span>
          <span className="rounded bg-white px-2 py-0.5 text-[11px] text-slate-600 shadow-2xs">
            {!selectedInRange
              ? "不在当前查询区间内"
              : selectedInfo?.label || (selectedIsWork ? "工作日" : "休息日")}
          </span>
          {selectedInRange && (
            <span className="font-mono text-slate-700">
              已填 <strong className="text-slate-900">{selectedHours.toFixed(1)}h</strong>
              {selectedIsWork && (
                <span className="text-slate-500"> / 标准 {timeWork.toFixed(1)}h</span>
              )}
            </span>
          )}
          {selectedNeedRepair && (
            <span className="font-medium text-rose-600">
              （缺 {(Math.max(0, timeWork - selectedHours)).toFixed(1)}h）
            </span>
          )}
        </div>

        {selectedNeedRepair && onGoReport && (
          <button
            type="button"
            onClick={onGoReport}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
          >
            <ExternalLink className="h-3 w-3" />
            <span>去工时填报补录</span>
          </button>
        )}
      </div>
    </div>
  );
}
