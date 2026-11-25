import type { RepeatRule } from "./types";

export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayYmd(): string {
  return formatYmd(new Date());
}

export function isValidYmd(ymd: string | null | undefined): ymd is string {
  return typeof ymd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ymd);
}

export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return formatYmd(dt);
}

export function diffDaysYmd(targetYmd: string, baseYmd = todayYmd()): number {
  if (!isValidYmd(targetYmd) || !isValidYmd(baseYmd)) return 0;
  return Math.round((parseYmdUtcMs(targetYmd) - parseYmdUtcMs(baseYmd)) / 86_400_000);
}

export function weekRangeYmd(ref = new Date()): { start: string; end: string } {
  const dow = ref.getDay(); // 0=Sun..6=Sat
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + diffToMon);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return { start: formatYmd(mon), end: formatYmd(sun) };
}

export function monthRangeYmd(ref = new Date()): { start: string; end: string } {
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return { start: formatYmd(first), end: formatYmd(last) };
}

export function msToYmd(ms: number | null | undefined): string {
  if (!ms) return "";
  return formatYmd(new Date(ms));
}

export function formatWeekdayZh(
  ymd: string,
  style: "short" | "long" = "short",
): string {
  if (!isValidYmd(ymd)) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const names =
    style === "long"
      ? ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
      : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return names[dt.getDay()] ?? "";
}

/** ISO week-of-year (1..53). */
export function getWeekOfYear(ymd: string): number {
  if (!isValidYmd(ymd)) return 1;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Greeting suited to the current time of day. */
export function getGreetingZh(date = new Date()): string {
  const h = date.getHours();
  if (h < 6) return "凌晨好";
  if (h < 9) return "早安";
  if (h < 12) return "上午好";
  if (h < 14) return "午安";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** This week's Friday (or next week's Friday if today is weekend/Friday evening check). */
export function getThisFridayYmd(refYmd = todayYmd()): string {
  const [y, m, d] = refYmd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0=Sun..6=Sat
  const delta = dow <= 5 && dow >= 1 ? 5 - dow : dow === 6 ? 6 : 5;
  return addDaysYmd(refYmd, delta);
}

/** Next week's Monday from a reference YYYY-MM-DD. */
export function getNextMondayYmd(refYmd = todayYmd()): string {
  return nextMondayYmd(refYmd);
}

/**
 * Human-friendly Chinese date formatter.
 * Automatically prepends `YYYY年` when year differs from current year or `includeYear` is true.
 */
export function formatDateZh(
  ymd: string | null | undefined,
  opts?: {
    includeYear?: boolean;
    showWeekday?: boolean;
    weekdayStyle?: "short" | "long";
  },
): string {
  const raw = (ymd ?? "").trim();
  if (!isValidYmd(raw)) return raw;
  const [y, m, d] = raw.split("-").map(Number);
  const curYear = new Date().getFullYear();
  const needYear = opts?.includeYear || y !== curYear;
  const datePart = needYear ? `${y}年${m}月${d}日` : `${m}月${d}日`;
  if (!opts?.showWeekday) return datePart;
  const wk = formatWeekdayZh(raw, opts.weekdayStyle ?? "short");
  return wk ? `${datePart} ${wk}` : datePart;
}

/** Format `YYYY-MM` into `YYYY年M月`. */
export function formatMonthZh(ym: string | null | undefined): string {
  if (!ym) return "";
  const match = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!match) return ym;
  return `${Number(match[1])}年${Number(match[2])}月`;
}

/** Concise Chinese date range, e.g. `11月23日 – 29日` or `11月28日 – 12月4日`. */
export function formatDateRangeZh(startYmd: string, endYmd: string): string {
  if (!isValidYmd(startYmd) && !isValidYmd(endYmd)) return "";
  if (!isValidYmd(endYmd)) return formatDateZh(startYmd, { showWeekday: true });
  if (!isValidYmd(startYmd)) return formatDateZh(endYmd, { showWeekday: true });
  if (startYmd === endYmd) return formatDateZh(startYmd, { showWeekday: true });

  const [sy, sm, sd] = startYmd.split("-").map(Number);
  const [ey, em, ed] = endYmd.split("-").map(Number);
  const curYear = new Date().getFullYear();
  const showYear = sy !== curYear || ey !== curYear;

  if (sy === ey && sm === em) {
    const prefix = showYear ? `${sy}年${sm}月` : `${sm}月`;
    return `${prefix}${sd}日 – ${ed}日`;
  }
  if (sy === ey) {
    const yPrefix = showYear ? `${sy}年` : "";
    return `${yPrefix}${sm}月${sd}日 – ${em}月${ed}日`;
  }
  return `${sy}年${sm}月${sd}日 – ${ey}年${em}月${ed}日`;
}

