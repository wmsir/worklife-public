import { toast } from "sonner";
import { create } from "zustand";
import { wtCall } from "../lib/api";
import { monthRangeYmd, todayYmd } from "../lib/date";
import type { LogEntry, WhoamiResult } from "../lib/types";
import { getConst } from "../lib/wtx";

const MAX_LOGS = 800;
const FLUSH_INTERVAL_MS = 100;
const BREAK_REMINDER_STORAGE_KEY = "lw.breakReminderMins";

export type BreakReminderMins = 0 | 45 | 60;

function nowTimeStr(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function loadBreakReminder(): BreakReminderMins {
  try {
    const raw = Number(window.localStorage.getItem(BREAK_REMINDER_STORAGE_KEY) || "0");
    if (raw === 45 || raw === 60) return raw;
  } catch {
    // Ignore storage errors
  }
  return 0;
}

interface LogState {
  logs: LogEntry[];
  logDrawerOpen: boolean;
  setLogDrawerOpen: (open: boolean) => void;
  pushLog: (line: string, ts?: string) => void;
  clearLogs: () => void;
}

let pendingLogs: LogEntry[] = [];
let flushTimer: number | null = null;

function flushPendingLogs() {
  flushTimer = null;
  if (pendingLogs.length === 0) return;
  const batch = pendingLogs;
  pendingLogs = [];
  useLogStore.setState((state) => {
    const combined = [...state.logs, ...batch];
    if (combined.length > MAX_LOGS) {
      combined.splice(0, combined.length - MAX_LOGS);
    }
    return { logs: combined };
  });
}

export const useLogStore = create<LogState>((set) => ({
  logs: [],
  logDrawerOpen: false,

  setLogDrawerOpen: (logDrawerOpen) => set({ logDrawerOpen }),

  pushLog: (line, ts) => {
    pendingLogs.push({
      id: crypto.randomUUID(),
      ts: ts || nowTimeStr(),
      line,
    });
    if (pendingLogs.length >= 40) {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
      }
      flushPendingLogs();
      return;
    }
    if (flushTimer === null) {
      flushTimer = window.setTimeout(flushPendingLogs, FLUSH_INTERVAL_MS);
    }
  },

  clearLogs: () => {
    pendingLogs = [];
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    set({ logs: [] });
  },
}));

interface FocusState {
  focusTodoId: string | null;
  focusTitle: string;
  focusSecondsLeft: number;
  focusTotalSeconds: number;
  focusRunning: boolean;
  breakReminderMins: BreakReminderMins;

  startFocus: (todoId: string | null, title: string, minutes?: number) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  stopFocus: () => void;
  tickFocus: () => boolean;
  setBreakReminderMins: (mins: BreakReminderMins) => void;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  focusTodoId: null,
  focusTitle: "",
  focusSecondsLeft: 0,
  focusTotalSeconds: 1500,
  focusRunning: false,
  breakReminderMins: typeof window !== "undefined" ? loadBreakReminder() : 0,

  startFocus: (todoId, title, minutes = 25) => {
    const total = Math.max(60, Math.round(minutes * 60));
    set({
      focusTodoId: todoId,
      focusTitle: title,
      focusSecondsLeft: total,
      focusTotalSeconds: total,
      focusRunning: true,
    });
  },

  pauseFocus: () => set({ focusRunning: false }),

  resumeFocus: () => {
    if (get().focusSecondsLeft > 0 && get().focusTitle) {
      set({ focusRunning: true });
    }
  },

  stopFocus: () =>
    set({
      focusTodoId: null,
      focusTitle: "",
      focusSecondsLeft: 0,
      focusRunning: false,
    }),

  tickFocus: () => {
    const s = get();
    if (!s.focusRunning) return false;
    if (s.focusSecondsLeft <= 1) {
      set({ focusSecondsLeft: 0, focusRunning: false });
      return true;
    }
    set({ focusSecondsLeft: s.focusSecondsLeft - 1 });
    return false;
  },

  setBreakReminderMins: (mins) => {
    try {
      window.localStorage.setItem(BREAK_REMINDER_STORAGE_KEY, String(mins));
    } catch {
      // Ignore storage errors
    }
    set({ breakReminderMins: mins });
  },
}));

export interface MissDayInfo {
  is_workday?: boolean;
  day_type?: string;
  label?: string;
  weekday_str?: string;
  holiday_name?: string;
}

export interface MonthlyMissSummary {
  monthLabel: string;
  startDate: string;
  endDate: string;
  targetName: string;
  targetErp: string;
  timeWork: number;
  dailyMap: Record<string, number>;
  underMap: Record<string, number>;
  dayInfoMap: Record<string, MissDayInfo>;
  pastMissDates: string[];
  todayNeedsReport: boolean;
  totalReportedHours: number;
  reportedWorkdays: number;
  checkedAt: string;
}

type NotReportTuple = [
  Record<string, number>,
  Record<string, number>,
  Record<string, MissDayInfo>,
];

interface MonthlyMissState {
  checkedKey: string | null;
  checking: boolean;
  summary: MonthlyMissSummary | null;
  error: string | null;
  checkCurrentMonth: (
    user: WhoamiResult,
    opts?: {
      force?: boolean;
      silent?: boolean;
      onOpenCalendar?: () => void;
    },
  ) => Promise<MonthlyMissSummary | null>;
  setSummaryFromCheck: (payload: {
    startDate: string;
    endDate: string;
    targetName: string;
    targetErp: string;
    timeWork: number;
    dailyMap: Record<string, number>;
    underMap: Record<string, number>;
    dayInfoMap: Record<string, MissDayInfo>;
  }) => void;
  resetMonthlyMiss: () => void;
}

