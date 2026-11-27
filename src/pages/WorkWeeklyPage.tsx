import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Columns2,
  Copy,
  Eye,
  FileText,
  FileUp,
  FolderOpen,
  Loader2,
  Pencil,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { confirmDialog } from "../components/ConfirmDialog";
import { DatePicker } from "../components/DatePicker";
import { TencentDocPushModal } from "../components/TencentDocPushModal";
import { api } from "../lib/api";
import {
  addDaysYmd,
  formatDateRangeZh,
  formatDateZh,
  formatYmd,
  monthRangeYmd,
  todayYmd,
  weekRangeYmd,
} from "../lib/date";
import { getTaskProgress, isTaskInDateRange, isTaskPastRelease } from "../lib/taskFilter";
import type { WeeklyReportSummary } from "../lib/types";
import { sendWechat } from "../lib/wtx";
import { useAppStore } from "../store/appStore";

function getIsoWeekKey(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function extractModificationSummary(mdText: string): string[] {
  const lines = mdText.split(/\r?\n/);
  let inSection = false;
  const out: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (/^##\s+/.test(t)) {
      inSection = /修改方案|解决方案|改动内容/.test(t);
      continue;
    }
    if (!inSection) continue;
    if (/^#{1,6}\s*/.test(t)) continue;
    if (!t || t.startsWith("<!--") || /^[-*]\s*$/.test(t)) continue;
    if (/^[-*_]{3,}$/.test(t) || /^\|[-\s|:]+\|$/.test(t)) continue;
    if (/^-\s*\[\s*[xX ]?\s*\]\s*$/.test(t)) continue;
    if (
      /^(待填写|暂无|请填写|1\.\s*$|-\s*涉?及模块[:：]?\s*$|背景[:：]?$|目标[:：]?$|验收标准[:：]?$|按实际修改填写)/.test(
        t,
      )
    ) {
      continue;
    }
    const clean = t.replace(/^[-*•]\s*/, "").trim();
    if (clean.length > 2) {
      out.push(clean);
      if (out.length >= 3) break;
    }
  }
  return out;
}

type ReportStyle = "standard" | "standup" | "monthly";

export function WorkWeeklyPage() {
  const { projects, todos, tasks, settings } = useAppStore(
    useShallow((s) => ({
      projects: s.projects,
      todos: s.todos,
      tasks: s.tasks,
      settings: s.settings,
    })),
  );

  const initWeek = weekRangeYmd(new Date());
  const [startDate, setStartDate] = useState(initWeek.start);
  const [endDate, setEndDate] = useState(initWeek.end);
  const [reportKey, setReportKey] = useState(() => getIsoWeekKey(initWeek.start));
  const [reportStyle, setReportStyle] = useState<ReportStyle>("standard");
  const [includeTaskMd, setIncludeTaskMd] = useState(true);
  const [includePomodoro, setIncludePomodoro] = useState(true);
  const [onlyInDateRange, setOnlyInDateRange] = useState(true);
  const [excludePastReleased, setExcludePastReleased] = useState(true);
  const [taskSprintFilter, setTaskSprintFilter] = useState("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [taskKeyword, setTaskKeyword] = useState("");
  const [excludedTaskCodes, setExcludedTaskCodes] = useState<string[]>([]);

  const [reports, setReports] = useState<WeeklyReportSummary[]>([]);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [viewMode, setViewMode] = useState<"edit" | "split" | "preview">("split");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingWechat, setSendingWechat] = useState(false);
  const [tencentModalOpen, setTencentModalOpen] = useState(false);

  const isDirty = content !== savedContent;
  const today = todayYmd();

  const { sprintOptions, noSprintCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let emptyCnt = 0;
    for (const tk of tasks) {
      const sp = tk.sprint.trim();
      if (!sp) emptyCnt += 1;
      else counts.set(sp, (counts.get(sp) ?? 0) + 1);
    }
    const opts = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.name.localeCompare(a.name, "zh-CN", { numeric: true }));
    return { sprintOptions: opts, noSprintCount: emptyCnt };
  }, [tasks]);

  const candidateTasks = useMemo(() => {
    const q = taskKeyword.trim().toLowerCase();
    return tasks
      .filter((tk) => {
        if (excludePastReleased) {
          if (isTaskPastRelease(tk, today) || tk.status === "已关闭") return false;
        }
        if (onlyInDateRange && !isTaskInDateRange(tk, startDate, endDate)) {
          return false;
        }
        if (taskSprintFilter === "__none__") {
          if (tk.sprint.trim()) return false;
        } else if (taskSprintFilter !== "all" && tk.sprint.trim() !== taskSprintFilter) {
          return false;
        }
        if (taskStatusFilter !== "all" && tk.status !== taskStatusFilter) {
          return false;
        }
        if (q) {
          const hit =
            tk.code.toLowerCase().includes(q) ||
            tk.name.toLowerCase().includes(q) ||
            tk.sprint.toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ra = a.releaseDate || "9999-99-99";
        const rb = b.releaseDate || "9999-99-99";
        if (ra !== rb) return ra.localeCompare(rb);
        return a.code.localeCompare(b.code);
      });
  }, [
    tasks,
    today,
    excludePastReleased,
    onlyInDateRange,
    startDate,
    endDate,
    taskSprintFilter,
    taskStatusFilter,
    taskKeyword,
  ]);

  const selectedTasks = useMemo(
    () => candidateTasks.filter((tk) => !excludedTaskCodes.includes(tk.code)),
    [candidateTasks, excludedTaskCodes],
  );

  const workProjectIds = useMemo(
    () =>
      new Set(
        projects
          .filter((p) => p.kind === "work" || p.id === "work")
          .map((p) => p.id),
      ),
    [projects],
  );

  const refreshReports = useCallback(async () => {
    try {
      const list = await api.listWeeklyReports();
      setReports(list);
    } catch {
      // ignore
    }
  }, []);

  const loadReport = useCallback(async (key: string) => {
    if (!key.trim()) return;
    try {
      const raw = await api.readWeeklyReport(key);
      setContent(raw);
      setSavedContent(raw);
    } catch (err) {
      toast.error(`读取周报失败: ${err}`);
    }
  }, []);

  useEffect(() => {
    void refreshReports();
    void loadReport(reportKey);
  }, [refreshReports, loadReport, reportKey]);

  const applyPreset = (preset: "thisWeek" | "lastWeek" | "thisMonth") => {
    if (preset === "thisWeek") {
      const r = weekRangeYmd(new Date());
      setStartDate(r.start);
      setEndDate(r.end);
      setReportStyle("standard");
      setReportKey(getIsoWeekKey(r.start));
    } else if (preset === "lastWeek") {
      const lastWeekDate = new Date();
      lastWeekDate.setDate(lastWeekDate.getDate() - 7);
      const r = weekRangeYmd(lastWeekDate);
      setStartDate(r.start);
      setEndDate(r.end);
      setReportStyle("standard");
      setReportKey(getIsoWeekKey(r.start));
    } else {
      const r = monthRangeYmd(new Date());
      setStartDate(r.start);
      setEndDate(r.end);
      setReportStyle("monthly");
      setReportKey(r.start.slice(0, 7));
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const inRange = (d?: string | null) =>
        Boolean(d && d >= startDate && d <= endDate);

      const completedTodos = todos.filter((t) => {
        if (!t.done || !workProjectIds.has(t.projectId)) return false;
        const refDay = t.doneAt ? t.doneAt.slice(0, 10) : t.date;
        return inRange(refDay);
      });

      const inProgressTodos = todos.filter(
        (t) => !t.done && workProjectIds.has(t.projectId) && (!t.date || t.date <= endDate),
      );

      const nextEnd = addDaysYmd(endDate, 7);
      const nextPlanTodos = todos.filter(
        (t) =>
          !t.done &&
          workProjectIds.has(t.projectId) &&
          Boolean(t.date && t.date > endDate && t.date <= nextEnd),
      );

      const matchedTasks = selectedTasks;

      const mdSummaries = new Map<string, string[]>();
      if (includeTaskMd && matchedTasks.length > 0) {
        const readResults = await Promise.allSettled(
          matchedTasks.slice(0, 20).map(async (tk) => {
            const raw = await api.taskReadMd(tk.code);
            return [tk.code, extractModificationSummary(raw)] as const;
          }),
        );
        for (const r of readResults) {
          if (r.status === "fulfilled" && r.value[1].length > 0) {
            mdSummaries.set(r.value[0], r.value[1]);
          }
        }
      }

      const totalPomodoros = todos
        .filter((t) => workProjectIds.has(t.projectId) && (inRange(t.date) || inRange(t.doneAt?.slice(0, 10))))
        .reduce((acc, t) => acc + (t.pomodoros || 0), 0);

      const titleHeading =
        reportStyle === "monthly"
          ? `# ${reportKey} 月度研发工作复盘`
          : reportStyle === "standup"
            ? `# 研发站会同步 (${startDate} ~ ${endDate})`
            : `# ${reportKey} 工作周报 (${startDate} ~ ${endDate})`;

      const lines: string[] = [titleHeading, ""];

      if (reportStyle === "standup") {
        lines.push("## 昨日/本阶段已完成");
        const standupDoneTasks = matchedTasks.filter((t) => t.status === "已发版" || t.status === "已提测");
        if (completedTodos.length === 0 && standupDoneTasks.length === 0) {
          lines.push("- （暂无已标记完成项，可自行补充）");
        } else {
          for (const td of completedTodos) {
            lines.push(`- ${td.title}${td.taskCode ? ` (${td.taskCode})` : ""}`);
          }
          for (const tk of standupDoneTasks) {
            lines.push(`- [${tk.status}] ${tk.code} ${tk.name}`);
          }
        }
        lines.push("", "## 今日/进行中事项");
        for (const tk of matchedTasks.filter((t) => t.status !== "已发版" && t.status !== "已提测")) {
          const pct = getTaskProgress(tk);
          const pctTxt = pct > 0 ? ` · 进度 ${pct}%` : "";
          lines.push(
            `- [${tk.code}] ${tk.name}${pctTxt}${tk.planTestDate ? `（计划提测 ${tk.planTestDate}）` : ""}`,
          );
        }
        for (const td of inProgressTodos.slice(0, 8)) {
          lines.push(`- ${td.title}`);
        }
        lines.push("", "## 风险与需协调", "- 暂无阻塞");
      } else {
        lines.push("## 一、重点研发任务进展（离线台账汇总）");
        if (matchedTasks.length === 0) {
          lines.push("- （当前过滤条件下暂无纳入周报的研发任务）");
        } else {
          for (const tk of matchedTasks) {
            const dates: string[] = [];
            if (tk.planTestDate) dates.push(`计划提测: ${tk.planTestDate}`);
            if (tk.releaseDate) dates.push(`发版日期: ${tk.releaseDate}`);
            const pct = getTaskProgress(tk);
            const progTxt =
              !isTaskPastRelease(tk, today) && tk.status !== "已发版" && pct > 0
                ? ` | 进度: ${pct}%`
                : "";
            const repoTxt = tk.repos.length > 0 ? ` | 仓库: ${tk.repos.join(", ")}` : "";
            const dateTxt = dates.length > 0 ? ` | ${dates.join(" · ")}` : "";
            lines.push(`- **[${tk.status}] ${tk.code} ${tk.name}**${progTxt}${dateTxt}${repoTxt}`);
            const notes = mdSummaries.get(tk.code);
            if (notes && notes.length > 0) {
              for (const n of notes) {
                lines.push(`  - 方案要点：${n}`);
              }
            }
          }
        }

        lines.push("", `## 二、工作待办完成清单 (${completedTodos.length} 项)`);
        if (completedTodos.length === 0) {
          lines.push("- （本周期暂未勾选完成的工作待办）");
        } else {
          for (const td of completedTodos) {
            const meta: string[] = [];
            if (td.taskCode) meta.push(td.taskCode);
            if (td.tags.length > 0) meta.push(td.tags.map((g) => `#${g}`).join(" "));
            const suffix = meta.length > 0 ? `（${meta.join(" · ")}）` : "";
            lines.push(`- [x] ${td.title}${suffix}`);
          }
        }

        lines.push("", `## 三、下阶段计划与跟进 (${inProgressTodos.length + nextPlanTodos.length} 项)`);
        if (nextPlanTodos.length === 0 && inProgressTodos.length === 0) {
          lines.push("- 继续跟进迭代开发与测试验证工作");
        } else {
          for (const td of nextPlanTodos) {
            lines.push(`- [ ] ${td.date} · ${td.title}`);
          }
          for (const td of inProgressTodos.slice(0, 10)) {
            lines.push(`- [ ] ${td.date || "待排期"} · ${td.title}`);
          }
        }

        lines.push("", "## 四、问题总结与改进建议", "- ");
      }

      if (includePomodoro && totalPomodoros > 0) {
        lines.push(
          "",
          `> 🍅 专注数据：本周期工作事项共投入 **${totalPomodoros}** 个番茄钟（约 ${Math.round((totalPomodoros * 25) / 60 * 10) / 10} 小时）。`,
        );
      }

      const generated = lines.join("\n") + "\n";
      setContent(generated);
      toast.success(
        `已聚合 ${matchedTasks.length} 个任务与 ${completedTodos.length} 条已完成待办生成周报`,
      );
    } catch (err) {
      toast.error(`生成周报失败: ${err}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = useCallback(async () => {
    if (!reportKey.trim()) {
      toast.error("请输入周报标识（如 2026-W47）");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.saveWeeklyReport(reportKey.trim(), content);
      setSavedContent(content);
      await refreshReports();
      toast.success(`已保存归档至 ${saved.key}.md`);
    } catch (err) {
      toast.error(`保存周报失败: ${err}`);
    } finally {
      setSaving(false);
    }
  }, [reportKey, content, refreshReports]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("已复制周报 Markdown 到剪贴板");
    } catch (err) {
      toast.error(`复制失败: ${err}`);
    }
  };

  const handleSendWechat = async () => {
    if (!content.trim()) {
      toast.error("周报内容为空");
      return;
    }
    const wx = settings?.worktime.wechat_config;
    if (!wx?.enabled) {
      toast.error("请先在「设置」中开启企业微信推送配置");
      return;
    }
    setSendingWechat(true);
    try {
      const [ok, msg] = await sendWechat(content);
      if (ok) toast.success(`周报已推送至企业微信：${msg}`);
      else toast.error(`推送失败：${msg}`);
    } catch (err) {
      toast.error(`企微推送异常：${err}`);
    } finally {
      setSendingWechat(false);
    }
  };

  return (
    <div className="flex h-full min-h-[560px] flex-col gap-4 xl:flex-row">
      {/* 左栏：聚合参数 + 历史归档列表 */}
      <aside className="flex w-full shrink-0 flex-col gap-4 xl:w-72 2xl:w-80">
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span>工作周报自动聚合</span>
            </div>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              纯离线可用
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => applyPreset("thisWeek")}
              className="rounded-lg border border-gray-200 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
            >
              本周
            </button>
            <button
              type="button"
              onClick={() => applyPreset("lastWeek")}
              className="rounded-lg border border-gray-200 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
            >
              上周
            </button>
            <button
              type="button"
              onClick={() => applyPreset("thisMonth")}
              className="rounded-lg border border-gray-200 py-1.5 font-medium text-gray-700 hover:bg-gray-50"
            >
              本月
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-slate-500">开始日期</label>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                size="sm"
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-500">结束日期</label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                size="sm"
                align="right"
                className="w-full"
              />
            </div>
          </div>

          {(startDate || endDate) && (
            <div className="lw-nums rounded-xl bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
              统计周期：<span className="font-medium text-slate-800">{formatDateRangeZh(startDate, endDate)}</span>
            </div>
          )}

          <div>
            <label className="mb-1 block text-gray-500">输出格式</label>
            <select
              value={reportStyle}
              onChange={(e) => setReportStyle(e.target.value as ReportStyle)}
              className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="standard">标准研发周报（任务进展+待办+下周计划）</option>
              <option value="standup">极简站会汇报（昨日/今日/阻塞）</option>
              <option value="monthly">月度研发工作复盘</option>
            </select>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={onlyInDateRange}
                onChange={(e) => setOnlyInDateRange(e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span>仅保留统计时间范围内的任务</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={excludePastReleased}
                onChange={(e) => setExcludePastReleased(e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span>排除已发版任务（发版日期 &lt; 今日）</span>
            </label>
            {Boolean(endDate && endDate < today && excludePastReleased) && (
              <div className="rounded-md bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
                当前结束日期早于今日，如需回溯历史已发版任务可取消勾选上方过滤。
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={includeTaskMd}
                onChange={(e) => setIncludeTaskMd(e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span>提取「需求描述.md」修改方案要点</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={includePomodoro}
                onChange={(e) => setIncludePomodoro(e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span>附带番茄专注统计</span>
            </label>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-700">
                纳入任务过滤 ({selectedTasks.length}/{candidateTasks.length})
              </span>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setExcludedTaskCodes([])}
                  className="rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-50"
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setExcludedTaskCodes(candidateTasks.map((tk) => tk.code))
                  }
                  className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-200/60"
                >
                  清空
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <select
                value={taskSprintFilter}
                onChange={(e) => setTaskSprintFilter(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700"
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
              <select
                value={taskStatusFilter}
                onChange={(e) => setTaskStatusFilter(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700"
              >
                <option value="all">全部状态</option>
                <option value="未开始">未开始</option>
                <option value="进行中">进行中</option>
                <option value="已提测">已提测</option>
                <option value="已发版">已发版</option>
              </select>
            </div>

            <input
              type="text"
              value={taskKeyword}
              onChange={(e) => setTaskKeyword(e.target.value)}
              placeholder="搜索任务号 / 需求名称..."
              className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] focus:border-blue-500 focus:outline-none"
            />

            <div className="max-h-40 space-y-1 overflow-y-auto pr-0.5">
              {candidateTasks.length === 0 ? (
                <div className="py-3 text-center text-[11px] text-slate-400">
                  当前筛选条件下无匹配任务
                </div>
              ) : (
                candidateTasks.map((tk) => {
                  const checked = !excludedTaskCodes.includes(tk.code);
                  return (
                    <label
                      key={tk.code}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 text-[11px] transition ${
                        checked
                          ? "border-blue-200 bg-white text-slate-800"
                          : "border-transparent bg-slate-100/70 text-slate-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setExcludedTaskCodes((prev) =>
                            checked
                              ? [...prev, tk.code]
                              : prev.filter((c) => c !== tk.code),
                          )
                        }
                        className="mt-0.5 shrink-0 rounded border-gray-300 text-blue-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-mono font-semibold text-blue-700">
                            {tk.code}
                          </span>
                          <span className="shrink-0 rounded bg-slate-100 px-1 py-0 text-[10px] text-slate-600">
                            {tk.status}
                          </span>
                        </div>
                        <div className="truncate text-slate-600" title={tk.name}>
                          {tk.name || "（未命名任务）"}
                        </div>
                        {tk.releaseDate && (
                          <div className="lw-nums text-[10px] text-slate-400">
                            发版: {tk.releaseDate}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={generating}
            onClick={handleGenerate}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>一键自动聚合生成</span>
          </button>
        </div>

        {/* 历史周报归档列表 */}
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
              <FileText className="h-3.5 w-3.5 text-blue-600" />
              <span>历史周报归档 ({reports.length})</span>
            </div>
            <button
              type="button"
              onClick={() => api.openWeeklyReportsDir().catch((e) => toast.error(String(e)))}
              className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              <FolderOpen className="h-3 w-3" />
              <span>打开目录</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2.5">
            {reports.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-400">
                暂无已归档周报，点击上方「一键自动聚合生成」并保存
              </div>
            ) : (
              reports.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={async () => {
                    if (isDirty) {
                      const ok = await confirmDialog({
                        title: "放弃当前未保存周报修改？",
                        description: "当前周报内容有未保存的改动，切换到其他周报后将丢失未保存部分。",
                        confirmText: "放弃并切换",
                        tone: "warning",
                      });
                      if (!ok) return;
                    }
                    setReportKey(r.key);
                  }}
                  className={`w-full rounded-xl border p-2.5 text-left text-xs transition ${
                    reportKey === r.key
                      ? "border-blue-300 bg-blue-50/70"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-900">{r.key}</span>
                    <span className="lw-nums text-[10px] text-slate-400">
                      {formatDateZh(r.updatedAt.slice(0, 10) || formatYmd(new Date()))}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-medium text-gray-700">{r.title}</div>
                  {r.preview && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-gray-400">
                      {r.preview}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* 右栏：Markdown 周报编辑与预览 */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-gray-500">归档文件名:</label>
            <input
              type="text"
              value={reportKey}
              onChange={(e) => setReportKey(e.target.value)}
              placeholder="2026-W47"
              className="w-32 rounded-lg border border-gray-200 px-2.5 py-1 font-mono text-xs font-semibold text-gray-900 focus:border-blue-500 focus:outline-none"
            />
            <span className="font-mono text-xs text-gray-400">.md</span>
            {isDirty && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                有未保存修改
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("edit")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                  viewMode === "edit" ? "bg-white font-medium text-gray-900 shadow-2xs" : "text-gray-500"
                }`}
              >
                <Pencil className="h-3 w-3" />
                <span>编辑</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("split")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                  viewMode === "split" ? "bg-white font-medium text-gray-900 shadow-2xs" : "text-gray-500"
                }`}
              >
                <Columns2 className="h-3 w-3" />
                <span>分栏</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                  viewMode === "preview" ? "bg-white font-medium text-gray-900 shadow-2xs" : "text-gray-500"
                }`}
              >
                <Eye className="h-3 w-3" />
                <span>预览</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>复制</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!content.trim()) {
                  toast.error("周报正文为空，请先点击「一键自动聚合生成」或输入内容");
                  return;
                }
                setTencentModalOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              <FileUp className="h-3.5 w-3.5" />
              <span>发腾讯文档</span>
            </button>

            <button
              type="button"
              disabled={sendingWechat}
              onClick={handleSendWechat}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              {sendingWechat ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>推送企微</span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>保存归档 (Ctrl+S)</span>
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-gray-100 md:grid-cols-2 md:divide-x md:divide-y-0">
          {viewMode !== "preview" && (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="点击左侧「一键自动聚合生成」，或在此手写本周研发与工作周报..."
              className={`min-h-[420px] w-full resize-none bg-white p-5 font-mono text-[13px] leading-relaxed text-gray-800 focus:outline-none ${
                viewMode === "edit" ? "md:col-span-2" : ""
              }`}
            />
          )}

          {viewMode !== "edit" && (
            <div
              className={`min-h-[420px] overflow-y-auto p-5 text-sm leading-relaxed text-gray-800 [&_blockquote]:border-l-4 [&_blockquote]:border-amber-300 [&_blockquote]:bg-amber-50/50 [&_blockquote]:px-3 [&_blockquote]:py-1.5 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-gray-100 [&_h2]:pb-1 [&_h2]:text-base [&_h2]:font-semibold [&_li]:my-0.5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ${
                viewMode === "preview" ? "md:col-span-2" : ""
              }`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || "*（点击左侧「一键自动聚合生成」立即生成本周工作周报）*"}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>

      <TencentDocPushModal
        open={tencentModalOpen}
        onClose={() => setTencentModalOpen(false)}
        initialTitle={`研发工作周报 · ${reportKey}`}
        initialMarkdown={content}
        sourceLabel="工作周报"
      />
    </div>
  );
}
