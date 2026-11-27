import { toast } from "sonner";
import { create } from "zustand";
import { wtCall } from "../lib/api";
import { monthRangeYmd, todayYmd, weekRangeYmd } from "../lib/date";
import type { LogEntry, WhoamiResult } from "../lib/types";
import { getConst } from "../lib/wtx";

const MAX_LOGS = 800;
const FLUSH_INTERVAL_MS = 100;
const BREAK_REMINDER_STORAGE_KEY = "lw.breakReminderMins";
const BREAK_CONFIG_STORAGE_KEY = "lw.breakLockConfig.v1";
const BREAK_COMPLETED_STORAGE_KEY = "lw.breakCompletedToday.v1";

export type BreakReminderMins = number;

export interface BreakLockConfig {
  breakReminderMins: number;
  breakDurationMins: number;
  breakLockEnabled: boolean;
  breakStrictMode: boolean;
}

const DEFAULT_BREAK_CONFIG: BreakLockConfig = {
  breakReminderMins: 45,
  breakDurationMins: 5,
  breakLockEnabled: true,
  breakStrictMode: true,
};

function clampReminderMins(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.max(1, Math.min(240, Math.round(v)));
}

function clampDurationMins(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 5;
  return Math.max(1, Math.min(30, Math.round(v)));
}

function loadBreakConfig(): BreakLockConfig {
  try {
    const raw = window.localStorage.getItem(BREAK_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BreakLockConfig>;
      return {
        breakReminderMins:
          typeof parsed.breakReminderMins === "number"
            ? clampReminderMins(parsed.breakReminderMins)
            : DEFAULT_BREAK_CONFIG.breakReminderMins,
        breakDurationMins:
          typeof parsed.breakDurationMins === "number"
            ? clampDurationMins(parsed.breakDurationMins)
            : DEFAULT_BREAK_CONFIG.breakDurationMins,
        breakLockEnabled:
          typeof parsed.breakLockEnabled === "boolean"
            ? parsed.breakLockEnabled
            : DEFAULT_BREAK_CONFIG.breakLockEnabled,
        breakStrictMode:
          typeof parsed.breakStrictMode === "boolean"
            ? parsed.breakStrictMode
            : DEFAULT_BREAK_CONFIG.breakStrictMode,
      };
    }
    const legacyRaw = Number(window.localStorage.getItem(BREAK_REMINDER_STORAGE_KEY) || "0");
    if (legacyRaw > 0) {
      return {
        ...DEFAULT_BREAK_CONFIG,
        breakReminderMins: clampReminderMins(legacyRaw),
      };
    }
  } catch {
    // Ignore storage errors
  }
  return { ...DEFAULT_BREAK_CONFIG };
}

