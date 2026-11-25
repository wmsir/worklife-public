import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  ListTodo,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { todayYmd } from "../lib/date";
import { useAppStore } from "../store/appStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ScratchTab {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

const STORAGE_KEY = "lw.scratchpad.v1";
const MAX_TABS = 5;

function nowHms(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function defaultTabs(): ScratchTab[] {
  return [
    { id: "tab-1", title: "随手贴 1", content: "", updatedAt: "" },
    { id: "tab-2", title: "临时单号", content: "", updatedAt: "" },
  ];
}

function loadScratchState(): { tabs: ScratchTab[]; activeId: string } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs?: ScratchTab[]; activeId?: string };
      if (Array.isArray(parsed?.tabs) && parsed.tabs.length > 0) {
        const clean = parsed.tabs.slice(0, MAX_TABS).map((t, i) => ({
          id: String(t.id || `tab-${i + 1}`),
          title: String(t.title || `随手贴 ${i + 1}`),
          content: String(t.content || ""),
          updatedAt: String(t.updatedAt || ""),
        }));
        const activeId =
          clean.find((t) => t.id === parsed.activeId)?.id || clean[0].id;
        return { tabs: clean, activeId };
      }
    }
  } catch {
    // Ignore parse error
  }
  const defs = defaultTabs();
  return { tabs: defs, activeId: defs[0].id };
}

