import { useEffect, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { addDaysYmd, todayYmd } from "../lib/date";
import { flattenProjectTree } from "../lib/projects";
import type { RepeatRule, Subtask, Todo } from "../lib/types";
import { useAppStore } from "../store/appStore";
import { DatePicker } from "./DatePicker";

interface Props {
  open: boolean;
  onClose: () => void;
  todo?: Todo | null;
  defaultProjectId?: string;
  defaultDate?: string | null;
}

function getNextMondayStr(): string {
  const now = new Date();
  const dow = now.getDay();
  const diffToCurMon = dow === 0 ? -6 : 1 - dow;
  return addDaysYmd(todayYmd(), diffToCurMon + 7);
}

export function TodoEditModal({
  open,
  onClose,
  todo,
  defaultProjectId,
  defaultDate,
}: Props) {
  const { projects, tasks, upsertTodo } = useAppStore(
    useShallow((s) => ({ projects: s.projects, tasks: s.tasks, upsertTodo: s.upsertTodo })),
  );
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId || "work");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [taskCode, setTaskCode] = useState("");
  const [repeat, setRepeat] = useState<RepeatRule>("none");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [subInput, setSubInput] = useState("");
  const [saving, setSaving] = useState(false);

  const today = todayYmd();

  useEffect(() => {
    if (!open) return;
    if (todo) {
      setTitle(todo.title);
      setNote(todo.note || "");
      setProjectId(todo.projectId);
      setDate(todo.date || "");
      setTime(todo.time || "");
      setPriority(todo.priority || 2);
      setTaskCode(todo.taskCode || "");
      setRepeat(todo.repeat || "none");
      setTags(todo.tags ? [...todo.tags] : []);
      setSubtasks(todo.subtasks ? todo.subtasks.map((s) => ({ ...s })) : []);
    } else {
      setTitle("");
      setNote("");
      setProjectId(defaultProjectId || projects[0]?.id || "work");
      setDate(defaultDate ?? "");
      setTime("");
      setPriority(2);
      setTaskCode("");
      setRepeat("none");
      setTags([]);
      setSubtasks([]);
    }
    setTagInput("");
    setSubInput("");
  }, [open, todo, defaultProjectId, defaultDate, projects]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const addTag = () => {
    const clean = tagInput.trim().replace(/^#/, "");
    if (!clean) return;
    if (!tags.includes(clean)) setTags((prev) => [...prev, clean]);
    setTagInput("");
  };

  const addSubtask = () => {
    const clean = subInput.trim();
    if (!clean) return;
    setSubtasks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), title: clean, done: false },
    ]);
    setSubInput("");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("请输入待办标题");
      return;
    }
    setSaving(true);
    try {
      await upsertTodo({
        ...(todo ?? {}),
        id: todo?.id ?? "",
        projectId,
        title: title.trim(),
        note: note.trim(),
        date: date.trim() ? date.trim() : null,
        time: time.trim() ? time.trim() : null,
        priority,
        taskCode: taskCode.trim() ? taskCode.trim() : null,
        repeat,
        tags,
        subtasks,
      });
      toast.success(todo ? "待办已更新" : "已新增待办");
      onClose();
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lw-modal-panel max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-3.5 backdrop-blur-xs">
          <h3 className="text-base font-semibold text-slate-900">
            {todo ? "编辑待办" : "新建待办"}
          </h3>
          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">标题</label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入要做的事项..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">所属项目</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {flattenProjectTree(projects).map((item) => (
                  <option key={item.project.id} value={item.project.id}>
                    {item.indentedLabel} ({item.project.kind === "work" ? "工作" : "生活"})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">优先级</label>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value={1}>!1 高优先级</option>
                <option value={2}>!2 中优先级</option>
                <option value={3}>!3 低优先级</option>
              </select>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-600">计划日期</label>
              <div className="flex flex-wrap gap-1 text-[11px]">
                {[
                  { val: today, label: "今天" },
                  { val: addDaysYmd(today, 1), label: "明天" },
                  { val: addDaysYmd(today, 2), label: "后天" },
                  { val: getNextMondayStr(), label: "下周一" },
                ].map((chip) => {
                  const active = date === chip.val;
                  return (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => setDate(chip.val)}
                      className={`rounded-md px-2 py-0.5 transition-colors ${
                        active
                          ? "bg-blue-600 font-medium text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setDate("")}
                  className={`rounded-md px-2 py-0.5 transition-colors ${
                    !date
                      ? "bg-slate-800 font-medium text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-700"
                  }`}
                >
                  收集箱
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <DatePicker
                value={date}
                onChange={setDate}
                clearable
                showQuickActions={false}
                placeholder="未排期（收集箱）"
                size="md"
                className="w-full"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="lw-nums rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              />
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as RepeatRule)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              >
                <option value="none">不重复</option>
                <option value="daily">每天重复</option>
                <option value="workdays">仅工作日</option>
                <option value="weekly">每周重复</option>
                <option value="monthly">每月重复</option>
              </select>
            </div>
          </div>

          {/* 标签管理 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">标签</label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2">
              {tags.map((tg) => (
                <span
                  key={tg}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700"
                >
                  #{tg}
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((x) => x !== tg))}
                    className="text-emerald-500 hover:text-emerald-900"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="输入标签后按回车..."
                className="min-w-[140px] flex-1 text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={addTag}
                className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-200"
              >
                添加
              </button>
            </div>
          </div>

          {/* 子任务检查项 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              子任务清单 ({subtasks.filter((s) => s.done).length}/{subtasks.length})
            </label>
            <div className="space-y-1.5 rounded-lg border border-gray-200 p-2.5">
              {subtasks.map((sub, idx) => (
                <div key={sub.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={sub.done}
                    onChange={() =>
                      setSubtasks((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, done: !s.done } : s)),
                      )
                    }
                    className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600"
                  />
                  <input
                    type="text"
                    value={sub.title}
                    onChange={(e) =>
                      setSubtasks((prev) =>
                        prev.map((s, i) =>
                          i === idx ? { ...s, title: e.target.value } : s,
                        ),
                      )
                    }
                    className={`min-w-0 flex-1 bg-transparent focus:outline-none ${
                      sub.done ? "text-gray-400 line-through" : "text-gray-800"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setSubtasks((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  type="text"
                  value={subInput}
                  onChange={(e) => setSubInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSubtask();
                    }
                  }}
                  placeholder="输入子步骤后点击添加..."
                  className="min-w-0 flex-1 rounded border border-gray-200 px-2.5 py-1 text-xs focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addSubtask}
                  className="inline-flex items-center gap-1 rounded bg-gray-100 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200"
                >
                  <Plus className="h-3 w-3" />
                  <span>添加步骤</span>
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">关联任务号（可选）</label>
            <input
              type="text"
              list="edit-todo-task-codes"
              value={taskCode}
              onChange={(e) => setTaskCode(e.target.value)}
              placeholder="如 TASK-0001"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <datalist id="edit-todo-task-codes">
              {tasks.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </datalist>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">备注</label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="补充细节、链接或检查要点..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? "保存中..." : "保存"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