function saveBreakConfig(cfg: BreakLockConfig) {
  try {
    window.localStorage.setItem(BREAK_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
    window.localStorage.setItem(BREAK_REMINDER_STORAGE_KEY, String(cfg.breakReminderMins));
  } catch {
    // Ignore storage errors
  }
}

function loadBreakCompletedToday(): number {
  try {
    const raw = window.localStorage.getItem(BREAK_COMPLETED_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date?: string; count?: number };
    if (parsed.date === todayYmd() && typeof parsed.count === "number" && parsed.count >= 0) {
      return Math.floor(parsed.count);
    }
  } catch {
    // Ignore storage errors
  }
  return 0;
}

function nowTimeStr(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function saveBreakCompletedToday(count: number) {
  try {
    window.localStorage.setItem(
      BREAK_COMPLETED_STORAGE_KEY,
      JSON.stringify({ date: todayYmd(), count }),
    );
  } catch {
    // Ignore storage errors
  }
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
  breakDurationMins: number;
  breakLockEnabled: boolean;
  breakStrictMode: boolean;
  breakNextDueAt: number | null;
  breakPaused: boolean;
  breakPausedRemainMs: number;
  breakActive: boolean;
  breakSecondsLeft: number;
  breakTotalSeconds: number;
  breakCompletedToday: number;

  startFocus: (todoId: string | null, title: string, minutes?: number) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  stopFocus: () => void;
  tickFocus: () => boolean;
  setBreakReminderMins: (mins: BreakReminderMins) => void;
  setBreakConfig: (patch: Partial<BreakLockConfig>) => void;
  toggleBreakPaused: () => void;
  resetBreakTimer: () => void;
  triggerBreakNow: (customSeconds?: number) => void;
  snoozeBreak: (mins?: number) => void;
  finishBreak: (completed: boolean) => void;
  tickBreak: () => boolean;
}

const initBreakCfg: BreakLockConfig =
  typeof window !== "undefined" ? loadBreakConfig() : { ...DEFAULT_BREAK_CONFIG };
const initCompletedToday =
  typeof window !== "undefined" ? loadBreakCompletedToday() : 0;

export const useFocusStore = create<FocusState>((set, get) => ({
  focusTodoId: null,
  focusTitle: "",
  focusSecondsLeft: 0,
  focusTotalSeconds: 1500,
  focusRunning: false,
  breakReminderMins: initBreakCfg.breakReminderMins,
  breakDurationMins: initBreakCfg.breakDurationMins,
  breakLockEnabled: initBreakCfg.breakLockEnabled,
  breakStrictMode: initBreakCfg.breakStrictMode,
  breakNextDueAt:
    initBreakCfg.breakReminderMins > 0
      ? Date.now() + initBreakCfg.breakReminderMins * 60_000
      : null,
  breakPaused: false,
  breakPausedRemainMs: 0,
  breakActive: false,
  breakSecondsLeft: 0,
  breakTotalSeconds: initBreakCfg.breakDurationMins * 60,
  breakCompletedToday: initCompletedToday,

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
    get().setBreakConfig({ breakReminderMins: mins });
  },

  setBreakConfig: (patch) => {
    const s = get();
    const next: BreakLockConfig = {
      breakReminderMins:
        patch.breakReminderMins !== undefined
          ? clampReminderMins(patch.breakReminderMins)
          : s.breakReminderMins,
      breakDurationMins:
        patch.breakDurationMins !== undefined
          ? clampDurationMins(patch.breakDurationMins)
          : s.breakDurationMins,
      breakLockEnabled:
        patch.breakLockEnabled !== undefined ? patch.breakLockEnabled : s.breakLockEnabled,
      breakStrictMode:
        patch.breakStrictMode !== undefined ? patch.breakStrictMode : s.breakStrictMode,
    };
    saveBreakConfig(next);
    const intervalChanged = next.breakReminderMins !== s.breakReminderMins;
    set({
      ...next,
      ...(intervalChanged
        ? {
            breakNextDueAt:
              next.breakReminderMins > 0
                ? Date.now() + next.breakReminderMins * 60_000
                : null,
            breakPaused: false,
            breakPausedRemainMs: 0,
          }
        : {}),
    });
  },

  toggleBreakPaused: () => {
    const s = get();
    if (s.breakReminderMins <= 0) return;
    if (s.breakPaused) {
      const remain =
        s.breakPausedRemainMs > 0
          ? s.breakPausedRemainMs
          : s.breakReminderMins * 60_000;
      set({
        breakPaused: false,
        breakPausedRemainMs: 0,
        breakNextDueAt: Date.now() + remain,
      });
    } else {
      const remain = s.breakNextDueAt
        ? Math.max(0, s.breakNextDueAt - Date.now())
        : s.breakReminderMins * 60_000;
      set({
        breakPaused: true,
        breakPausedRemainMs: remain,
      });
    }
  },

  resetBreakTimer: () => {
    const s = get();
    set({
      breakPaused: false,
      breakPausedRemainMs: 0,
      breakNextDueAt:
        s.breakReminderMins > 0 ? Date.now() + s.breakReminderMins * 60_000 : null,
    });
  },

  triggerBreakNow: (customSeconds) => {
    const s = get();
    const total =
      typeof customSeconds === "number" && customSeconds > 0
        ? Math.round(customSeconds)
        : clampDurationMins(s.breakDurationMins) * 60;
    set({
      breakActive: true,
      breakSecondsLeft: total,
      breakTotalSeconds: total,
    });
  },

  snoozeBreak: (mins = 5) => {
    const safeMins = Math.max(1, Math.min(60, Math.round(mins)));
    set({
      breakActive: false,
      breakSecondsLeft: 0,
      breakPaused: false,
      breakPausedRemainMs: 0,
      breakNextDueAt: Date.now() + safeMins * 60_000,
    });
  },

  finishBreak: (completed) => {
    const s = get();
    let nextCompleted = s.breakCompletedToday;
    if (completed) {
      nextCompleted += 1;
      saveBreakCompletedToday(nextCompleted);
    }
    set({
      breakActive: false,
      breakSecondsLeft: 0,
      breakPaused: false,
      breakPausedRemainMs: 0,
      breakCompletedToday: nextCompleted,
      breakNextDueAt:
        s.breakReminderMins > 0 ? Date.now() + s.breakReminderMins * 60_000 : null,
    });
  },

  tickBreak: () => {
    const s = get();
    if (!s.breakActive || s.breakSecondsLeft <= 0) return false;
    const next = s.breakSecondsLeft - 1;
    set({ breakSecondsLeft: next });
    return next === 0;
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

export interface WorkCheckRowCache {
  card_id: number;
  sprint: string;
  code: string;
  name: string;
  declared: number;
  required: number;
  gap: number;
  [k: string]: unknown;
}

export interface DeclarePlanRowCache {
  declare_date_ms?: number;
  card_id: number | string;
  date: string;
  task_id?: number | string;
  hours: number;
  desc: string;
  status?: string;
  task_name?: string;
  exec_status?: string;
  [k: string]: unknown;
}

export interface TeamMemberStatCache {
  name: string;
  total: number;
  target: number;
  achieve: number;
  gap: number;
  sprints?: Record<string, number>;
}

export interface TeamWorkTimeResultCache {
  org: string;
  members: TeamMemberStatCache[];
  sprints: string[];
}

export type TeamSortKey = "name" | "total" | "target" | "achieve" | "gap";

export interface WorkReportQueryCache {
  startDate: string;
  endDate: string;
  roleName: string;
  checkRows: WorkCheckRowCache[];
  selectedIds: number[];
  queriedAt: string | null;
  queriedAtMs: number | null;
  queriedRange: string;
  planMode: "dynamic" | "fixed";
  fixedHours: string;
  planStart: string;
  planEnd: string;
  planRows: DeclarePlanRowCache[];
  planGeneratedAt: string | null;
}

export interface WorkTeamQueryCache {
  nameFilter: string;
  sortKey: TeamSortKey;
  sortAsc: boolean;
  result: TeamWorkTimeResultCache | null;
  queriedAt: string | null;
  queriedAtMs: number | null;
}

export interface WorkFlowQueryCache {
  codeInput: string;
  summary: Record<string, unknown> | null;
  cardChecklist: Record<string, unknown[]>;
  selectedStages: string[];
  planDate: string;
  uploadedAttachments: Record<string, unknown>;
  queriedAt: string | null;
  queriedAtMs: number | null;
}

export interface WorkMissQueryCache {
  startDate: string;
  endDate: string;
  singleResult: Record<string, unknown> | null;
  batchResults: unknown[];
  queriedAt: string | null;
  queriedAtMs: number | null;
}

interface WorkQueryCacheState {
  ownerKey: string | null;
  report: WorkReportQueryCache;
  team: WorkTeamQueryCache;
  flow: WorkFlowQueryCache;
  miss: WorkMissQueryCache;
  syncOwner: (ownerKey: string | null) => void;
  patchReport: (
    patch:
      | Partial<WorkReportQueryCache>
      | ((prev: WorkReportQueryCache) => Partial<WorkReportQueryCache>),
  ) => void;
  clearReportData: () => void;
  patchTeam: (
    patch:
      | Partial<WorkTeamQueryCache>
      | ((prev: WorkTeamQueryCache) => Partial<WorkTeamQueryCache>),
  ) => void;
  clearTeamData: () => void;
  patchFlow: (
    patch:
      | Partial<WorkFlowQueryCache>
      | ((prev: WorkFlowQueryCache) => Partial<WorkFlowQueryCache>),
  ) => void;
  clearFlowData: () => void;
  patchMiss: (
    patch:
      | Partial<WorkMissQueryCache>
      | ((prev: WorkMissQueryCache) => Partial<WorkMissQueryCache>),
  ) => void;
  clearMissData: () => void;
}

function createDefaultReportCache(): WorkReportQueryCache {
  const month = monthRangeYmd();
  const week = weekRangeYmd();
  return {
    startDate: month.start,
    endDate: month.end,
    roleName: "",
    checkRows: [],
    selectedIds: [],
    queriedAt: null,
    queriedAtMs: null,
    queriedRange: "",
    planMode: "dynamic",
    fixedHours: "8.0",
    planStart: week.start,
    planEnd: week.end,
    planRows: [],
    planGeneratedAt: null,
  };
}

function createDefaultTeamCache(): WorkTeamQueryCache {
  return {
    nameFilter: "",
    sortKey: "achieve",
    sortAsc: false,
    result: null,
    queriedAt: null,
    queriedAtMs: null,
  };
}

function createDefaultFlowCache(): WorkFlowQueryCache {
  return {
    codeInput: "",
    summary: null,
    cardChecklist: {},
    selectedStages: ["review", "design", "dev", "test"],
    planDate: "",
    uploadedAttachments: {},
    queriedAt: null,
    queriedAtMs: null,
  };
}

function createDefaultMissCache(): WorkMissQueryCache {
  const month = monthRangeYmd();
  return {
    startDate: month.start,
    endDate: todayYmd(),
    singleResult: null,
    batchResults: [],
    queriedAt: null,
    queriedAtMs: null,
  };
}

export const useWorkQueryCacheStore = create<WorkQueryCacheState>((set, get) => ({
  ownerKey: null,
  report: createDefaultReportCache(),
  team: createDefaultTeamCache(),
  flow: createDefaultFlowCache(),
  miss: createDefaultMissCache(),

  syncOwner: (nextOwnerKey) => {
    const prevOwner = get().ownerKey;
    if (nextOwnerKey === null) {
      if (
        prevOwner !== null ||
        get().report.queriedAt ||
        get().team.queriedAt ||
        get().flow.queriedAt ||
        get().miss.queriedAt
      ) {
        set({
          ownerKey: null,
          report: createDefaultReportCache(),
          team: createDefaultTeamCache(),
          flow: createDefaultFlowCache(),
          miss: createDefaultMissCache(),
        });
      }
      return;
    }
    if (prevOwner !== null && prevOwner !== nextOwnerKey) {
      set({
        ownerKey: nextOwnerKey,
        report: createDefaultReportCache(),
        team: createDefaultTeamCache(),
        flow: createDefaultFlowCache(),
        miss: createDefaultMissCache(),
      });
      return;
    }
    if (prevOwner === null) {
      set({ ownerKey: nextOwnerKey });
    }
  },

  patchReport: (patch) =>
    set((state) => {
      const nextPatch = typeof patch === "function" ? patch(state.report) : patch;
      return { report: { ...state.report, ...nextPatch } };
    }),

  clearReportData: () =>
    set((state) => ({
      report: {
        ...state.report,
        checkRows: [],
        selectedIds: [],
        queriedAt: null,
        queriedAtMs: null,
        queriedRange: "",
        planRows: [],
        planGeneratedAt: null,
      },
    })),

  patchTeam: (patch) =>
    set((state) => {
      const nextPatch = typeof patch === "function" ? patch(state.team) : patch;
      return { team: { ...state.team, ...nextPatch } };
    }),

  clearTeamData: () =>
    set((state) => ({
      team: {
        ...state.team,
        result: null,
        queriedAt: null,
        queriedAtMs: null,
      },
    })),

  patchFlow: (patch) =>
    set((state) => {
      const nextPatch = typeof patch === "function" ? patch(state.flow) : patch;
      return { flow: { ...state.flow, ...nextPatch } };
    }),

  clearFlowData: () =>
    set((state) => ({
      flow: {
        ...createDefaultFlowCache(),
        codeInput: state.flow.codeInput,
      },
    })),

  patchMiss: (patch) =>
    set((state) => {
      const nextPatch = typeof patch === "function" ? patch(state.miss) : patch;
      return { miss: { ...state.miss, ...nextPatch } };
    }),

  clearMissData: () =>
    set((state) => ({
      miss: {
        ...createDefaultMissCache(),
        startDate: state.miss.startDate,
        endDate: state.miss.endDate,
      },
    })),
}));
