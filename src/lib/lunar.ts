import { addDaysYmd, formatWeekdayZh, getWeekOfYear, isValidYmd } from "./date";

const HEAVENLY_STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"] as const;
const EARTHLY_BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;
const ZODIAC_NAMES = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"] as const;
const ZODIAC_EMOJIS = ["🐭", "🐮", "🐯", "🐰", "🐲", "🐍", "🐴", "🐑", "🐵", "🐔", "🐶", "🐷"] as const;

const LUNAR_DAY_NAMES = [
  "",
  "初一",
  "初二",
  "初三",
  "初四",
  "初五",
  "初六",
  "初七",
  "初八",
  "初九",
  "初十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
  "廿一",
  "廿二",
  "廿三",
  "廿四",
  "廿五",
  "廿六",
  "廿七",
  "廿八",
  "廿九",
  "三十",
] as const;

const SOLAR_TERMS = [
  "小寒",
  "大寒",
  "立春",
  "雨水",
  "惊蛰",
  "春分",
  "清明",
  "谷雨",
  "立夏",
  "小满",
  "芒种",
  "夏至",
  "小暑",
  "大暑",
  "立秋",
  "处暑",
  "白露",
  "秋分",
  "寒露",
  "霜降",
  "立冬",
  "小雪",
  "大雪",
  "冬至",
] as const;

// 21st-century (2000-2099) solar term C constants in Gregorian month order (2 per month)
const SOLAR_TERM_C_21C = [
  5.4055, 20.12, 3.87, 18.73, 5.63, 20.646, 4.81, 20.1,
  5.52, 21.04, 5.678, 21.37, 7.108, 22.83, 7.5, 23.13,
  7.646, 23.042, 8.318, 23.438, 7.438, 22.36, 7.18, 21.94,
] as const;

// 20th-century (1900-1999) solar term C constants
const SOLAR_TERM_C_20C = [
  6.11, 20.84, 4.6295, 19.4599, 6.3826, 21.4155, 5.59, 20.888,
  6.318, 21.86, 6.5, 22.2, 7.928, 23.65, 8.35, 23.95,
  8.44, 23.822, 9.098, 24.218, 8.218, 23.08, 7.9, 22.6,
] as const;

const SOLAR_TERM_DELTAS: Record<string, number> = {
  "2019-0": -1,
  "2026-3": -1,
  "2084-5": 1,
  "2008-9": 1,
  "2002-14": 1,
  "2089-19": 1,
  "2089-20": 1,
  "2021-23": -1,
};

const LUNAR_FESTIVALS: Record<string, string> = {
  "正月初一": "春节",
  "正月十五": "元宵",
  "二月初二": "龙抬头",
  "五月初五": "端午",
  "七月初七": "七夕",
  "七月十五": "中元",
  "八月十五": "中秋",
  "九月初九": "重阳",
  "腊月初八": "腊八",
  "腊月廿三": "北小年",
  "腊月廿四": "南小年",
};

const chineseCalendarFmt = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

interface RawLunarParts {
  lunarYear: number;
  ganZhiYear: string;
  zodiac: string;
  zodiacEmoji: string;
  zodiacLabel: string;
  lunarMonthName: string;
  lunarDayNum: number;
  lunarDayName: string;
  lunarDateText: string;
}

export interface LunarAlmanacInfo {
  ymd: string;
  year: number;
  month: number;
  day: number;
  gregorianFull: string;
  weekdayShort: string;
  weekdayLong: string;
  lunarYear: number;
  ganZhiYear: string;
  zodiac: string;
  zodiacEmoji: string;
  zodiacLabel: string;
  lunarMonthName: string;
  lunarDayNum: number;
  lunarDayName: string;
  lunarDateText: string;
  lunarFullText: string;
  lunarFestival: string | null;
  solarTerm: string | null;
  nextSolarTerm: { name: string; date: string; daysAway: number };
  cellSubLabel: string;
  cellSubTone: "festival" | "term" | "month" | "day";
  quarter: 1 | 2 | 3 | 4;
  weekOfYear: number;
  dayOfYear: number;
  daysInYear: number;
  yearProgressPct: number;
  daysUntilWeekend: number;
  daysLeftInMonth: number;
}

const rawLunarCache = new Map<string, RawLunarParts>();
const almanacCache = new Map<string, LunarAlmanacInfo>();
const MAX_CACHE_ENTRIES = 1500;

