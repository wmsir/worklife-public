import { memo, useState } from "react";
import {
  CalendarArrowUp,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  Hash,
  Play,
  Repeat,
  Sun,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { addDaysYmd, todayYmd } from "../lib/date";
import type { Project, RepeatRule, Todo } from "../lib/types";
import { useAppStore } from "../store/appStore";
import { useFocusStore } from "../store/runtimeStore";
import { DateBadge } from "./DateBadge";

interface Props {
  todo: Todo;
  project?: Project;
  onToggle: (id: string) => void | Promise<unknown>;
  onEdit: (todo: Todo) => void;
  onDelete: (id: string) => void;
  showDate?: boolean;
  showProject?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelectChange?: (id: string, checked: boolean) => void;
}

const PRIORITY_BADGE: Record<number, { text: string; cls: string }> = {
  1: { text: "高", cls: "bg-red-50 text-red-600 border-red-200" },
  2: { text: "中", cls: "bg-amber-50 text-amber-600 border-amber-200" },
  3: { text: "低", cls: "bg-gray-100 text-gray-500 border-gray-200" },
};

const REPEAT_BADGE: Partial<Record<RepeatRule, string>> = {
  daily: "每天",
  workdays: "工作日",
  weekly: "每周",
  monthly: "每月",
};

export const TodoRow = memo(function TodoRow({
  todo,
  project,
  onToggle,
  onEdit,
  onDelete,
  showDate = false,
  showProject = false,
  selectable = false,
  selected = false,
  onSelectChange,
}: Props) {
  const navigate = useNavigate();
  const { toggleSubtask, batchRescheduleTodos } = useAppStore(
    useShallow((s) => ({
      toggleSubtask: s.toggleSubtask,
      batchRescheduleTodos: s.batchRescheduleTodos,
    })),
  );
  const startFocus = useFocusStore((s) => s.startFocus);
  const isFocusing = useFocusStore(
    (s) => s.focusTodoId === todo.id && s.focusRunning,
  );
  const [subExpanded, setSubExpanded] = useState(false);

  const today = todayYmd();
  const tomorrow = addDaysYmd(today, 1);
  const pr = PRIORITY_BADGE[todo.priority] ?? PRIORITY_BADGE[2];
  const subtasks = todo.subtasks ?? [];
  const subDone = subtasks.filter((s) => s.done).length;
  const repeatText = todo.repeat && todo.repeat !== "none" ? REPEAT_BADGE[todo.repeat] : null;

  const handleQuickMove = async (targetDate: string, label: string) => {
    try {
      await batchRescheduleTodos([todo.id], targetDate);
      toast.success(`已将「${todo.title}」移至${label}`);
    } catch (err) {
      toast.error(`调整日期失败: ${err}`);
    }
  };

  return (
    <div
      className={`group rounded-xl border bg-white px-3.5 py-2.5 transition-colors ${
        isFocusing
          ? "border-blue-400 bg-blue-50/30 shadow-2xs"
          : selected
            ? "border-blue-300 bg-blue-50/20"
            : "border-slate-200/80 hover:border-slate-300/90 hover:bg-slate-50/40"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelectChange?.(todo.id, e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600"
          />
        )}

        <button
          type="button"
          onClick={() => onToggle(todo.id)}
          className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md border transition-colors ${
            todo.done
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-gray-300 bg-white hover:border-blue-500"
          }`}
          title={todo.done ? "标为未完成" : "标为已完成"}
        >
          {todo.done && <Check className="h-3 w-3 stroke-[3]" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-sm ${
                todo.done ? "text-gray-400 line-through" : "font-medium text-gray-900"
              }`}
            >
              {todo.title}
            </span>
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${pr.cls}`}>
              {pr.text}
            </span>
            {todo.time && (
              <span className="lw-nums inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {todo.time}
              </span>
            )}
            {showDate && (
              <DateBadge date={todo.date} done={todo.done} showWeekday showIcon />
            )}
            {showProject && project && (
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: `${project.color}15`,
                  color: project.color,
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
                {project.name}
              </span>
            )}
            {repeatText && (
              <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                <Repeat className="h-2.5 w-2.5" />
                {repeatText}
              </span>
            )}
            {(todo.pomodoros ?? 0) > 0 && (
              <span
                className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600"
                title={`已完成 ${todo.pomodoros} 个番茄钟`}
              >
                🍅 {todo.pomodoros}
              </span>
            )}
            {subtasks.length > 0 && (
              <button
                type="button"
                onClick={() => setSubExpanded((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 hover:bg-gray-200"
                title="展开/收起子任务"
              >
                {subExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <CheckSquare className="h-2.5 w-2.5" />
                <span>
                  {subDone}/{subtasks.length}
                </span>
              </button>
            )}
            {(todo.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"
              >
                <Hash className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
            {todo.taskCode && (
              <button
                type="button"
                onClick={() => navigate(`/work/task/${encodeURIComponent(todo.taskCode!)}`)}
                className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-mono text-indigo-600 hover:bg-indigo-100"
                title="打开任务需求文档"
              >
                {todo.taskCode}
              </button>
            )}
          </div>
          {todo.note && <p className="mt-0.5 text-xs text-gray-500">{todo.note}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {!todo.done && (
            <button
              type="button"
              aria-label="专注 25 分钟"
              onClick={() => {
                startFocus(todo.id, todo.title, 25);
                toast.success(`开始 25 分钟专注：${todo.title}`);
              }}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              title="专注 25 分钟 (番茄钟)"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {!todo.done && todo.date !== today && (
            <button
              type="button"
              aria-label="移至今天"
              onClick={() => handleQuickMove(today, "今天")}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
              title="移至今天"
            >
              <Sun className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {!todo.done && todo.date !== tomorrow && (
            <button
              type="button"
              aria-label="推迟到明天"
              onClick={() => handleQuickMove(tomorrow, "明天")}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
              title="推迟到明天"
            >
              <CalendarArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            aria-label="编辑待办"
            onClick={() => onEdit(todo)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="编辑"
          >
            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="删除待办"
            onClick={() => onDelete(todo.id)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {subExpanded && subtasks.length > 0 && (
        <div className="mt-2 ml-7 space-y-1 border-l-2 border-gray-100 pl-3">
          {subtasks.map((sub) => (
            <label
              key={sub.id}
              className="flex cursor-pointer items-center gap-2 rounded py-0.5 text-xs hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={sub.done}
                onChange={() =>
                  toggleSubtask(todo.id, sub.id).catch((err) =>
                    toast.error(`切换子任务失败: ${err}`),
                  )
                }
                className="h-3.5 w-3.5 rounded border-gray-300 text-emerald-600"
              />
              <span className={sub.done ? "text-gray-400 line-through" : "text-gray-700"}>
                {sub.title}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
});