export function ScratchpadDrawer({ open, onClose }: Props) {
  const [tabs, setTabs] = useState<ScratchTab[]>(() => loadScratchState().tabs);
  const [activeId, setActiveId] = useState<string>(() => loadScratchState().activeId);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [busyTodo, setBusyTodo] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ tabs, activeId }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [tabs, activeId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId) || tabs[0],
    [tabs, activeId],
  );

  const stats = useMemo(() => {
    const text = activeTab?.content || "";
    const lines = text ? text.split(/\r?\n/) : [];
    const nonEmpty = lines.filter((l) => l.trim().length > 0).length;
    return {
      totalLines: lines.length,
      nonEmptyLines: nonEmpty,
      chars: text.length,
    };
  }, [activeTab?.content]);

  if (!open || !activeTab) return null;

  const updateActiveContent = (nextContent: string) => {
    const stamp = nowHms();
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, content: nextContent, updatedAt: stamp } : t,
      ),
    );
  };

  const handleAddTab = () => {
    if (tabs.length >= MAX_TABS) {
      toast.info(`最多支持 ${MAX_TABS} 个随手贴分页`);
      return;
    }
    const id = `tab-${Date.now()}`;
    const newTab: ScratchTab = {
      id,
      title: `随手贴 ${tabs.length + 1}`,
      content: "",
      updatedAt: "",
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveId(id);
  };

  const handleDeleteTab = (id: string) => {
    if (tabs.length <= 1) {
      updateActiveContent("");
      return;
    }
    const nextTabs = tabs.filter((t) => t.id !== id);
    setTabs(nextTabs);
    if (activeId === id) {
      setActiveId(nextTabs[0].id);
    }
  };

  const handleCopyAll = async () => {
    if (!activeTab.content.trim()) {
      toast.info("当前草稿板为空");
      return;
    }
    try {
      await navigator.clipboard.writeText(activeTab.content);
      toast.success("已复制草稿全文");
    } catch (e) {
      toast.error(`复制失败: ${String(e)}`);
    }
  };

  const handleTidyLines = () => {
    const cleaned = activeTab.content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n");
    updateActiveContent(cleaned);
    toast.success("已去除空行与首尾空格");
  };

  const handleSaveToNotes = async () => {
    if (!activeTab.content.trim()) {
      toast.info("请先输入要保存的内容");
      return;
    }
    try {
      await useAppStore.getState().upsertNote({
        title: `${activeTab.title} (${todayYmd()})`,
        content: activeTab.content,
        kind: "note",
        tags: ["随手贴"],
        pinned: false,
      });
      toast.success("已存入便签与片段库");
    } catch (e) {
      toast.error(`存入便签失败: ${String(e)}`);
    }
  };

  const handleLinesToTodos = async () => {
    const lines = activeTab.content
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^([-*•]|\d+[.)、])\s*/, "").trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.info("没有可转换的非空文本行");
      return;
    }
    const batch = lines.slice(0, 20);
    setBusyTodo(true);
    try {
      const today = todayYmd();
      const { projects, upsertTodo } = useAppStore.getState();
      const targetProjectId = projects.find((p) => p.id === "work")?.id || projects[0]?.id || "work";
      for (const title of batch) {
        await upsertTodo({
          projectId: targetProjectId,
          title,
          date: today,
          priority: 2,
          tags: ["随手贴"],
        });
      }
      toast.success(
        lines.length > 20
          ? `已将前 20 行添加到今日待办（共 ${lines.length} 行）`
          : `已将 ${batch.length} 行内容添加到今日待办`,
      );
    } catch (e) {
      toast.error(`转换待办失败: ${String(e)}`);
    } finally {
      setBusyTodo(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/25 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <StickyNote className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                全局随手草稿板
              </h3>
              <p className="text-[11px] text-slate-400">
                快捷键 <kbd className="lw-kbd">Alt+S</kbd> 随时呼出 · 本地自动保存
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭随手贴"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50/70 px-3 py-2">
          {tabs.map((tab) => {
            const active = tab.id === activeTab.id;
            const isEditing = editingTabId === tab.id;
            return (
              <div
                key={tab.id}
                className={`group flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition ${
                  active
                    ? "bg-white font-semibold text-blue-700 shadow-2xs ring-1 ring-slate-200"
                    : "text-slate-600 hover:bg-slate-200/60"
                }`}
              >
                {isEditing ? (
                  <input
                    type="text"
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => {
                      const trimmed = editingTitle.trim();
                      if (trimmed) {
                        setTabs((prev) =>
                          prev.map((t) =>
                            t.id === tab.id ? { ...t, title: trimmed } : t,
                          ),
                        );
                      }
                      setEditingTabId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingTabId(null);
                    }}
                    className="w-20 rounded border border-blue-400 px-1 py-0 text-xs focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveId(tab.id)}
                    onDoubleClick={() => {
                      setEditingTabId(tab.id);
                      setEditingTitle(tab.title);
                    }}
                    title="单击切换，双击重命名"
                    className="max-w-24 truncate"
                  >
                    {tab.title}
                  </button>
                )}
                {tabs.length > 1 && (
                  <button
                    type="button"
                    aria-label="删除分页"
                    onClick={() => handleDeleteTab(tab.id)}
                    className="hidden rounded p-0.5 text-slate-400 group-hover:inline-flex hover:text-rose-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
          {tabs.length < MAX_TABS && (
            <button
              type="button"
              onClick={handleAddTab}
              title="新建草稿分页"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2">
          <button
            type="button"
            onClick={handleCopyAll}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <Copy className="h-3 w-3" />
            <span>复制全文</span>
          </button>
          <button
            type="button"
            onClick={handleTidyLines}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <Sparkles className="h-3 w-3 text-amber-500" />
            <span>去空行</span>
          </button>
          <button
            type="button"
            disabled={busyTodo}
            onClick={handleLinesToTodos}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            <ListTodo className="h-3 w-3" />
            <span>逐行转今日待办</span>
          </button>
          <button
            type="button"
            onClick={handleSaveToNotes}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
          >
            <StickyNote className="h-3 w-3" />
            <span>存入便签库</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!activeTab.content) return;
              updateActiveContent("");
              toast.info("已清空当前随手贴");
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-3 w-3" />
            <span>清空</span>
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 p-3">
          <textarea
            value={activeTab.content}
            onChange={(e) => updateActiveContent(e.target.value)}
            placeholder="随手记下临时任务单号、会议口头安排、排查报错片段或待整理事项…&#10;&#10;每行一条时，可点击上方「逐行转今日待办」直接加入今日待办。"
            className="h-full w-full resize-none rounded-xl border border-slate-200 bg-amber-50/25 p-3 font-mono text-xs leading-relaxed text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none"
          />
        </div>

        {/* Footer */}
        <div className="lw-nums flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500">
          <span>
            {stats.nonEmptyLines} 非空行 / 共 {stats.totalLines} 行 · {stats.chars} 字符
          </span>
          <span>
            {activeTab.updatedAt ? `已自动保存 ${activeTab.updatedAt}` : "就绪"}
          </span>
        </div>
      </div>
    </div>
  );
}
