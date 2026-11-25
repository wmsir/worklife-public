import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderArchive,
  Heart,
  Hourglass,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { CalendarDateTile, DateBadge } from "../components/DateBadge";
import { MonthPicker } from "../components/DatePicker";
import { TodoEditModal } from "../components/TodoEditModal";
import { TodoRow } from "../components/TodoRow";
import { SegmentedTabs } from "../components/UiKit";
import { api } from "../lib/api";
import { flattenProjectTree } from "../lib/projects";
import {
  addDaysYmd,
  formatDateZh,
  formatYmd,
  parseQuickTodo,
  todayYmd,
} from "../lib/date";
import type { CnDayInfo, JournalSummary, TaskRecord, Todo } from "../lib/types";
import { useAppStore } from "../store/appStore";

type LayerFilter = "all" | "todo" | "task" | "countdown" | "life";

function matchCountdownDateInRange(
  targetDate: string,
  annual: boolean,
  years: number[],
): string[] {
  if (!targetDate) return [];
  if (!annual) return [targetDate];
  const [, tm, td] = targetDate.split("-").map(Number);
  if (!tm || !td) return [];
  return years.map((y) => {
    const maxDay = new Date(Date.UTC(y, tm, 0)).getUTCDate();
    const d = Math.min(td, maxDay);
    return `${y}-${String(tm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
}

export function CalendarPage() {
  const navigate = useNavigate();
  const {
    projects,
    todos,
    tasks,
    habits,
    countdowns,
    upsertTodo,
    toggleTodo,
    deleteTodo,
    toggleHabitCheckin,
  } = useAppStore(
    useShallow((s) => ({
      projects: s.projects,
      todos: s.todos,
      tasks: s.tasks,
      habits: s.habits,
      countdowns: s.countdowns,
      upsertTodo: s.upsertTodo,
      toggleTodo: s.toggleTodo,
      deleteTodo: s.deleteTodo,
      toggleHabitCheckin: s.toggleHabitCheckin,
    })),
  );

  const today = todayYmd();
  const [viewYear, setViewYear] = useState(() => Number(today.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(today.slice(5, 7)));
  const [selectedDate, setSelectedDate] = useState(today);
  const [layer, setLayer] = useState<LayerFilter>("all");

  const [cnMap, setCnMap] = useState<Record<string, CnDayInfo>>({});
  const [journals, setJournals] = useState<JournalSummary[]>([]);

  const [quickText, setQuickText] = useState("");
  const [quickProjectId, setQuickProjectId] = useState(projects[0]?.id || "work");
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects],
  );

  const loadCalendarMeta = useCallback(async (y: number, m: number) => {
    try {
      const [info, jList] = await Promise.all([
        api.getCalendarMonthInfo(y, m),
        api.listJournals(),
      ]);
      setCnMap(info);
      setJournals(jList);
    } catch {
      // Ignore transient error
    }
  }, []);

  useEffect(() => {
    void loadCalendarMeta(viewYear, viewMonth);
  }, [viewYear, viewMonth, loadCalendarMeta]);

  const gridDates = useMemo(() => {
    const first = new Date(viewYear, viewMonth - 1, 1);
    const startDow = (first.getDay() + 6) % 7; // 0=Mon..6=Sun
    const gridStart = formatYmd(new Date(viewYear, viewMonth - 1, 1 - startDow));
    const out: string[] = [];
    for (let i = 0; i < 42; i += 1) {
      out.push(addDaysYmd(gridStart, i));
    }
    return out;
  }, [viewYear, viewMonth]);

  const gridYears = useMemo(() => {
    const s = new Set<number>();
    for (const d of gridDates) s.add(Number(d.slice(0, 4)));
    return Array.from(s);
  }, [gridDates]);

  const todosByDate = useMemo(() => {
    const map: Record<string, Todo[]> = {};
    for (const td of todos) {
      if (!td.date) continue;
      if (!map[td.date]) map[td.date] = [];
      map[td.date].push(td);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.priority - b.priority;
      });
    }
    return map;
  }, [todos]);

  const taskEventsByDate = useMemo(() => {
    const map: Record<string, Array<{ task: TaskRecord; kind: string }>> = {};
    const add = (dateStr: string | undefined, task: TaskRecord, kind: string) => {
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push({ task, kind });
    };
    for (const t of tasks) {
      add(t.planTestDate, t, "提测");
      add(t.releaseDate, t, "发版");
      if (t.startDate && t.startDate !== t.planTestDate && t.startDate !== t.releaseDate) {
        add(t.startDate, t, "立项");
      }
    }
    return map;
  }, [tasks]);

  const countdownsByDate = useMemo(() => {
    const map: Record<string, typeof countdowns> = {};
    for (const cd of countdowns) {
      const dates = matchCountdownDateInRange(cd.targetDate, cd.annual, gridYears);
      for (const d of dates) {
        if (!map[d]) map[d] = [];
        map[d].push(cd);
      }
    }
    return map;
  }, [countdowns, gridYears]);

  const journalByDate = useMemo(
    () => Object.fromEntries(journals.map((j) => [j.date, j])),
    [journals],
  );

  const activeHabits = useMemo(() => habits.filter((h) => !h.archived), [habits]);

  const habitCheckinCountByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of activeHabits) {
      for (const d of h.checkins) {
        map[d] = (map[d] || 0) + 1;
      }
    }
    return map;
  }, [activeHabits]);

  const shiftMonth = (delta: number) => {
    const dt = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(dt.getFullYear());
    setViewMonth(dt.getMonth() + 1);
  };

  const jumpToday = () => {
    setViewYear(Number(today.slice(0, 4)));
    setViewMonth(Number(today.slice(5, 7)));
    setSelectedDate(today);
  };

  const handleQuickAddOnSelected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickText.trim()) return;
    const { title, date, time, priority, tags, repeat } = parseQuickTodo(quickText);
    if (!title) {
      toast.error("请输入有效的待办标题");
      return;
    }
    try {
      const targetDate = date ?? selectedDate;
      await upsertTodo({
        projectId: quickProjectId || projects[0]?.id || "work",
        title,
        date: targetDate,
        time,
        priority,
        tags,
        repeat,
      });
      setQuickText("");
      toast.success(`已添加到 ${formatDateZh(targetDate, { showWeekday: true })}`);
    } catch (err) {
      toast.error(`添加失败: ${err}`);
    }
  };

  const selectedDayTodos = todosByDate[selectedDate] || [];
  const selectedDayTasks = taskEventsByDate[selectedDate] || [];
  const selectedDayCountdowns = countdownsByDate[selectedDate] || [];
  const selectedDayJournal = journalByDate[selectedDate];
  const selectedCn = cnMap[selectedDate];
  const monthPrefix = `${viewYear}-${String(viewMonth).padStart(2, "0")}`;

  const handleToggleTodo = async (id: string) => {
    try {
      const res = await toggleTodo(id);
      if (res.spawned) {
        toast.success(`已完成「${res.todo.title}」，已生成下期 (${res.spawned.date ?? ""})`);
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶栏控制与图层过滤 */}
      <div className="lw-card flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <CalendarIcon className="h-4 w-4" aria-hidden="true" />
            </div>
            <h1 className="text-base font-semibold tracking-tight text-slate-900">
              工作与生活全景月历
            </h1>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/90 p-0.5">
            <button
              type="button"
              aria-label="上个月"
              onClick={() => shiftMonth(-1)}
              className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
              title="上个月"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <MonthPicker
              value={monthPrefix}
              onChange={(ym) => {
                if (/^\d{4}-\d{2}$/.test(ym)) {
                  setViewYear(Number(ym.slice(0, 4)));
                  setViewMonth(Number(ym.slice(5, 7)));
                }
              }}
              size="sm"
              className="min-w-[118px]"
            />
            <button
              type="button"
              aria-label="下个月"
              onClick={() => shiftMonth(1)}
              className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-white hover:text-slate-900"
              title="下个月"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={jumpToday}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            回到今天
          </button>
        </div>

        <SegmentedTabs
          value={layer}
          onChange={setLayer}
          items={[
            { value: "all", label: "全部图层" },
            { value: "todo", label: "待办" },
            { value: "task", label: "提测与发版" },
            { value: "countdown", label: "倒数日" },
            { value: "life", label: "习惯与日记" },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* 左 2 列：月历网格 */}
        <div className="lw-card overflow-hidden xl:col-span-2">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 text-center text-xs font-semibold text-gray-600">
            {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((w, idx) => (
              <div
                key={w}
                className={`py-2.5 ${idx >= 5 ? "text-rose-500" : ""}`}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 divide-x divide-y divide-gray-100">
            {gridDates.map((ymd) => {
              const inMonth = ymd.startsWith(monthPrefix);
              const isToday = ymd === today;
              const isSelected = ymd === selectedDate;
              const cn = cnMap[ymd];
              const isHoliday = cn?.day_type === "holiday";
              const isInLieu = cn?.day_type === "in_lieu";
              const isWeekendOff = cn?.day_type === "weekend";

              const dayTodos = layer === "all" || layer === "todo" ? todosByDate[ymd] || [] : [];
              const dayTasks = layer === "all" || layer === "task" ? taskEventsByDate[ymd] || [] : [];
              const dayCds =
                layer === "all" || layer === "countdown" ? countdownsByDate[ymd] || [] : [];
              const hasJournal =
                (layer === "all" || layer === "life") && Boolean(journalByDate[ymd]);
              const habitCount =
                layer === "all" || layer === "life" ? habitCheckinCountByDate[ymd] || 0 : 0;

              const pills: Array<{ key: string; text: string; cls: string }> = [];
              for (const ev of dayTasks) {
                const cls =
                  ev.kind === "发版"
                    ? "bg-rose-100 text-rose-700"
                    : ev.kind === "提测"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-slate-700";
                pills.push({
                  key: `task-${ev.kind}-${ev.task.code}`,
                  text: `[${ev.kind}] ${ev.task.code}`,
                  cls,
                });
              }
              for (const cd of dayCds) {
                pills.push({
                  key: `cd-${cd.id}`,
                  text: `🎉 ${cd.title}`,
                  cls: "bg-violet-100 text-violet-700",
                });
              }
              for (const td of dayTodos) {
                pills.push({
                  key: `td-${td.id}`,
                  text: td.title,
                  cls: td.done
                    ? "bg-gray-100 text-gray-400 line-through"
                    : td.priority === 1
                      ? "bg-blue-100 text-blue-800"
                      : "bg-sky-50 text-sky-700",
                });
              }

              const visiblePills = pills.slice(0, 3);
              const extraCount = pills.length - visiblePills.length;

              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => setSelectedDate(ymd)}
                  className={`flex min-h-26 flex-col justify-between p-1.5 text-left align-top transition ${
                    !inMonth
                      ? "bg-gray-50/70 text-gray-400"
                      : isHoliday || isWeekendOff
                        ? "bg-rose-50/20 hover:bg-blue-50/30"
                        : "bg-white hover:bg-blue-50/30"
                  } ${isSelected ? "ring-2 ring-inset ring-blue-500" : ""}`}
                >
                  <div className="w-full">
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <span
                        className={`lw-nums inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${
                          isToday
                            ? "bg-blue-600 text-white shadow-2xs"
                            : !inMonth
                              ? "text-slate-400"
                              : isHoliday
                                ? "text-rose-600"
                                : "text-slate-800"
                        }`}
                      >
                        {Number(ymd.slice(8, 10))}
                      </span>

                      {isHoliday && (
                        <span className="truncate rounded bg-rose-100 px-1 py-0.5 text-[9px] font-medium text-rose-700">
                          休·{cn?.holiday_name || "假"}
                        </span>
                      )}
                      {isInLieu && (
                        <span className="truncate rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800">
                          班
                        </span>
                      )}
                    </div>

                    <div className="space-y-0.5">
                      {visiblePills.map((p) => (
                        <div
                          key={p.key}
                          className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${p.cls}`}
                          title={p.text}
                        >
                          {p.text}
                        </div>
                      ))}
                      {extraCount > 0 && (
                        <div className="px-1 text-[10px] font-medium text-gray-400">
                          +{extraCount} 项
                        </div>
                      )}
                    </div>
                  </div>

                  {(hasJournal || habitCount > 0) && (
                    <div className="mt-1 flex items-center justify-end gap-1">
                      {habitCount > 0 && (
                        <span
                          className="rounded bg-emerald-50 px-1 text-[9px] font-medium text-emerald-700"
                          title={`当日打卡 ${habitCount} 项习惯`}
                        >
                          ✓{habitCount}
                        </span>
                      )}
                      {hasJournal && (
                        <span
                          className="h-2 w-2 rounded-full bg-indigo-500"
                          title="当日已写日记"
                        />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右 1 列：选中日期联动详情工作面板 */}
        <div className="flex flex-col gap-4">
          <div className="lw-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <CalendarDateTile date={selectedDate} size="md" cnInfo={selectedCn} />
                <div className="min-w-0">
                  <div className="lw-nums truncate text-sm font-bold text-slate-900">
                    {formatDateZh(selectedDate, {
                      includeYear: true,
                      showWeekday: true,
                      weekdayStyle: "long",
                    })}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <DateBadge date={selectedDate} variant="subtle" showIcon={false} />
                    {selectedCn && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          selectedCn.day_type === "holiday"
                            ? "bg-rose-100 text-rose-700"
                            : selectedCn.day_type === "in_lieu"
                              ? "bg-amber-100 text-amber-800"
                              : selectedCn.is_workday
                                ? "bg-blue-50 text-blue-700"
                                : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {selectedCn.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate(`/life/journal?date=${selectedDate}`)}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{selectedDayJournal ? "查看日记" : "写当日日记"}</span>
              </button>
            </div>

            {selectedDayJournal && (
              <div className="mt-2.5 rounded-xl bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-900">
                <span className="font-medium">日记摘要：</span>
                {selectedDayJournal.preview || "（空白正文）"}
              </div>
            )}

            {/* 当日快速添加待办 */}
            <form onSubmit={handleQuickAddOnSelected} className="mt-3 flex gap-1.5">
              <select
                value={quickProjectId}
                onChange={(e) => setQuickProjectId(e.target.value)}
                className="w-22 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
              >
                {flattenProjectTree(projects).map((item) => (
                  <option key={item.project.id} value={item.project.id}>
                    {item.indentedLabel}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                placeholder={`添加到 ${formatDateZh(selectedDate)} (@14:00 !1)`}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                aria-label="添加到选中日期"
                className="inline-flex shrink-0 items-center rounded-xl bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </form>
          </div>

          {/* 当日待办 */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-900">
                当日待办 ({selectedDayTodos.length})
              </h2>
              <button
                type="button"
                onClick={() => {
                  setEditingTodo(null);
                  setModalOpen(true);
                }}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                + 详细新建
              </button>
            </div>
            {selectedDayTodos.length === 0 ? (
              <div className="py-4 text-center text-xs text-gray-400">当日暂无安排待办</div>
            ) : (
              <div className="space-y-2">
                {selectedDayTodos.map((td) => (
                  <TodoRow
                    key={td.id}
                    todo={td}
                    project={projectMap[td.projectId]}
                    showDate={false}
                    showProject
                    onToggle={handleToggleTodo}
                    onEdit={(t) => {
                      setEditingTodo(t);
                      setModalOpen(true);
                    }}
                    onDelete={(id) =>
                      deleteTodo(id)
                        .then(() => toast.success("已删除待办"))
                        .catch((e) => toast.error(String(e)))
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* 当日提测发版与倒数日 */}
          {(selectedDayTasks.length > 0 || selectedDayCountdowns.length > 0) && (
            <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
              {selectedDayTasks.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-900">
                    <FolderArchive className="h-3.5 w-3.5 text-amber-600" />
                    <span>研发节点里程碑</span>
                  </div>
                  <div className="space-y-1.5">
                    {selectedDayTasks.map(({ task, kind }) => (
                      <Link
                        key={`${kind}-${task.code}`}
                        to={`/work/task/${encodeURIComponent(task.code)}`}
                        className="flex items-center justify-between rounded-lg border border-gray-100 px-2.5 py-1.5 text-xs hover:border-blue-300 hover:bg-blue-50/40"
                      >
                        <span className="truncate font-medium text-gray-800">
                          <span className="mr-1.5 font-mono text-blue-600">{task.code}</span>
                          {task.name}
                        </span>
                        <span className="ml-2 shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          {kind}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {selectedDayCountdowns.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-900">
                    <Hourglass className="h-3.5 w-3.5 text-violet-600" />
                    <span>重要倒数日</span>
                  </div>
                  <div className="space-y-1.5">
                    {selectedDayCountdowns.map((cd) => (
                      <div
                        key={cd.id}
                        className="flex items-center justify-between rounded-lg border border-violet-100 bg-violet-50/50 px-2.5 py-1.5 text-xs"
                      >
                        <span className="font-medium text-violet-900">{cd.title}</span>
                        <span className="text-[10px] text-violet-600">{cd.category}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 当日习惯打卡 */}
          {activeHabits.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Heart className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                <span>{formatDateZh(selectedDate, { showWeekday: true })} 习惯打卡（点击补卡/撤销）</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeHabits.map((h) => {
                  const done = h.checkins.includes(selectedDate);
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() =>
                        toggleHabitCheckin(h.id, selectedDate).catch((e) =>
                          toast.error(`打卡失败: ${e}`),
                        )
                      }
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
                        done
                          ? "border-emerald-300 bg-emerald-50 font-medium text-emerald-800"
                          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <span>{h.icon}</span>
                      <span>{h.name}</span>
                      {done && <Check className="h-3 w-3 text-emerald-600" />}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      <TodoEditModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        todo={editingTodo}
        defaultProjectId={quickProjectId}
        defaultDate={selectedDate}
      />
    </div>
  );
}