function trimCache<T>(cache: Map<string, T>) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

function normalizeLunarMonthName(rawMonth: string): string {
  const isLeap = rawMonth.startsWith("闰");
  const base = isLeap ? rawMonth.slice(1) : rawMonth;
  let normalized = base;
  if (base === "一月") normalized = "正月";
  else if (base === "十二月") normalized = "腊月";
  return isLeap ? `闰${normalized}` : normalized;
}

function getRawLunarParts(ymd: string): RawLunarParts {
  const cached = rawLunarCache.get(ymd);
  if (cached) return cached;

  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  const parts = chineseCalendarFmt.formatToParts(dt);

  let relatedYear = y;
  let yearName = "";
  let rawMonth = "";
  let rawDay = 1;

  for (const p of parts) {
    const pType = p.type as string;
    if (pType === "relatedYear") {
      const n = Number(p.value);
      if (Number.isFinite(n)) relatedYear = n;
    } else if (pType === "yearName") {
      yearName = p.value;
    } else if (pType === "month") {
      rawMonth = p.value;
    } else if (pType === "day") {
      const n = Number(p.value);
      if (Number.isFinite(n) && n >= 1 && n <= 30) rawDay = n;
    }
  }

  const offset = (((relatedYear - 4) % 60) + 60) % 60;
  const stem = HEAVENLY_STEMS[offset % 10] ?? "甲";
  const branch = EARTHLY_BRANCHES[offset % 12] ?? "子";
  const ganZhiYear = yearName || `${stem}${branch}`;
  const zodiacIdx = offset % 12;
  const zodiac = ZODIAC_NAMES[zodiacIdx] ?? "鼠";
  const zodiacEmoji = ZODIAC_EMOJIS[zodiacIdx] ?? "🐭";
  const zodiacLabel = `${ganZhiYear}${zodiac}年`;

  const lunarMonthName = normalizeLunarMonthName(rawMonth || "正月");
  const lunarDayName = LUNAR_DAY_NAMES[rawDay] ?? `${rawDay}日`;
  const lunarDateText = `${lunarMonthName}${lunarDayName}`;

  const result: RawLunarParts = {
    lunarYear: relatedYear,
    ganZhiYear,
    zodiac,
    zodiacEmoji,
    zodiacLabel,
    lunarMonthName,
    lunarDayNum: rawDay,
    lunarDayName,
    lunarDateText,
  };

  trimCache(rawLunarCache);
  rawLunarCache.set(ymd, result);
  return result;
}

function calcSolarTermDay(year: number, termIdx: number): number | null {
  if (year < 1900 || year > 2099 || termIdx < 0 || termIdx >= 24) return null;
  const is21c = year >= 2000;
  const yy = year % 100;
  const c = is21c ? SOLAR_TERM_C_21C[termIdx] : SOLAR_TERM_C_20C[termIdx];
  const leap = termIdx <= 3 ? Math.floor((yy - 1) / 4) : Math.floor(yy / 4);
  const delta = SOLAR_TERM_DELTAS[`${year}-${termIdx}`] ?? 0;
  return Math.floor(yy * 0.2422 + c) - leap + delta;
}

