import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Hash, Repeat, Sparkles, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { addDaysYmd, formatDateZh, parseQuickTodo, todayYmd } from "../lib/date";
import { flattenProjectTree } from "../lib/projects";
import { useAppStore } from "../store/appStore";
import { DateBadge } from "./DateBadge";

interface Props {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
}

const REPEAT_LABEL: Record<string, string> = {
  none: "不重复",
  daily: "每天",
  workdays: "工作日",
  weekly: "每周",
  monthly: "每月",
};

const SYNTAX_CHIPS = [
  { label: "今天", token: "今天" },
  { label: "明天", token: "明天" },
  { label: "下周一", token: "下周一" },
  { label: "@14:30", token: "@14:30" },
  { label: "!1 高优", token: "!1" },
  { label: "#工作", token: "#工作" },
  { label: "/每天", token: "/每天" },
  { label: "/工作日", token: "/工作日" },
] as const;

export function QuickCaptureModal({ open, onClose, defaultProjectId }: Props) {
  const { projects, upsertTodo } = useAppStore(
    useShallow((s) => ({ projects: s.projects, upsertTodo: s.upsertTodo })),
  );
  const today = todayYmd();
  const tomorrow = addDaysYmd(today, 1);
  const inputRef = useRef<HTMLInputElement>(null);

  const [rawInput, setRawInput] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId || "life");
  const [fallbackDateMode, setFallbackDateMode] = useState<"today" | "tomorrow" | "inbox">(
    "today",
  );
  const [saving, setSaving] = useState(false);

  const flatProjects = useMemo(() => flattenProjectTree(projects), [projects]);

  useEffect(() => {
    if (open) {
      setRawInput("");
      setProjectId(defaultProjectId || projects[0]?.id || "life");
      setFallbackDateMode("today");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, defaultProjectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const parsed = useMemo(() => parseQuickTodo(rawInput), [rawInput]);

  const effectiveDate = useMemo(() => {
    if (parsed.date) return parsed.date;
    if (fallbackDateMode === "today") return today;
    if (fallbackDateMode === "tomorrow") return tomorrow;
    return null;
  }, [parsed.date, fallbackDateMode, today, tomorrow]);

  if (!open) return null;

  const appendSyntaxToken = (token: string) => {
    setRawInput((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed} ${token}` : token;
    });
    inputRef.current?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.title) {
      toast.error("请输入待办标题");
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await upsertTodo({
        projectId,
        title: parsed.title,
        date: effectiveDate,
        time: parsed.time,
        priority: parsed.priority,
        tags: parsed.tags,
        repeat: parsed.repeat,
      });
      toast.success(
        effectiveDate
          ? `已添加到 ${formatDateZh(effectiveDate, { showWeekday: true })}`
          : "已放入收集箱（待安排）",
      );
      onClose();
    } catch (err) {
      toast.error(`创建失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="lw-modal-backdrop fixed inset-0 z-50 flex items-start justify-center bg-slate-950/35 p-4 pt-20 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="lw-modal-panel w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xl"
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span>全局快速记录</span>
            <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500">
              Alt+N
            </kbd>
          </div>
          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* 主体输入与语法配置 */}
        <div className="space-y-3.5 p-5">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="例如：交水电费 明天 @20:00 !1 #生活 /每月  或  梳理需求方案 @14:30 !1 #工作"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-3 pr-9 pl-4 text-sm text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15 focus:outline-none"
            />
            {rawInput && (
              <button
                type="button"
                aria-label="清空输入"
                onClick={() => {
                  setRawInput("");
                  inputRef.current?.focus();
                }}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* 所属项目与默认日期快捷键 */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
              {flatProjects.map((item) => {
                const active = projectId === item.project.id;
                return (
                  <button
                    key={item.project.id}
                    type="button"
                    onClick={() => {
                      setProjectId(item.project.id);
                      inputRef.current?.focus();
                    }}
                    className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 transition ${
                      active
                        ? "border-blue-500 bg-blue-50 font-medium text-blue-700 shadow-2xs"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.project.color }}
                    />
                    <span>{item.fullPath}</span>
                  </button>
                );
              })}
            </div>

            <div className="inline-flex shrink-0 items-center rounded-xl border border-slate-200/80 bg-slate-100/80 p-0.5 whitespace-nowrap">
              {(
                [
                  ["today", "今天"],
                  ["tomorrow", "明天"],
                  ["inbox", "收集箱"],
                ] as const
              ).map(([mode, lbl]) => {
                const active = !parsed.date && fallbackDateMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setFallbackDateMode(mode);
                      inputRef.current?.focus();
                    }}
                    className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs transition ${
                      active
                        ? "bg-slate-900 font-medium text-white shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 快捷语法标签栏（可点击插入） */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="inline-flex shrink-0 items-center gap-1 text-slate-400">
              <Tag className="h-3 w-3" aria-hidden="true" />
              <span>快捷语法:</span>
            </span>
            {SYNTAX_CHIPS.map((chip) => (
              <button
                key={chip.token}
                type="button"
                onClick={() => appendSyntaxToken(chip.token)}
                className="shrink-0 whitespace-nowrap rounded-md border border-slate-200/80 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 transition hover:border-blue-200 hover:bg-blue-50/70 hover:text-blue-700"
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* 实时智能解析预览 */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-600">
            <span className="shrink-0 font-medium text-slate-500">解析预览</span>
            <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
            <span
              className={`font-semibold ${
                parsed.title ? "text-slate-900" : "font-normal text-slate-400"
              }`}
            >
              {parsed.title || "（等待输入标题）"}
            </span>
            <DateBadge
              date={effectiveDate}
              showWeekday
              showIcon
              emptyLabel="收集箱 (待排期)"
            />
            {parsed.time && (
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[11px] text-blue-700">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {parsed.time}
              </span>
            )}
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                parsed.priority === 1
                  ? "bg-rose-50 text-rose-600"
                  : parsed.priority === 2
                    ? "bg-amber-50 text-amber-600"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              !{parsed.priority} {parsed.priority === 1 ? "高" : parsed.priority === 2 ? "中" : "低"}
            </span>
            {parsed.repeat !== "none" && (
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                <Repeat className="h-3 w-3" aria-hidden="true" />
                {REPEAT_LABEL[parsed.repeat]}
              </span>
            )}
            {parsed.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
              >
                <Hash className="h-2.5 w-2.5" aria-hidden="true" />
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* 独立底部操作栏：按钮严格禁止换行 */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-slate-400">
            <span className="truncate">
              支持 <code className="rounded bg-slate-100 px-1 text-slate-600">@YYYY-MM-DD</code> ·{" "}
              <code className="rounded bg-slate-100 px-1 text-slate-600">@HH:MM</code> ·{" "}
              <code className="rounded bg-slate-100 px-1 text-slate-600">!1~3</code> ·{" "}
              <code className="rounded bg-slate-100 px-1 text-slate-600">/每周 /每月</code>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !parsed.title}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>{saving ? "保存中..." : "Enter 立即保存"}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
