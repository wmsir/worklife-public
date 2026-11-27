import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  CalendarHeart,
  Check,
  Edit2,
  Eye,
  EyeOff,
  Flame,
  Heart,
  Hourglass,
  Plus,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "../components/ConfirmDialog";
import { DatePicker } from "../components/DatePicker";
import { api } from "../lib/api";
import {
  addDaysYmd,
  calcHabitStreak,
  daysUntilCountdown,
  formatDateZh,
  lastNDaysYmd,
  todayYmd,
} from "../lib/date";
import type { Countdown, Habit } from "../lib/types";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store/appStore";

const HABIT_EMOJIS = ["💧", "🏃", "📖", "🌙", "🧘", "🍎", "💊", "🧹", "💰", "🎯"];
const COLOR_SWATCHES = [
  "#0ea5e9",
  "#10b981",
  "#6366f1",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
];
const COUNTDOWN_CATEGORIES = ["纪念日", "生日", "账单", "体检", "证件", "出行", "其他"];

interface HabitModalProps {
  open: boolean;
  initial: Habit | null;
  onClose: () => void;
  onSave: (habit: Habit) => Promise<void>;
}

function HabitModal({ open, initial, onClose, onSave }: HabitModalProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💧");
  const [color, setColor] = useState("#10b981");
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
  const [targetPerWeek, setTargetPerWeek] = useState(7);
  const [reminderTime, setReminderTime] = useState("");
  const [archived, setArchived] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setIcon(initial.icon || "✅");
      setColor(initial.color || "#10b981");
      setFrequency(initial.frequency === "weekly" ? "weekly" : "daily");
      setTargetPerWeek(initial.targetPerWeek || 7);
      setReminderTime(initial.reminderTime || "");
      setArchived(Boolean(initial.archived));
    } else {
      setName("");
      setIcon("💧");
      setColor("#10b981");
      setFrequency("daily");
      setTargetPerWeek(7);
      setReminderTime("");
      setArchived(false);
    }
  }, [open, initial]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("请输入习惯名称");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: initial?.id || "",
        name: name.trim(),
        icon: icon.trim() || "✅",
        color,
        frequency,
        targetPerWeek: Math.min(7, Math.max(1, Number(targetPerWeek) || 7)),
        reminderTime: reminderTime.trim() || null,
        archived,
        createdAt: initial?.createdAt || "",
        checkins: initial?.checkins || [],
      });
      onClose();
    } catch (err) {
      toast.error(`保存习惯失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">
            {initial ? "编辑习惯" : "新建习惯打卡"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
          <div>
            <label className="mb-1 block font-medium text-gray-700">习惯名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：喝水 2L / 夜跑 30 分钟 / 阅读 20 页"
              autoFocus
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-medium text-gray-700">图标</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {HABIT_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setIcon(em)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base transition ${
                    icon === em
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 bg-white hover:bg-gray-50"
                  }`}
                >
                  {em}
                </button>
              ))}
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={4}
                className="h-8 w-14 rounded-lg border border-gray-200 px-2 text-center text-sm focus:border-blue-500 focus:outline-none"
                title="自定义图标"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-medium text-gray-700">主题色</label>
            <div className="flex items-center gap-2">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-full border-2 transition ${
                    color === c ? "scale-110 border-gray-900" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block font-medium text-gray-700">打卡频率</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as "daily" | "weekly")}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="daily">每日习惯</option>
                <option value="weekly">每周目标</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">每周目标(天)</label>
              <input
                type="number"
                min={1}
                max={7}
                value={targetPerWeek}
                onChange={(e) => setTargetPerWeek(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">提醒时间</label>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {initial && (
            <label className="flex cursor-pointer items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>归档该习惯（不在今日工作台展示，保留历史记录）</span>
            </label>
          )}

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存习惯"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CountdownModalProps {
  open: boolean;
  initial: Countdown | null;
  onClose: () => void;
  onSave: (item: Countdown) => Promise<void>;
}