export function getSolarTermOnDate(ymd: string): string | null {
  if (!isValidYmd(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const baseIdx = (m - 1) * 2;
  for (const offset of [0, 1]) {
    const idx = baseIdx + offset;
    const termDay = calcSolarTermDay(y, idx);
    if (termDay === d) return SOLAR_TERMS[idx] ?? null;
  }
  return null;
}

export function getNextSolarTerm(ymd: string): { name: string; date: string; daysAway: number } {
  const [y, m] = ymd.split("-").map(Number);
  const candidates: Array<{ name: string; date: string }> = [];

  for (const yr of [y, y + 1]) {
    const startMonth = yr === y ? m : 1;
    for (let mo = startMonth; mo <= 12; mo += 1) {
      const baseIdx = (mo - 1) * 2;
      for (const offset of [0, 1]) {
        const idx = baseIdx + offset;
        const day = calcSolarTermDay(yr, idx);
        if (day !== null) {
          const date = `${yr}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          if (date > ymd) {
            candidates.push({ name: SOLAR_TERMS[idx], date });
          }
        }
      }
    }
    if (candidates.length > 0) break;
  }

  const next = candidates[0] ?? { name: "立春", date: `${y + 1}-02-04` };
  const [ny, nm, nd] = next.date.split("-").map(Number);
  const [cy, cm, cd] = ymd.split("-").map(Number);
  const daysAway = Math.round(
    (Date.UTC(ny, nm - 1, nd) - Date.UTC(cy, cm - 1, cd)) / 86_400_000,
  );
  return { name: next.name, date: next.date, daysAway: Math.max(1, daysAway) };
}

function getLunarFestival(ymd: string, raw: RawLunarParts): string | null {
  const hit = LUNAR_FESTIVALS[raw.lunarDateText];
  if (hit) return hit;
  if (raw.lunarMonthName === "腊月" && raw.lunarDayNum >= 29) {
    const tomorrow = addDaysYmd(ymd, 1);
    const tomorrowRaw = getRawLunarParts(tomorrow);
    if (tomorrowRaw.lunarDateText === "正月初一") {
      return "除夕";
    }
  }
  return null;
}

export function getLunarAlmanac(ymd: string): LunarAlmanacInfo {
  const cached = almanacCache.get(ymd);
  if (cached) return cached;

  const safeYmd = isValidYmd(ymd) ? ymd : "2026-01-01";
  const [year, month, day] = safeYmd.split("-").map(Number);
  const raw = getRawLunarParts(safeYmd);
  const solarTerm = getSolarTermOnDate(safeYmd);
  const lunarFestival = getLunarFestival(safeYmd, raw);
  const nextSolarTerm = getNextSolarTerm(safeYmd);

  const weekdayShort = formatWeekdayZh(safeYmd, "short");
  const weekdayLong = formatWeekdayZh(safeYmd, "long");
  const gregorianFull = `${year}年${month}月${day}日`;

  let cellSubLabel = raw.lunarDayName;
  let cellSubTone: LunarAlmanacInfo["cellSubTone"] = "day";
  if (lunarFestival) {
    cellSubLabel = lunarFestival;
    cellSubTone = "festival";
  } else if (solarTerm) {
    cellSubLabel = solarTerm;
    cellSubTone = "term";
  } else if (raw.lunarDayNum === 1) {
    cellSubLabel = raw.lunarMonthName;
    cellSubTone = "month";
  }

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInYear = isLeapYear ? 366 : 365;
  const dayOfYear =
    Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  const yearProgressPct = Math.round((dayOfYear / daysInYear) * 100);
  const quarter = (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  const weekOfYear = getWeekOfYear(safeYmd);

  const dow = new Date(year, month - 1, day).getDay(); // 0=Sun..6=Sat
  const daysUntilWeekend = dow === 0 || dow === 6 ? 0 : 6 - dow;
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const daysLeftInMonth = Math.max(0, lastDayOfMonth - day);

  const info: LunarAlmanacInfo = {
    ymd: safeYmd,
    year,
    month,
    day,
    gregorianFull,
    weekdayShort,
    weekdayLong,
    lunarYear: raw.lunarYear,
    ganZhiYear: raw.ganZhiYear,
    zodiac: raw.zodiac,
    zodiacEmoji: raw.zodiacEmoji,
    zodiacLabel: raw.zodiacLabel,
    lunarMonthName: raw.lunarMonthName,
    lunarDayNum: raw.lunarDayNum,
    lunarDayName: raw.lunarDayName,
    lunarDateText: raw.lunarDateText,
    lunarFullText: `${raw.zodiacLabel} 农历${raw.lunarDateText}`,
    lunarFestival,
    solarTerm,
    nextSolarTerm,
    cellSubLabel,
    cellSubTone,
    quarter,
    weekOfYear,
    dayOfYear,
    daysInYear,
    yearProgressPct,
    daysUntilWeekend,
    daysLeftInMonth,
  };

  trimCache(almanacCache);
  almanacCache.set(safeYmd, info);
  return info;
}

export function formatRelativeElapsed(queriedAtMs: number | null, nowMs = Date.now()): string {
  if (!queriedAtMs || !Number.isFinite(queriedAtMs)) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - queriedAtMs) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    const remMin = diffMin % 60;
    return remMin > 0 ? `${diffHour} 小时 ${remMin} 分钟前` : `${diffHour} 小时前`;
  }
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}
