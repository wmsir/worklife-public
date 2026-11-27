import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckSquare,
  Clock,
  Copy,
  Eye,
  FileEdit,
  FolderOpen,
  GitBranch,
  GitMerge,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { DatePicker } from "../components/DatePicker";
import { api, wtCall } from "../lib/api";
import { msToYmd } from "../lib/date";
import { formatRelativeElapsed } from "../lib/lunar";
import type { TaskSyncItem } from "../lib/types";
import { fmtTpl, nowDateTimeStr, sendWechat, ymdToLocalMs } from "../lib/wtx";
import { useAppStore } from "../store/appStore";
import {
  useWorkQueryCacheStore,
  type DeclarePlanRowCache,
  type WorkCheckRowCache,
} from "../store/runtimeStore";

type WorkCheckItem = WorkCheckRowCache;
type DeclarePlanItem = DeclarePlanRowCache;

interface SprintItem {
  id: number | string;
  name?: string;
  startDate?: number | null;
  endDate?: number | null;
}

const MIN_DECLARED_RATIO = 0.65;
const HOURS_PER_DAY = 7;

function calcDeclaredRatio(declared: number, required: number) {
  if (!(required > 0)) {
    return {
      ratio: null as number | null,
      pct: null as number | null,
      isLow: false,
      minNeededDays: 0,
      exactNeededHours: 0,
      minNeededHours: 0,
    };
  }
  const ratio = declared / required;
  const minNeededDays = Math.max(0, required * MIN_DECLARED_RATIO - declared);
  const exactNeededHours = minNeededDays * HOURS_PER_DAY;
  const minNeededHours =
    exactNeededHours > 0 ? Math.ceil((exactNeededHours + 1e-9) * 10) / 10 : 0;
  return {
    ratio,
    pct: ratio * 100,
    isLow: ratio < MIN_DECLARED_RATIO,
    minNeededDays,
    exactNeededHours,
    minNeededHours,
  };
}

