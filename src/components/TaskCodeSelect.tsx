import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, GitBranch, Search, X } from "lucide-react";
import { isValidYmd, todayYmd } from "../lib/date";
import { isTaskEffectivelyDone } from "../lib/taskFilter";
import type { TaskRecord } from "../lib/types";
import { getTaskBranches } from "../lib/wtx";

interface TaskCodeSelectProps {
  tasks: TaskRecord[];
  value: string;
  onChange: (val: string) => void;
  onSelectTask?: (task: TaskRecord) => void;
  placeholder?: string;
  className?: string;
}

function extractVersionYmd(t: TaskRecord): string {
  if (isValidYmd(t.releaseDate)) return t.releaseDate;
  if (isValidYmd(t.sprintEnd)) return t.sprintEnd;
  const m = /(\d{4})[-/]?(\d{2})[-/]?(\d{2})/.exec(t.sprint || "");
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

function isCurrentVersionTask(t: TaskRecord, today: string): boolean {
  if (isTaskEffectivelyDone(t, today)) return false;
  const verYmd = extractVersionYmd(t);
  if (!verYmd) return true;
  return verYmd >= today;
}

export function TaskCodeSelect({
  tasks,
  value,
  onChange,
  onSelectTask,
  placeholder = "输入或选择任务号（优先展示当前版本任务）",
  className = "",
}: TaskCodeSelectProps) {
  const [open, setOpen] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setIsFiltering(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const { currentTasks, otherTasks } = useMemo(() => {
    const today = todayYmd();
    const q = isFiltering ? value.trim().toLowerCase() : "";
    const cur: TaskRecord[] = [];
    const rest: TaskRecord[] = [];

    for (const t of tasks) {
      if (q) {
        const branches = getTaskBranches(t);
        const hit =
          t.code.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.sprint.toLowerCase().includes(q) ||
          branches.some((b) => b.branch.toLowerCase().includes(q));
        if (!hit) continue;
      }
      if (isCurrentVersionTask(t, today)) {
        cur.push(t);
      } else {
        rest.push(t);
      }
    }

    cur.sort((a, b) => {
      const aHasBranch = getTaskBranches(a).length > 0 ? 1 : 0;
      const bHasBranch = getTaskBranches(b).length > 0 ? 1 : 0;
      if (aHasBranch !== bHasBranch) return bHasBranch - aHasBranch;
      const va = extractVersionYmd(a) || "9999-99-99";
      const vb = extractVersionYmd(b) || "9999-99-99";
      if (va !== vb) return va.localeCompare(vb);
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });

    rest.sort((a, b) => {
      const va = extractVersionYmd(a) || a.startDate || "";
      const vb = extractVersionYmd(b) || b.startDate || "";
      if (va !== vb) return vb.localeCompare(va);
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });

    return { currentTasks: cur, otherTasks: rest };
  }, [tasks, value, isFiltering]);

  const flatList = useMemo(
    () => [...currentTasks, ...otherTasks],
    [currentTasks, otherTasks],
  );

  useEffect(() => {
    setActiveIdx(0);
  }, [value, isFiltering, open]);

  const handlePick = (task: TaskRecord) => {
    onChange(task.code);
    onSelectTask?.(task);
    setOpen(false);
    setIsFiltering(false);
  };

  const renderItem = (task: TaskRecord, flatIdx: number, isCur: boolean) => {
    const branches = getTaskBranches(task);
    const active = flatIdx === activeIdx;
    const isExact = value.trim().toLowerCase() === task.code.toLowerCase();
    return (
      <button
        key={task.code}
        type="button"
        onMouseEnter={() => setActiveIdx(flatIdx)}
        onMouseDown={(e) => {
          e.preventDefault();
          handlePick(task);
        }}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
          active
            ? "bg-blue-50 text-blue-900"
            : isExact
              ? "bg-slate-50 font-medium text-slate-900"
              : "text-slate-700 hover:bg-slate-50"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 font-mono font-semibold text-blue-700">
              {task.code}
            </span>
            <span className="truncate text-slate-700" title={task.name}>
              {task.name || "（未填写任务名）"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {branches.length > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-violet-700">
              <GitBranch className="h-2.5 w-2.5" />
              {branches.length}
            </span>
          )}
          {task.sprint && (
            <span
              className={`max-w-28 truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${
                isCur
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}
              title={task.sprint}
            >
              {task.sprint}
            </span>
          )}
          {!isCur && task.status && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
              {task.status}
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={value}
          onFocus={() => {
            setOpen(true);
            setIsFiltering(false);
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setIsFiltering(true);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
              setOpen(true);
              return;
            }
            if (!open) return;
            if (e.key === "Escape") {
              setOpen(false);
              setIsFiltering(false);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => (flatList.length ? (i + 1) % flatList.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) =>
                flatList.length ? (i - 1 + flatList.length) % flatList.length : 0,
              );
            } else if (e.key === "Enter" && flatList[activeIdx]) {
              e.preventDefault();
              handlePick(flatList[activeIdx]);
            }
          }}
          placeholder={placeholder}
          className="w-full rounded-xl border border-gray-200 bg-white py-2 pr-14 pl-8 font-mono text-xs text-gray-800 placeholder:font-sans placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
        />
        <div className="absolute right-1.5 flex items-center gap-0.5">
          {value && (
            <button
              type="button"
              aria-label="清空任务号"
              onClick={() => {
                onChange("");
                setIsFiltering(false);
                setOpen(true);
              }}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            aria-label="展开任务列表"
            onClick={() => {
              setOpen((v) => !v);
              setIsFiltering(false);
            }}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      {open && (
        <div className="lw-popover-panel absolute left-0 z-40 mt-1.5 max-h-72 w-full min-w-[340px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {flatList.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-slate-400">
              {tasks.length === 0
                ? "离线台账暂无任务，可直接手动输入任务号"
                : "未匹配到符合关键词的任务，可直接使用当前输入值"}
            </div>
          ) : (
            <>
              {currentTasks.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-emerald-700">
                    <span>当前版本 / 待交付任务（优先推荐）</span>
                    <span>{currentTasks.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {currentTasks.map((t, idx) => renderItem(t, idx, true))}
                  </div>
                </div>
              )}

              {otherTasks.length > 0 && (
                <div className={currentTasks.length > 0 ? "mt-1.5 border-t border-slate-100 pt-1.5" : ""}>
                  <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-slate-400">
                    <span>全部历史 / 其他版本任务</span>
                    <span>{otherTasks.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {otherTasks.map((t, idx) =>
                      renderItem(t, currentTasks.length + idx, false),
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