/** Format ISO / `YYYY-MM-DD HH:mm:ss` timestamp into `今天 02:15` / `11月20日 09:10`. */
export function formatIsoTimeZh(isoOrStr: string | null | undefined): string {
  if (!isoOrStr) return "";
  const clean = isoOrStr.trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/.exec(clean);
  if (!m) return clean;
  const ymd = m[1];
  const hhmm = m[2];
  const diff = diffDaysYmd(ymd, todayYmd());
  let dayLabel: string;
  if (diff === 0) dayLabel = "今天";
  else if (diff === -1) dayLabel = "昨天";
  else if (diff === 1) dayLabel = "明天";
  else dayLabel = formatDateZh(ymd);
  return hhmm ? `${dayLabel} ${hhmm}` : dayLabel;
}

export type RelativeDateTone =
  | "overdue"
  | "today"
  | "tomorrow"
  | "soon"
  | "future"
  | "done"
  | "empty";

export interface RelativeDateMeta {
  raw: string;
  valid: boolean;
  diffDays: number;
  label: string;
  shortLabel: string;
  weekday: string;
  fullZh: string;
  tone: RelativeDateTone;
}

export function getRelativeDateMeta(
  ymd: string | null | undefined,
  opts?: { done?: boolean; today?: string },
): RelativeDateMeta {
  if (!isValidYmd(ymd)) {
    return {
      raw: ymd ?? "",
      valid: false,
      diffDays: 0,
      label: "收集箱",
      shortLabel: "无日期",
      weekday: "",
      fullZh: "未设置日期（收集箱）",
      tone: "empty",
    };
  }
  const ref = opts?.today ?? todayYmd();
  const diff = diffDaysYmd(ymd, ref);
  const weekday = formatWeekdayZh(ymd, "short");
  const fullZh = formatDateZh(ymd, {
    includeYear: true,
    showWeekday: true,
    weekdayStyle: "long",
  });
  const baseDate = formatDateZh(ymd);

  if (opts?.done) {
    return {
      raw: ymd,
      valid: true,
      diffDays: diff,
      label: baseDate,
      shortLabel: baseDate,
      weekday,
      fullZh,
      tone: "done",
    };
  }

  if (diff < 0) {
    const days = Math.abs(diff);
    return {
      raw: ymd,
      valid: true,
      diffDays: diff,
      label: diff === -1 ? "昨天 · 逾期 1 天" : `${baseDate} · 已逾期 ${days} 天`,
      shortLabel: diff === -1 ? "逾期 1 天" : `逾期 ${days} 天`,
      weekday,
      fullZh,
      tone: "overdue",
    };
  }
  if (diff === 0) {
    return {
      raw: ymd,
      valid: true,
      diffDays: 0,
      label: `今天`,
      shortLabel: "今天",
      weekday,
      fullZh,
      tone: "today",
    };
  }
  if (diff === 1) {
    return {
      raw: ymd,
      valid: true,
      diffDays: 1,
      label: "明天",
      shortLabel: "明天",
      weekday,
      fullZh,
      tone: "tomorrow",
    };
  }
  if (diff === 2) {
    return {
      raw: ymd,
      valid: true,
      diffDays: 2,
      label: `后天`,
      shortLabel: "后天",
      weekday,
      fullZh,
      tone: "soon",
    };
  }
  if (diff <= 7) {
    return {
      raw: ymd,
      valid: true,
      diffDays: diff,
      label: `${baseDate} · ${diff} 天后`,
      shortLabel: `${diff} 天后`,
      weekday,
      fullZh,
      tone: "soon",
    };
  }

  return {
    raw: ymd,
    valid: true,
    diffDays: diff,
    label: baseDate,
    shortLabel: baseDate,
    weekday,
    fullZh,
    tone: "future",
  };
}

function resolveWeekdayOffset(targetDow: number, refYmd: string): string {
  const [y, m, d] = refYmd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const curDow = dt.getDay(); // 0=Sun..6=Sat
  const delta = (targetDow - curDow + 7) % 7;
  return addDaysYmd(refYmd, delta);
}

