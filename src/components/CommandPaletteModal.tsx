import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Briefcase,
  Calendar,
  CalendarCheck2,
  CalendarClock,
  CheckSquare,
  CloudUpload,
  Command,
  Copy,
  FileText,
  FileUp,
  FolderArchive,
  Heart,
  Play,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  StickyNote,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store/appStore";
import { useFocusStore } from "../store/runtimeStore";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenQuickCapture: () => void;
}

interface PaletteItem {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  keywords: string;
  icon: typeof Search;
  badge?: string;
  action: () => void | Promise<void>;
}

export function CommandPaletteModal({ open, onClose, onOpenQuickCapture }: Props) {
  const navigate = useNavigate();
  const { tasks, todos, notes, incrementNoteCopy } = useAppStore(
    useShallow((s) => ({
      tasks: s.tasks,
      todos: s.todos,
      notes: s.notes,
      incrementNoteCopy: s.incrementNoteCopy,
    })),
  );
  const startFocus = useFocusStore((s) => s.startFocus);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();

    const actions: PaletteItem[] = [
      {
        id: "act-quick",
        group: "快捷操作",
        title: "速记一条待办 (Alt+N)",
        subtitle: "支持 @时间 !优先级 #标签 /重复 自然语法",
        keywords: "suji quick todo add 速记 新建待办",
        icon: Plus,
        action: () => {
          onClose();
          onOpenQuickCapture();
        },
      },
      {
        id: "act-focus",
        group: "快捷操作",
        title: "开始 25 分钟深度专注番茄钟",
        subtitle: "顶部实时计时并在结束后响铃提示",
        keywords: "focus pomodoro 专注 番茄钟 计时",
        icon: Play,
        action: () => {
          startFocus(null, "深度专注时间", 25);
          onClose();
          toast.success("已开启 25 分钟深度专注 🍅");
        },
      },
      {
        id: "act-journal",
        group: "快捷操作",
        title: "撰写今日生活日记与复盘",
        subtitle: "支持一键导入今日已完成待办",
        keywords: "journal diary riji 日记 复盘",
        icon: BookOpen,
        action: () => {
          onClose();
          navigate("/life/journal");
        },
      },
      {
        id: "act-weekly",
        group: "快捷操作",
        title: "一键生成本周工作周报",
        subtitle: "自动聚合离线任务台账、需求修改方案与完成待办",
        keywords: "weekly report zhoubao 周报 月报 站会",
        icon: FileText,
        action: () => {
          onClose();
          navigate("/work/weekly");
        },
      },
      {
        id: "act-finance",
        group: "快捷操作",
        title: "记一笔收支 / 查看月度预算",
        subtitle: "个人轻记账与固定周期账单",
        keywords: "finance money budget jizhang 记账 账单 预算",
        icon: Wallet,
        action: () => {
          onClose();
          navigate("/life/finance");
        },
      },
      {
        id: "act-notes",
        group: "快捷操作",
        title: "打开便签与代码片段库",
        subtitle: "常用 SQL / Git 命令 / 测试账号一键复制",
        keywords: "notes snippet bianqian 便签 片段 复制",
        icon: StickyNote,
        action: () => {
          onClose();
          navigate("/notes");
        },
      },
      {
        id: "act-backup",
        group: "快捷操作",
        title: "前往网盘备份指定文件夹",
        subtitle: "本地同步盘与 WebDAV 直连压缩快照/增量镜像",
        keywords: "backup cloud webdav beifen 网盘 备份",
        icon: CloudUpload,
        action: () => {
          onClose();
          navigate("/backup");
        },
      },
      {
        id: "act-tencent-docs",
        group: "快捷操作",
        title: "腾讯文档自动填报与发布 (MCP / 智能表格)",
        subtitle: "周报/需求文档一键转腾讯在线文档，任务台账写入智能表格",
        keywords: "tencent docs qq mcp smartsheet webhook 腾讯文档 智能表格 分享",
        icon: FileUp,
        action: () => {
          onClose();
          navigate("/tencent-docs");
        },
      },
    ];

    const pages: PaletteItem[] = [
      { id: "pg-today", group: "页面跳转", title: "今日工作台", keywords: "today jinri 今日", icon: CalendarCheck2, action: () => { onClose(); navigate("/today"); } },
      { id: "pg-calendar", group: "页面跳转", title: "全景月历视图", keywords: "calendar yueli 日历 月历 节假日", icon: Calendar, action: () => { onClose(); navigate("/calendar"); } },
      { id: "pg-todos", group: "页面跳转", title: "全部待办 / 收集箱 / 看板", keywords: "todos kanban inbox 待办 看板", icon: CheckSquare, action: () => { onClose(); navigate("/todos"); } },
      { id: "pg-templates", group: "页面跳转", title: "排期模板管理", keywords: "templates paiqi 排期 模板", icon: CalendarClock, action: () => { onClose(); navigate("/templates"); } },
      { id: "pg-work-ov", group: "页面跳转", title: "工作区概览", keywords: "work overview 工作", icon: Briefcase, action: () => { onClose(); navigate("/work/overview"); } },
      { id: "pg-work-rep", group: "页面跳转", title: "工时填报与检查", keywords: "work report gongshi 工时 填报 检查", icon: Briefcase, action: () => { onClose(); navigate("/work/report"); } },
      { id: "pg-work-flow", group: "页面跳转", title: "任务流转与检查单", keywords: "work flow checklist 流转 检查单", icon: Briefcase, action: () => { onClose(); navigate("/work/flow"); } },
      { id: "pg-work-mr", group: "页面跳转", title: "批量提交 MR / 审批合并", keywords: "work mr merge 合并", icon: Briefcase, action: () => { onClose(); navigate("/work/mr"); } },
      { id: "pg-work-br", group: "页面跳转", title: "批量创建代码分支", keywords: "work branch 分支", icon: Briefcase, action: () => { onClose(); navigate("/work/branch"); } },
      { id: "pg-work-miss", group: "页面跳转", title: "个人与团队缺报提醒", keywords: "work miss 缺报", icon: Briefcase, action: () => { onClose(); navigate("/work/miss"); } },
      { id: "pg-work-team", group: "页面跳转", title: "团队工作量统计", keywords: "work team 团队", icon: Briefcase, action: () => { onClose(); navigate("/work/team"); } },
      { id: "pg-ledger", group: "页面跳转", title: "离线任务台账", keywords: "work ledger taizhang 台账", icon: FolderArchive, action: () => { onClose(); navigate("/work/ledger"); } },
      { id: "pg-life-ov", group: "页面跳转", title: "生活概览与习惯打卡", keywords: "life habits countdowns 生活 习惯 倒数日", icon: Heart, action: () => { onClose(); navigate("/life/overview"); } },
      { id: "pg-api-cfg", group: "页面跳转", title: "接口配置与参数规则（修改 IP / 路径 / 参数即时生效）", keywords: "api ip port url config rules 接口 配置 规则 端口 参数", icon: SlidersHorizontal, action: () => { onClose(); navigate("/api-config"); } },
      { id: "pg-settings", group: "页面跳转", title: "系统设置与本地目录", keywords: "settings shezhi 设置 企微 配置", icon: Settings, action: () => { onClose(); navigate("/settings"); } },
    ];

    const matchedNotes: PaletteItem[] = notes
      .filter((n) =>
        !q
          ? n.pinned
          : n.title.toLowerCase().includes(q) ||
            n.content.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .slice(0, 6)
      .map((n) => ({
        id: `note-${n.id}`,
        group: "便签片段（回车直接复制内容）",
        title: n.title,
        subtitle: n.content.split("\n")[0]?.slice(0, 60) || "",
        keywords: `${n.title} ${n.content} ${n.tags.join(" ")}`,
        icon: Copy,
        badge: n.kind === "snippet" ? n.language : "便签",
        action: async () => {
          try {
            await navigator.clipboard.writeText(n.content);
            await incrementNoteCopy(n.id).catch(() => {});
            toast.success(`已复制片段「${n.title}」`);
          } catch {
            navigate("/notes");
          }
          onClose();
        },
      }));

    const matchedTasks: PaletteItem[] = q
      ? tasks
          .filter((t) => {
            const branchHit =
              t.branch.toLowerCase().includes(q) ||
              (t.branches?.some((b) => b.branch.toLowerCase().includes(q)) ?? false);
            const repoHit = t.repos.some((r) => r.toLowerCase().includes(q));
            return (
              t.code.toLowerCase().includes(q) ||
              t.name.toLowerCase().includes(q) ||
              t.sprint.toLowerCase().includes(q) ||
              branchHit ||
              repoHit
            );
          })
          .slice(0, 6)
          .map((t) => {
            const branchList = [
              t.branch,
              ...(t.branches?.map((b) => b.branch) ?? []),
            ].filter(Boolean);
            const primaryBranch = t.branches?.[0]?.branch || t.branch;
            return {
              id: `task-${t.code}`,
              group: "离线任务台账（打开需求描述.md）",
              title: `${t.code} · ${t.name}`,
              subtitle: `${t.status}${primaryBranch ? ` · 分支 ${primaryBranch}` : ""}${
                t.planTestDate ? ` · 提测 ${t.planTestDate}` : ""
              }`,
              keywords: `${t.code} ${t.name} ${t.sprint} ${branchList.join(" ")} ${t.repos.join(" ")}`,
              icon: FolderArchive,
              badge: t.status,
              action: () => {
                onClose();
                navigate(`/work/task/${encodeURIComponent(t.code)}`);
              },
            };
          })
      : [];

    const matchedTodos: PaletteItem[] = q
      ? todos
          .filter(
            (td) =>
              td.title.toLowerCase().includes(q) ||
              td.tags.some((t) => t.toLowerCase().includes(q)),
          )
          .slice(0, 6)
          .map((td) => ({
            id: `todo-${td.id}`,
            group: "待办事项",
            title: td.title,
            subtitle: `${td.date || "收集箱"}${td.done ? " · 已完成" : ""}`,
            keywords: `${td.title} ${td.tags.join(" ")}`,
            icon: CheckSquare,
            badge: td.done ? "已完成" : `P${td.priority}`,
            action: () => {
              onClose();
              navigate("/todos");
            },
          }))
      : [];

    const baseList = [...actions, ...pages];
    const filteredBase = !q
      ? actions
      : baseList.filter(
          (it) =>
            it.title.toLowerCase().includes(q) ||
            (it.subtitle || "").toLowerCase().includes(q) ||
            it.keywords.toLowerCase().includes(q),
        );

    return [...filteredBase, ...matchedNotes, ...matchedTasks, ...matchedTodos].slice(0, 18);
  }, [
    open,
    query,
    tasks,
    todos,
    notes,
    onClose,
    onOpenQuickCapture,
    startFocus,
    navigate,
    incrementNoteCopy,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (items.length === 0 ? 0 : (prev + 1) % items.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) =>
        items.length === 0 ? 0 : (prev - 1 + items.length) % items.length,
      );
      return;
    }
    if (e.key === "Enter" && items[activeIndex]) {
      e.preventDefault();
      void items[activeIndex].action();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-20 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-gray-100 px-4 py-3">
          <Command className="h-4 w-4 text-blue-600" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入命令、页面名称、任务号、待办或便签片段关键词..."
            className="min-w-0 flex-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          <span className="rounded border border-gray-200 px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
            ESC
          </span>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-400">
              未找到匹配的命令、页面或记录
            </div>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === activeIndex;
              const prevGroup = idx > 0 ? items[idx - 1].group : "";
              return (
                <div key={item.id}>
                  {item.group !== prevGroup && (
                    <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-gray-400 uppercase">
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => void item.action()}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs transition ${
                      active ? "bg-blue-50 text-blue-900" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          active ? "text-blue-600" : "text-gray-400"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{item.title}</div>
                        {item.subtitle && (
                          <div className="truncate text-[11px] text-gray-400">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    {item.badge && (
                      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-500 ring-1 ring-gray-200">
                        {item.badge}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-2 text-[11px] text-gray-400">
          <span>↑↓ 选择 · Enter 执行</span>
          <span>Ctrl+K 全局呼出 · Alt+N 极速记待办</span>
        </div>
      </div>
    </div>
  );
}
