import { useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarArrowUp,
  Inbox,
  Kanban,
  List,
  Play,
  Plus,
  Search,
  Sun,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { DateBadge } from "../components/DateBadge";
import { TodoEditModal } from "../components/TodoEditModal";
import { TodoRow } from "../components/TodoRow";
import { EmptyState, SegmentedTabs } from "../components/UiKit";
import {
  addDaysYmd,
  formatDateZh,
  parseQuickTodo,
  todayYmd,
  weekRangeYmd,
} from "../lib/date";
import { flattenProjectTree, getProjectDescendantIds } from "../lib/projects";
import type { Todo } from "../lib/types";
import { useAppStore } from "../store/appStore";
import { useFocusStore } from "../store/runtimeStore";

type FilterMode = "inbox" | "all" | "today" | "overdue" | "week" | "repeat" | "done";

export function TodosPage() {
  const {
    projects,
    todos,
    upsertTodo,
    toggleTodo,
    deleteTodo,
    batchRescheduleTodos,
    clearDoneTodos,
  } = useAppStore(
    useShallow((s) => ({
      projects: s.projects,
      todos: s.todos,
      upsertTodo: s.upsertTodo,
      toggleTodo: s.toggleTodo,
      deleteTodo: s.deleteTodo,
      batchRescheduleTodos: s.batchRescheduleTodos,
      clearDoneTodos: s.clearDoneTodos,
    })),
  );
  const startFocus = useFocusStore((s) => s.startFocus);

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [projectId, setProjectId] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quickInput, setQuickInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);

  const today = todayYmd();
  const tomorrow = addDaysYmd(today, 1);
  const week = weekRangeYmd();

  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects],
  );

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of todos) {
      for (const tg of t.tags ?? []) {
        if (tg.trim()) set.add(tg.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [todos]);

  const overdueTodos = useMemo(
    () => todos.filter((t) => !t.done && Boolean(t.date) && t.date! < today),
    [todos, today],
  );

  const counts = useMemo(
    () => ({
      inbox: todos.filter((t) => !t.done && !t.date).length,
      all: todos.length,
      today: todos.filter((t) => t.date === today).length,
      overdue: overdueTodos.length,
      week: todos.filter((t) => t.date && t.date >= week.start && t.date <= week.end).length,
      repeat: todos.filter((t) => t.repeat && t.repeat !== "none").length,
      done: todos.filter((t) => t.done).length,
    }),
    [todos, today, overdueTodos.length, week.start, week.end],
  );

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const allowedPids =
      projectId === "all" ? null : getProjectDescendantIds(projects, projectId);
    return todos
      .filter((t) => {
        if (allowedPids && !allowedPids.has(t.projectId)) return false;
        if (tagFilter !== "all" && !(t.tags ?? []).includes(tagFilter)) return false;
        if (filterMode === "inbox" && (t.done || !!t.date)) return false;
        if (filterMode === "today" && t.date !== today) return false;
        if (filterMode === "overdue" && (t.done || !t.date || t.date >= today)) return false;
        if (filterMode === "week") {
          if (!t.date || t.date < week.start || t.date > week.end) return false;
        }
        if (filterMode === "repeat" && (!t.repeat || t.repeat === "none")) return false;
        if (filterMode === "done" && !t.done) return false;
        if (q) {
          const hit =
            t.title.toLowerCase().includes(q) ||
            t.note.toLowerCase().includes(q) ||
            (t.taskCode && t.taskCode.toLowerCase().includes(q)) ||
            (t.tags ?? []).some((tg) => tg.toLowerCase().includes(q));
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const da = a.date || "9999-99-99";
        const db = b.date || "9999-99-99";
        if (da !== db) return da.localeCompare(db);
        return a.priority - b.priority;
      });
  }, [todos, projects, projectId, tagFilter, filterMode, keyword, today, week.start, week.end]);

  const handleToggle = async (id: string) => {
    try {
      const res = await toggleTodo(id);
      if (res.spawned) {
        toast.success(
          `已完成「${res.todo.title}」，已生成下一次重复待办 (${res.spawned.date ?? ""})`,
        );
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTodo(id);
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      toast.success("已删除待办");
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;
    const { title, date, time, priority, tags, repeat } = parseQuickTodo(quickInput);
    if (!title) {
      toast.error("请输入有效的待办标题");
      return;
    }
    const targetDate =
      filterMode === "inbox" ? null : date ?? (filterMode === "today" ? today : null);
    try {
      await upsertTodo({
        projectId: projectId === "all" ? "work" : projectId,
        title,
        date: targetDate,
        time,
        priority,
        tags,
        repeat,
      });
      setQuickInput("");
      toast.success(
        targetDate
          ? `已添加到 ${formatDateZh(targetDate, { showWeekday: true })}`
          : "已放入收集箱",
      );
    } catch (err) {
      toast.error(`添加失败: ${err}`);
    }
  };

  const handleBatchMove = async (targetDate: string | null, label: string) => {
    if (selectedIds.length === 0) return;
    try {
      await batchRescheduleTodos(selectedIds, targetDate);
      toast.success(`已将 ${selectedIds.length} 项待办移至${label}`);
      setSelectedIds([]);
    } catch (err) {
      toast.error(`批量调整失败: ${err}`);
    }
  };

  const handleClearDone = async () => {
    try {
      const n = await clearDoneTodos(projectId === "all" ? null : projectId);
      if (n === 0) {
        toast.info("没有可清理的已完成待办");
      } else {
        toast.success(`已清理 ${n} 条已完成待办`);
      }
    } catch (err) {
      toast.error(`清理失败: ${err}`);
    }
  };

  const handleMoveOverdueToToday = async () => {
    if (overdueTodos.length === 0) return;
    try {
      await batchRescheduleTodos(
        overdueTodos.map((t) => t.id),
        today,
      );
      toast.success(`已将 ${overdueTodos.length} 条逾期待办顺延到今天`);
      setSelectedIds([]);
    } catch (err) {
      toast.error(`顺延失败: ${err}`);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="lw-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["inbox", "收集箱", counts.inbox],
              ["all", "全部", counts.all],
              ["today", "今天", counts.today],
              ["overdue", "逾期", counts.overdue],
              ["week", "本周", counts.week],
              ["repeat", "重复", counts.repeat],
              ["done", "已完成", counts.done],
            ] as const
          ).map(([k, lbl, cnt]) => {
            const isOverdueAlert = k === "overdue" && cnt > 0 && filterMode !== "overdue";
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setFilterMode(k);
                  setSelectedIds([]);
                }}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  filterMode === k
                    ? k === "overdue"
                      ? "bg-rose-600 text-white shadow-2xs"
                      : "bg-blue-600 text-white shadow-2xs"
                    : isOverdueAlert
                      ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200/80"
                }`}
              >
                {k === "inbox" && <Inbox className="h-3.5 w-3.5" aria-hidden="true" />}
                {k === "overdue" && <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>{lbl}</span>
                <span
                  className={`lw-nums rounded-full px-1.5 py-0 text-[10px] ${
                    filterMode === k
                      ? k === "overdue"
                        ? "bg-rose-500 text-white"
                        : "bg-blue-500 text-white"
                      : isOverdueAlert
                        ? "bg-rose-100 text-rose-700"
                        : "bg-white text-slate-500"
                  }`}
                >
                  {cnt}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs
            value={viewMode}
            onChange={setViewMode}
            items={[
              { value: "list", label: "清单", icon: List },
              { value: "board", label: "优先级看板", icon: Kanban },
            ]}
          />

          {counts.overdue > 0 && (
            <button
              type="button"
              onClick={handleMoveOverdueToToday}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
              title="将所有未完成且早于今天的待办一键移至今日"
            >
              <Sun className="h-3.5 w-3.5" />
              <span>顺延逾期 ({counts.overdue})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleClearDone}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            title="清理当前范围内的已完成待办"
          >
            <Trash2 className="h-3.5 w-3.5 text-gray-400" />
            <span>清理已完成</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingTodo(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建待办</span>
          </button>
        </div>
      </div>

      {/* 过滤栏与快速收集 */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-3">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
        >
          <option value="all">全部项目</option>
          {flattenProjectTree(projects).map((item) => (
            <option key={item.project.id} value={item.project.id}>
              {item.indentedLabel}
            </option>
          ))}
        </select>

        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
        >
          <option value="all">全部标签</option>
          {allTags.map((tg) => (
            <option key={tg} value={tg}>
              #{tg}
            </option>
          ))}
        </select>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题/备注/标签..."
            className="w-44 rounded-lg border border-gray-200 py-1.5 pr-3 pl-8 text-xs focus:border-blue-500 focus:outline-none"
          />
        </div>

        <form onSubmit={handleQuickAdd} className="flex min-w-[260px] flex-1 items-center gap-2">
          <input
            type="text"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder={
              filterMode === "inbox"
                ? "直接回车速记到收集箱（支持 #标签 !1 /每周）..."
                : "快速新增待办（支持 明天 @18:00 !1 #标签 /每天）..."
            }
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
          >
            快速添加
          </button>
        </form>
      </div>

      {viewMode === "list" ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <div className="flex items-center gap-3">
              <span>共 {filtered.length} 条记录</span>
              <span>未完成 {filtered.filter((t) => !t.done).length} 条</span>
              {filtered.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIds(
                      selectedIds.length === filtered.length
                        ? []
                        : filtered.map((t) => t.id),
                    )
                  }
                  className="font-medium text-blue-600 hover:underline"
                >
                  {selectedIds.length === filtered.length ? "取消全选" : "全选当前"}
                </button>
              )}
            </div>

            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-blue-700">已选 {selectedIds.length} 项：</span>
                <button
                  type="button"
                  onClick={() => handleBatchMove(today, "今天")}
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                >
                  <Sun className="h-3 w-3" />
                  <span>移至今日</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBatchMove(tomorrow, "明天")}
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  <CalendarArrowUp className="h-3 w-3" />
                  <span>推迟明天</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBatchMove(null, "收集箱")}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                >
                  <Inbox className="h-3 w-3" />
                  <span>放入收集箱</span>
                </button>
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={List}
              title="暂无符合条件的待办"
              description="可调整上方筛选条件，或在输入框直接使用快速语法添加"
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((td) => (
                <TodoRow
                  key={td.id}
                  todo={td}
                  project={projectMap[td.projectId]}
                  showDate
                  showProject
                  selectable
                  selected={selectedIds.includes(td.id)}
                  onSelectChange={(id, checked) =>
                    setSelectedIds((prev) =>
                      checked ? [...prev, id] : prev.filter((x) => x !== id),
                    )
                  }
                  onToggle={handleToggle}
                  onEdit={(item) => {
                    setEditingTodo(item);
                    setModalOpen(true);
                  }}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(
            [
              { p: 1 as const, label: "!1 高优先级 · 优先处理", headerCls: "text-red-700 bg-red-50 border-red-200" },
              { p: 2 as const, label: "!2 中优先级 · 计划推进", headerCls: "text-amber-700 bg-amber-50 border-amber-200" },
              { p: 3 as const, label: "!3 低优先级 · 随时处理", headerCls: "text-gray-700 bg-gray-100 border-gray-200" },
            ]
          ).map((col) => {
            const items = filtered.filter((t) => !t.done && t.priority === col.p);
            return (
              <div
                key={col.p}
                className="flex flex-col rounded-xl border border-gray-200 bg-white p-3.5"
              >
                <div
                  className={`mb-3 flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold ${col.headerCls}`}
                >
                  <span>{col.label}</span>
                  <span>{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <div className="py-8 text-center text-xs text-gray-400">暂无待办</div>
                  ) : (
                    items.map((td) => {
                      const proj = projectMap[td.projectId];
                      return (
                        <div
                          key={td.id}
                          className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 text-xs hover:border-gray-200"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => handleToggle(td.id)}
                              className="text-left font-medium text-gray-900 hover:text-blue-600"
                              title="点击标为完成"
                            >
                              {td.title}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                startFocus(td.id, td.title, 25);
                                toast.success(`开始 25 分钟专注：${td.title}`);
                              }}
                              className="shrink-0 rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                              title="专注 25 分钟"
                            >
                              <Play className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500">
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              <DateBadge date={td.date} done={td.done} showWeekday showIcon={false} />
                              {proj && <span className="text-slate-400">{proj.name}</span>}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {td.date !== today && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    batchRescheduleTodos([td.id], today).then(() =>
                                      toast.success("已移至今日"),
                                    )
                                  }
                                  className="text-blue-600 hover:underline"
                                >
                                  移至今日
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTodo(td);
                                  setModalOpen(true);
                                }}
                                className="text-gray-500 hover:underline"
                              >
                                编辑
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TodoEditModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        todo={editingTodo}
        defaultProjectId={projectId === "all" ? "work" : projectId}
        defaultDate={filterMode === "inbox" ? null : today}
      />
    </div>
  );
}