function CountdownModal({ open, initial, onClose, onSave }: CountdownModalProps) {
  const today = todayYmd();
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState(today);
  const [category, setCategory] = useState("纪念日");
  const [annual, setAnnual] = useState(false);
  const [color, setColor] = useState("#6366f1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setTitle(initial.title);
      setTargetDate(initial.targetDate);
      setCategory(initial.category || "重要日程");
      setAnnual(Boolean(initial.annual));
      setColor(initial.color || "#6366f1");
      setNote(initial.note || "");
    } else {
      setTitle("");
      setTargetDate(addDaysYmd(today, 7));
      setCategory("纪念日");
      setAnnual(false);
      setColor("#6366f1");
      setNote("");
    }
  }, [open, initial, today]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("请输入倒数日标题");
      return;
    }
    if (!targetDate.trim()) {
      toast.error("请选择目标日期");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: initial?.id || "",
        title: title.trim(),
        targetDate: targetDate.trim(),
        category: category.trim() || "其他",
        annual,
        note: note.trim(),
        color,
        createdAt: initial?.createdAt || "",
      });
      onClose();
    } catch (err) {
      toast.error(`保存倒数日失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">
            {initial ? "编辑倒数日" : "新建倒数日 / 周期提醒"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
          <div>
            <label className="mb-1 block font-medium text-gray-700">事项标题 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：信用卡还款 / 驾照换证 / 年度体检 / 结婚纪念日"
              autoFocus
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-slate-700">目标日期 *</label>
              <DatePicker
                value={targetDate}
                onChange={setTargetDate}
                size="md"
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">分类标签</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              >
                {COUNTDOWN_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700">
            <input
              type="checkbox"
              checked={annual}
              onChange={(e) => setAnnual(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>每年按月日循环（如生日、纪念日、年审到期）</span>
          </label>

          <div>
            <label className="mb-1.5 block font-medium text-gray-700">标签色</label>
            <div className="flex items-center gap-2">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-full border-2 transition ${
                    color === c ? "scale-110 border-gray-900" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block font-medium text-gray-700">备注说明</label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="可选：办理所需证件、注意事项..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存倒数日"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LifeOverviewPage() {
  const {
    projects,
    todos,
    habits,
    countdowns,
    finance,
    upsertHabit,
    deleteHabit,
    toggleHabitCheckin,
    upsertCountdown,
    deleteCountdown,
  } = useAppStore(
    useShallow((s) => ({
      projects: s.projects,
      todos: s.todos,
      habits: s.habits,
      countdowns: s.countdowns,
      finance: s.finance,
      upsertHabit: s.upsertHabit,
      deleteHabit: s.deleteHabit,
      toggleHabitCheckin: s.toggleHabitCheckin,
      upsertCountdown: s.upsertCountdown,
      deleteCountdown: s.deleteCountdown,
    })),
  );

  const today = todayYmd();
  const currentYm = today.slice(0, 7);
  const monthExpense = useMemo(
    () =>
      (finance?.transactions || [])
        .filter((tx) => tx.kind === "expense" && tx.date.startsWith(currentYm))
        .reduce((acc, tx) => acc + tx.amount, 0),
    [finance, currentYm],
  );
  const monthlyBudget = finance?.monthlyBudget ?? 5000;
  const budgetRatio =
    monthlyBudget > 0 ? Math.round((monthExpense / monthlyBudget) * 100) : 0;
  const last14 = useMemo(() => lastNDaysYmd(14, today), [today]);
  const last7Set = useMemo(() => new Set(lastNDaysYmd(7, today)), [today]);

  const [journalCount, setJournalCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);

  const [habitModalOpen, setHabitModalOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  const [cdModalOpen, setCdModalOpen] = useState(false);
  const [editingCd, setEditingCd] = useState<Countdown | null>(null);

  useEffect(() => {
    api
      .listJournals()
      .then((list) => setJournalCount(list.length))
      .catch(() => {});
  }, []);

  const activeHabits = useMemo(
    () => habits.filter((h) => !h.archived),
    [habits],
  );
  const visibleHabits = useMemo(
    () => (showArchived ? habits : activeHabits),
    [habits, activeHabits, showArchived],
  );
  const archivedCount = habits.length - activeHabits.length;

  const todayCheckedCount = useMemo(
    () => activeHabits.filter((h) => h.checkins.includes(today)).length,
    [activeHabits, today],
  );
  const habitPct =
    activeHabits.length === 0
      ? 0
      : Math.round((todayCheckedCount / activeHabits.length) * 100);

  const lifeProjectIds = useMemo(() => {
    return new Set(
      projects
        .filter((p) => p.kind === "life" || p.id !== "work")
        .map((p) => p.id),
    );
  }, [projects]);

  const weeklyLifeDoneCount = useMemo(() => {
    return todos.filter((t) => {
      if (!t.done || !lifeProjectIds.has(t.projectId)) return false;
      const refDate = (t.doneAt ? t.doneAt.slice(0, 10) : "") || t.date || "";
      return last7Set.has(refDate);
    }).length;
  }, [todos, lifeProjectIds, last7Set]);

  const sortedCountdowns = useMemo(() => {
    return countdowns
      .map((item) => ({
        item,
        ...daysUntilCountdown(item.targetDate, item.annual, today),
      }))
      .sort((a, b) => {
        const aFuture = a.days >= 0;
        const bFuture = b.days >= 0;
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        if (aFuture) return a.days - b.days;
        return b.days - a.days;
      });
  }, [countdowns, today]);

  const upcoming30Count = useMemo(
    () => sortedCountdowns.filter((c) => c.days >= 0 && c.days <= 30).length,
    [sortedCountdowns],
  );

  const handleSaveHabit = async (h: Habit) => {
    await upsertHabit(h);
    toast.success(h.id ? "习惯已更新" : "新习惯已创建");
  };

  const handleDeleteHabit = async (h: Habit) => {
    const ok = await confirmDialog({
      title: `确定删除习惯「${h.name}」吗？`,
      description: "删除后，该习惯的所有历史打卡记录也将一并移除，且无法恢复。",
      confirmText: "确认删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteHabit(h.id);
      toast.success("已删除习惯");
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  };

  const handleSaveCountdown = async (c: Countdown) => {
    await upsertCountdown(c);
    toast.success(c.id ? "倒数日已更新" : "新倒数日已添加");
  };

  const handleDeleteCountdown = async (c: Countdown) => {
    const ok = await confirmDialog({
      title: `确定删除倒数日「${c.title}」吗？`,
      confirmText: "确认删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteCountdown(c.id);
      toast.success("已删除倒数日");
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  };

  return (
    <div className="space-y-5">
      {/* 顶部标题与生活工作台说明 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-emerald-600" />
            <h1 className="text-lg font-semibold text-gray-900">生活与健康总览</h1>
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              100% 本地离线存储
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            每日微习惯打卡、连续天数追踪、重要倒数日/账单纪念日提醒，全部保存在本地{" "}
            <code className="rounded bg-gray-100 px-1">.lifework</code> 目录。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/life/finance"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Wallet className="h-3.5 w-3.5 text-emerald-600" />
            <span>轻记账与预算</span>
          </Link>
          <Link
            to="/life/journal"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
            <span>写今日日记</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              setEditingHabit(null);
              setHabitModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建习惯</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingCd(null);
              setCdModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建倒数日</span>
          </button>
        </div>
      </div>

      {/* KPI 卡片行 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>今日习惯打卡率</span>
            <Sparkles className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{habitPct}%</span>
            <span className="text-xs text-gray-500">
              {todayCheckedCount} / {activeHabits.length} 项
            </span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${habitPct}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>本周生活待办完成</span>
            <Check className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{weeklyLifeDoneCount}</span>
            <span className="text-xs text-gray-500">近 7 天已打卡事项</span>
          </div>
          <div className="mt-2 text-[11px] text-gray-400">包含生活区与自定义非工作项目</div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>近期倒数日 (30天内)</span>
            <Hourglass className="h-4 w-4 text-violet-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{upcoming30Count}</span>
            <span className="text-xs text-gray-500">共 {countdowns.length} 个提醒</span>
          </div>
          <div className="mt-2 text-[11px] text-gray-400">支持每年按月日自动循环计算</div>
        </div>

        <Link
          to="/life/journal"
          className="group rounded-xl border border-gray-200 bg-white p-4 transition hover:border-indigo-300 hover:bg-indigo-50/20"
        >
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>本地 Markdown 日记</span>
            <BookOpen className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{journalCount}</span>
            <span className="text-xs text-gray-500">篇已记录</span>
          </div>
          <div className="mt-2 text-[11px] text-indigo-600 group-hover:underline">
            前往撰写或导入今日已完成待办 →
          </div>
        </Link>

        <Link
          to="/life/finance"
          className="group rounded-xl border border-gray-200 bg-white p-4 transition hover:border-emerald-300 hover:bg-emerald-50/20"
        >
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{currentYm} 消费支出</span>
            <Wallet className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-gray-900">
              ¥{monthExpense.toFixed(0)}
            </span>
            <span className="text-xs text-gray-500">/ ¥{monthlyBudget.toFixed(0)}</span>
          </div>
          <div className="mt-2 text-[11px] text-emerald-700 group-hover:underline">
            预算已用 {budgetRatio}% · 记一笔 →
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 左 2 列：习惯打卡区 */}
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                习惯打卡与 14 天热力点阵
              </h2>
              <p className="mt-0.5 text-[11px] text-gray-500">
                点击右侧「今日打卡」按钮完成今日打卡，点击任意历史圆点可补卡或撤销。
              </p>
            </div>
            {archivedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                {showArchived ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                <span>{showArchived ? "隐藏已归档" : `显示已归档 (${archivedCount})`}</span>
              </button>
            )}
          </div>

          {visibleHabits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-xs text-gray-400">
              还没有习惯卡片，点击右上角「新建习惯」开始养成好习惯
            </div>
          ) : (
            <div className="space-y-3">
              {visibleHabits.map((h) => {
                const checkinSet = new Set(h.checkins);
                const todayDone = checkinSet.has(today);
                const streak = calcHabitStreak(h.checkins, today);
                const done14 = last14.filter((d) => checkinSet.has(d)).length;
                return (
                  <div
                    key={h.id}
                    className={`rounded-xl border p-4 transition ${
                      h.archived
                        ? "border-gray-200 bg-gray-50/70 opacity-75"
                        : todayDone
                          ? "border-emerald-200 bg-emerald-50/30"
                          : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
                          style={{ backgroundColor: `${h.color}18` }}
                        >
                          {h.icon}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold text-gray-900">
                              {h.name}
                            </span>
                            {h.archived && (
                              <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                                已归档
                              </span>
                            )}
                            {streak > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                <Flame className="h-3 w-3" />
                                连续 {streak} 天
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                            <span>
                              {h.frequency === "weekly" ? "每周习惯" : "每日习惯"} · 目标每周{" "}
                              {h.targetPerWeek} 天
                            </span>
                            {h.reminderTime && (
                              <span className="font-mono text-gray-400">
                                ⏰ {h.reminderTime}
                              </span>
                            )}
                            <span>· 近14天 {done14}/14</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            toggleHabitCheckin(h.id, today).catch((e) =>
                              toast.error(`打卡失败: ${e}`),
                            )
                          }
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                            todayDone
                              ? "bg-emerald-600 text-white hover:bg-emerald-700"
                              : "border border-gray-200 bg-white text-gray-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>{todayDone ? "今日已打卡" : "今日打卡"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingHabit(h);
                            setHabitModalOpen(true);
                          }}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          title="编辑习惯"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHabit(h)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          title="删除习惯"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* 14 天点阵 */}
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
                      <span className="shrink-0 text-[10px] text-gray-400">近 14 天记录</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {last14.map((ymd) => {
                          const checked = checkinSet.has(ymd);
                          const isToday = ymd === today;
                          return (
                            <button
                              key={ymd}
                              type="button"
                              onClick={() =>
                                toggleHabitCheckin(h.id, ymd).catch((e) =>
                                  toast.error(`操作失败: ${e}`),
                                )
                              }
                              title={`${formatDateZh(ymd, { includeYear: true, showWeekday: true })} (${checked ? "已打卡，点击撤销" : "未打卡，点击补卡"})`}
                              className={`lw-nums flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-medium transition ${
                                isToday ? "ring-2 ring-offset-1 ring-emerald-500" : ""
                              }`}
                              style={{
                                backgroundColor: checked ? h.color : "#f3f4f6",
                                color: checked ? "#ffffff" : "#9ca3af",
                              }}
                            >
                              {ymd.slice(8)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 右 1 列：重要倒数日与周期提醒区 */}
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarHeart className="h-4 w-4 text-indigo-600" />
              <h2 className="text-sm font-semibold text-gray-900">重要倒数日与周期提醒</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingCd(null);
                setCdModalOpen(true);
              }}
              className="text-xs font-medium text-indigo-600 hover:underline"
            >
              + 添加
            </button>
          </div>

          {sortedCountdowns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-12 text-center text-xs text-gray-400">
              <p>暂无倒数日提醒</p>
              <p className="mt-1">可添加纪念日、房租/信用卡还款、体检、证件续期等事项</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sortedCountdowns.map(({ item, days, nextDate }) => {
                const badgeClass =
                  days === 0
                    ? "bg-rose-100 text-rose-700"
                    : days > 0 && days <= 7
                      ? "bg-amber-100 text-amber-800"
                      : days > 0
                        ? "bg-indigo-50 text-indigo-700"
                        : "bg-gray-100 text-gray-500";
                const daysText =
                  days === 0
                    ? "今天 🎉"
                    : days > 0
                      ? `还有 ${days} 天`
                      : `已过 ${Math.abs(days)} 天`;
                return (
                  <div
                    key={item.id}
                    className="group rounded-xl border border-gray-200 p-3 transition hover:border-indigo-200"
                    style={{ borderLeftWidth: 4, borderLeftColor: item.color }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-gray-900">
                            {item.title}
                          </span>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                            {item.category}
                          </span>
                          {item.annual && (
                            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
                              每年重复
                            </span>
                          )}
                        </div>
                        <div className="lw-nums mt-1 text-[11px] text-slate-500">
                          {formatDateZh(nextDate, { showWeekday: true })}
                          {item.annual && item.targetDate !== nextDate && (
                            <span className="ml-1.5 text-slate-400">
                              (起始 {formatDateZh(item.targetDate, { includeYear: true })})
                            </span>
                          )}
                        </div>
                        {item.note && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-gray-500">
                            {item.note}
                          </p>
                        )}
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${badgeClass}`}
                      >
                        {daysText}
                      </span>
                    </div>

                    <div className="mt-2 flex justify-end gap-1 opacity-75 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCd(item);
                          setCdModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                      >
                        <Edit2 className="h-3 w-3" />
                        <span>编辑</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCountdown(item)}
                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-gray-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>删除</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <HabitModal
        open={habitModalOpen}
        initial={editingHabit}
        onClose={() => setHabitModalOpen(false)}
        onSave={handleSaveHabit}
      />

      <CountdownModal
        open={cdModalOpen}
        initial={editingCd}
        onClose={() => setCdModalOpen(false)}
        onSave={handleSaveCountdown}
      />
    </div>
  );
}
