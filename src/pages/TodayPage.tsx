import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Award,
  Calendar,
  CalendarArrowUp,
  CalendarClock,
  CalendarDays,
  Check,
  ClipboardList,
  Clock,
  Copy,
  FileText,
  Flame,
  Heart,
  Hourglass,
  Plus,
  Sparkles,
  UserCheck,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ApplyTemplateModal } from "../components/ApplyTemplateModal";
import { CalendarDateTile } from "../components/DateBadge";
import { TodoEditModal } from "../components/TodoEditModal";
import { TodoRow } from "../components/TodoRow";
import { EmptyState } from "../components/UiKit";
import { api } from "../lib/api";
import { flattenProjectTree } from "../lib/projects";
import {
  addDaysYmd,
  calcHabitStreak,
  daysUntilCountdown,
  formatDateZh,
  formatMonthZh,
  getGreetingZh,
  getWeekOfYear,
  parseQuickTodo,
  todayYmd,
} from "../lib/date";
import { getLunarAlmanac } from "../lib/lunar";
import { getTaskProgress, isTaskEffectivelyDone } from "../lib/taskFilter";
import type { CnDayInfo, Todo } from "../lib/types";
import { useAppStore } from "../store/appStore";

const EXPENSE_CATEGORIES = ["餐饮", "交通", "购物", "日用", "娱乐", "医疗", "学习", "其他"];
const INCOME_CATEGORIES = ["工资", "奖金", "副业", "理财", "其他"];

