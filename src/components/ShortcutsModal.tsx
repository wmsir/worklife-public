import { useEffect } from "react";
import { Command, Keyboard, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: "Alt + N", desc: "全局快速记录待办（随时呼出）" },
  { keys: "Ctrl + K", desc: "打开全局命令面板 / 快速跳转 / 搜任务与分支" },
  { keys: "Ctrl + S", desc: "在「需求描述.md」编辑页快速保存" },
  { keys: "?", desc: "打开 / 关闭本快捷键与语法速查面板" },
  { keys: "Esc", desc: "关闭当前弹窗或抽屉" },
];

const SYNTAX_ITEMS = [
  { token: "今天 / 明天 / 后天 / 下周一", desc: "自动识别待办目标日期" },
  { token: "@YYYY-MM-DD", desc: "指定精确日期（如 @2026-12-01）" },
  { token: "@HH:MM", desc: "设定时间并进入「今日安排」时间线" },
  { token: "!1  !2  !3", desc: "设定高 / 中 / 低优先级" },
  { token: "#标签名", desc: "为待办自动附加分类标签" },
  { token: "/每天 /工作日 /每周 /每月", desc: "设为周期重复任务，完成后自动顺延" },
];

export function ShortcutsModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lw-modal-panel w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Keyboard className="h-4 w-4 text-blue-600" />
            <span>快捷键与速记语法指南</span>
          </div>
          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-xs">
          <div>
            <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-700">
              <Command className="h-3.5 w-3.5 text-blue-600" />
              <span>全局快捷键</span>
            </div>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-slate-50/50">
              {SHORTCUTS.map((s) => (
                <div
                  key={s.keys}
                  className="flex items-center justify-between gap-3 px-3.5 py-2"
                >
                  <span className="text-slate-600">{s.desc}</span>
                  <kbd className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800 shadow-2xs">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 font-semibold text-slate-700">
              速记 / 快速添加自然语言语法
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SYNTAX_ITEMS.map((item) => (
                <div
                  key={item.token}
                  className="rounded-xl border border-slate-200/80 bg-white px-3 py-2"
                >
                  <div className="font-mono text-[11px] font-semibold text-blue-700">
                    {item.token}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
