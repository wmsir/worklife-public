import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BookOpen,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eye,
  FileUp,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { confirmDialog } from "../components/ConfirmDialog";
import { CalendarDateTile, DateBadge } from "../components/DateBadge";
import { DatePicker } from "../components/DatePicker";
import { TencentDocPushModal } from "../components/TencentDocPushModal";
import { api } from "../lib/api";
import { addDaysYmd, formatDateZh, todayYmd } from "../lib/date";
import type { JournalSummary } from "../lib/types";
import { useAppStore } from "../store/appStore";

const MOOD_OPTIONS = [
  { value: 1, emoji: "😫", label: "低落" },
  { value: 2, emoji: "😕", label: "疲惫" },
  { value: 3, emoji: "😐", label: "平静" },
  { value: 4, emoji: "🙂", label: "不错" },
  { value: 5, emoji: "😄", label: "充实" },
];

export function LifeJournalPage() {
  const { todos, projects } = useAppStore(
    useShallow((s) => ({ todos: s.todos, projects: s.projects })),
  );
  const [searchParams] = useSearchParams();
  const today = todayYmd();
  const rawDateParam = searchParams.get("date");
  const initialDate =
    rawDateParam && /^\d{4}-\d{2}-\d{2}$/.test(rawDateParam) ? rawDateParam : today;

  const [selectedDate, setSelectedDate] = useState(initialDate);

  useEffect(() => {
    if (rawDateParam && /^\d{4}-\d{2}-\d{2}$/.test(rawDateParam)) {
      setSelectedDate(rawDateParam);
    }
  }, [rawDateParam]);
  const [summaries, setSummaries] = useState<JournalSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [mood, setMood] = useState(4);
  const [energy, setEnergy] = useState(4);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [content, setContent] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [entryExists, setEntryExists] = useState(false);
  const [entryPath, setEntryPath] = useState("");
  const [viewMode, setViewMode] = useState<"edit" | "split" | "preview">("split");

  const [loadingEntry, setLoadingEntry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tencentModalOpen, setTencentModalOpen] = useState(false);

  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const makeSnapshot = (m: number, e: number, tg: string[], c: string) =>
    JSON.stringify({ mood: m, energy: e, tags: tg, content: c });

  const isDirty = makeSnapshot(mood, energy, tags, content) !== savedSnapshot;

  const refreshList = useCallback(async () => {
    try {
      const list = await api.listJournals();
      setSummaries(list);
    } catch (err) {
      toast.error(`读取日记列表失败: ${err}`);
    }
  }, []);

  const loadEntry = useCallback(async (date: string) => {
    setLoadingEntry(true);
    try {
      const entry = await api.readJournal(date);
      setMood(entry.mood);
      setEnergy(entry.energy);
      setTags(entry.tags || []);
      setContent(entry.content);
      setEntryExists(entry.exists);
      setEntryPath(entry.path);
      setSavedSnapshot(
        JSON.stringify({
          mood: entry.mood,
          energy: entry.energy,
          tags: entry.tags || [],
          content: entry.content,
        }),
      );
    } catch (err) {
      toast.error(`加载日记失败: ${err}`);
    } finally {
      setLoadingEntry(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    void loadEntry(selectedDate);
  }, [selectedDate, loadEntry]);

  const handleSelectDate = async (nextDate: string) => {
    if (!nextDate || nextDate === selectedDate) return;
    if (isDirty) {
      const ok = await confirmDialog({
        title: "放弃未保存的日记改动？",
        description: "当前日期的日记尚有未保存内容，切换日期后修改将会丢失。",
        confirmText: "放弃并切换",
        tone: "warning",
      });
      if (!ok) return;
    }
    setSelectedDate(nextDate);
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const summary = await api.saveJournal({
        date: selectedDate,
        mood,
        energy,
        tags,
        content,
        exists: true,
        path: entryPath,
      });
      setEntryExists(true);
      setEntryPath(summary.path);
      setSavedSnapshot(
        JSON.stringify({ mood, energy, tags, content }),
      );
      await refreshList();
      toast.success(`${formatDateZh(selectedDate, { showWeekday: true })} 日记已保存`);
    } catch (err) {
      toast.error(`保存日记失败: ${err}`);
    } finally {
      setSaving(false);
    }
  }, [selectedDate, mood, energy, tags, content, entryPath, refreshList]);

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

  const handleAddTag = () => {
    const clean = tagInput.trim().replace(/^#/, "");
    if (!clean) return;
    if (!tags.includes(clean)) {
      setTags((prev) => [...prev, clean]);
    }
    setTagInput("");
  };

  const handleImportCompletedTodos = () => {
    const matched = todos.filter((td) => {
      if (!td.done) return false;
      return td.date === selectedDate || (td.doneAt?.startsWith(selectedDate) ?? false);
    });
    if (matched.length === 0) {
      toast.info(`${selectedDate} 暂无已完成的待办事项`);
      return;
    }
    const lines = matched.map((td) => {
      const proj = projectMap[td.projectId] || "";
      const prefix = proj ? `[${proj}] ` : "";
      const timeStr = td.time ? ` @${td.time}` : "";
      return `- [x] ${prefix}${td.title}${timeStr}`;
    });
    const block = `\n## 当日已完成待办 (${matched.length} 项)\n${lines.join("\n")}\n`;
    setContent((prev) => {
      const base = prev.trimEnd();
      return base ? `${base}\n${block}` : block.trimStart();
    });
    toast.success(`已导入 ${matched.length} 条已完成待办`);
  };

  const filteredSummaries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter(
      (s) =>
        s.date.toLowerCase().includes(q) ||
        s.preview.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [summaries, searchQuery]);

  const moodEmoji = (val: number) =>
    MOOD_OPTIONS.find((m) => m.value === val)?.emoji || "🙂";

  return (
    <div className="flex h-full min-h-[560px] flex-col gap-4 xl:flex-row">
      {/* 左侧历史日记目录 */}
      <aside className="flex w-full shrink-0 flex-col rounded-xl border border-slate-200 bg-white xl:w-72 2xl:w-80">
        <div className="border-b border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <BookOpen className="h-4 w-4 text-indigo-600" />
              <span>生活日记本</span>
            </div>
            <button
              type="button"
              onClick={() => api.openJournalDir().catch((e) => toast.error(String(e)))}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
              title="打开日记 Markdown 存储目录"
            >
              <FolderOpen className="h-3 w-3" />
              <span>打开目录</span>
            </button>
          </div>

          <div className="mt-3 flex items-center gap-1.5">
            <button
              type="button"
              aria-label="前一天"
              onClick={() => void handleSelectDate(addDaysYmd(selectedDate, -1))}
              className="rounded-xl border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              title="前一天"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <DatePicker
              value={selectedDate}
              onChange={(d) => void handleSelectDate(d)}
              size="sm"
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              aria-label="后一天"
              onClick={() => void handleSelectDate(addDaysYmd(selectedDate, 1))}
              className="rounded-xl border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              title="后一天"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void handleSelectDate(today)}
              className={`shrink-0 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors ${
                selectedDate === today
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              今日
            </button>
          </div>

          <div className="relative mt-2.5">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索日期、关键词或标签..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pr-2.5 pl-8 text-xs text-gray-800 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2.5">
          {filteredSummaries.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-400">
              {summaries.length === 0 ? "还没有写过日记，在右侧开始今天的第一篇吧" : "无匹配日记"}
            </div>
          ) : (
            filteredSummaries.map((s) => {
              const active = s.date === selectedDate;
              return (
                <button
                  key={s.date}
                  type="button"
                  onClick={() => void handleSelectDate(s.date)}
                  className={`w-full rounded-xl border p-2.5 text-left transition ${
                    active
                      ? "border-indigo-300 bg-indigo-50/70"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="lw-nums font-semibold text-slate-900">
                      {formatDateZh(s.date, { showWeekday: true })}
                    </span>
                    <span title={`心情 ${s.mood}/5 · 精力 ${s.energy}/5`}>
                      {moodEmoji(s.mood)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-gray-500">
                    {s.preview || "（空白正文）"}
                  </p>
                  {s.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.tags.slice(0, 3).map((tg) => (
                        <span
                          key={tg}
                          className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-gray-500 ring-1 ring-gray-200"
                        >
                          #{tg}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* 右侧 Markdown 日记编辑器 */}
      <div className="lw-card flex min-w-0 flex-1 flex-col">
        {/* 顶部工具条 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <CalendarDateTile date={selectedDate} size="sm" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="lw-nums text-base font-semibold text-slate-900">
                  {formatDateZh(selectedDate, {
                    includeYear: true,
                    showWeekday: true,
                    weekdayStyle: "long",
                  })}
                </h1>
                <DateBadge date={selectedDate} variant="subtle" showIcon={false} />
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    entryExists
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {entryExists ? "已存档 .md" : "未保存草稿"}
                </span>
                {isDirty && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    有未保存更改
                  </span>
                )}
              </div>
              {entryPath && (
                <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                  {entryPath}
                </div>
              )}
            </div>
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
              onClick={handleImportCompletedTodos}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              <span>导入今日已完成待办</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!content.trim()) {
                  toast.error("当前日记正文为空");
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
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>保存 (Ctrl+S)</span>
            </button>
          </div>
        </div>

        {/* 心情、精力与标签条 */}
        <div className="flex flex-wrap items-center gap-4 border-b border-gray-100 bg-gray-50/60 px-5 py-2.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-gray-600">心情:</span>
            {MOOD_OPTIONS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMood(m.value)}
                title={m.label}
                className={`rounded-lg px-1.5 py-0.5 text-sm transition ${
                  mood === m.value
                    ? "bg-white shadow-xs ring-1 ring-indigo-300"
                    : "opacity-60 hover:opacity-100"
                }`}
              >
                {m.emoji}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-medium text-gray-600">精力:</span>
            {[1, 2, 3, 4, 5].map((lv) => (
              <button
                key={lv}
                type="button"
                onClick={() => setEnergy(lv)}
                className={`h-5 w-5 rounded-md font-mono text-[11px] font-semibold transition ${
                  energy >= lv
                    ? "bg-emerald-500 text-white"
                    : "bg-gray-200 text-gray-500 hover:bg-gray-300"
                }`}
              >
                {lv}
              </button>
            ))}
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-gray-400" />
            {tags.map((tg) => (
              <span
                key={tg}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-700 ring-1 ring-gray-200"
              >
                #{tg}
                <button
                  type="button"
                  onClick={() => setTags((prev) => prev.filter((x) => x !== tg))}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            <div className="inline-flex items-center gap-1">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="+ 标签 (回车)"
                className="w-24 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 focus:border-indigo-500 focus:outline-none"
              />
              {tagInput.trim() && (
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="rounded bg-gray-200 p-0.5 text-gray-700 hover:bg-gray-300"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 编辑 + Markdown 预览体 */}
        {loadingEntry ? (
          <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            <span>读取日记中...</span>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-gray-100 md:grid-cols-2 md:divide-x md:divide-y-0">
            {viewMode !== "preview" && (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="记录今天的想法、运动饮食、情绪复盘或小确幸..."
                className={`min-h-[380px] w-full resize-none bg-white p-5 font-mono text-[13px] leading-relaxed text-gray-800 focus:outline-none ${
                  viewMode === "edit" ? "md:col-span-2" : ""
                }`}
              />
            )}

            {viewMode !== "edit" && (
              <div
                className={`min-h-[380px] overflow-y-auto p-5 text-sm leading-relaxed text-gray-800 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-gray-100 [&_h2]:pb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ${
                  viewMode === "preview" ? "md:col-span-2" : ""
                }`}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content || "*（暂无正文内容）*"}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>

      <TencentDocPushModal
        open={tencentModalOpen}
        onClose={() => setTencentModalOpen(false)}
        initialTitle={`个人简记复盘 · ${selectedDate}`}
        initialMarkdown={content}
        sourceLabel="每日简记"
      />
    </div>
  );
}