export function TodayPage() {
  const {
    projects,
    todos,
    tasks,
    habits,
    countdowns,
    finance,
    user,
    upsertTodo,
    toggleTodo,
    deleteTodo,
    batchRescheduleTodos,
    toggleHabitCheckin,
    upsertTransaction,
  } = useAppStore(
    useShallow((s) => ({
      projects: s.projects,
      todos: s.todos,
      tasks: s.tasks,
      habits: s.habits,
      countdowns: s.countdowns,
      finance: s.finance,
      user: s.user,
      upsertTodo: s.upsertTodo,
      toggleTodo: s.toggleTodo,
      deleteTodo: s.deleteTodo,
      batchRescheduleTodos: s.batchRescheduleTodos,
      toggleHabitCheckin: s.toggleHabitCheckin,
      upsertTransaction: s.upsertTransaction,
    })),
  );
  const today = todayYmd();
  const tomorrow = addDaysYmd(today, 1);

  const [cnInfo, setCnInfo] = useState<CnDayInfo | null>(null);
  const [quickInput, setQuickInput] = useState("");
  const [quickProjectId, setQuickProjectId] = useState(projects[0]?.id || "work");
  const [adding, setAdding] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);

  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);

  // 一键站会日报弹窗
  const [standupOpen, setStandupOpen] = useState(false);
  const [standupFormat, setStandupFormat] = useState<"text" | "markdown">("text");
  const [standupText, setStandupText] = useState("");

  // 快捷记一笔弹窗
  const [txOpen, setTxOpen] = useState(false);
  const [txKind, setTxKind] = useState<"expense" | "income">("expense");
  const [txAmount, setTxAmount] = useState("");
  const [txCategory, setTxCategory] = useState("餐饮");
  const [txNote, setTxNote] = useState("");
  const [txSaving, setTxSaving] = useState(false);

  useEffect(() => {
    api
      .getTodayCnInfo()
      .then(setCnInfo)
      .catch(() => {});
  }, []);

  const currentYm = today.slice(0, 7);
  const monthExpense = useMemo(
    () =>
      (finance?.transactions || [])
        .filter((tx) => tx.kind === "expense" && tx.date.startsWith(currentYm))
        .reduce((acc, tx) => acc + tx.amount, 0),
    [finance, currentYm],
  );

  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects],
  );

  const todayTodos = useMemo(
    () =>
      todos
        .filter((t) => t.date === today)
        .sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1;
          if (a.priority !== b.priority) return a.priority - b.priority;
          return (a.time || "99:99").localeCompare(b.time || "99:99");
        }),
    [todos, today],
  );

  const overdueTodos = useMemo(
    () =>
      todos
        .filter((t) => !t.done && t.date && t.date < today)
        .sort((a, b) => (a.date || "").localeCompare(b.date || "")),
    [todos, today],
  );

  const tomorrowTodos = useMemo(
    () =>
      todos
        .filter((t) => t.date === tomorrow)
        .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99")),
    [todos, tomorrow],
  );

  const groupedToday = useMemo(() => {
    const groups: Record<string, Todo[]> = {};
    for (const td of todayTodos) {
      if (!groups[td.projectId]) groups[td.projectId] = [];
      groups[td.projectId].push(td);
    }
    return groups;
  }, [todayTodos]);

  const timelineItems = useMemo(
    () =>
      todayTodos
        .filter((t) => !!t.time)
        .sort((a, b) => (a.time || "").localeCompare(b.time || "")),
    [todayTodos],
  );

  const activeHabits = useMemo(
    () => habits.filter((h) => !h.archived),
    [habits],
  );

  const habitsTodayDone = useMemo(
    () => activeHabits.filter((h) => h.checkins.includes(today)).length,
    [activeHabits, today],
  );

  const upcomingCountdowns = useMemo(() => {
    return countdowns
      .map((c) => ({
        item: c,
        ...daysUntilCountdown(c.targetDate, c.annual, today),
      }))
      .filter((x) => x.days >= 0 && x.days <= 14)
      .sort((a, b) => a.days - b.days)
      .slice(0, 5);
  }, [countdowns, today]);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;
    const { title, date, time, priority, tags, repeat } = parseQuickTodo(quickInput);
    if (!title) {
      toast.error("请输入有效的待办标题");
      return;
    }
    setAdding(true);
    try {
      const targetDate = date ?? today;
      await upsertTodo({
        projectId: quickProjectId || projects[0]?.id || "work",
        title,
        date: targetDate,
        time,
        priority,
        tags,
        repeat,
      });
      setQuickInput("");
      toast.success(
        targetDate === today
          ? "已添加到今日待办"
          : `已添加到 ${formatDateZh(targetDate, { showWeekday: true })}`,
      );
    } catch (err) {
      toast.error(`添加失败: ${err}`);
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      const res = await toggleTodo(id);
      if (res.spawned) {
        toast.success(
          `已完成「${res.todo.title}」，已自动生成下一次重复待办 (${res.spawned.date ?? ""})`,
        );
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTodo(id);
      toast.success("已删除待办");
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  };

  const handleRescheduleAllOverdue = async () => {
    if (overdueTodos.length === 0) return;
    setRescheduling(true);
    try {
      await batchRescheduleTodos(
        overdueTodos.map((t) => t.id),
        today,
      );
      toast.success(`已将 ${overdueTodos.length} 条逾期待办全部顺延到今日`);
    } catch (err) {
      toast.error(`顺延失败: ${err}`);
    } finally {
      setRescheduling(false);
    }
  };

  const buildStandupContent = (fmt: "text" | "markdown") => {
    const doneItems = todayTodos.filter((t) => t.done);
    const activeItems = todayTodos.filter((t) => !t.done);
    const activeTasks = tasks
      .filter((t) => !isTaskEffectivelyDone(t, today))
      .sort((a, b) => (a.releaseDate || "9999-99-99").localeCompare(b.releaseDate || "9999-99-99"))
      .slice(0, 6);
    const dateHeader = formatDateZh(today, {
      includeYear: true,
      showWeekday: true,
      weekdayStyle: "long",
    });

    if (fmt === "markdown") {
      return [
        `## 📅 今日工作简报 · ${dateHeader}`,
        "",
        "### ✅ 今日已完成",
        ...(doneItems.length > 0
          ? doneItems.map((t) => `- ${t.title}`)
          : ["- （暂无已勾选完成项）"]),
        "",
        "### 🚧 今日待推进",
        ...(activeItems.length > 0
          ? activeItems.map((t) => `- ${t.time ? `[${t.time}] ` : ""}${t.title}`)
          : ["- 今日待办已全部清空 🎉"]),
        "",
        "### 📌 在研任务进度",
        ...(activeTasks.length > 0
          ? activeTasks.map(
              (tk) => {
                const pct = getTaskProgress(tk);
                return `- **${tk.code}** ${tk.name || ""} [${tk.status}${pct > 0 ? ` · ${pct}%` : ""}]${
                  tk.releaseDate ? ` · 发版 ${tk.releaseDate}` : ""
                }`;
              },
            )
          : ["- 暂无进行中台账任务"]),
        "",
        "### 📆 明日计划",
        ...(tomorrowTodos.length > 0
          ? tomorrowTodos.map((t) => `- ${t.title}`)
          : ["- 待规划"]),
      ].join("\n");
    }

    return [
      `【工作简报】${dateHeader}`,
      `一、今日已完成（${doneItems.length} 项）`,
      ...(doneItems.length > 0
        ? doneItems.map((t, i) => `  ${i + 1}. ${t.title}`)
        : ["  - 暂无"]),
      `二、今日待推进（${activeItems.length} 项）`,
      ...(activeItems.length > 0
        ? activeItems.map((t, i) => `  ${i + 1}. ${t.time ? `[${t.time}] ` : ""}${t.title}`)
        : ["  - 今日待办已清零"]),
      ...(activeTasks.length > 0
        ? [
            `三、进行中研发任务（${activeTasks.length} 项）`,
            ...activeTasks.map(
              (tk, i) => {
                const pct = getTaskProgress(tk);
                return `  ${i + 1}. [${tk.code}] ${tk.name || ""} (${tk.status}${pct > 0 ? ` ${pct}%` : ""}${
                  tk.releaseDate ? `, 发版 ${tk.releaseDate}` : ""
                })`;
              },
            ),
          ]
        : []),
      `四、明日计划（${tomorrowTodos.length} 项）`,
      ...(tomorrowTodos.length > 0
        ? tomorrowTodos.map((t, i) => `  ${i + 1}. ${t.title}`)
        : ["  - 待规划"]),
    ].join("\n");
  };

  const openStandupModal = () => {
    setStandupText(buildStandupContent(standupFormat));
    setStandupOpen(true);
  };

  const handleQuickTxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(txAmount);
    if (!Number.isFinite(num) || num <= 0) {
      toast.error("请输入大于 0 的有效金额");
      return;
    }
    setTxSaving(true);
    try {
      await upsertTransaction({
        date: today,
        kind: txKind,
        amount: Math.round(num * 100) / 100,
        category: txCategory || (txKind === "expense" ? "其他" : "工资"),
        note: txNote.trim(),
      });
      toast.success(
        `已记一笔${txKind === "expense" ? "支出" : "收入"}：¥${num.toFixed(2)}（${txCategory}）`,
      );
      setTxAmount("");
      setTxNote("");
      setTxOpen(false);
    } catch (err) {
      toast.error(`记账失败: ${err}`);
    } finally {
      setTxSaving(false);
    }
  };

  const doneCount = todayTodos.filter((t) => t.done).length;
  const pct = todayTodos.length > 0 ? Math.round((doneCount / todayTodos.length) * 100) : 0;
  const weekNo = getWeekOfYear(today);
  const almanac = useMemo(() => getLunarAlmanac(today), [today]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* 顶部日期头 + 今日进度条 */}
      <div className="lw-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <CalendarDateTile date={today} size="lg" cnInfo={cnInfo} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  {getGreetingZh()} · 今日安排
                </h1>
                {cnInfo && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      cnInfo.day_type === "holiday"
                        ? "bg-rose-100 text-rose-700"
                        : cnInfo.day_type === "in_lieu"
                          ? "bg-amber-100 text-amber-800"
                          : cnInfo.is_workday
                            ? "bg-slate-100 text-slate-700"
                            : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {cnInfo.label}
                  </span>
                )}
              </div>
              <div className="lw-nums mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">
                  {formatDateZh(today, {
                    includeYear: true,
                    showWeekday: true,
                    weekdayStyle: "long",
                  })}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200/70">
                  <span>{almanac.zodiacEmoji}</span>
                  <span>
                    {almanac.zodiacLabel} · 农历{almanac.lunarDateText}
                  </span>
                </span>
                {(almanac.lunarFestival || almanac.solarTerm) && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200/70">
                    {almanac.lunarFestival
                      ? `🎊 ${almanac.lunarFestival}`
                      : `🌿 ${almanac.solarTerm}`}
                  </span>
                )}
                {!almanac.solarTerm && (
                  <span className="text-[11px] text-slate-400">
                    距{almanac.nextSolarTerm.name} {almanac.nextSolarTerm.daysAway} 天
                  </span>
                )}
                <span className="text-slate-300">·</span>
                <span>
                  第 {weekNo} 周 · Q{almanac.quarter} · 今年已过 {almanac.yearProgressPct}%
                </span>
                <span className="text-slate-300">·</span>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                  待办 {doneCount} / {todayTodos.length} ({pct}%)
                </span>
                {activeHabits.length > 0 && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                    习惯 {habitsTodayDone} / {activeHabits.length}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                支持快速语法 <code className="lw-kbd">@09:30 !1 #标签 /每天 明天</code>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/calendar"
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <Calendar className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden="true" />
              <span>月历</span>
            </Link>
            <Link
              to="/work/weekly"
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden="true" />
              <span>工作周报</span>
            </Link>
            <button
              type="button"
              onClick={openStandupModal}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              title="一键汇总今日已完成/待办/任务生成站会或日终简报"
            >
              <ClipboardList className="h-3.5 w-3.5 shrink-0 text-violet-600" aria-hidden="true" />
              <span>站会日报</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTxKind("expense");
                setTxCategory("餐饮");
                setTxOpen(true);
              }}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              title="快速记一笔生活收支"
            >
              <Wallet className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>记一笔</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingTodo(null);
                setModalOpen(true);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>详细新建</span>
            </button>
            <button
              type="button"
              onClick={() => setTplOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-blue-700"
            >
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>套用排期模板</span>
            </button>
          </div>
        </div>

        <div className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* 快速添加框 */}
      <form
        onSubmit={handleQuickAdd}
        className="lw-card flex flex-wrap items-center gap-2.5 p-3 sm:flex-nowrap"
      >
        <select
          value={quickProjectId}
          onChange={(e) => setQuickProjectId(e.target.value)}
          className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
        >
          {flattenProjectTree(projects).map((item) => (
            <option key={item.project.id} value={item.project.id}>
              {item.indentedLabel}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={quickInput}
          onChange={(e) => setQuickInput(e.target.value)}
          placeholder="快速添加今日待办，例如：完成方案评审 @14:00 !1 #工作  或  夜跑5公里 @20:00 #健康 /每周"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={adding}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>添加</span>
        </button>
      </form>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 左2列：逾期待办 + 今日待办按项目分组 */}
        <div className="space-y-5 lg:col-span-2">
          {overdueTodos.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <AlertCircle className="h-4 w-4" />
                  <span>逾期待办 ({overdueTodos.length})</span>
                </div>
                <button
                  type="button"
                  disabled={rescheduling}
                  onClick={handleRescheduleAllOverdue}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  <CalendarArrowUp className="h-3.5 w-3.5" />
                  <span>一键全部顺延到今日</span>
                </button>
              </div>
              <div className="space-y-2">
                {overdueTodos.map((td) => (
                  <TodoRow
                    key={td.id}
                    todo={td}
                    project={projectMap[td.projectId]}
                    showDate
                    showProject
                    onToggle={handleToggle}
                    onEdit={(item) => {
                      setEditingTodo(item);
                      setModalOpen(true);
                    }}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="lw-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">今日待办（按项目分组）</h2>
              <span className="lw-nums text-xs text-slate-400">{todayTodos.length} 项</span>
            </div>

            {todayTodos.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="今天还没有待办事项"
                description="可以在上方输入快速语法添加待办，或套用预设排期模板一键展开节点"
              />
            ) : (
              <div className="space-y-5">
                {Object.entries(groupedToday).map(([pid, list]) => {
                  const proj = projectMap[pid];
                  return (
                    <div key={pid} className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: proj?.color || "#6b7280" }}
                        />
                        <span>{proj?.name || pid}</span>
                        <span className="text-gray-400">
                          ({list.filter((x) => x.done).length}/{list.length})
                        </span>
                      </div>
                      <div className="space-y-2">
                        {list.map((td) => (
                          <TodoRow
                            key={td.id}
                            todo={td}
                            project={proj}
                            onToggle={handleToggle}
                            onEdit={(item) => {
                              setEditingTodo(item);
                              setModalOpen(true);
                            }}
                            onDelete={handleDelete}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* 右1列：今日习惯打卡 + 倒数日 + 当日时间线 + 明日预览 */}
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Heart className="h-4 w-4 text-emerald-600" />
                <span>今日习惯打卡</span>
              </div>
              <Link
                to="/life/overview"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                全部习惯
              </Link>
            </div>
            {activeHabits.length === 0 ? (
              <div className="py-4 text-center text-xs text-gray-400">暂无习惯</div>
            ) : (
              <div className="space-y-2">
                {activeHabits.map((h) => {
                  const done = h.checkins.includes(today);
                  const streak = calcHabitStreak(h.checkins, today);
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() =>
                        toggleHabitCheckin(h.id, today).catch((e) =>
                          toast.error(`打卡失败: ${e}`),
                        )
                      }
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition ${
                        done
                          ? "border-emerald-200 bg-emerald-50/70"
                          : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-base">{h.icon}</span>
                        <span
                          className={`truncate font-medium ${
                            done ? "text-emerald-900" : "text-gray-800"
                          }`}
                        >
                          {h.name}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {streak > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-600">
                            <Flame className="h-3 w-3" />
                            {streak}天
                          </span>
                        )}
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                            done
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-gray-300 bg-white text-transparent"
                          }`}
                        >
                          <Check className="h-3 w-3 stroke-[3]" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {upcomingCountdowns.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Hourglass className="h-4 w-4 text-violet-600" />
                  <span>即将到来 (14天内)</span>
                </div>
                <Link
                  to="/life/overview"
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  管理
                </Link>
              </div>
              <div className="space-y-2">
                {upcomingCountdowns.map(({ item, days, nextDate }) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800">{item.title}</div>
                      <div className="lw-nums mt-0.5 text-[11px] text-slate-400">
                        {formatDateZh(nextDate, { showWeekday: true })} · {item.category}
                      </div>
                    </div>
                    <span
                      className={`lw-nums ml-2 shrink-0 rounded-full px-2 py-0.5 font-semibold ${
                        days === 0
                          ? "bg-rose-100 text-rose-700"
                          : "bg-violet-50 text-violet-700"
                      }`}
                    >
                      {days === 0 ? "今天" : `还有 ${days} 天`}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Clock className="h-4 w-4 text-blue-600" />
              <span>当日时间线</span>
            </div>
            {timelineItems.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">
                暂无设定具体时间（@HH:MM）的待办
              </div>
            ) : (
              <div className="relative space-y-3 border-l-2 border-blue-100 pl-4">
                {timelineItems.map((td) => {
                  const proj = projectMap[td.projectId];
                  return (
                    <div key={td.id} className="relative">
                      <span
                        className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
                          td.done ? "bg-emerald-500" : "bg-blue-600"
                        }`}
                      />
                      <div className="text-[11px] font-mono font-semibold text-blue-600">
                        {td.time}
                      </div>
                      <div
                        className={`text-xs ${
                          td.done ? "text-gray-400 line-through" : "font-medium text-gray-800"
                        }`}
                      >
                        {td.title}
                      </div>
                      {proj && (
                        <div className="text-[11px] text-gray-400">{proj.name}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="lw-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CalendarDays className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                <span>明日预览 · {formatDateZh(tomorrow, { showWeekday: true })}</span>
              </div>
              <span className="lw-nums text-xs text-slate-400">{tomorrowTodos.length} 项</span>
            </div>
            {tomorrowTodos.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center text-xs text-gray-400">
                <Sparkles className="mb-1.5 h-4 w-4 text-gray-300" />
                <span>明日暂无安排</span>
              </div>
            ) : (
              <div className="space-y-2">
                {tomorrowTodos.map((td) => (
                  <div
                    key={td.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs"
                  >
                    <span className="truncate font-medium text-gray-700">{td.title}</span>
                    <span className="ml-2 shrink-0 font-mono text-[11px] text-gray-400">
                      {td.time || projectMap[td.projectId]?.name || ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {user && (
            <Link
              to="/work/overview"
              className="lw-card block p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/20"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-slate-900">
                  <UserCheck className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                  <span className="truncate">{user.realName}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  已连接
                </span>
              </div>
              {(user.orgName || user.user?.org?.name || user.erp || user.user?.userErp) && (
                <div className="mt-1 truncate text-[11px] text-slate-500">
                  {user.orgName || user.user?.org?.name || ""}
                  {(user.orgName || user.user?.org?.name) && (user.erp || user.user?.userErp) ? " · " : ""}
                  {user.erp || user.user?.userErp || ""}
                </div>
              )}
              {user.capacity &&
                (user.capacity.personalDeliveryCapacity !== undefined ||
                  user.capacity.personalDeliveryCapacityStandard !== undefined) && (
                  <div className="lw-nums mt-2.5 flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                      <Award className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                      <span>个人交付产能</span>
                    </span>
                    <span className="font-semibold text-slate-900">
                      {Number(user.capacity.personalDeliveryCapacity ?? 0).toFixed(2)} /{" "}
                      {Number(user.capacity.personalDeliveryCapacityStandard ?? 0).toFixed(2)}
                      <span
                        className={`ml-1.5 rounded px-1 py-0 text-[10px] ${
                          user.capacity.isQualified
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {user.capacity.isQualified ? "已达标" : "未达标"}
                      </span>
                    </span>
                  </div>
                )}
            </Link>
          )}

          {finance && (
            <Link
              to="/life/finance"
              className="lw-card block p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/20"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                  <Wallet className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  <span>{formatMonthZh(currentYm)} 预算进度</span>
                </span>
                <span className="lw-nums font-semibold text-slate-700">
                  ¥{monthExpense.toFixed(0)} / ¥{finance.monthlyBudget.toFixed(0)}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${
                    finance.monthlyBudget > 0 && monthExpense > finance.monthlyBudget
                      ? "bg-rose-500"
                      : finance.monthlyBudget > 0 && monthExpense / finance.monthlyBudget >= 0.8
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                  style={{
                    width: `${
                      finance.monthlyBudget > 0
                        ? Math.min(100, Math.round((monthExpense / finance.monthlyBudget) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>
            </Link>
          )}
        </div>
      </div>

      <TodoEditModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        todo={editingTodo}
        defaultProjectId={quickProjectId}
        defaultDate={today}
      />

      <ApplyTemplateModal
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        defaultProjectId={quickProjectId}
        defaultStartDate={today}
      />

      {/* 一键站会 / 日终简报弹窗 */}
      {standupOpen && (
        <div
          className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setStandupOpen(false);
          }}
        >
          <div className="lw-modal-panel w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ClipboardList className="h-4 w-4 text-violet-600" />
                <span>今日站会 / 日终工作简报</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[11px]">
                  {(["text", "markdown"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => {
                        setStandupFormat(fmt);
                        setStandupText(buildStandupContent(fmt));
                      }}
                      className={`rounded-md px-2 py-0.5 font-medium transition ${
                        standupFormat === fmt
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {fmt === "text" ? "简洁文本" : "Markdown"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setStandupOpen(false)}
                  aria-label="关闭弹窗"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-5">
              <textarea
                rows={13}
                value={standupText}
                onChange={(e) => setStandupText(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 p-3 font-mono text-xs leading-relaxed text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
              <Link
                to="/work/weekly"
                onClick={() => setStandupOpen(false)}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                前往完整工作周报 →
              </Link>
              <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setStandupOpen(false)}
                  className="shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  关闭
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(standupText)
                      .then(() => toast.success("已复制今日简报到剪贴板"))
                      .catch((err) => toast.error(`复制失败: ${String(err)}`));
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Copy className="h-3.5 w-3.5 shrink-0" />
                  <span>一键复制</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ⚡ 今日快捷记一笔弹窗 */}
      {txOpen && (
        <div
          className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTxOpen(false);
          }}
        >
          <form
            onSubmit={handleQuickTxSubmit}
            className="lw-modal-panel w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Wallet className="h-4 w-4 text-emerald-600" />
                <span>快捷记一笔 ({today})</span>
              </div>
              <button
                type="button"
                onClick={() => setTxOpen(false)}
                aria-label="关闭弹窗"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 p-5 text-xs">
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setTxKind("expense");
                    setTxCategory("餐饮");
                  }}
                  className={`rounded-lg py-1.5 font-medium transition ${
                    txKind === "expense"
                      ? "bg-white text-rose-600 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  支出
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTxKind("income");
                    setTxCategory("工资");
                  }}
                  className={`rounded-lg py-1.5 font-medium transition ${
                    txKind === "income"
                      ? "bg-white text-emerald-600 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  收入
                </button>
              </div>

              <label className="block">
                <span className="font-medium text-slate-700">金额 (¥)</span>
                <input
                  type="number"
                  autoFocus
                  step="0.01"
                  min="0.01"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  placeholder="例如：28.5"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-base font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <div>
                <span className="font-medium text-slate-700">分类</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(txKind === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setTxCategory(cat)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                        txCategory === cat
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="font-medium text-slate-700">备注（可选）</span>
                <input
                  type="text"
                  value={txNote}
                  onChange={(e) => setTxNote(e.target.value)}
                  placeholder="例如：午餐外卖 / 地铁通勤"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
              <Link
                to="/life/finance"
                onClick={() => setTxOpen(false)}
                className="text-xs font-medium text-emerald-700 hover:underline"
              >
                进入轻记账账本 →
              </Link>
              <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setTxOpen(false)}
                  className="shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={txSaving}
                  className="shrink-0 whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {txSaving ? "保存中..." : "保存记账"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
