import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileEdit,
  FileCode2,
  FileSpreadsheet,
  FolderOpen,
  GitBranch,
  GitMerge,
  Loader2,
  Plus,
  Search,
  Send,
  Table2,
  Workflow,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ApplyTemplateModal } from "../components/ApplyTemplateModal";
import { DateBadge } from "../components/DateBadge";
import { DatePicker, MonthPicker } from "../components/DatePicker";
import { SegmentedTabs } from "../components/UiKit";
import { api } from "../lib/api";
import { formatMonthZh, isValidYmd, todayYmd } from "../lib/date";
import { getTaskBranches, shortRepoName } from "../lib/wtx";
import type {
  SmartsheetWebhookProfile,
  TaskRecord,
  TaskStatus,
  WebhookPushResult,
} from "../lib/types";
import { useAppStore } from "../store/appStore";

const STATUS_OPTIONS: TaskStatus[] = ["未开始", "进行中", "已提测", "已发版", "已关闭"];

function isTaskReleaseOverdue(t: TaskRecord, today: string): boolean {
  return Boolean(
    isValidYmd(t.releaseDate) &&
      t.releaseDate < today &&
      t.status !== "已发版" &&
      t.status !== "已关闭",
  );
}

export function WorkLedgerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tasks, taskCreate, taskUpdate, tasksConfirmReleased } = useAppStore(
    useShallow((s) => ({
      tasks: s.tasks,
      taskCreate: s.taskCreate,
      taskUpdate: s.taskUpdate,
      tasksConfirmReleased: s.tasksConfirmReleased,
    })),
  );

  const [viewMode, setViewMode] = useState<"table" | "calendar">("table");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  const [sprintFilter, setSprintFilter] = useState(searchParams.get("sprint") || "all");
  const [startMonth, setStartMonth] = useState("");
  const [releaseMonth, setReleaseMonth] = useState("");
  const [keyword, setKeyword] = useState("");

  const [newOpen, setNewOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [tplTask, setTplTask] = useState<TaskRecord | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [webhooks, setWebhooks] = useState<SmartsheetWebhookProfile[]>([]);
  const [pickedWebhookId, setPickedWebhookId] = useState("");
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [sheetPushRes, setSheetPushRes] = useState<WebhookPushResult | null>(null);
  const [confirmingReleases, setConfirmingReleases] = useState(false);
  const [confirmingCode, setConfirmingCode] = useState<string | null>(null);

  const openSheetSyncModal = async () => {
    setSheetPushRes(null);
    setSyncModalOpen(true);
    try {
      const cfg = await api.getTencentDocsConfig();
      setWebhooks(cfg.webhooks);
      if (cfg.webhooks.length > 0) {
        setPickedWebhookId((prev) =>
          cfg.webhooks.some((w) => w.id === prev) ? prev : cfg.webhooks[0].id,
        );
      } else {
        setPickedWebhookId("");
      }
    } catch (e) {
      toast.error(`读取智能表格配置失败: ${String(e)}`);
    }
  };

  useEffect(() => {
    const st = searchParams.get("status");
    if (st) setStatusFilter(st);
    const sp = searchParams.get("sprint");
    if (sp) setSprintFilter(sp);
  }, [searchParams]);

  const today = todayYmd();

  const { sprintOptions, noSprintCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let emptyCnt = 0;
    for (const t of tasks) {
      const sp = t.sprint.trim();
      if (!sp) {
        emptyCnt += 1;
      } else {
        counts.set(sp, (counts.get(sp) ?? 0) + 1);
      }
    }
    const opts = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.name.localeCompare(a.name, "zh-CN", { numeric: true }));
    return { sprintOptions: opts, noSprintCount: emptyCnt };
  }, [tasks]);

  const hasActiveFilter =
    statusFilter !== "all" ||
    sprintFilter !== "all" ||
    Boolean(startMonth) ||
    Boolean(releaseMonth) ||
    Boolean(keyword.trim());

  const filteredTasks = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter === "__pending_release__") {
        if (!isTaskReleaseOverdue(t, today)) return false;
      } else if (statusFilter !== "all" && t.status !== statusFilter) {
        return false;
      }
      if (sprintFilter === "__none__") {
        if (t.sprint.trim()) return false;
      } else if (sprintFilter !== "all" && t.sprint.trim() !== sprintFilter) {
        return false;
      }
      if (startMonth && !t.startDate.startsWith(startMonth)) return false;
      if (releaseMonth && !t.releaseDate.startsWith(releaseMonth)) return false;
      if (q) {
        const hit =
          t.code.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.sprint.toLowerCase().includes(q) ||
          t.branch.toLowerCase().includes(q) ||
          (t.branches?.some((b) => b.branch.toLowerCase().includes(q)) ?? false) ||
          t.repos.some((r) => r.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, sprintFilter, startMonth, releaseMonth, keyword, today]);

  const allOverdueTasks = useMemo(
    () => tasks.filter((t) => isTaskReleaseOverdue(t, today)),
    [tasks, today],
  );

  const selectedOverdueCodes = useMemo(
    () => allOverdueTasks.filter((t) => selectedCodes.includes(t.code)).map((t) => t.code),
    [allOverdueTasks, selectedCodes],
  );

  const selectedTasks = useMemo(
    () => tasks.filter((t) => selectedCodes.includes(t.code)),
    [tasks, selectedCodes],
  );

  const formatTaskCommitMsg = (t: { code: string; name: string }) =>
    t.name.trim() ? `#${t.code} ${t.name.trim()}` : `#${t.code}`;

  const copyLedgerText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`已复制${label}`);
    } catch (err) {
      toast.error(`复制失败: ${String(err)}`);
    }
  };

  const targetTasksForSync = useMemo(() => {
    if (selectedCodes.length > 0) {
      return tasks.filter((t) => selectedCodes.includes(t.code));
    }
    return filteredTasks;
  }, [tasks, selectedCodes, filteredTasks]);

  const handleSyncToSheet = async () => {
    if (!pickedWebhookId) {
      toast.error("请先配置并选择智能表格模板");
      return;
    }
    if (targetTasksForSync.length === 0) {
      toast.error("当前没有可同步的任务记录");
      return;
    }
    setSyncingSheet(true);
    try {
      const rows = targetTasksForSync.map((t) => ({
        code: t.code,
        name: t.name,
        status: t.status,
        sprint: t.sprint,
        startDate: t.startDate,
        planTestDate: t.planTestDate,
        releaseDate: t.releaseDate,
        branch: t.branch,
        repos: t.repos,
      }));
      const res = await api.pushSmartsheetWebhook(
        pickedWebhookId,
        rows,
        "任务台账一键同步",
      );
      setSheetPushRes(res);
      toast.success(res.record.message);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSyncingSheet(false);
    }
  };

  const calendarGroups = useMemo(() => {
    const map: Record<string, TaskRecord[]> = {};
    for (const t of filteredTasks) {
      const key = t.releaseDate ? t.releaseDate.slice(0, 7) : "未排发版日期";
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    return Object.entries(map).sort(([a], [b]) => {
      if (a === "未排发版日期") return 1;
      if (b === "未排发版日期") return -1;
      return b.localeCompare(a);
    });
  }, [filteredTasks]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() && !newName.trim()) {
      toast.error("任务号和任务名称不能同时为空");
      return;
    }
    setCreating(true);
    try {
      const created = await taskCreate(newCode.trim(), newName.trim());
      toast.success(`已创建任务文件夹：${created.code}（含查询 SQL 与三套附件模板）`);
      setNewCode("");
      setNewName("");
      setNewOpen(false);
    } catch (err) {
      toast.error(`创建失败: ${err}`);
    } finally {
      setCreating(false);
    }
  };

  const handlePatch = async (code: string, patch: Partial<TaskRecord>) => {
    const prev = tasks.find((t) => t.code === code);
    try {
      const updated = await taskUpdate(code, patch);
      if (
        patch.releaseDate &&
        !patch.status &&
        updated.status === "已发版" &&
        prev?.status !== "已发版"
      ) {
        toast.success(`已更新 [${code}]（发版日期早于今天，已自动标记为「已发版」）`);
      } else {
        toast.success(`已更新 [${code}]`);
      }
    } catch (err) {
      toast.error(`更新失败: ${err}`);
    }
  };

  const handleConfirmSingleRelease = async (code: string) => {
    if (confirmingCode || confirmingReleases) return;
    setConfirmingCode(code);
    try {
      const res = await tasksConfirmReleased([code]);
      if (res.confirmedCodes.length > 0) {
        setSelectedCodes((prev) => prev.filter((c) => !res.confirmedCodes.includes(c)));
      }
      if (res.confirmed > 0) {
        toast.success(`已确认 [${code}] 为「已发版」`);
      } else {
        toast.info(`[${code}] 已处于「已发版」状态`);
      }
    } catch (err) {
      toast.error(`确认发版失败: ${err}`);
    } finally {
      setConfirmingCode(null);
    }
  };

  const handleConfirmBatchReleases = async (codes?: string[]) => {
    if (confirmingReleases || confirmingCode) return;
    setConfirmingReleases(true);
    try {
      const res = await tasksConfirmReleased(codes);
      if (res.confirmedCodes.length > 0) {
        setSelectedCodes((prev) => prev.filter((c) => !res.confirmedCodes.includes(c)));
      }
      if (res.confirmed > 0) {
        toast.success(`已一键确认 ${res.confirmed} 个任务为「已发版」`);
      } else {
        toast.info("当前没有需要确认的「待确认发版」任务");
      }
    } catch (err) {
      toast.error(`批量确认失败: ${err}`);
    } finally {
      setConfirmingReleases(false);
    }
  };

  const isReleaseOverdue = (t: TaskRecord) => isTaskReleaseOverdue(t, today);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {/* 顶部工具栏 */}
      <div className="lw-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <SegmentedTabs
            value={viewMode}
            onChange={setViewMode}
            items={[
              { value: "table", label: "台账表格", icon: Table2 },
              { value: "calendar", label: "发版日历", icon: Calendar },
            ]}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          >
            <option value="all">全部状态</option>
            <option value="__pending_release__">
              待确认发版{allOverdueTasks.length > 0 ? ` (${allOverdueTasks.length})` : ""}
            </option>
            {STATUS_OPTIONS.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <select
            value={sprintFilter}
            onChange={(e) => setSprintFilter(e.target.value)}
            title="按迭代筛选"
            className={`max-w-[200px] rounded-xl border px-2.5 py-1.5 text-xs transition ${
              sprintFilter !== "all"
                ? "border-blue-300 bg-blue-50 font-medium text-blue-700"
                : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            <option value="all">全部迭代 ({tasks.length})</option>
            {sprintOptions.map((opt) => (
              <option key={opt.name} value={opt.name}>
                {opt.name} ({opt.count})
              </option>
            ))}
            {noSprintCount > 0 && (
              <option value="__none__">未分配迭代 ({noSprintCount})</option>
            )}
          </select>

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span>开始月</span>
            <MonthPicker
              value={startMonth}
              onChange={setStartMonth}
              clearable
              placeholder="全部"
              size="sm"
              className="w-32"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span>发版月</span>
            <MonthPicker
              value={releaseMonth}
              onChange={setReleaseMonth}
              clearable
              placeholder="全部"
              size="sm"
              className="w-32"
            />
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索任务号 / 名称 / 迭代..."
              className="rounded-lg border border-gray-200 py-1.5 pr-3 pl-8 text-xs focus:border-blue-500 focus:outline-none"
            />
          </div>

          {hasActiveFilter && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-slate-600">
                {filteredTasks.length}/{tasks.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter("all");
                  setSprintFilter("all");
                  setStartMonth("");
                  setReleaseMonth("");
                  setKeyword("");
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
              >
                <X className="h-3 w-3" />
                <span>重置筛选</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openSheetSyncModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>
              同步腾讯表格
              {selectedCodes.length > 0 ? ` (${selectedCodes.length})` : ""}
            </span>
          </button>
          <button
            type="button"
            onClick={() => api.openDataRoot().catch((e) => toast.error(String(e)))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>打开数据根目录</span>
          </button>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建任务</span>
          </button>
        </div>
      </div>

      {/* 待确认发版一键批量确认条 */}
      {allOverdueTasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200/90 bg-amber-50/75 px-4 py-3 text-xs">
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="min-w-0 space-y-0.5">
              <div className="font-semibold text-amber-950">
                发现 {allOverdueTasks.length} 个「待确认发版」任务（发版日期早于 {today}）
              </div>
              <p className="text-[11px] text-amber-800/90">
                发版日期小于当前日期默认视为已上线，可一键批量确认为「已发版」，后续新同步或修改早于今天的发版日期也将自动标为「已发版」。
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 whitespace-nowrap">
            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) =>
                  prev === "__pending_release__" ? "all" : "__pending_release__",
                )
              }
              className={`shrink-0 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === "__pending_release__"
                  ? "border-amber-400 bg-amber-100 text-amber-950"
                  : "border-amber-200 bg-white text-amber-900 hover:bg-amber-100/60"
              }`}
            >
              {statusFilter === "__pending_release__" ? "显示全部状态" : "仅看待确认"}
            </button>

            {selectedOverdueCodes.length > 0 && (
              <button
                type="button"
                disabled={confirmingReleases || Boolean(confirmingCode)}
                onClick={() => void handleConfirmBatchReleases(selectedOverdueCodes)}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5 shrink-0" />
                <span>确认已选 ({selectedOverdueCodes.length})</span>
              </button>
            )}

            <button
              type="button"
              disabled={confirmingReleases || Boolean(confirmingCode)}
              onClick={() => void handleConfirmBatchReleases()}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {confirmingReleases ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              )}
              <span>
                {confirmingReleases
                  ? "确认中..."
                  : `一键全部确认已发版 (${allOverdueTasks.length})`}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 勾选批量快速复制条 */}
      {selectedTasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-blue-200/80 bg-blue-50/70 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 font-medium text-blue-900">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
            <span>已勾选 {selectedTasks.length} 个任务：</span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 whitespace-nowrap">
            <button
              type="button"
              onClick={() =>
                void copyLedgerText(
                  selectedTasks.map((t) => t.code).join("\n"),
                  `${selectedTasks.length} 个任务号`,
                )
              }
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-blue-50"
            >
              <Copy className="h-3 w-3 shrink-0 text-blue-600" />
              <span>复制任务号</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void copyLedgerText(
                  selectedTasks.map((t) => t.name.trim() || t.code).join("\n"),
                  `${selectedTasks.length} 个任务名称`,
                )
              }
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-blue-50"
            >
              <Copy className="h-3 w-3 shrink-0 text-emerald-600" />
              <span>复制任务名称</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void copyLedgerText(
                  selectedTasks.map(formatTaskCommitMsg).join("\n"),
                  `${selectedTasks.length} 条提交信息 (#任务号 名称)`,
                )
              }
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50"
            >
              <Copy className="h-3 w-3 shrink-0 text-violet-600" />
              <span>复制 #任务号 名称</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedCodes([])}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
            >
              <X className="h-3 w-3 shrink-0" />
              <span>清空勾选</span>
            </button>
          </div>
        </div>
      )}

      {/* 视图区 */}
      {viewMode === "table" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <tr>
                <th className="w-8 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={
                      filteredTasks.length > 0 &&
                      filteredTasks.every((t) => selectedCodes.includes(t.code))
                    }
                    onChange={() => {
                      const vis = filteredTasks.map((t) => t.code);
                      const allSel =
                        vis.length > 0 && vis.every((c) => selectedCodes.includes(c));
                      if (allSel) {
                        setSelectedCodes((prev) => prev.filter((c) => !vis.includes(c)));
                      } else {
                        setSelectedCodes((prev) => Array.from(new Set([...prev, ...vis])));
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                    title="全选当前列表"
                  />
                </th>
                <th className="px-3.5 py-3 font-medium">任务号</th>
                <th className="px-3.5 py-3 font-medium">名称</th>
                <th className="px-3.5 py-3 font-medium">迭代</th>
                <th className="px-3.5 py-3 font-medium">开发分支 / 仓库</th>
                <th className="px-3.5 py-3 font-medium">开始日期</th>
                <th className="px-3.5 py-3 font-medium">发版日期</th>
                <th className="px-3.5 py-3 font-medium">计划提测</th>
                <th className="px-3.5 py-3 font-medium">状态</th>
                <th className="px-3.5 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredTasks.map((t) => {
                const taskBranches = getTaskBranches(t);
                const latestBranch = taskBranches[0]?.branch || "";
                const repoList = Array.from(
                  new Set([
                    ...(t.repos ?? []).map(shortRepoName),
                    ...taskBranches.flatMap((b) => b.repos.map(shortRepoName)),
                  ]),
                ).filter(Boolean);
                const branchesTooltip = taskBranches
                  .map(
                    (b) =>
                      `${b.branch}${b.refBranch ? ` ← ${b.refBranch}` : ""}${
                        b.repos.length > 0 ? ` (${b.repos.map(shortRepoName).join(", ")})` : ""
                      }`,
                  )
                  .join("\n");

                return (
                <tr key={t.code} className="group hover:bg-gray-50/70">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedCodes.includes(t.code)}
                      onChange={() =>
                        setSelectedCodes((prev) =>
                          prev.includes(t.code)
                            ? prev.filter((c) => c !== t.code)
                            : [...prev, t.code],
                        )
                      }
                      className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                    />
                  </td>
                  <td className="px-3.5 py-2.5 font-mono font-semibold text-blue-600 whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => navigate(`/work/task/${encodeURIComponent(t.code)}`)}
                        className="hover:underline"
                      >
                        {t.code}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyLedgerText(t.code, `任务号：${t.code}`)}
                        title={`复制任务号：${t.code}`}
                        aria-label={`复制任务号 ${t.code}`}
                        className="rounded p-0.5 text-slate-400 opacity-60 transition group-hover:opacity-100 hover:bg-blue-50 hover:text-blue-700"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                  <td className="max-w-xs px-3.5 py-2.5 font-medium text-gray-800">
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1 truncate" title={t.name}>
                        {t.name || "-"}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-60 transition group-hover:opacity-100">
                        {t.name.trim() && (
                          <button
                            type="button"
                            onClick={() =>
                              void copyLedgerText(t.name.trim(), `任务名称：${t.name.trim()}`)
                            }
                            title="复制任务名称"
                            aria-label={`复制任务名称 ${t.name}`}
                            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void copyLedgerText(
                              formatTaskCommitMsg(t),
                              `提交信息：${formatTaskCommitMsg(t)}`,
                            )
                          }
                          title={`复制提交信息：${formatTaskCommitMsg(t)}`}
                          className="rounded border border-violet-200/80 bg-violet-50/70 px-1 py-0.5 font-mono text-[10px] leading-none font-semibold text-violet-700 hover:bg-violet-100"
                        >
                          #
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5 text-gray-500 whitespace-nowrap">
                    {t.sprint.trim() ? (
                      <button
                        type="button"
                        onClick={() =>
                          setSprintFilter((prev) =>
                            prev === t.sprint.trim() ? "all" : t.sprint.trim(),
                          )
                        }
                        title={
                          sprintFilter === t.sprint.trim()
                            ? "点击取消按该迭代筛选"
                            : `点击按「${t.sprint.trim()}」筛选`
                        }
                        className={`rounded-md px-1.5 py-0.5 text-left text-xs transition ${
                          sprintFilter === t.sprint.trim()
                            ? "bg-blue-50 font-medium text-blue-700"
                            : "hover:bg-slate-100 hover:text-slate-800"
                        }`}
                      >
                        {t.sprint.trim()}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="max-w-[240px] px-3.5 py-2.5">
                    {taskBranches.length === 0 ? (
                      <div className="flex items-center gap-1.5 text-gray-400">
                        <span>-</span>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/work/branch?code=${encodeURIComponent(t.code)}`)
                          }
                          className="rounded border border-dashed border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 opacity-0 transition group-hover:opacity-100 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                        >
                          建分支
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(latestBranch);
                              toast.success(`已复制分支：${latestBranch}`);
                            }}
                            title={`${branchesTooltip}\n\n点击复制最新分支`}
                            className="inline-flex min-w-0 max-w-[190px] items-center gap-1 rounded-md border border-violet-200/80 bg-violet-50/70 px-1.5 py-0.5 font-mono text-[11px] font-medium text-violet-800 hover:bg-violet-100"
                          >
                            <GitBranch className="h-3 w-3 shrink-0 text-violet-600" />
                            <span className="truncate">{latestBranch}</span>
                          </button>
                          {taskBranches.length > 1 && (
                            <span
                              title={branchesTooltip}
                              className="shrink-0 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-600"
                            >
                              +{taskBranches.length - 1}
                            </span>
                          )}
                        </div>
                        {repoList.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1">
                            {repoList.slice(0, 2).map((repo) => (
                              <span
                                key={repo}
                                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                              >
                                {repo}
                              </span>
                            ))}
                            {repoList.length > 2 && (
                              <span
                                title={repoList.join(", ")}
                                className="text-[10px] text-slate-400"
                              >
                                +{repoList.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <DatePicker
                      value={t.startDate}
                      onChange={(val) => handlePatch(t.code, { startDate: val })}
                      clearable
                      size="xs"
                      placeholder="未设置"
                      className="w-[126px]"
                    />
                  </td>
                  <td className="px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <DatePicker
                        value={t.releaseDate}
                        onChange={(val) => handlePatch(t.code, { releaseDate: val })}
                        clearable
                        size="xs"
                        tone={isReleaseOverdue(t) ? "overdue" : "default"}
                        placeholder="未排期"
                        className="w-[126px]"
                      />
                      {isReleaseOverdue(t) && (
                        <button
                          type="button"
                          disabled={confirmingReleases || confirmingCode === t.code}
                          onClick={() => void handleConfirmSingleRelease(t.code)}
                          title="发版日期早于当前日期，点击立即确认为「已发版」"
                          className="group inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-rose-200/80 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                        >
                          {confirmingCode === t.code ? (
                            <>
                              <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
                              <span>确认中...</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle
                                className="h-3 w-3 shrink-0 group-hover:hidden"
                                aria-hidden="true"
                              />
                              <Check
                                className="hidden h-3 w-3 shrink-0 group-hover:inline"
                                aria-hidden="true"
                              />
                              <span className="group-hover:hidden">待确认发版</span>
                              <span className="hidden group-hover:inline">一键确认已发版</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <DatePicker
                      value={t.planTestDate}
                      onChange={(val) => handlePatch(t.code, { planTestDate: val })}
                      clearable
                      size="xs"
                      placeholder="未设置"
                      className="w-[126px]"
                    />
                  </td>
                  <td className="px-3.5 py-2.5">
                    <select
                      value={t.status}
                      onChange={(e) =>
                        handlePatch(t.code, { status: e.target.value as TaskStatus })
                      }
                      className="rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-800"
                    >
                      {STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => api.taskOpenFolder(t.code).catch((e) => toast.error(String(e)))}
                        title="打开任务文件夹"
                        className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-100"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/work/task/${encodeURIComponent(t.code)}`)}
                        title="编辑需求描述.md"
                        className="rounded-lg border border-gray-200 p-1.5 text-blue-600 hover:bg-blue-50"
                      >
                        <FileEdit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/work/task/${encodeURIComponent(t.code)}?doc=sql`)
                        }
                        title="直接打开专属查询 SQL 脚本"
                        className="rounded-lg border border-gray-200 p-1.5 text-amber-600 hover:bg-amber-50"
                      >
                        <FileCode2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setTplTask(t)}
                        title="套用排期模板"
                        className="rounded-lg border border-gray-200 p-1.5 text-indigo-600 hover:bg-indigo-50"
                      >
                        <CalendarClock className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/work/flow?code=${encodeURIComponent(t.code)}`)}
                        title="跳转到任务流转与检查单"
                        className="rounded-lg border border-gray-200 p-1.5 text-emerald-600 hover:bg-emerald-50"
                      >
                        <Workflow className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/work/branch?code=${encodeURIComponent(t.code)}`)}
                        title="跳转到创建分支"
                        className="rounded-lg border border-gray-200 p-1.5 text-violet-600 hover:bg-violet-50"
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            latestBranch
                              ? `/work/mr?code=${encodeURIComponent(t.code)}&branch=${encodeURIComponent(latestBranch)}`
                              : `/work/mr?code=${encodeURIComponent(t.code)}`,
                          )
                        }
                        title="跳转到提交 MR"
                        className="rounded-lg border border-gray-200 p-1.5 text-pink-600 hover:bg-pink-50"
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
              {filteredTasks.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    暂无任务台账记录。可点击右上角「新建任务」，或在「填报与检查」中搜索工时自动同步建立文件夹。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          {calendarGroups.map(([monthKey, items]) => (
            <div key={monthKey} className="lw-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="lw-nums text-sm font-semibold text-slate-900">
                  {monthKey === "未排发版日期" ? monthKey : formatMonthZh(monthKey)}{" "}
                  <span className="font-normal text-slate-400">({items.length} 个任务)</span>
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {items
                  .slice()
                  .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
                  .map((t) => {
                    const taskBranches = getTaskBranches(t);
                    const latestBranch = taskBranches[0]?.branch || "";
                    return (
                    <div
                      key={t.code}
                      className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => navigate(`/work/task/${encodeURIComponent(t.code)}`)}
                              className="truncate font-mono text-xs font-semibold text-blue-600 hover:underline"
                            >
                              {t.code}
                            </button>
                            <button
                              type="button"
                              onClick={() => void copyLedgerText(t.code, `任务号：${t.code}`)}
                              title={`复制任务号：${t.code}`}
                              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-blue-700"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void copyLedgerText(
                                  formatTaskCommitMsg(t),
                                  `提交信息：${formatTaskCommitMsg(t)}`,
                                )
                              }
                              title={`复制提交信息：${formatTaskCommitMsg(t)}`}
                              className="shrink-0 rounded border border-violet-200/80 bg-violet-50/70 px-1 font-mono text-[10px] font-semibold text-violet-700 hover:bg-violet-100"
                            >
                              #
                            </button>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                            {isReleaseOverdue(t) && (
                              <button
                                type="button"
                                disabled={confirmingReleases || confirmingCode === t.code}
                                onClick={() => void handleConfirmSingleRelease(t.code)}
                                title="发版日期早于今天，点击一键确认为「已发版」"
                                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                              >
                                {confirmingCode === t.code ? (
                                  <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
                                ) : (
                                  <Check className="h-2.5 w-2.5 shrink-0" />
                                )}
                                <span>确认已发版</span>
                              </button>
                            )}
                            <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200/70">
                              {t.status}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs font-medium text-slate-800">
                          {t.name || "-"}
                        </div>
                        {latestBranch && (
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(latestBranch);
                              toast.success(`已复制分支：${latestBranch}`);
                            }}
                            title={`点击复制分支：${latestBranch}`}
                            className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md border border-violet-200/70 bg-white px-2 py-0.5 font-mono text-[10px] text-violet-700 hover:bg-violet-50"
                          >
                            <GitBranch className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{latestBranch}</span>
                            {taskBranches.length > 1 && (
                              <span className="shrink-0 text-slate-400">
                                +{taskBranches.length - 1}
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <span>开始:</span>
                          <DateBadge date={t.startDate} showRelative={false} showIcon={false} emptyLabel="未设" />
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span>发版:</span>
                          <DateBadge
                            date={t.releaseDate}
                            done={t.status === "已发版" || t.status === "已关闭"}
                            showWeekday
                            showIcon={false}
                            emptyLabel="未排期"
                          />
                        </span>
                      </div>
                    </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建任务弹窗 */}
      {newOpen && (
        <div
          className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNewOpen(false);
          }}
        >
          <form
            onSubmit={handleCreateTask}
            className="lw-modal-panel w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-center justify-between pb-3">
              <h3 className="text-base font-semibold text-gray-900">新建离线任务文件夹</h3>
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  任务号（可选，无任务号可留空自动编号）
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="例如：TASK-0001（留空自动生成本地编号）"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">任务描述 / 名称</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：接口改造或数据核查需求"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600">
                自动生成：<code>需求描述.md</code>、专属 <code>查询脚本.sql</code>，以及{" "}
                <code>附件/&#123;设计附件, 开发附件, 测试附件&#125;</code> 三套标准模板。
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs text-gray-600"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? "创建中..." : "创建文件夹与需求模板"}
              </button>
            </div>
          </form>
        </div>
      )}

      <ApplyTemplateModal
        open={Boolean(tplTask)}
        onClose={() => setTplTask(null)}
        defaultTemplateId="work-standard"
        defaultProjectId="work"
        defaultStartDate={tplTask?.startDate || today}
        defaultTaskCode={tplTask?.code || ""}
      />

      {syncModalOpen && (
        <div
          className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSyncModalOpen(false);
          }}
        >
          <div className="lw-modal-panel w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-gray-900">
                  同步任务台账到腾讯智能表格
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSyncModalOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="rounded-xl bg-gray-50 px-3 py-2 text-gray-600">
                本次待写入记录：
                <span className="font-semibold text-blue-700">
                  {targetTasksForSync.length} 条
                </span>
                {selectedCodes.length > 0 ? "（已勾选条目）" : "（当前筛选列表全部条目）"}
              </div>

              {webhooks.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
                  <p className="font-medium">尚未配置智能表格 Webhook 模板</p>
                  <p className="mt-1 text-amber-800">
                    请前往「腾讯文档 → 智能表格自动填报」新增表格 Webhook 并设置列映射，之后即可在此一键同步。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSyncModalOpen(false);
                      navigate("/tencent-docs");
                    }}
                    className="mt-2.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700"
                  >
                    前往配置智能表格模板 →
                  </button>
                </div>
              ) : (
                <label className="block">
                  <span className="font-medium text-gray-700">选择目标智能表格模板</span>
                  <select
                    value={pickedWebhookId}
                    onChange={(e) => setPickedWebhookId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800"
                  >
                    {webhooks.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.fields.length} 列 · {w.payloadMode})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {sheetPushRes && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>{sheetPushRes.record.message}</span>
                  </div>
                  {sheetPushRes.record.docUrl && (
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] text-blue-700">
                        {sheetPushRes.record.docUrl}
                      </code>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(sheetPushRes.record.docUrl);
                          toast.success("已复制分享链接");
                        }}
                        className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[11px] text-emerald-800 ring-1 ring-emerald-200"
                      >
                        <Copy className="h-3 w-3" />
                        <span>复制</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          api
                            .openExternalUrl(sheetPushRes.record.docUrl)
                            .catch((e) => toast.error(String(e)))
                        }
                        className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[11px] text-white"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>打开</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSyncModalOpen(false)}
                className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                关闭
              </button>
              {webhooks.length > 0 && (
                <button
                  type="button"
                  disabled={syncingSheet || targetTasksForSync.length === 0}
                  onClick={handleSyncToSheet}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {syncingSheet ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  <span>{syncingSheet ? "推送中..." : "立即写入智能表格"}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
