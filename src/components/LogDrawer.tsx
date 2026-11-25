import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, wtCall } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { useLogStore } from "../store/runtimeStore";

const DEFAULT_VISIBLE_LOGS = 250;

function formatKeepAliveInterval(secs: number): string {
  const clamped = Math.max(30, Math.min(3600, Math.round(secs || 600)));
  if (clamped >= 60 && clamped % 60 === 0) {
    return `${clamped / 60}分钟`;
  }
  return `${clamped}秒`;
}

export function LogDrawer() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const logs = useLogStore((s) => s.logs);
  const logDrawerOpen = useLogStore((s) => s.logDrawerOpen);
  const setLogDrawerOpen = useLogStore((s) => s.setLogDrawerOpen);
  const pushLog = useLogStore((s) => s.pushLog);
  const clearLogs = useLogStore((s) => s.clearLogs);

  const [keepAliveIntervalSecs, setKeepAliveIntervalSecs] = useState(600);
  const [keepAliveBusy, setKeepAliveBusy] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [showAllLogs, setShowAllLogs] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getApiConfig()
      .then((cfg) => {
        const secs = cfg?.rules?.keepAliveIntervalSecs;
        if (typeof secs === "number" && secs > 0) {
          setKeepAliveIntervalSecs(secs);
        }
      })
      .catch(() => {});
  }, [location.pathname]);

  useEffect(() => {
    if (!logDrawerOpen) return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length, logDrawerOpen]);

  const filteredLogs = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (entry) =>
        entry.line.toLowerCase().includes(q) || entry.ts.toLowerCase().includes(q),
    );
  }, [logs, filterText]);

  const renderedLogs = useMemo(() => {
    if (showAllLogs || filteredLogs.length <= DEFAULT_VISIBLE_LOGS) {
      return filteredLogs;
    }
    return filteredLogs.slice(filteredLogs.length - DEFAULT_VISIBLE_LOGS);
  }, [filteredLogs, showAllLogs]);

  const triggerKeepAliveNow = async () => {
    if (!user || keepAliveBusy) return;
    setKeepAliveBusy(true);
    setLogDrawerOpen(true);
    pushLog("💓 [手动保活] 正在立即执行会话保活请求...");
    try {
      const res = await wtCall<{ code?: number; data?: { name?: string; userErp?: string } }>(
        "keep_alive_ping",
        {},
      );
      const name = res?.data?.name || res?.data?.userErp || "";
      const msg = name
        ? `会话保活成功（当前账号: ${name}，Cookie 保持活跃）`
        : "会话保活成功，Cookie 保持活跃";
      pushLog(`♻️ [手动保活] ${msg}`);
      toast.success(msg);
    } catch (err) {
      const msg = String(err);
      pushLog(`⚠️ [手动保活] 保活失败: ${msg}`);
      toast.error(`保活失败: ${msg}`);
    } finally {
      setKeepAliveBusy(false);
    }
  };

  const copyLogs = async () => {
    const text = filteredLogs.map((l) => `[${l.ts}] ${l.line}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制运行日志到剪贴板");
    } catch (err) {
      toast.error(`复制失败: ${err}`);
    }
  };

  return (
    <div className="shrink-0 border-t border-slate-200/90 bg-white">
      <div className="flex h-8 items-center justify-between gap-2 px-4 text-xs text-slate-600">
        <button
          type="button"
          onClick={() => setLogDrawerOpen(!logDrawerOpen)}
          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap font-medium hover:text-slate-900"
        >
          <Terminal className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          <span className="lw-nums shrink-0">运行日志 ({logs.length})</span>
          {logDrawerOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 shrink-0" />
          )}
          {!logDrawerOpen && logs.length > 0 && (
            <span className="min-w-0 truncate font-mono text-[11px] text-slate-400">
              {logs[logs.length - 1].line}
            </span>
          )}
        </button>

        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <button
            type="button"
            onClick={() => navigate("/api-config")}
            title={`后台自动保活频率：每 ${keepAliveIntervalSecs} 秒（${formatKeepAliveInterval(keepAliveIntervalSecs)}）请求一次 /devops-api/arch/api/v1/user/info?appCode=arch，点击前往接口配置调整`}
            className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200/80 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 transition hover:border-blue-200 hover:bg-blue-50/70 hover:text-blue-700 sm:inline-flex"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                user ? "bg-emerald-500" : "bg-slate-300"
              }`}
            />
            <span>保活 · 每 {formatKeepAliveInterval(keepAliveIntervalSecs)}</span>
          </button>
          <button
            type="button"
            disabled={!user || keepAliveBusy}
            onClick={() => void triggerKeepAliveNow()}
            title={
              user
                ? "立即执行一次保活请求并在运行日志中查看详情"
                : "请先登录 DevOps 后再执行保活"
            }
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-blue-200/80 bg-blue-50/70 px-2 py-0.5 text-[11px] font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
          >
            {keepAliveBusy ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            ) : (
              <Activity className="h-3 w-3 shrink-0" />
            )}
            <span>立即保活</span>
          </button>
          <button
            type="button"
            onClick={copyLogs}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Copy className="h-3 w-3 shrink-0" />
            <span>复制</span>
          </button>
          <button
            type="button"
            onClick={clearLogs}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-rose-600"
          >
            <Trash2 className="h-3 w-3 shrink-0" />
            <span>清空</span>
          </button>
        </div>
      </div>

      {logDrawerOpen && (
        <div className="border-t border-gray-200 bg-gray-950 text-gray-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800/80 px-4 py-1.5 text-[11px]">
            <div className="relative flex min-w-[200px] flex-1 max-w-sm items-center">
              <Search className="pointer-events-none absolute left-2 h-3 w-3 text-gray-500" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="筛选日志关键词（如 保活 / 401 / 错误）..."
                className="w-full rounded border border-gray-800 bg-gray-900 py-0.5 pr-6 pl-6 text-[11px] text-gray-200 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
              />
              {filterText && (
                <button
                  type="button"
                  onClick={() => setFilterText("")}
                  aria-label="清空日志筛选"
                  className="absolute right-1.5 text-gray-500 hover:text-gray-300"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 text-gray-400">
              <span>
                显示 {renderedLogs.length} / {filteredLogs.length} 条
              </span>
              {filteredLogs.length > DEFAULT_VISIBLE_LOGS && (
                <button
                  type="button"
                  onClick={() => setShowAllLogs((v) => !v)}
                  className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-gray-800"
                >
                  {showAllLogs ? `仅看最近 ${DEFAULT_VISIBLE_LOGS} 条` : `显示全部 (${filteredLogs.length})`}
                </button>
              )}
            </div>
          </div>
          <div
            ref={scrollContainerRef}
            className="h-44 overflow-y-auto px-4 py-2 font-mono text-xs"
          >
            {renderedLogs.length === 0 ? (
              <div className="text-gray-500">
                {logs.length === 0 ? "暂无运行日志..." : "没有匹配当前筛选关键词的日志..."}
              </div>
            ) : (
              renderedLogs.map((entry) => (
                <div key={entry.id} className="leading-relaxed whitespace-pre-wrap">
                  <span className="mr-2 text-gray-500">[{entry.ts}]</span>
                  <span>{entry.line}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
