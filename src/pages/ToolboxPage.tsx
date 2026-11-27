import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Clock,
  Code2,
  Copy,
  FileText,
  KeyRound,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  StickyNote,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { SegmentedTabs } from "../components/UiKit";
import { api } from "../lib/api";
import { addDaysYmd, diffDaysYmd, formatYmd, todayYmd } from "../lib/date";
import { getLunarAlmanac } from "../lib/lunar";
import type { CnDayInfo } from "../lib/types";
import { useAppStore } from "../store/appStore";

type ToolTab = "time" | "batch" | "json" | "encode";

function formatLocalDateTime(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function amountToChineseUpper(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return "请输入有效的非负金额数字";
  if (num >= 1e12) return "金额过大（需小于万亿）";
  const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const radices = ["", "拾", "佰", "仟"];
  const bigUnits = ["", "万", "亿"];
  const decUnits = ["角", "分"];

  const rounded = Math.round(num * 100);
  const intPart = Math.floor(rounded / 100);
  const decPart = rounded % 100;

  let out = "";
  if (intPart === 0) {
    out = "零元";
  } else {
    const intStr = String(intPart);
    let zeroCount = 0;
    for (let i = 0; i < intStr.length; i += 1) {
      const p = intStr.length - 1 - i;
      const d = Number(intStr[i]);
      const quotient = Math.floor(p / 4);
      const modulus = p % 4;
      if (d === 0) {
        zeroCount += 1;
      } else {
        if (zeroCount > 0) out += "零";
        zeroCount = 0;
        out += digits[d] + radices[modulus];
      }
      if (modulus === 0 && zeroCount < 4) {
        out += bigUnits[quotient];
      }
    }
    out += "元";
  }

  if (decPart === 0) {
    out += "整";
  } else {
    const jiao = Math.floor(decPart / 10);
    const fen = decPart % 10;
    if (jiao > 0) out += digits[jiao] + decUnits[0];
    else if (intPart > 0) out += "零";
    if (fen > 0) out += digits[fen] + decUnits[1];
  }
  return out;
}

function sortJsonKeysDeep(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(sortJsonKeysDeep);
  if (val && typeof val === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      sorted[k] = sortJsonKeysDeep((val as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return val;
}

function isDefaultWorkday(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow !== 0 && dow !== 6;
}

export function ToolboxPage() {
  const [tab, setTab] = useState<ToolTab>("time");
  const today = todayYmd();

  // ---- Tab 1: Time & Workday Calculator ----
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [clockRunning, setClockRunning] = useState(true);
  const [tsInput, setTsInput] = useState(() => String(Date.now()));
  const [dtDate, setDtDate] = useState(today);
  const [dtTime, setDtTime] = useState(() => formatLocalDateTime(Date.now()).slice(11));

  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(() => addDaysYmd(today, 14));
  const [shiftBaseDate, setShiftBaseDate] = useState(today);
  const [shiftDelta, setShiftDelta] = useState("5");
  const [shiftUnit, setShiftUnit] = useState<"workday" | "natural">("workday");
  const [cnMonthCache, setCnMonthCache] = useState<Record<string, CnDayInfo>>({});

  useEffect(() => {
    if (!clockRunning || tab !== "time") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [clockRunning, tab]);

  // Fetch Chinese holiday info for months used in workday calculations
  useEffect(() => {
    if (tab !== "time") return;
    const months = new Set<string>();
    for (const ymd of [rangeStart, rangeEnd, shiftBaseDate]) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        months.add(ymd.slice(0, 7));
      }
    }
    const [sy, sm] = rangeStart.split("-").map(Number);
    const [ey, em] = rangeEnd.split("-").map(Number);
    if (sy && sm && ey && em) {
      let curY = sy;
      let curM = sm;
      let guard = 0;
      while ((curY < ey || (curY === ey && curM <= em)) && guard < 12) {
        months.add(`${curY}-${String(curM).padStart(2, "0")}`);
        curM += 1;
        if (curM > 12) {
          curM = 1;
          curY += 1;
        }
        guard += 1;
      }
    }
    if (shiftBaseDate) {
      const approxTarget = addDaysYmd(shiftBaseDate, (Number(shiftDelta) || 0) * 2 + 10);
      const approxPrev = addDaysYmd(shiftBaseDate, -Math.abs(Number(shiftDelta) || 0) * 2 - 10);
      months.add(approxTarget.slice(0, 7));
      months.add(approxPrev.slice(0, 7));
    }

    let cancelled = false;
    void Promise.all(
      Array.from(months).map((ym) => {
        const [y, m] = ym.split("-").map(Number);
        return api.getCalendarMonthInfo(y, m).catch(() => ({}));
      }),
    ).then((maps) => {
      if (cancelled) return;
      const merged: Record<string, CnDayInfo> = {};
      for (const mp of maps) {
        Object.assign(merged, mp);
      }
      setCnMonthCache((prev) => ({ ...prev, ...merged }));
    });
    return () => {
      cancelled = true;
    };
  }, [tab, rangeStart, rangeEnd, shiftBaseDate, shiftDelta]);

  const parsedTsResult = useMemo(() => {
    const clean = tsInput.trim();
    if (!clean) return null;
    const num = Number(clean);
    if (!Number.isFinite(num)) return { error: "请输入有效的数字时间戳（10位秒或13位毫秒）" };
    const isSec = Math.abs(num) < 1e11;
    const ms = Math.round(isSec ? num * 1000 : num);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return { error: "时间戳超出有效日期范围" };
    const localStr = formatLocalDateTime(ms);
    const ymd = formatYmd(d);
    const almanac = getLunarAlmanac(ymd);
    return {
      unit: isSec ? "10位秒级 (自动×1000)" : "13位毫秒级",
      ms,
      sec: Math.floor(ms / 1000),
      localStr,
      isoUtc: d.toISOString(),
      almanac,
    };
  }, [tsInput]);

  const parsedDtResult = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dtDate)) return null;
    const safeTime = /^\d{2}:\d{2}(:\d{2})?$/.test(dtTime.trim())
      ? dtTime.trim().length === 5
        ? `${dtTime.trim()}:00`
        : dtTime.trim()
      : "00:00:00";
    const [y, m, d] = dtDate.split("-").map(Number);
    const [hh, mm, ss] = safeTime.split(":").map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, ss, 0);
    if (Number.isNaN(dt.getTime())) return null;
    const ms = dt.getTime();
    return {
      ms,
      sec: Math.floor(ms / 1000),
      almanac: getLunarAlmanac(dtDate),
    };
  }, [dtDate, dtTime]);

  const rangeStats = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeStart) || !/^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)) {
      return null;
    }
    const diff = diffDaysYmd(rangeEnd, rangeStart);
    const absDays = Math.abs(diff);
    const low = diff >= 0 ? rangeStart : rangeEnd;
    const high = diff >= 0 ? rangeEnd : rangeStart;
    let workdays = 0;
    let restdays = 0;
    if (absDays <= 400) {
      let cur = low;
      while (cur <= high) {
        const cn = cnMonthCache[cur];
        const isWork = cn ? cn.is_workday : isDefaultWorkday(cur);
        if (isWork) workdays += 1;
        else restdays += 1;
        cur = addDaysYmd(cur, 1);
      }
    }
    return { diff, absDays, workdays, restdays, capped: absDays > 400 };
  }, [rangeStart, rangeEnd, cnMonthCache]);

  const shiftResult = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftBaseDate)) return null;
    const delta = Math.trunc(Number(shiftDelta) || 0);
    if (Math.abs(delta) > 365) return null;
    let target = shiftBaseDate;
    if (shiftUnit === "natural") {
      target = addDaysYmd(shiftBaseDate, delta);
    } else if (delta !== 0) {
      const step = delta > 0 ? 1 : -1;
      let remaining = Math.abs(delta);
      let cur = shiftBaseDate;
      let guard = 0;
      while (remaining > 0 && guard < 800) {
        cur = addDaysYmd(cur, step);
        const cn = cnMonthCache[cur];
        const isWork = cn ? cn.is_workday : isDefaultWorkday(cur);
        if (isWork) remaining -= 1;
        guard += 1;
      }
      target = cur;
    }
    return {
      target,
      almanac: getLunarAlmanac(target),
      cn: cnMonthCache[target],
    };
  }, [shiftBaseDate, shiftDelta, shiftUnit, cnMonthCache]);

  // ---- Tab 2: Batch Text & SQL IN ----
  const [batchInput, setBatchInput] = useState("");
  const [batchDedup, setBatchDedup] = useState(true);
  const [batchTrim, setBatchTrim] = useState(true);
  const [batchSort, setBatchSort] = useState(false);

  const batchProcessed = useMemo(() => {
    const rawLines = batchInput.split(/\r?\n/);
    let items = rawLines.map((l) => (batchTrim ? l.trim() : l)).filter((l) => l.length > 0);
    const beforeDedupCount = items.length;
    if (batchDedup) {
      items = Array.from(new Set(items));
    }
    if (batchSort) {
      items = [...items].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
    }
    const sqlStrings =
      items.length > 0
        ? `(${items.map((x) => `'${x.replace(/'/g, "''")}'`).join(", ")})`
        : "()";
    const sqlRaw = items.length > 0 ? `(${items.join(", ")})` : "()";
    const commaJoin = items.join(",");
    const jsonArray = JSON.stringify(items);
    const newlineText = items.join("\n");
    return {
      rawCount: rawLines.filter((l) => l.trim().length > 0).length,
      dedupRemoved: beforeDedupCount - items.length,
      items,
      sqlStrings,
      sqlRaw,
      commaJoin,
      jsonArray,
      newlineText,
    };
  }, [batchInput, batchDedup, batchTrim, batchSort]);

  // ---- Tab 3: JSON Tools ----
  const [jsonText, setJsonText] = useState(
    '{\n  "taskCode": "TASK-0001",\n  "status": "开发中",\n  "hours": 7.5\n}',
  );
  const jsonValidation = useMemo(() => {
    if (!jsonText.trim()) return { valid: null as boolean | null, message: "" };
    try {
      const parsed = JSON.parse(jsonText);
      const typeDesc = Array.isArray(parsed)
        ? `数组 (${parsed.length} 项)`
        : parsed && typeof parsed === "object"
          ? `对象 (${Object.keys(parsed).length} 个字段)`
          : typeof parsed;
      return { valid: true, message: `JSON 格式合法 · ${typeDesc} · ${jsonText.length} 字符` };
    } catch (e) {
      return { valid: false, message: `JSON 语法错误：${String(e)}` };
    }
  }, [jsonText]);

  const handleJsonAction = (mode: "pretty" | "minify" | "sort" | "escape" | "unescape") => {
    try {
      if (mode === "escape") {
        setJsonText(JSON.stringify(jsonText));
        toast.success("已转换为转义字符串");
        return;
      }
      if (mode === "unescape") {
        let val: unknown = jsonText.trim();
        if (typeof val === "string" && val.startsWith('"') && val.endsWith('"')) {
          val = JSON.parse(val);
        } else {
          val = JSON.parse(`"${jsonText.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
        }
        const str = typeof val === "string" ? val : JSON.stringify(val, null, 2);
        try {
          const inner = JSON.parse(str);
          setJsonText(JSON.stringify(inner, null, 2));
        } catch {
          setJsonText(str);
        }
        toast.success("已去除转义");
        return;
      }
      const parsed = JSON.parse(jsonText);
      if (mode === "pretty") {
        setJsonText(JSON.stringify(parsed, null, 2));
        toast.success("已格式化美化 JSON");
      } else if (mode === "minify") {
        setJsonText(JSON.stringify(parsed));
        toast.success("已压缩为单行 JSON");
      } else if (mode === "sort") {
        setJsonText(JSON.stringify(sortJsonKeysDeep(parsed), null, 2));
        toast.success("已按 Key 字典序重排 JSON");
      }
    } catch (e) {
      toast.error(`处理失败: ${String(e)}`);
    }
  };

  // ---- Tab 4: Encode / UUID / RMB ----
  const [rmbInput, setRmbInput] = useState("12580.50");
  const [codecInput, setCodecInput] = useState("");
  const [codecOutput, setCodecOutput] = useState("");
  const [uuidCount, setUuidCount] = useState(5);
  const [uuidNoDash, setUuidNoDash] = useState(false);
  const [uuidUpper, setUuidUpper] = useState(false);
  const [uuidList, setUuidList] = useState<string[]>(() =>
    Array.from({ length: 5 }, () => crypto.randomUUID()),
  );

  const copyText = async (txt: string, label: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      toast.success(`已复制${label}`);
    } catch (e) {
      toast.error(`复制失败: ${String(e)}`);
    }
  };

  const generateUuids = (count = uuidCount, noDash = uuidNoDash, upper = uuidUpper) => {
    const out = Array.from({ length: count }, () => {
      let id = crypto.randomUUID() as string;
      if (noDash) id = id.replace(/-/g, "");
      if (upper) id = id.toUpperCase();
      return id;
    });
    setUuidList(out);
  };

  const generateStrongPassword = (length: number) => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-";
    const arr = new Uint32Array(length);
    crypto.getRandomValues(arr);
    const pwd = Array.from(arr, (n) => chars[n % chars.length]).join("");
    setCodecOutput(pwd);
    void copyText(pwd, `${length} 位随机强密码`);
  };

  const handleCodec = (mode: "urlEnc" | "urlDec" | "b64Enc" | "b64Dec") => {
    try {
      if (mode === "urlEnc") setCodecOutput(encodeURIComponent(codecInput));
      else if (mode === "urlDec") setCodecOutput(decodeURIComponent(codecInput));
      else if (mode === "b64Enc") {
        const bytes = new TextEncoder().encode(codecInput);
        let bin = "";
        bytes.forEach((b) => {
          bin += String.fromCharCode(b);
        });
        setCodecOutput(btoa(bin));
      } else {
        const bin = atob(codecInput.trim());
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        setCodecOutput(new TextDecoder().decode(bytes));
      }
    } catch (e) {
      toast.error(`转换失败: ${String(e)}`);
    }
  };

  const nowAlmanac = useMemo(() => getLunarAlmanac(formatYmd(new Date(nowMs))), [nowMs]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Wrench className="h-4.5 w-4.5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">常用百宝箱</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              高频实用小工具集成：时间戳转换、工作日推算、单号去重 SQL 拼接、JSON 美化与编码/金额转换。
            </p>
          </div>
        </div>

        <SegmentedTabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "time", label: "时间戳与工作日" },
            { value: "batch", label: "单号去重与 SQL 拼接" },
            { value: "json", label: "JSON 美化与校验" },
            { value: "encode", label: "编码 · UUID · 大写金额" },
          ]}
        />
      </div>

      {/* Tab 1: 时间戳与工作日计算 */}
      {tab === "time" && (
        <div className="space-y-4">
          {/* 实时时间条 */}
          <section className="lw-card lw-nums flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Clock className="h-4 w-4 text-blue-600" />
                <span className="font-mono">{formatLocalDateTime(nowMs)}</span>
              </div>
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200/70">
                {nowAlmanac.zodiacEmoji} {nowAlmanac.zodiacLabel} · 农历{nowAlmanac.lunarDateText}
              </span>
              <button
                type="button"
                onClick={() => copyText(String(nowMs), "毫秒时间戳")}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700"
              >
                <span>ms: {nowMs}</span>
                <Copy className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => copyText(String(Math.floor(nowMs / 1000)), "秒级时间戳")}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700"
              >
                <span>s: {Math.floor(nowMs / 1000)}</span>
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setClockRunning((v) => !v)}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {clockRunning ? (
                <>
                  <Pause className="h-3.5 w-3.5 text-amber-600" />
                  <span>暂停跳动</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 text-emerald-600" />
                  <span>恢复实时</span>
                </>
              )}
            </button>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 时间戳 -> 日期 */}
            <section className="lw-card space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">时间戳 → 日期时间</h2>
                <button
                  type="button"
                  onClick={() => setTsInput(String(Date.now()))}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  填入当前毫秒
                </button>
              </div>
              <input
                type="text"
                value={tsInput}
                onChange={(e) => setTsInput(e.target.value)}
                placeholder="输入 10 位秒或 13 位毫秒时间戳"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
              />
              {parsedTsResult && "error" in parsedTsResult ? (
                <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {parsedTsResult.error}
                </div>
              ) : parsedTsResult ? (
                <div className="lw-nums space-y-2 rounded-xl bg-slate-50 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">识别精度</span>
                    <span className="font-medium text-slate-700">{parsedTsResult.unit}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">北京时间</span>
                    <button
                      type="button"
                      onClick={() => copyText(parsedTsResult.localStr, "北京时间")}
                      className="inline-flex items-center gap-1 font-mono font-semibold text-blue-700 hover:underline"
                    >
                      <span>{parsedTsResult.localStr}</span>
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">生肖农历</span>
                    <span className="font-medium text-amber-800">
                      {parsedTsResult.almanac.zodiacEmoji} {parsedTsResult.almanac.zodiacLabel} ·{" "}
                      {parsedTsResult.almanac.lunarDateText}（{parsedTsResult.almanac.weekdayShort}）
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">ISO / UTC</span>
                    <span className="font-mono text-[11px] text-slate-600">
                      {parsedTsResult.isoUtc}
                    </span>
                  </div>
                </div>
              ) : null}
            </section>

            {/* 日期 -> 时间戳 */}
            <section className="lw-card space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">日期时间 → 时间戳</h2>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setDtTime("00:00:00")}
                    className="text-slate-500 hover:text-blue-600"
                  >
                    当日零点
                  </button>
                  <button
                    type="button"
                    onClick={() => setDtTime("23:59:59")}
                    className="text-slate-500 hover:text-blue-600"
                  >
                    23:59:59
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const now = formatLocalDateTime(Date.now());
                      setDtDate(now.slice(0, 10));
                      setDtTime(now.slice(11));
                    }}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    设为现在
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={dtDate}
                  onChange={(e) => setDtDate(e.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={dtTime}
                  onChange={(e) => setDtTime(e.target.value)}
                  placeholder="HH:MM:SS"
                  className="rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {parsedDtResult && (
                <div className="lw-nums space-y-2 rounded-xl bg-slate-50 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">13 位毫秒戳</span>
                    <button
                      type="button"
                      onClick={() => copyText(String(parsedDtResult.ms), "13位毫秒戳")}
                      className="inline-flex items-center gap-1 font-mono font-semibold text-blue-700 hover:underline"
                    >
                      <span>{parsedDtResult.ms}</span>
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">10 位秒戳</span>
                    <button
                      type="button"
                      onClick={() => copyText(String(parsedDtResult.sec), "10位秒戳")}
                      className="inline-flex items-center gap-1 font-mono font-semibold text-slate-800 hover:underline"
                    >
                      <span>{parsedDtResult.sec}</span>
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">对应生肖农历</span>
                    <span className="font-medium text-amber-800">
                      {parsedDtResult.almanac.zodiacEmoji} {parsedDtResult.almanac.zodiacLabel} ·{" "}
                      {parsedDtResult.almanac.lunarDateText}（第 {parsedDtResult.almanac.weekOfYear} 周）
                    </span>
                  </div>
                </div>
              )}
            </section>

            {/* 工作日间隔计算 */}
            <section className="lw-card space-y-3 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Calendar className="h-4 w-4 text-emerald-600" />
                <span>日期间隔与法定工作日统计</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">开始日期</span>
                  <input
                    type="date"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">结束日期</span>
                  <input
                    type="date"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </label>
              </div>
              {rangeStats && (
                <div className="lw-nums grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center text-xs">
                  <div>
                    <div className="text-[11px] text-slate-500">自然日差值</div>
                    <div className="mt-0.5 text-base font-bold text-slate-900">
                      {rangeStats.diff} 天
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">含法定工作日</div>
                    <div className="mt-0.5 text-base font-bold text-emerald-700">
                      {rangeStats.capped ? "超出400天" : `${rangeStats.workdays} 天`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">含周末/节假日</div>
                    <div className="mt-0.5 text-base font-bold text-slate-600">
                      {rangeStats.capped ? "-" : `${rangeStats.restdays} 天`}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* 日期推算 */}
            <section className="lw-card space-y-3 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Calendar className="h-4 w-4 text-indigo-600" />
                <span>日期推算（算提测日 / 发版日）</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">基准日期</span>
                  <input
                    type="date"
                    value={shiftBaseDate}
                    onChange={(e) => setShiftBaseDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">偏移天数（可负）</span>
                  <input
                    type="number"
                    min={-365}
                    max={365}
                    value={shiftDelta}
                    onChange={(e) => setShiftDelta(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500">计算口径</span>
                  <select
                    value={shiftUnit}
                    onChange={(e) =>
                      setShiftUnit(e.target.value === "natural" ? "natural" : "workday")
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="workday">法定工作日</option>
                    <option value="natural">自然日</option>
                  </select>
                </label>
              </div>
              {shiftResult && (
                <div className="lw-nums flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50/60 p-3 text-xs">
                  <div>
                    <div className="font-bold text-indigo-900">
                      {shiftResult.almanac.gregorianFull} {shiftResult.almanac.weekdayLong}
                    </div>
                    <div className="mt-0.5 text-[11px] text-indigo-700">
                      {shiftResult.almanac.zodiacEmoji} {shiftResult.almanac.zodiacLabel} · 农历
                      {shiftResult.almanac.lunarDateText}
                      {shiftResult.cn ? ` · ${shiftResult.cn.label}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(shiftResult.target, "目标日期")}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-mono text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
                  >
                    <span>{shiftResult.target}</span>
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Tab 2: 多行单号去重与 SQL 拼接 */}
      {tab === "batch" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="lw-card flex flex-col space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <FileText className="h-4 w-4 text-blue-600" />
                <span>原始多行文本（单号 / 任务号 / 工号）</span>
              </div>
              <button
                type="button"
                onClick={() => setBatchInput("")}
                className="text-xs text-slate-400 hover:text-rose-600"
              >
                清空输入
              </button>
            </div>
            <textarea
              rows={13}
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              placeholder={"每行粘贴一条，例如：\nTASK-0001\nTASK-0002\nTASK-0001"}
              className="w-full flex-1 rounded-xl border border-slate-200 p-3 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={batchDedup}
                    onChange={(e) => setBatchDedup(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                  />
                  <span>自动去重</span>
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={batchTrim}
                    onChange={(e) => setBatchTrim(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                  />
                  <span>去首尾空格与空行</span>
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={batchSort}
                    onChange={(e) => setBatchSort(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                  />
                  <span>排序</span>
                </label>
              </div>
              <span className="lw-nums text-[11px] text-slate-500">
                有效 <strong>{batchProcessed.items.length}</strong> 项
                {batchProcessed.dedupRemoved > 0
                  ? `（已去重 ${batchProcessed.dedupRemoved} 项）`
                  : ""}
              </span>
            </div>
          </section>

          <section className="space-y-3">
            {[
              {
                title: "SQL IN 字符串（查库常用）",
                value: batchProcessed.sqlStrings,
                label: "SQL IN 字符串",
              },
              {
                title: "SQL IN 数字 / 无引号",
                value: batchProcessed.sqlRaw,
                label: "SQL IN 无引号",
              },
              {
                title: "英文逗号分隔",
                value: batchProcessed.commaJoin,
                label: "逗号分隔列表",
              },
              {
                title: "JSON 数组",
                value: batchProcessed.jsonArray,
                label: "JSON 数组",
              },
            ].map((card) => (
              <div key={card.title} className="lw-card p-3.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">{card.title}</span>
                  <button
                    type="button"
                    onClick={() => copyText(card.value, card.label)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                  >
                    <Copy className="h-3 w-3" />
                    <span>复制</span>
                  </button>
                </div>
                <pre className="max-h-24 overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-[11px] break-all whitespace-pre-wrap text-slate-700">
                  {card.value}
                </pre>
              </div>
            ))}

            <div className="lw-card p-3.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">整理后多行结果</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBatchInput(batchProcessed.newlineText)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    写回左侧
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(batchProcessed.newlineText, "整理后多行文本")}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                  >
                    <Copy className="h-3 w-3" />
                    <span>复制</span>
                  </button>
                </div>
              </div>
              <pre className="max-h-28 overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-[11px] whitespace-pre-wrap text-slate-700">
                {batchProcessed.newlineText || "（空）"}
              </pre>
            </div>
          </section>
        </div>
      )}

      {/* Tab 3: JSON 美化与校验 */}
      {tab === "json" && (
        <section className="lw-card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleJsonAction("pretty")}
                className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>格式化美化</span>
              </button>
              <button
                type="button"
                onClick={() => handleJsonAction("minify")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                压缩单行
              </button>
              <button
                type="button"
                onClick={() => handleJsonAction("sort")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                按 Key 排序
              </button>
              <button
                type="button"
                onClick={() => handleJsonAction("unescape")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                去转义
              </button>
              <button
                type="button"
                onClick={() => handleJsonAction("escape")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                加转义
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => copyText(jsonText, "JSON 内容")}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>复制</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!jsonText.trim()) return;
                  await useAppStore.getState().upsertNote({
                    title: `JSON 片段 (${today})`,
                    content: jsonText,
                    kind: "snippet",
                    language: "json",
                    tags: ["JSON"],
                  });
                  toast.success("已存入便签与片段库");
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              >
                <StickyNote className="h-3.5 w-3.5" />
                <span>存为片段</span>
              </button>
            </div>
          </div>

          {jsonValidation.valid !== null && (
            <div
              className={`rounded-xl px-3 py-2 text-xs font-medium ${
                jsonValidation.valid
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {jsonValidation.valid ? "✅ " : "❌ "}
              {jsonValidation.message}
            </div>
          )}

          <textarea
            rows={16}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder="粘贴 JSON 字符串、接口报文或日志片段..."
            className="w-full rounded-xl border border-slate-200 p-3 font-mono text-xs leading-relaxed text-slate-800 focus:border-blue-500 focus:outline-none"
          />
        </section>
      )}

      {/* Tab 4: 编码 · UUID · 大写金额 */}
      {tab === "encode" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 人民币大写金额 */}
          <section className="lw-card space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Code2 className="h-4 w-4 text-amber-600" />
              <span>人民币财务大写金额转换</span>
            </div>
            <input
              type="text"
              value={rmbInput}
              onChange={(e) => setRmbInput(e.target.value)}
              placeholder="输入金额，如 12580.50"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-50/70 p-3">
              <span className="text-sm font-semibold text-amber-950">
                {amountToChineseUpper(rmbInput) || "（等待输入）"}
              </span>
              <button
                type="button"
                onClick={() =>
                  copyText(amountToChineseUpper(rmbInput), "大写金额")
                }
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
              >
                <Copy className="h-3 w-3" />
                <span>复制</span>
              </button>
            </div>
          </section>

          {/* UUID / 强密码 */}
          <section className="lw-card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <KeyRound className="h-4 w-4 text-violet-600" />
                <span>UUID v4 / 随机强密码</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => generateStrongPassword(16)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  生成16位密码
                </button>
                <button
                  type="button"
                  onClick={() => generateUuids()}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>刷新 UUID</span>
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <label className="inline-flex items-center gap-1">
                <span>数量</span>
                <select
                  value={uuidCount}
                  onChange={(e) => {
                    const c = Number(e.target.value);
                    setUuidCount(c);
                    generateUuids(c, uuidNoDash, uuidUpper);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs"
                >
                  <option value={1}>1</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={uuidNoDash}
                  onChange={(e) => {
                    setUuidNoDash(e.target.checked);
                    generateUuids(uuidCount, e.target.checked, uuidUpper);
                  }}
                />
                <span>去掉 -</span>
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={uuidUpper}
                  onChange={(e) => {
                    setUuidUpper(e.target.checked);
                    generateUuids(uuidCount, uuidNoDash, e.target.checked);
                  }}
                />
                <span>大写</span>
              </label>
              <button
                type="button"
                onClick={() => copyText(uuidList.join("\n"), "全部 UUID")}
                className="ml-auto text-xs font-medium text-blue-600 hover:underline"
              >
                复制全部
              </button>
            </div>
            <div className="space-y-1 rounded-xl bg-slate-50 p-2.5 font-mono text-[11px] text-slate-700">
              {uuidList.map((id) => (
                <div key={id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{id}</span>
                  <button
                    type="button"
                    onClick={() => copyText(id, "UUID")}
                    className="shrink-0 text-slate-400 hover:text-blue-600"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* URL & Base64 */}
          <section className="lw-card space-y-3 p-4 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">
                URL / UTF-8 Base64 编解码
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleCodec("urlEnc")}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  URL 编码
                </button>
                <button
                  type="button"
                  onClick={() => handleCodec("urlDec")}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  URL 解码
                </button>
                <button
                  type="button"
                  onClick={() => handleCodec("b64Enc")}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Base64 编码
                </button>
                <button
                  type="button"
                  onClick={() => handleCodec("b64Dec")}
                  className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Base64 解码
                </button>
                <button
                  type="button"
                  onClick={() => copyText(codecOutput, "转换结果")}
                  className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Copy className="h-3 w-3" />
                  <span>复制结果</span>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <textarea
                rows={4}
                value={codecInput}
                onChange={(e) => setCodecInput(e.target.value)}
                placeholder="输入原始文本或待解码字符串..."
                className="w-full rounded-xl border border-slate-200 p-2.5 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
              />
              <textarea
                rows={4}
                readOnly
                value={codecOutput}
                placeholder="转换结果输出在这里..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-800 focus:outline-none"
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