export function WorkReportPage() {
  const navigate = useNavigate();
  const { settings, user, tasksSync, pushLog } = useAppStore(
    useShallow((s) => ({
      settings: s.settings,
      user: s.user,
      tasksSync: s.tasksSync,
      pushLog: s.pushLog,
    })),
  );

  const {
    report,
    patchReport,
    clearReportData,
  } = useWorkQueryCacheStore(
    useShallow((s) => ({
      report: s.report,
      patchReport: s.patchReport,
      clearReportData: s.clearReportData,
    })),
  );

  const {
    startDate,
    endDate,
    checkRows,
    selectedIds,
    queriedAt,
    queriedAtMs,
    queriedRange,
    planMode,
    fixedHours,
    planStart,
    planEnd,
    planRows,
    planGeneratedAt,
  } = report;
  const roleName = report.roleName || settings?.worktime.role_name || "开发";

  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    row: WorkCheckItem;
  } | null>(null);

  const [workloadModal, setWorkloadModal] = useState<{
    row: WorkCheckItem;
    loading: boolean;
    own: unknown;
    actual: unknown;
    error?: string;
  } | null>(null);

  const planRef = useRef<DeclarePlanItem[]>(planRows);
  useEffect(() => {
    planRef.current = planRows;
  }, [planRows]);

  useEffect(() => {
    if (!report.roleName && settings?.worktime.role_name) {
      patchReport({ roleName: settings.worktime.role_name });
    }
  }, [report.roleName, settings?.worktime.role_name, patchReport]);

  useEffect(() => {
    if (queriedAtMs === null) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [queriedAtMs]);

  useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const declareErp = user?.user.userErp || user?.user.erp || "";

  const selectedRows = useMemo(() => {
    const idSet = new Set(selectedIds);
    return checkRows.filter((r) => idSet.has(r.card_id));
  }, [checkRows, selectedIds]);

  const activeRow = selectedRows[0] ?? null;

  const setSelectedIds = (
    updater: number[] | ((prev: number[]) => number[]),
  ) => {
    patchReport((prev) => ({
      selectedIds: typeof updater === "function" ? updater(prev.selectedIds) : updater,
    }));
  };

  const toggleRow = (cardId: number) => {
    setSelectedIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === checkRows.length && checkRows.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(checkRows.map((r) => r.card_id));
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`已复制${label}`);
    } catch (e) {
      toast.error(`复制失败: ${String(e)}`);
    }
  };

  const handleOpenFolder = async (code: string) => {
    try {
      await api.taskOpenFolder(code);
    } catch (e) {
      toast.error(`打开文件夹失败: ${String(e)}`);
    }
  };

  const handleOpenWorkload = async (row: WorkCheckItem) => {
    setWorkloadModal({ row, loading: true, own: null, actual: null });
    try {
      const [own, actual] = await Promise.all([
        wtCall("get_own_workload", { card_id: row.card_id }),
        wtCall("get_actual_report_hours", { card_id: row.card_id }),
      ]);
      setWorkloadModal({ row, loading: false, own, actual });
    } catch (e) {
      setWorkloadModal({
        row,
        loading: false,
        own: null,
        actual: null,
        error: String(e),
      });
    }
  };

  const handleSearch = async () => {
    if (!user || !declareErp) {
      toast.error("请先登录 DevOps");
      return;
    }
    setSearching(true);
    try {
      const items = await wtCall<WorkCheckItem[]>("count_work", {
        declare_erp: declareErp,
        all_sprints: true,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      const list = Array.isArray(items) ? items : [];
      const fetchedAt = nowDateTimeStr();
      const fetchedAtMs = Date.now();
      setNowMs(fetchedAtMs);
      patchReport({
        checkRows: list,
        selectedIds: [],
        queriedAt: fetchedAt,
        queriedAtMs: fetchedAtMs,
        queriedRange: `${startDate || "不限"} ~ ${endDate || "不限"}`,
      });
      toast.success(`工时查询完成，共 ${list.length} 张卡片`);
      const lowInfos = list
        .map((r) => calcDeclaredRatio(Number(r.declared || 0), Number(r.required || 0)))
        .filter((info) => info.isLow);
      if (lowInfos.length > 0) {
        const lowHours = lowInfos.reduce((acc, info) => acc + info.minNeededHours, 0);
        toast.warning(
          `有 ${lowInfos.length} 张卡片已填工时占比低于 65%，需至少补填 ${lowHours.toFixed(1)}h（按 7h/天）`,
        );
      }

      // Automatic sprint range lookup & offline task ledger sync
      try {
        const [s1, s2] = await Promise.all([
          wtCall<SprintItem[]>("get_sprints", { query_type: 1 }).catch(() => []),
          wtCall<SprintItem[]>("get_sprints", { query_type: 2 }).catch(() => []),
        ]);
        const sprintMap = new Map<string, { start: string; end: string }>();
        for (const sp of [...(Array.isArray(s1) ? s1 : []), ...(Array.isArray(s2) ? s2 : [])]) {
          const spName = String(sp?.name ?? "").trim();
          if (spName) {
            sprintMap.set(spName, {
              start: msToYmd(sp.startDate ?? null),
              end: msToYmd(sp.endDate ?? null),
            });
          }
        }

        const dedup = new Map<string, TaskSyncItem>();
        for (const row of list) {
          const code = String(row.code ?? "").trim();
          if (!code) continue;
          const spInfo = sprintMap.get(String(row.sprint ?? "").trim());
          dedup.set(code, {
            code,
            cardId: row.card_id ?? null,
            name: row.name ?? "",
            sprint: row.sprint ?? "",
            sprintStart: spInfo?.start ?? "",
            sprintEnd: spInfo?.end ?? "",
          });
        }
        const syncItems = Array.from(dedup.values());
        if (syncItems.length > 0) {
          const syncRes = await tasksSync(syncItems);
          const msg = `已同步 ${syncItems.length} 个任务文件夹（新建 ${syncRes.created} 个）`;
          toast.success(msg);
          pushLog(`📁 ${msg}`);
        }
      } catch (syncErr) {
        const errMsg = `⚠️ 同步离线任务文件夹异常: ${String(syncErr)}`;
        pushLog(errMsg);
        toast.error(errMsg);
      }
    } catch (e) {
      toast.error(`搜索工时失败: ${String(e)}`);
    } finally {
      setSearching(false);
    }
  };

  const handleGeneratePlan = async (onlySelected: boolean) => {
    if (!user || !declareErp) {
      toast.error("请先登录 DevOps");
      return;
    }
    if (onlySelected && selectedRows.length === 0) {
      toast.error("请先在上方表格中勾选至少 1 张卡片");
      return;
    }
    const fh = Number(fixedHours);
    if (planMode === "fixed" && (Number.isNaN(fh) || fh <= 0)) {
      toast.error("请输入有效的固定工时小时数（例如 8.0）");
      return;
    }

    setGenerating(true);
    try {
      const params: Record<string, unknown> = {
        declare_erp: declareErp,
        mode: planMode,
        fixed_hours: Number.isNaN(fh) ? 8.0 : fh,
        start_date: planStart || null,
        end_date: planEnd || null,
      };
      if (onlySelected) {
        params.check_items = selectedRows;
      }

      const generated = await wtCall<DeclarePlanItem[]>("generate_declare_plan", params);
      const normalized = (Array.isArray(generated) ? generated : []).map((p) => ({
        ...p,
        exec_status: p.exec_status || "待提报",
      }));
      planRef.current = normalized;
      patchReport({
        planRows: normalized,
        planGeneratedAt: nowDateTimeStr(),
      });
      toast.success(`已生成 ${normalized.length} 条工时提报计划`);
    } catch (e) {
      toast.error(`生成提报计划失败: ${String(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  const updatePlanCell = <K extends keyof DeclarePlanItem>(
    idx: number,
    key: K,
    value: DeclarePlanItem[K],
  ) => {
    patchReport((prev) => {
      const next = prev.planRows.map((row, i) => {
        if (i !== idx) return row;
        const updated: DeclarePlanItem = { ...row, [key]: value };
        if (key === "date" && typeof value === "string") {
          const ms = ymdToLocalMs(value);
          if (ms !== undefined) updated.declare_date_ms = ms;
        }
        return updated;
      });
      planRef.current = next;
      return { planRows: next };
    });
  };

  const removePlanRow = (idx: number) => {
    patchReport((prev) => {
      const next = prev.planRows.filter((_, i) => i !== idx);
      planRef.current = next;
      return { planRows: next };
    });
  };

  const handleExecutePlan = async () => {
    if (!user || !declareErp) {
      toast.error("请先登录 DevOps");
      return;
    }
    if (planRows.length === 0) {
      toast.error("提报计划为空，请先生成提报计划");
      return;
    }

    setExecuting(true);
    // Reset status before running
    const initialPlan = planRows.map((r) => ({ ...r, exec_status: "执行中..." }));
    planRef.current = initialPlan;
    patchReport({ planRows: initialPlan });

    try {
      await wtCall(
        "execute_declare_plan",
        {
          declare_erp: declareErp,
          role_name: roleName || "开发",
          plan_list: initialPlan,
        },
        (name, args) => {
          if (name === "update_status_cb" && args.length >= 2) {
            const idx = Number(args[0]);
            const statusText = String(args[1] ?? "");
            patchReport((prev) => {
              const next = prev.planRows.map((r, i) =>
                i === idx ? { ...r, exec_status: statusText } : r,
              );
              planRef.current = next;
              return { planRows: next };
            });
          }
        },
      );

      toast.success("工时提报执行完成，请核对各行提报状态与日志");

      // Optional WeChat notification
      const wx = settings?.worktime.wechat_config;
      if (wx?.enabled && wx?.auto_notify_report) {
        const finalPlan = planRef.current;
        const successCount = finalPlan.filter((r) => {
          const s = String(r.exec_status ?? "");
          return s.includes("成功") || s.includes("✅");
        }).length;
        const failCount = finalPlan.filter((r) => {
          const s = String(r.exec_status ?? "");
          return s.includes("失败") || s.includes("❌") || s.includes("异常");
        }).length;
        const statusDesc =
          failCount === 0
            ? `全部成功 (${successCount}/${finalPlan.length})`
            : `成功 ${successCount} 笔，失败 ${failCount} 笔`;
        const details = finalPlan
          .map(
            (r) =>
              `- ${r.date} | ${r.task_name || r.card_id} | ${r.hours}h | ${r.exec_status || ""}`,
          )
          .join("\n");

        const content = fmtTpl(wx.template_report || "", {
          user_name: user.realName || "",
          user_erp: declareErp,
          time: nowDateTimeStr(),
          plan_count: String(finalPlan.length),
          status_desc: statusDesc,
          report_details: details,
          success_count: String(successCount),
          fail_count: String(failCount),
        });

        try {
          const [ok, msg] = await sendWechat(content, wx.target_erp?.trim() || declareErp);
          if (ok) {
            toast.success("企业微信工时提报通知已发送");
          } else {
            toast.warning(`企微推送未成功: ${msg}`);
          }
        } catch (wxErr) {
          pushLog(`⚠️ 企微推送调用失败: ${String(wxErr)}`);
        }
      }
    } catch (e) {
      toast.error(`工时提报失败: ${String(e)}`);
    } finally {
      setExecuting(false);
    }
  };

  const handleStop = async () => {
    try {
      await api.wtStop();
      toast.info("已发送中止信号，当前步骤完成后将停止");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const totalDeclared = checkRows.reduce((acc, r) => acc + Number(r.declared || 0), 0);
  const totalRequired = checkRows.reduce((acc, r) => acc + Number(r.required || 0), 0);
  const totalGap = checkRows.reduce((acc, r) => acc + Number(r.gap || 0), 0);
  const totalRatioInfo = calcDeclaredRatio(totalDeclared, totalRequired);
  const lowRatioRows = checkRows.filter(
    (r) => calcDeclaredRatio(Number(r.declared || 0), Number(r.required || 0)).isLow,
  );
  const totalLowCardsNeedHours = lowRatioRows.reduce(
    (acc, r) =>
      acc + calcDeclaredRatio(Number(r.declared || 0), Number(r.required || 0)).minNeededHours,
    0,
  );
  const totalPlanHours = planRows.reduce((acc, r) => acc + Number(r.hours || 0), 0);
  const elapsedText = formatRelativeElapsed(queriedAtMs, nowMs);
  const isCacheStale = queriedAtMs !== null && nowMs - queriedAtMs > 60 * 60 * 1000;

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">填报与检查</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            一键检查 DevOps 卡片应填/已填工时差额，自动同步离线任务台账目录，生成并批量提报工时。
          </p>
        </div>
        {checkRows.length > 0 && (
          <div
            className={`lw-nums flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2 text-xs ${
              totalRatioInfo.isLow
                ? "border-rose-200 bg-rose-50/50"
                : "border-gray-200 bg-white"
            }`}
          >
            <span className="text-gray-500">
              卡片 <strong className="text-gray-900">{checkRows.length}</strong>
            </span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">
              已填 <strong className="text-emerald-700">{totalDeclared.toFixed(1)}d</strong>
            </span>
            <span className="text-gray-500">
              应填 <strong className="text-gray-900">{totalRequired.toFixed(1)}d</strong>
            </span>
            <span className="text-gray-500">
              总差额{" "}
              <strong className={totalGap > 0 ? "text-amber-600" : "text-gray-700"}>
                {totalGap.toFixed(1)}d ({(totalGap * HOURS_PER_DAY).toFixed(1)}h)
              </strong>
            </span>
            <span className="text-gray-300">|</span>
            <span className="inline-flex items-center gap-1.5 text-gray-500">
              <span>占比</span>
              <strong
                className={
                  totalRatioInfo.pct === null
                    ? "text-slate-400"
                    : totalRatioInfo.isLow
                      ? "text-rose-600"
                      : "text-emerald-700"
                }
              >
                {totalRatioInfo.pct !== null ? `${totalRatioInfo.pct.toFixed(1)}%` : "-"}
              </strong>
              {totalRatioInfo.isLow && (
                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                  需高于 65%
                </span>
              )}
              {totalLowCardsNeedHours > 0 && (
                <span
                  title="按 7h/天折算，使所有低于 65% 卡片达到 >65% 至少需补填小时数"
                  className="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-700"
                >
                  达标需补 {totalLowCardsNeedHours.toFixed(1)}h
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      {!user && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            当前尚未连接 DevOps，请先通过左侧栏底部卡片使用「网页/扫码登录」、「读取 Chrome」或「粘贴 Cookie」登录。未登录状态下在线查询与提报按钮已禁用。
          </span>
        </div>
      )}

      {/* 搜索条件栏 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="mb-1 block text-[11px] font-medium text-slate-500">开始日期</span>
              <DatePicker
                value={startDate}
                onChange={(val) => patchReport({ startDate: val })}
                size="sm"
              />
            </div>
            <div>
              <span className="mb-1 block text-[11px] font-medium text-slate-500">结束日期</span>
              <DatePicker
                value={endDate}
                onChange={(val) => patchReport({ endDate: val })}
                size="sm"
              />
            </div>
            <label className="block">
              <span className="text-[11px] font-medium text-gray-500">填报角色</span>
              <select
                value={roleName}
                onChange={(e) => patchReport({ roleName: e.target.value })}
                className="mt-1 block rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="开发">开发</option>
                <option value="测试">测试</option>
                <option value="产品">产品</option>
                <option value="运维">运维</option>
                {!["开发", "测试", "产品", "运维"].includes(roleName) && roleName && (
                  <option value={roleName}>{roleName}</option>
                )}
              </select>
            </label>

            <button
              type="button"
              disabled={!user || searching || executing}
              onClick={handleSearch}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              <span>{searching ? "查询并同步中..." : queriedAt ? "重新查询" : "搜索工时情况"}</span>
            </button>
          </div>

          {queriedAt && (
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={`lw-nums inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] ${
                  isCacheStale
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-blue-100 bg-blue-50/70 text-blue-700"
                }`}
                title={`查询区间：${queriedRange} · 切换其他页面时自动保留结果`}
              >
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>
                  上次查询：<strong>{queriedAt}</strong>（{elapsedText} · 切换页面自动保留）
                </span>
              </div>
              <button
                type="button"
                disabled={!user || searching || executing}
                onClick={handleSearch}
                title="立即重新从 DevOps 拉取最新工时"
                className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${searching ? "animate-spin" : ""}`} />
                <span>刷新</span>
              </button>
              <button
                type="button"
                disabled={searching || executing}
                onClick={() => {
                  clearReportData();
                  toast.info("已清空缓存的工时查询与计划数据");
                }}
                title="清空当前保留的查询结果和提报计划"
                className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                <span>清空缓存</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 上半区：工时查询结果表 */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50/70 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
            <CheckSquare className="h-4 w-4 text-blue-600" />
            <span>工时检查结果（已选 {selectedIds.length} / {checkRows.length}，右键单行也可操作）</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={selectedRows.length === 0}
              onClick={() =>
                copyText(selectedRows.map((r) => r.code).join("\n"), "卡片编号")
              }
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <Copy className="h-3 w-3" />
              <span>复制编号</span>
            </button>
            <button
              type="button"
              disabled={selectedRows.length === 0}
              onClick={() =>
                copyText(selectedRows.map((r) => r.name).join("\n"), "卡片名称")
              }
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <Copy className="h-3 w-3" />
              <span>复制名称</span>
            </button>
            <button
              type="button"
              disabled={selectedRows.length === 0}
              onClick={() =>
                copyText(
                  selectedRows.map((r) => `${r.code} ${r.name}`).join("\n"),
                  "编号+名称",
                )
              }
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <Copy className="h-3 w-3" />
              <span>复制编号+名称</span>
            </button>
            <button
              type="button"
              disabled={!activeRow}
              onClick={() =>
                activeRow &&
                navigate(`/work/flow?code=${encodeURIComponent(activeRow.code)}`)
              }
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <Workflow className="h-3 w-3 text-indigo-600" />
              <span>跳转流转</span>
            </button>
            <button
              type="button"
              disabled={!activeRow}
              onClick={() =>
                activeRow &&
                navigate(`/work/branch?code=${encodeURIComponent(activeRow.code)}`)
              }
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <GitBranch className="h-3 w-3 text-violet-600" />
              <span>创建分支</span>
            </button>
            <button
              type="button"
              disabled={!activeRow}
              onClick={() =>
                activeRow &&
                navigate(`/work/mr?code=${encodeURIComponent(activeRow.code)}`)
              }
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <GitMerge className="h-3 w-3 text-pink-600" />
              <span>提交 MR</span>
            </button>
            <button
              type="button"
              disabled={!activeRow}
              onClick={() => activeRow && handleOpenFolder(activeRow.code)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <FolderOpen className="h-3 w-3 text-amber-600" />
              <span>打开文件夹</span>
            </button>
            <button
              type="button"
              disabled={!activeRow}
              onClick={() =>
                activeRow &&
                navigate(`/work/task/${encodeURIComponent(activeRow.code)}`)
              }
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <FileEdit className="h-3 w-3 text-emerald-600" />
              <span>编辑需求描述</span>
            </button>
            <button
              type="button"
              disabled={!user || !activeRow}
              onClick={() => activeRow && handleOpenWorkload(activeRow)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              <Eye className="h-3 w-3 text-blue-600" />
              <span>工作量明细</span>
            </button>
          </div>
        </div>

        {(lowRatioRows.length > 0 || totalRatioInfo.isLow) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200 bg-rose-50/90 px-4 py-2 text-xs text-rose-700">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
              <span>
                {lowRatioRows.length > 0
                  ? `共有 ${lowRatioRows.length} 张卡片已填工时占应填工时比例低于 65%，逐卡达标(>65%)共需补填 ${totalLowCardsNeedHours.toFixed(1)}h（按 7h/天折算）`
                  : `当前汇总已填工时占应填工时比例低于 65%（${totalRatioInfo.pct?.toFixed(1) ?? "0.0"}%），还需补填 ${totalRatioInfo.minNeededHours.toFixed(1)}h（${totalRatioInfo.minNeededDays.toFixed(2)}d，按 7h/天折算）`}
                {lowRatioRows.length > 0 && totalRatioInfo.isLow && totalRatioInfo.pct !== null
                  ? `；当前汇总占比 ${totalRatioInfo.pct.toFixed(1)}%，汇总达标需补 ${totalRatioInfo.minNeededHours.toFixed(1)}h (${totalRatioInfo.minNeededDays.toFixed(2)}d)`
                  : ""}
              </span>
            </div>
            {lowRatioRows.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(lowRatioRows.map((r) => r.card_id))}
                className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 transition-colors hover:bg-rose-100"
              >
                一键选中低于 65% 的卡片 ({lowRatioRows.length})
              </button>
            )}
          </div>
        )}

        <div className="max-h-72 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-gray-50 text-[11px] font-semibold text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="w-9 px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={
                      checkRows.length > 0 && selectedIds.length === checkRows.length
                    }
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                  />
                </th>
                <th className="px-3 py-2">迭代</th>
                <th className="px-3 py-2">卡片ID</th>
                <th className="px-3 py-2">卡片编号</th>
                <th className="px-3 py-2">卡片名称</th>
                <th className="px-3 py-2 text-right">已填(d)</th>
                <th className="px-3 py-2 text-right">应填(d)</th>
                <th className="px-3 py-2 text-right">差额(d)</th>
                <th className="px-3 py-2 text-right">占比</th>
                <th
                  className="px-3 py-2 text-right"
                  title="按每天 7 小时折算：低于 65% 卡片达到 >65% 至少需补充的小时数"
                >
                  需补(h)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {checkRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-gray-400">
                    暂无工时查询结果，请点击上方「搜索工时情况」。
                  </td>
                </tr>
              ) : (
                checkRows.map((row) => {
                  const selected = selectedIds.includes(row.card_id);
                  const declaredNum = Number(row.declared ?? 0);
                  const requiredNum = Number(row.required ?? 0);
                  const gapNum = Number(row.gap ?? 0);
                  const fullGapHours = Math.max(0, gapNum) * HOURS_PER_DAY;
                  const hasGap = gapNum > 0;
                  const ratioInfo = calcDeclaredRatio(declaredNum, requiredNum);
                  return (
                    <tr
                      key={row.card_id}
                      onClick={() => toggleRow(row.card_id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCtxMenu({ x: e.clientX, y: e.clientY, row });
                      }}
                      className={`cursor-pointer transition ${
                        selected
                          ? "bg-blue-50/80 hover:bg-blue-100/70"
                          : ratioInfo.isLow
                            ? "bg-rose-50/85 hover:bg-rose-100/70"
                            : hasGap
                              ? "bg-amber-50/75 hover:bg-amber-100/60"
                              : "bg-white hover:bg-gray-50"
                      }`}
                    >
                      <td
                        className="px-3 py-2 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRow(row.card_id)}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                        {row.sprint}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-gray-500">
                        {row.card_id}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono font-medium text-blue-700">
                        {row.code}
                      </td>
                      <td className="max-w-md truncate px-3 py-2 text-gray-800" title={row.name}>
                        {row.name}
                      </td>
                      <td
                        className={`lw-nums whitespace-nowrap px-3 py-2 text-right font-mono ${
                          ratioInfo.isLow
                            ? "font-semibold text-rose-600"
                            : "text-gray-700"
                        }`}
                      >
                        {declaredNum.toFixed(2)}
                      </td>
                      <td className="lw-nums whitespace-nowrap px-3 py-2 text-right font-mono text-gray-700">
                        {requiredNum.toFixed(2)}
                      </td>
                      <td
                        title={`差额 ${gapNum.toFixed(2)}d ≈ ${fullGapHours.toFixed(1)}h（按 7h/天）`}
                        className={`lw-nums whitespace-nowrap px-3 py-2 text-right font-mono font-semibold ${
                          hasGap ? "text-amber-700" : "text-emerald-600"
                        }`}
                      >
                        {gapNum.toFixed(2)}
                      </td>
                      <td className="lw-nums whitespace-nowrap px-3 py-2 text-right">
                        {ratioInfo.pct === null ? (
                          <span className="text-slate-400">-</span>
                        ) : ratioInfo.isLow ? (
                          <span
                            className="inline-flex items-center justify-end gap-1"
                            title={`当前已填占应填 ${ratioInfo.pct.toFixed(1)}%，需高于 65%（按 7h/天至少需补 ${ratioInfo.minNeededHours.toFixed(1)}h / ${ratioInfo.minNeededDays.toFixed(2)}d）`}
                          >
                            <span className="font-mono font-semibold text-rose-600">
                              {ratioInfo.pct.toFixed(1)}%
                            </span>
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                              需&gt;65%
                            </span>
                          </span>
                        ) : (
                          <span className="font-mono font-medium text-emerald-600">
                            {ratioInfo.pct.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="lw-nums whitespace-nowrap px-3 py-2 text-right font-mono">
                        {ratioInfo.pct === null ? (
                          <span className="text-slate-400">-</span>
                        ) : ratioInfo.isLow ? (
                          <span
                            className="inline-flex items-center rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700"
                            title={`按 7h/天折算：(应填 ${requiredNum.toFixed(2)}d × 65% - 已填 ${declaredNum.toFixed(2)}d) × 7 = ${ratioInfo.exactNeededHours.toFixed(2)}h（${ratioInfo.minNeededDays.toFixed(2)}d），向上取 0.1h 需补 +${ratioInfo.minNeededHours.toFixed(1)}h；若全部补齐 100% 差额需 ${fullGapHours.toFixed(1)}h`}
                          >
                            +{ratioInfo.minNeededHours.toFixed(1)}h
                          </span>
                        ) : (
                          <span
                            className="text-[11px] text-emerald-600"
                            title={
                              gapNum > 0
                                ? `已大于 65%（若补齐 100% 差额还需 ${fullGapHours.toFixed(1)}h）`
                                : "已填满工时"
                            }
                          >
                            已达标
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 生成提报计划控制栏 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-gray-500">分配模式</span>
              <select
                value={planMode}
                onChange={(e) =>
                  patchReport({
                    planMode: e.target.value === "fixed" ? "fixed" : "dynamic",
                  })
                }
                className="mt-1 block rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="dynamic">动态按差额分配</option>
                <option value="fixed">每日固定工时</option>
              </select>
            </label>

            {planMode === "fixed" && (
              <label className="block">
                <span className="text-[11px] font-medium text-gray-500">每日工时 (h)</span>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="24"
                  value={fixedHours}
                  onChange={(e) => patchReport({ fixedHours: e.target.value })}
                  className="mt-1 block w-24 rounded-xl border border-gray-200 px-3 py-1.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
            )}

            <div>
              <span className="mb-1 block text-[11px] font-medium text-slate-500">填报开始日期</span>
              <DatePicker
                value={planStart}
                onChange={(val) => patchReport({ planStart: val })}
                size="sm"
              />
            </div>
            <div>
              <span className="mb-1 block text-[11px] font-medium text-slate-500">填报结束日期</span>
              <DatePicker
                value={planEnd}
                onChange={(val) => patchReport({ planEnd: val })}
                size="sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!user || generating || executing || selectedRows.length === 0}
              onClick={() => handleGeneratePlan(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>基于选中生成 ({selectedRows.length})</span>
            </button>
            <button
              type="button"
              disabled={!user || generating || executing}
              onClick={() => handleGeneratePlan(false)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>差额&gt;0默认生成</span>
            </button>
          </div>
        </div>
      </section>

      {/* 下半区：待提报计划表 */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50/70 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-800">
            <span>
              待提报工时计划（共 {planRows.length} 条，合计 {totalPlanHours.toFixed(1)} 小时）
            </span>
            {planGeneratedAt && (
              <span className="lw-nums rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">
                计划生成于 {planGeneratedAt}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {executing && (
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>中止</span>
              </button>
            )}
            <button
              type="button"
              disabled={!user || executing || planRows.length === 0}
              onClick={handleExecutePlan}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {executing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span>{executing ? "提报中..." : "确认提报"}</span>
            </button>
          </div>
        </div>

        <div className="max-h-80 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-gray-50 text-[11px] font-semibold text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="w-10 px-3 py-2 text-center">#</th>
                <th className="w-40 px-3 py-2">日期</th>
                <th className="px-3 py-2">任务名称 / 卡片</th>
                <th className="w-24 px-3 py-2">工时(h)</th>
                <th className="px-3 py-2">备注说明</th>
                <th className="w-36 px-3 py-2">提报状态</th>
                <th className="w-12 px-2 py-2 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {planRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-gray-400">
                    尚未生成工时提报计划，可在上方选中卡片或点击「差额&gt;0默认生成」。
                  </td>
                </tr>
              ) : (
                planRows.map((row, idx) => {
                  const st = String(row.exec_status ?? row.status ?? "待提报");
                  const isOk = st.includes("成功") || st.includes("✅");
                  const isErr = st.includes("失败") || st.includes("❌") || st.includes("异常");
                  return (
                    <tr key={`${row.card_id}-${idx}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-center font-mono text-[11px] text-gray-400">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-1.5">
                        <DatePicker
                          disabled={executing}
                          value={row.date}
                          onChange={(val) => updatePlanCell(idx, "date", val)}
                          size="xs"
                          className="w-[126px]"
                        />
                      </td>
                      <td className="max-w-xs px-3 py-2">
                        <div className="truncate font-medium text-gray-800" title={row.task_name}>
                          {row.task_name || `卡片 #${row.card_id}`}
                        </div>
                        <div className="font-mono text-[10px] text-gray-400">
                          card:{row.card_id}
                          {row.task_id ? ` · task:${row.task_id}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="24"
                          disabled={executing}
                          value={row.hours}
                          onChange={(e) =>
                            updatePlanCell(idx, "hours", Number(e.target.value) || 0)
                          }
                          className="w-20 rounded-lg border border-gray-200 px-2 py-1 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          disabled={executing}
                          value={row.desc || ""}
                          onChange={(e) => updatePlanCell(idx, "desc", e.target.value)}
                          className="w-full min-w-[160px] rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isOk
                              ? "bg-emerald-100 text-emerald-700"
                              : isErr
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {st}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          disabled={executing}
                          onClick={() => removePlanRow(idx)}
                          title="删除该行"
                          className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 单行右键菜单 */}
      {ctxMenu && (
        <div
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          className="fixed z-50 w-48 rounded-xl border border-gray-200 bg-white py-1.5 text-xs shadow-lg"
        >
          <button
            type="button"
            onClick={() => copyText(ctxMenu.row.code, "卡片编号")}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            <Copy className="h-3.5 w-3.5 text-gray-400" />
            <span>复制编号 ({ctxMenu.row.code})</span>
          </button>
          <button
            type="button"
            onClick={() => copyText(ctxMenu.row.name, "卡片名称")}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            <Copy className="h-3.5 w-3.5 text-gray-400" />
            <span>复制名称</span>
          </button>
          <button
            type="button"
            onClick={() =>
              copyText(`${ctxMenu.row.code} ${ctxMenu.row.name}`, "编号+名称")
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            <Copy className="h-3.5 w-3.5 text-gray-400" />
            <span>复制编号+名称</span>
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button
            type="button"
            onClick={() =>
              navigate(`/work/flow?code=${encodeURIComponent(ctxMenu.row.code)}`)
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            <Workflow className="h-3.5 w-3.5 text-indigo-500" />
            <span>跳转流转</span>
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(`/work/branch?code=${encodeURIComponent(ctxMenu.row.code)}`)
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            <GitBranch className="h-3.5 w-3.5 text-violet-500" />
            <span>创建分支</span>
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(`/work/mr?code=${encodeURIComponent(ctxMenu.row.code)}`)
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            <GitMerge className="h-3.5 w-3.5 text-pink-500" />
            <span>提交 MR</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenFolder(ctxMenu.row.code)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
            <span>打开文件夹</span>
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(`/work/task/${encodeURIComponent(ctxMenu.row.code)}`)
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            <FileEdit className="h-3.5 w-3.5 text-emerald-500" />
            <span>编辑需求描述</span>
          </button>
          <button
            type="button"
            disabled={!user}
            onClick={() => handleOpenWorkload(ctxMenu.row)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 disabled:opacity-40"
          >
            <Eye className="h-3.5 w-3.5 text-blue-500" />
            <span>工作量明细</span>
          </button>
        </div>
      )}

      {/* 工作量明细弹窗 */}
      {workloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-gray-900">
                  工作量明细 · {workloadModal.row.code}
                </h3>
                <p className="truncate text-xs text-gray-500">
                  {workloadModal.row.name} (card_id: {workloadModal.row.card_id})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWorkloadModal(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {workloadModal.loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span>正在查询个人工作量与实际填报明细...</span>
              </div>
            ) : workloadModal.error ? (
              <div className="my-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                查询失败: {workloadModal.error}
              </div>
            ) : (
              <div className="mt-4 grid max-h-[60vh] grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs font-semibold text-gray-800">
                    卡片角色工作量 (get_own_workload)
                  </div>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-white p-2.5 font-mono text-[11px] text-gray-700">
                    {JSON.stringify(workloadModal.own, null, 2)}
                  </pre>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs font-semibold text-gray-800">
                    实际填报工时 (get_actual_report_hours)
                  </div>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-white p-2.5 font-mono text-[11px] text-gray-700">
                    {JSON.stringify(workloadModal.actual, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setWorkloadModal(null)}
                className="rounded-xl border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