function nextMondayYmd(refYmd: string): string {
  const [y, m, d] = refYmd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const diffToCurMon = dow === 0 ? -6 : 1 - dow;
  return addDaysYmd(refYmd, diffToCurMon + 7);
}

/** Parse quick todo syntax: `标题 明天 @09:30 !1 #标签 /每天` */
export function parseQuickTodo(raw: string): {
  title: string;
  date: string | null;
  time: string | null;
  priority: 1 | 2 | 3;
  tags: string[];
  repeat: RepeatRule;
} {
  let date: string | null = null;
  let time: string | null = null;
  let priority: 1 | 2 | 3 = 2;
  let repeat: RepeatRule = "none";
  const tagSet = new Set<string>();
  const refToday = todayYmd();

  const weekdayMap: Record<string, number> = {
    周日: 0,
    周一: 1,
    周二: 2,
    周三: 3,
    周四: 4,
    周五: 5,
    周六: 6,
  };

  let cleaned = raw
    .replace(/@(\d{4}-\d{2}-\d{2})/g, (_, dStr: string) => {
      date = dStr;
      return "";
    })
    .replace(/@(\d{1,2}:\d{2})/g, (_, t: string) => {
      const [h, m] = t.split(":");
      time = `${h.padStart(2, "0")}:${m}`;
      return "";
    })
    .replace(/!([123])/g, (_, p: string) => {
      priority = Number(p) as 1 | 2 | 3;
      return "";
    })
    .replace(/\/(每天|每日|工作日|每周|每月)/g, (_, r: string) => {
      if (r === "每天" || r === "每日") repeat = "daily";
      else if (r === "工作日") repeat = "workdays";
      else if (r === "每周") repeat = "weekly";
      else if (r === "每月") repeat = "monthly";
      return "";
    })
    .replace(/#([^\s@#!/]+)/g, (_, tag: string) => {
      if (tag.trim()) tagSet.add(tag.trim());
      return "";
    });

  cleaned = cleaned.replace(
    /(^|\s)@?(今天|明天|后天|下周一|周一|周二|周三|周四|周五|周六|周日)(?=\s|$)/g,
    (full, lead: string, token: string) => {
      if (token === "今天") date = refToday;
      else if (token === "明天") date = addDaysYmd(refToday, 1);
      else if (token === "后天") date = addDaysYmd(refToday, 2);
      else if (token === "下周一") date = nextMondayYmd(refToday);
      else if (token in weekdayMap) date = resolveWeekdayOffset(weekdayMap[token], refToday);
      else return full;
      return lead;
    },
  );

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return {
    title: cleaned,
    date,
    time,
    priority,
    tags: Array.from(tagSet),
    repeat,
  };
}

function parseYmdUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function makeClampedYmd(year: number, month: number, day: number): string {
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const d = Math.min(day, maxDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysUntilCountdown(
  targetDate: string,
  annual: boolean,
  today = todayYmd(),
): { days: number; nextDate: string } {
  if (!targetDate) return { days: 0, nextDate: today };
  const todayMs = parseYmdUtcMs(today);
  if (!annual) {
    const targetMs = parseYmdUtcMs(targetDate);
    return {
      days: Math.round((targetMs - todayMs) / 86_400_000),
      nextDate: targetDate,
    };
  }
  const [ty] = today.split("-").map(Number);
  const [, tm, td] = targetDate.split("-").map(Number);
  let cand = makeClampedYmd(ty, tm, td);
  if (cand < today) {
    cand = makeClampedYmd(ty + 1, tm, td);
  }
  const nextMs = parseYmdUtcMs(cand);
  return {
    days: Math.round((nextMs - todayMs) / 86_400_000),
    nextDate: cand,
  };
}

export function calcHabitStreak(checkins: string[], today = todayYmd()): number {
  const set = new Set(checkins);
  let cur = set.has(today) ? today : addDaysYmd(today, -1);
  if (!set.has(cur)) return 0;
  let streak = 0;
  while (set.has(cur)) {
    streak += 1;
    cur = addDaysYmd(cur, -1);
  }
  return streak;
}

export function lastNDaysYmd(n: number, refToday = todayYmd()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(addDaysYmd(refToday, -i));
  }
  return out;
}
