import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { api } from "../lib/api";
import {
  addDaysYmd,
  formatDateZh,
  formatMonthZh,
  formatWeekdayZh,
  formatYmd,
  getNextMondayYmd,
  getThisFridayYmd,
  isValidYmd,
  todayYmd,
} from "../lib/date";
import type { CnDayInfo } from "../lib/types";

const cnMonthCache = new Map<string, Record<string, CnDayInfo>>();
const cnMonthPending = new Map<string, Promise<Record<string, CnDayInfo>>>();

function loadCnMonth(year: number, month: number): Promise<Record<string, CnDayInfo>> {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const hit = cnMonthCache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = cnMonthPending.get(key);
  if (inflight) return inflight;
  const req = api
    .getCalendarMonthInfo(year, month)
    .then((res) => {
      cnMonthCache.set(key, res);
      cnMonthPending.delete(key);
      return res;
    })
    .catch(() => {
      cnMonthPending.delete(key);
      return {};
    });
  cnMonthPending.set(key, req);
  return req;
}

interface FloatingPosition {
  top: number;
  left: number;
  ready: boolean;
}

function useFloatingPosition(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  align: "left" | "right" = "left",
  fallbackWidth = 288,
  fallbackHeight = 340,
): FloatingPosition {
  const [pos, setPos] = useState<FloatingPosition>({ top: 0, left: 0, ready: false });

  useLayoutEffect(() => {
    if (!open) {
      setPos((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }

    const compute = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelW = panelRef.current?.offsetWidth || fallbackWidth;
      const panelH = panelRef.current?.offsetHeight || fallbackHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 10;

      let top = rect.bottom + 6;
      if (top + panelH > vh - margin && rect.top - panelH - 6 >= margin) {
        top = rect.top - panelH - 6;
      } else if (top + panelH > vh - margin) {
        top = Math.max(margin, vh - panelH - margin);
      }

      let left = align === "right" ? rect.right - panelW : rect.left;
      if (left + panelW > vw - margin) {
        left = vw - panelW - margin;
      }
      if (left < margin) {
        left = margin;
      }

      setPos({ top, left, ready: true });
    };

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, anchorRef, panelRef, align, fallbackWidth, fallbackHeight]);

  return pos;
}

export interface DatePickerProps {
  value: string;
  onChange: (nextYmd: string) => void;
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  clearable?: boolean;
  showQuickActions?: boolean;
  disabled?: boolean;
  className?: string;
  align?: "left" | "right";
  tone?: "default" | "overdue";
  ariaLabel?: string;
}

const WEEK_HEADER = ["一", "二", "三", "四", "五", "六", "日"];

export function DatePicker({
  value,
  onChange,
  placeholder = "选择日期",
  size = "sm",
  clearable = false,
  showQuickActions = true,
  disabled = false,
  className = "",
  align = "left",
  tone = "default",
  ariaLabel,
}: DatePickerProps) {
  const today = todayYmd();
  const [open, setOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"days" | "months">("days");
  const initialRef = isValidYmd(value) ? value : today;
  const [viewYear, setViewYear] = useState(() => Number(initialRef.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(initialRef.slice(5, 7)));
  const [cnMap, setCnMap] = useState<Record<string, CnDayInfo>>({});

  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const base = isValidYmd(value) ? value : todayYmd();
    setViewYear(Number(base.slice(0, 4)));
    setViewMonth(Number(base.slice(5, 7)));
    setPickerMode("days");
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadCnMonth(viewYear, viewMonth).then((data) => {
      if (active) setCnMap(data);
    });
    return () => {
      active = false;
    };
  }, [open, viewYear, viewMonth]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pos = useFloatingPosition(open, wrapRef, panelRef, align, 292, 355);

  const gridDates = useMemo(() => {
    const first = new Date(viewYear, viewMonth - 1, 1);
    const startDow = (first.getDay() + 6) % 7;
    const start = formatYmd(new Date(viewYear, viewMonth - 1, 1 - startDow));
    const list: string[] = [];
    for (let i = 0; i < 42; i += 1) {
      list.push(addDaysYmd(start, i));
    }
    return list;
  }, [viewYear, viewMonth]);

  const monthPrefix = `${viewYear}-${String(viewMonth).padStart(2, "0")}`;

  const shiftMonth = (delta: number) => {
    const dt = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(dt.getFullYear());
    setViewMonth(dt.getMonth() + 1);
  };

  const selectAndClose = (nextYmd: string) => {
    onChange(nextYmd);
    setOpen(false);
  };

  const valid = isValidYmd(value);
  const curYear = new Date().getFullYear();

  const triggerText = useMemo(() => {
    if (!valid) return placeholder;
    if (size === "xs") {
      const m = Number(value.slice(5, 7));
      const d = Number(value.slice(8, 10));
      const y = Number(value.slice(0, 4));
      const wk = formatWeekdayZh(value);
      return y === curYear ? `${m}月${d}日 ${wk}` : `${y}/${m}/${d}`;
    }
    return formatDateZh(value, { showWeekday: true });
  }, [valid, value, placeholder, size, curYear]);

  const relativeTag = useMemo(() => {
    if (!valid) return null;
    if (value === today) return "今天";
    if (value === addDaysYmd(today, 1)) return "明天";
    if (value === addDaysYmd(today, -1)) return "昨天";
    return null;
  }, [valid, value, today]);

  const sizeCls =
    size === "xs"
      ? "px-2 py-1 text-[11px] rounded-lg min-h-[28px]"
      : size === "md"
        ? "px-3 py-2 text-sm rounded-xl min-h-[38px]"
        : "px-2.5 py-1.5 text-xs rounded-xl min-h-[32px]";

  const toneCls =
    tone === "overdue"
      ? "border-rose-300 bg-rose-50/60 text-rose-800 hover:border-rose-400"
      : open
        ? "border-blue-500 bg-white text-slate-900 ring-2 ring-blue-500/15"
        : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50/40";

  return (
    <div
      ref={wrapRef}
      className={`relative inline-flex items-center ${className}`}
    >
      <div
        className={`lw-nums flex w-full items-center justify-between gap-1.5 border transition-colors ${sizeCls} ${toneCls} ${
          disabled ? "cursor-not-allowed bg-slate-50 opacity-60" : ""
        }`}
      >
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel || placeholder}
          aria-expanded={open}
          title={
            valid
              ? `${formatDateZh(value, { includeYear: true, showWeekday: true, weekdayStyle: "long" })} (${value})`
              : placeholder
          }
          onClick={() => !disabled && setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <CalendarIcon
            className={`shrink-0 ${size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"} ${
              tone === "overdue"
                ? "text-rose-500"
                : valid
                  ? "text-blue-600"
                  : "text-slate-400"
            }`}
            aria-hidden="true"
          />
          <span className={`truncate ${valid ? "font-medium text-slate-800" : "text-slate-400"}`}>
            {triggerText}
          </span>
          {relativeTag && size !== "xs" && (
            <span className="shrink-0 rounded bg-blue-50 px-1 py-0 text-[10px] font-medium text-blue-700">
              {relativeTag}
            </span>
          )}
        </button>

        {clearable && valid && !disabled ? (
          <button
            type="button"
            aria-label="清空日期"
            title="清空日期"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : (
          <ChevronDown
            className={`pointer-events-none shrink-0 text-slate-400 transition-transform duration-150 ${
              size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"
            } ${open ? "rotate-180 text-blue-600" : ""}`}
            aria-hidden="true"
          />
        )}
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              visibility: pos.ready ? "visible" : "hidden",
            }}
            className="lw-popover-panel z-[75] w-[292px] rounded-2xl border border-slate-200/90 bg-white p-3 text-xs select-none"
            role="dialog"
            aria-label="选择日期"
          >
            {/* Header navigation */}
            <div className="mb-2.5 flex items-center justify-between gap-1">
              <button
                type="button"
                aria-label={pickerMode === "days" ? "上个月" : "上一年"}
                onClick={() =>
                  pickerMode === "days" ? shiftMonth(-1) : setViewYear((y) => y - 1)
                }
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setPickerMode((m) => (m === "days" ? "months" : "days"))
                }
                className="lw-nums inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-100"
              >
                <span>
                  {pickerMode === "days" ? `${viewYear}年${viewMonth}月` : `${viewYear}年`}
                </span>
                <ChevronDown
                  className={`h-3 w-3 text-slate-400 transition-transform ${
                    pickerMode === "months" ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>

              <button
                type="button"
                aria-label={pickerMode === "days" ? "下个月" : "下一年"}
                onClick={() =>
                  pickerMode === "days" ? shiftMonth(1) : setViewYear((y) => y + 1)
                }
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {pickerMode === "months" ? (
              <div className="grid grid-cols-3 gap-1.5 py-2">
                {Array.from({ length: 12 }, (_, idx) => {
                  const m = idx + 1;
                  const active = m === viewMonth;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setViewMonth(m);
                        setPickerMode("days");
                      }}
                      className={`lw-nums rounded-xl py-2 text-xs font-medium transition-colors ${
                        active
                          ? "bg-blue-600 text-white shadow-2xs"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {m}月
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium">
                  {WEEK_HEADER.map((w, idx) => (
                    <div
                      key={w}
                      className={`py-1 ${idx >= 5 ? "text-rose-500" : "text-slate-400"}`}
                    >
                      {w}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-0.5">
                  {gridDates.map((ymd) => {
                    const inMonth = ymd.startsWith(monthPrefix);
                    const isToday = ymd === today;
                    const isSelected = ymd === value;
                    const dayNum = Number(ymd.slice(8, 10));
                    const cn = cnMap[ymd];
                    const isHoliday = cn?.day_type === "holiday";
                    const isInLieu = cn?.day_type === "in_lieu";

                    return (
                      <button
                        key={ymd}
                        type="button"
                        onClick={() => selectAndClose(ymd)}
                        title={
                          cn?.holiday_name
                            ? `${formatDateZh(ymd, { includeYear: true, showWeekday: true })} · ${cn.holiday_name}`
                            : formatDateZh(ymd, { includeYear: true, showWeekday: true })
                        }
                        className={`lw-nums relative flex h-8 flex-col items-center justify-center rounded-lg text-[12px] transition-colors ${
                          isSelected
                            ? "bg-blue-600 font-semibold text-white shadow-2xs"
                            : isToday
                              ? "bg-blue-50 font-semibold text-blue-700 ring-1 ring-inset ring-blue-300"
                              : !inMonth
                                ? "text-slate-300 hover:bg-slate-50 hover:text-slate-500"
                                : isHoliday
                                  ? "text-rose-600 hover:bg-rose-50"
                                  : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <span className="leading-none">{dayNum}</span>
                        {inMonth && (isHoliday || isInLieu) && (
                          <span
                            className={`mt-0.5 text-[8px] leading-none font-medium ${
                              isSelected
                                ? "text-blue-100"
                                : isHoliday
                                  ? "text-rose-500"
                                  : "text-amber-600"
                            }`}
                          >
                            {isHoliday ? "休" : "班"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {showQuickActions && (
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 pt-2">
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => selectAndClose(today)}
                    className="rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100"
                  >
                    今天
                  </button>
                  <button
                    type="button"
                    onClick={() => selectAndClose(addDaysYmd(today, 1))}
                    className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200"
                  >
                    明天
                  </button>
                  <button
                    type="button"
                    onClick={() => selectAndClose(getThisFridayYmd(today))}
                    className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200"
                  >
                    本周五
                  </button>
                  <button
                    type="button"
                    onClick={() => selectAndClose(getNextMondayYmd(today))}
                    className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-200"
                  >
                    下周一
                  </button>
                </div>

                {clearable && valid && (
                  <button
                    type="button"
                    onClick={() => selectAndClose("")}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                  >
                    清空
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export interface MonthPickerProps {
  value: string; // "" or "YYYY-MM"
  onChange: (nextYm: string) => void;
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  align?: "left" | "right";
  ariaLabel?: string;
}

export function MonthPicker({
  value,
  onChange,
  placeholder = "选择月份",
  size = "sm",
  clearable = false,
  disabled = false,
  className = "",
  align = "left",
  ariaLabel,
}: MonthPickerProps) {
  const curYm = todayYmd().slice(0, 7);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() =>
    /^\d{4}-\d{2}$/.test(value) ? Number(value.slice(0, 4)) : Number(curYm.slice(0, 4)),
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (/^\d{4}-\d{2}$/.test(value)) {
      setViewYear(Number(value.slice(0, 4)));
    } else {
      setViewYear(Number(curYm.slice(0, 4)));
    }
  }, [open, value, curYm]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const pos = useFloatingPosition(open, wrapRef, panelRef, align, 236, 236);

  const valid = /^\d{4}-\d{2}$/.test(value);

  const sizeCls =
    size === "xs"
      ? "px-2 py-1 text-[11px] rounded-lg min-h-[28px]"
      : size === "md"
        ? "px-3 py-2 text-sm rounded-xl min-h-[38px]"
        : "px-2.5 py-1.5 text-xs rounded-xl min-h-[32px]";

  return (
    <div ref={wrapRef} className={`relative inline-flex items-center ${className}`}>
      <div
        className={`lw-nums flex w-full items-center justify-between gap-1.5 border transition-colors ${sizeCls} ${
          open
            ? "border-blue-500 bg-white text-slate-900 ring-2 ring-blue-500/15"
            : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50/40"
        } ${disabled ? "cursor-not-allowed bg-slate-50 opacity-60" : ""}`}
      >
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel || placeholder}
          aria-expanded={open}
          onClick={() => !disabled && setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <CalendarIcon
            className={`shrink-0 ${size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"} ${
              valid ? "text-blue-600" : "text-slate-400"
            }`}
            aria-hidden="true"
          />
          <span className={`truncate ${valid ? "font-medium text-slate-800" : "text-slate-400"}`}>
            {valid ? formatMonthZh(value) : placeholder}
          </span>
        </button>

        {clearable && valid && !disabled ? (
          <button
            type="button"
            aria-label="清空月份"
            title="清空月份"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : (
          <ChevronDown
            className={`pointer-events-none shrink-0 text-slate-400 transition-transform duration-150 ${
              size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"
            } ${open ? "rotate-180 text-blue-600" : ""}`}
            aria-hidden="true"
          />
        )}
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              visibility: pos.ready ? "visible" : "hidden",
            }}
            className="lw-popover-panel z-[75] w-[236px] rounded-2xl border border-slate-200/90 bg-white p-3 text-xs select-none"
            role="dialog"
            aria-label="选择月份"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <button
                type="button"
                aria-label="上一年"
                onClick={() => setViewYear((y) => y - 1)}
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="lw-nums text-xs font-semibold text-slate-900">
                {viewYear}年
              </span>
              <button
                type="button"
                aria-label="下一年"
                onClick={() => setViewYear((y) => y + 1)}
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 12 }, (_, idx) => {
                const m = idx + 1;
                const ym = `${viewYear}-${String(m).padStart(2, "0")}`;
                const isSelected = ym === value;
                const isCurrent = ym === curYm;
                return (
                  <button
                    key={ym}
                    type="button"
                    onClick={() => {
                      onChange(ym);
                      setOpen(false);
                    }}
                    className={`lw-nums rounded-xl py-2 text-xs font-medium transition-colors ${
                      isSelected
                        ? "bg-blue-600 font-semibold text-white shadow-2xs"
                        : isCurrent
                          ? "bg-blue-50 font-semibold text-blue-700 ring-1 ring-inset ring-blue-300"
                          : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {m}月
                  </button>
                );
              })}
            </div>

            <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2">
              <button
                type="button"
                onClick={() => {
                  onChange(curYm);
                  setOpen(false);
                }}
                className="rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100"
              >
                本月
              </button>
              {clearable && valid && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                >
                  清空
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