function buildMonthlySummary(input: {
  startDate: string;
  endDate: string;
  targetName: string;
  targetErp: string;
  timeWork: number;
  dailyMap: Record<string, number>;
  underMap: Record<string, number>;
  dayInfoMap: Record<string, MissDayInfo>;
}): MonthlyMissSummary {
  const today = todayYmd();
  const underKeys = Object.keys(input.underMap).sort();
  const pastMissDates = underKeys.filter((d) => d < today);
  const todayNeedsReport = Boolean(
    input.dayInfoMap[today]?.is_workday && today in input.underMap,
  );
  let totalReportedHours = 0;
  let reportedWorkdays = 0;
  for (const [d, rawH] of Object.entries(input.dailyMap)) {
    const h = Number(rawH ?? 0);
    totalReportedHours += h;
    if (input.dayInfoMap[d]?.is_workday && h >= input.timeWork) {
      reportedWorkdays += 1;
    }
  }
  return {
    monthLabel: input.startDate.slice(0, 7),
    startDate: input.startDate,
    endDate: input.endDate,
    targetName: input.targetName,
    targetErp: input.targetErp,
    timeWork: input.timeWork,
    dailyMap: input.dailyMap,
    underMap: input.underMap,
    dayInfoMap: input.dayInfoMap,
    pastMissDates,
    todayNeedsReport,
    totalReportedHours: Math.round(totalReportedHours * 100) / 100,
    reportedWorkdays,
    checkedAt: nowTimeStr(),
  };
}

let inFlightMonthlyPromise: Promise<MonthlyMissSummary | null> | null = null;

export const useMonthlyMissStore = create<MonthlyMissState>((set, get) => ({
  checkedKey: null,
  checking: false,
  summary: null,
  error: null,

  checkCurrentMonth: async (user, opts) => {
    const today = todayYmd();
    const { start: monthStart } = monthRangeYmd();
    const erp = (user.erp || user.user.userErp || user.user.erp || "").trim();
    const targetName = (user.realName || user.user.name || user.user.userName || "当前用户").trim();
    const ident = erp || targetName;
    if (!ident) return null;

    const key = `${ident}@${today}`;
    if (!opts?.force && get().checkedKey === key && get().summary) {
      return get().summary;
    }
    if (inFlightMonthlyPromise && !opts?.force) {
      return inFlightMonthlyPromise;
    }

    const runner = (async () => {
      set({ checking: true, error: null });
      try {
        let tw = 7;
        try {
          const val = await getConst<number>("TIME_WORK");
          if (typeof val === "number" && val > 0) tw = val;
        } catch {
          // Keep default 7h
        }

        const res = await wtCall<NotReportTuple>("not_report", {
          start_date: monthStart,
          end_date: today,
          erp: ident,
        });
        const [dailyMap = {}, underMap = {}, dayInfoMap = {}] = Array.isArray(res)
          ? res
          : [{}, {}, {}];

        const summary = buildMonthlySummary({
          startDate: monthStart,
          endDate: today,
          targetName,
          targetErp: erp || ident,
          timeWork: tw,
          dailyMap,
          underMap,
          dayInfoMap,
        });

        set({
          checkedKey: key,
          checking: false,
          summary,
          error: null,
        });

        if (!opts?.silent) {
          const openAction = opts?.onOpenCalendar
            ? {
                label: "查看日历",
                onClick: opts.onOpenCalendar,
              }
            : undefined;
          const pastCnt = summary.pastMissDates.length;
          if (pastCnt > 0) {
            const recentPreview = summary.pastMissDates
              .slice(-3)
              .map((d) => d.slice(5))
              .join("、");
            const todayTip = summary.todayNeedsReport ? "，今日尚未填报" : "";
            toast.warning(
              `本月报工提醒：截至昨日有 ${pastCnt} 个工作日缺报/不足（如 ${recentPreview}）${todayTip}`,
              { duration: 9000, action: openAction },
            );
          } else if (summary.todayNeedsReport) {
            toast.info(
              `本月历史工作日已达标（累计 ${summary.totalReportedHours.toFixed(1)}h），今日记得填报工时`,
              { duration: 6000, action: openAction },
            );
          } else {
            toast.success(
              `本月工时已全部达标 ✅（累计 ${summary.totalReportedHours.toFixed(1)}h）`,
              { duration: 4500, action: openAction },
            );
          }
        }
        return summary;
      } catch (e) {
        set({ checking: false, error: String(e) });
        return null;
      } finally {
        inFlightMonthlyPromise = null;
      }
    })();

    inFlightMonthlyPromise = runner;
    return runner;
  },

  setSummaryFromCheck: (payload) => {
    const today = todayYmd();
    const { start: monthStart } = monthRangeYmd();
    if (payload.startDate !== monthStart || payload.endDate > today) {
      // Only update current-month summary cache when query covers monthStart..today (or full month)
      if (payload.startDate.slice(0, 7) !== today.slice(0, 7)) return;
    }
    const summary = buildMonthlySummary(payload);
    set({
      checkedKey: `${payload.targetErp || payload.targetName}@${today}`,
      checking: false,
      summary,
      error: null,
    });
  },

  resetMonthlyMiss: () => {
    inFlightMonthlyPromise = null;
    set({ checkedKey: null, checking: false, summary: null, error: null });
  },
}));
