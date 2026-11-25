import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Award,
  BellRing,
  BookOpen,
  Briefcase,
  Calendar,
  CalendarCheck2,
  CalendarClock,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardPaste,
  CloudUpload,
  Command,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderArchive,
  GitBranch,
  GitMerge,
  Globe,
  Heart,
  Keyboard,
  LayoutDashboard,
  ListTodo,
  Loader2,
  LogIn,
  LogOut,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  StickyNote,
  UserCircle2,
  Wallet,
  WifiOff,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { api, onLoginSucceeded, onLoginWindowClosed } from "../lib/api";
import { todayYmd } from "../lib/date";
import {
  getDirectChildProjects,
  getProjectAncestors,
  getProjectDescendantIds,
} from "../lib/projects";
import type { CnDayInfo, ProbeResult, Project } from "../lib/types";
import { useAppStore } from "../store/appStore";
import { AlmanacPopover } from "./AlmanacPopover";
import { CommandPaletteModal } from "./CommandPaletteModal";
import { confirmDialog } from "./ConfirmDialog";
import { CreateProjectModal } from "./CreateProjectModal";
import { DateBadge } from "./DateBadge";
import { FocusTimerPill } from "./FocusTimerPill";
import { LogDrawer } from "./LogDrawer";
import { MonthlyMissBadge } from "./MonthlyMissBadge";
import { QuickCaptureModal } from "./QuickCaptureModal";
import { ScratchpadDrawer } from "./ScratchpadDrawer";
import { ShortcutsModal } from "./ShortcutsModal";
import { useMonthlyMissStore, useWorkQueryCacheStore } from "../store/runtimeStore";

const WORK_SUB_NAV = [
  { label: "概览", path: "/work/overview", icon: LayoutDashboard },
  { label: "填报与检查", path: "/work/report", icon: FileSpreadsheet },
  { label: "任务流转与检查单", path: "/work/flow", icon: Workflow },
  { label: "缺报提醒", path: "/work/miss", icon: BellRing },
  { label: "团队统计", path: "/work/team", icon: ClipboardCheck },
  { label: "创建分支", path: "/work/branch", icon: GitBranch },
  { label: "提交 MR", path: "/work/mr", icon: GitMerge },
  { label: "任务台账(离线)", path: "/work/ledger", icon: FolderArchive },
  { label: "工作周报", path: "/work/weekly", icon: FileText },
  { label: "工作待办与文件夹", path: "/project/work", icon: CheckSquare },
];

const LIFE_SUB_NAV = [
  { label: "生活概览与习惯", path: "/life/overview", icon: Heart },
  { label: "每日简记与复盘", path: "/life/journal", icon: BookOpen },
  { label: "轻记账与预算", path: "/life/finance", icon: Wallet },
  { label: "生活待办与文件夹", path: "/project/life", icon: CheckSquare },
];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    projects,
    todos,
    tasks,
    notes,
    user,
    setUser,
    refreshAll,
    refreshSettings,
    lastUpdated,
    loading,
    updateProject,
    deleteProject,
    incrementNoteCopy,
  } = useAppStore(
    useShallow((s) => ({
      projects: s.projects,
      todos: s.todos,
      tasks: s.tasks,
      notes: s.notes,
      user: s.user,
      setUser: s.setUser,
      refreshAll: s.refreshAll,
      refreshSettings: s.refreshSettings,
      lastUpdated: s.lastUpdated,
      loading: s.loading,
      updateProject: s.updateProject,
      deleteProject: s.deleteProject,
      incrementNoteCopy: s.incrementNoteCopy,
    })),
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ work: true, life: true });
  const [searchText, setSearchText] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    project: Project;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [offlineLoginModal, setOfflineLoginModal] = useState<ProbeResult | null>(null);
  const [cookieModalOpen, setCookieModalOpen] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [todayCnInfo, setTodayCnInfo] = useState<CnDayInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );
  const manualAuthToastLockRef = useRef<number>(0);
  const prevWinWidthRef = useRef<number>(
    typeof window !== "undefined" ? window.innerWidth : 1360,
  );
  const today = todayYmd();

  useEffect(() => {
    api
      .getTodayCnInfo()
      .then(setTodayCnInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      const prev = prevWinWidthRef.current;
      prevWinWidthRef.current = w;
      if (w < 960 && prev >= 960) {
        setSidebarOpen(false);
      } else if (w >= 1200 && prev < 1200) {
        setSidebarOpen(true);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleOpenLogin = async (force = false) => {
    setAuthBusy(true);
    try {
      const res = await api.openLoginWindow(force);
      if (res.opened) {
        setOfflineLoginModal(null);
        setLoginPending(true);
        const isHttp = res.isHttp ?? res.probe.url.toLowerCase().startsWith("http://");
        toast.info(
          force
            ? "已打开 DevOps 登录窗口，扫码/账号登录成功后将自动同步并关闭弹窗"
            : isHttp
              ? `提示：当前为 HTTP 内网登录（延迟 ${res.probe.latencyMs}ms），直接扫码/输入账号即可，成功后将自动同步个人数据并关闭弹窗`
              : `已打开登录窗口（延迟 ${res.probe.latencyMs}ms），扫码/登录后将自动同步个人数据并关闭弹窗`,
        );
      } else {
        setLoginPending(false);
        setOfflineLoginModal(res.probe);
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCancelLogin = async () => {
    setAuthBusy(true);
    try {
      await api.closeLoginWindow();
      setLoginPending(false);
      toast.info("已关闭 DevOps 登录窗口");
    } catch (e) {
      setLoginPending(false);
      toast.error(String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    let unlistenClosed: (() => void) | undefined;
    let unlistenSucceeded: (() => void) | undefined;

    onLoginWindowClosed(() => {
      if (active) setLoginPending(false);
    })
      .then((fn) => {
        if (!active) fn();
        else unlistenClosed = fn;
      })
      .catch(() => {});

    onLoginSucceeded((info) => {
      if (!active) return;
      setUser(info);
      setLoginPending(false);
      setOfflineLoginModal(null);
      setCookieModalOpen(false);
      void refreshSettings().catch(() => {});
      if (Date.now() - manualAuthToastLockRef.current > 1800) {
        const capVal = Number(info.capacity?.personalDeliveryCapacity);
        const hasCap =
          info.capacity &&
          Number.isFinite(capVal) &&
          info.capacity.personalDeliveryCapacity !== undefined;
        const capTip = hasCap
          ? ` · 交付产能 ${capVal.toFixed(2)} (${info.capacity?.isQualified ? "已达标" : "未达标"})`
          : "";
        toast.success(`已连接 DevOps：${info.realName}${capTip}`);
      }
    })
      .then((fn) => {
        if (!active) fn();
        else unlistenSucceeded = fn;
      })
      .catch(() => {});

    return () => {
      active = false;
      if (unlistenClosed) unlistenClosed();
      if (unlistenSucceeded) unlistenSucceeded();
    };
  }, [refreshSettings, setUser]);

  useEffect(() => {
    const ownerKey = user
      ? (user.erp || user.user.userErp || user.user.erp || user.realName || "logged-in").trim()
      : null;
    useWorkQueryCacheStore.getState().syncOwner(ownerKey);

    if (user) {
      void useMonthlyMissStore.getState().checkCurrentMonth(user, {
        onOpenCalendar: () => navigate("/work/miss?view=calendar"),
      });
    } else {
      useMonthlyMissStore.getState().resetMonthlyMiss();
    }
  }, [user, navigate]);

  const handleCaptureLogin = async () => {
    setAuthBusy(true);
    manualAuthToastLockRef.current = Date.now();
    try {
      const res = await api.captureLoginCookies();
      setUser(res);
      await refreshSettings();
      setLoginPending(false);
      toast.success(`已连接 DevOps：${res.realName}`);
    } catch (e) {
      manualAuthToastLockRef.current = 0;
      toast.error(String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAutoLogin = async () => {
    setAuthBusy(true);
    manualAuthToastLockRef.current = Date.now();
    try {
      const res = await api.autoLogin();
      setUser(res);
      await refreshSettings();
      setLoginPending(false);
      toast.success(`已恢复 DevOps 登录态：${res.realName}`);
    } catch (e) {
      manualAuthToastLockRef.current = 0;
      toast.error(String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSubmitCookie = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookieInput.trim()) {
      toast.error("请先粘贴 Cookie 字符串");
      return;
    }
    setAuthBusy(true);
    manualAuthToastLockRef.current = Date.now();
    try {
      const res = await api.setCookieString(cookieInput.trim());
      setUser(res);
      await refreshSettings();
      setCookieModalOpen(false);
      setCookieInput("");
      setLoginPending(false);
      toast.success(`Cookie 验证成功：${res.realName}`);
    } catch (err) {
      manualAuthToastLockRef.current = 0;
      toast.error(String(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    setAuthBusy(true);
    try {
      await api.logout();
      setUser(null);
      await refreshSettings();
      setLoginPending(false);
      toast.success("已退出 DevOps 登录");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    const closeMenu = () => setCtxMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setQuickCaptureOpen(true);
      } else if (e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        setScratchpadOpen((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdOpen((v) => !v);
      } else if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (
          tag !== "INPUT" &&
          tag !== "TEXTAREA" &&
          tag !== "SELECT" &&
          !target?.isContentEditable
        ) {
          e.preventDefault();
          setShortcutsOpen((v) => !v);
        }
      }
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const searchResults = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return { matchedTasks: [], matchedTodos: [], matchedNotes: [] };
    const matchedTasks = tasks
      .filter(
        (t) =>
          t.code.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.branch.toLowerCase().includes(q) ||
          (t.branches?.some((b) => b.branch.toLowerCase().includes(q)) ?? false) ||
          t.repos.some((r) => r.toLowerCase().includes(q)),
      )
      .slice(0, 6);
    const matchedTodos = todos
      .filter(
        (td) =>
          td.title.toLowerCase().includes(q) ||
          (td.taskCode && td.taskCode.toLowerCase().includes(q)),
      )
      .slice(0, 6);
    const matchedNotes = notes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((tg) => tg.toLowerCase().includes(q)),
      )
      .slice(0, 5);
    return { matchedTasks, matchedTodos, matchedNotes };
  }, [searchText, tasks, todos, notes]);

  const breadcrumb = useMemo(() => {
    const p = location.pathname;
    if (p === "/today") return ["工作区", "今日焦点"];
    if (p === "/calendar") return ["工作区", "全景月历"];
    if (p === "/todos") return ["工作区", "全部待办"];
    if (p === "/notes") return ["工作区", "便签与片段"];
    if (p === "/templates") return ["工作区", "排期模板"];
    if (p === "/tools") return ["工作区", "常用百宝箱"];
    if (p === "/backup") return ["系统", "网盘备份"];
    if (p === "/tencent-docs") return ["系统", "腾讯文档自动填报"];
    if (p === "/api-config") return ["系统", "接口配置与参数规则"];
    if (p === "/settings") return ["系统", "设置"];
    if (p === "/life/overview") return ["生活", "生活概览与习惯"];
    if (p === "/life/journal") return ["生活", "每日简记与复盘"];
    if (p === "/life/finance") return ["生活", "轻记账与预算"];
    if (p === "/work/overview") return ["工作", "概览"];
    if (p === "/work/report") return ["工作", "填报与检查"];
    if (p === "/work/flow") return ["工作", "任务流转与检查单"];
    if (p === "/work/miss") return ["工作", "缺报提醒"];
    if (p === "/work/team") return ["工作", "团队统计"];
    if (p === "/work/branch") return ["工作", "创建分支"];
    if (p === "/work/mr") return ["工作", "提交 MR"];
    if (p === "/work/ledger") return ["工作", "任务台账（离线）"];
    if (p === "/work/weekly") return ["工作", "工作周报"];
    if (p.startsWith("/work/task/")) {
      return ["工作", "任务详情", decodeURIComponent(p.replace("/work/task/", ""))];
    }
    if (p.startsWith("/project/")) {
      const id = decodeURIComponent(p.replace("/project/", ""));
      const chain = getProjectAncestors(projects, id);
      if (chain.length > 0) {
        return ["项目", ...chain.map((x) => x.name)];
      }
      return ["项目", id];
    }
    return ["LifeWork"];
  }, [location.pathname, projects]);

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await updateProject({ ...renameTarget, name: renameValue.trim() });
      toast.success("项目已重命名");
      setRenameTarget(null);
    } catch (err) {
      toast.error(`重命名失败: ${err}`);
    }
  };

  const handleDeleteProject = async (proj: Project) => {
    if (proj.builtin) {
      toast.warning("内置项目「工作 / 生活」不可删除");
      return;
    }
    const descendants = getProjectDescendantIds(projects, proj.id);
    const subCount = Math.max(0, descendants.size - 1);
    const ok = await confirmDialog({
      title: `确定删除项目「${proj.name}」吗？`,
      description:
        subCount > 0
          ? `该项目下含 ${subCount} 个子项目，删除后其子项目、关联待办均将被清理，本地目录将移至备份回收站。`
          : "项目下属待办将被清理，本地文件夹将移至备份回收站。",
      confirmText: "删除项目",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteProject(proj.id);
      toast.success(`已删除项目「${proj.name}」`);
      if (location.pathname.startsWith("/project/")) {
        const curId = decodeURIComponent(location.pathname.replace("/project/", ""));
        if (descendants.has(curId)) {
          navigate(proj.parentId ? `/project/${proj.parentId}` : "/today");
        }
      }
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  };

  const activeWorkCount = tasks.filter(
    (t) => t.status !== "已发版" && t.status !== "已关闭",
  ).length;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f5f7fa] text-slate-900">
      {/* 1. 最左侧图标栏 (56px) */}
      <aside className="flex w-14 shrink-0 flex-col items-center justify-between border-r border-slate-200/90 bg-white py-3">
        <div className="flex flex-col items-center gap-2">
          <Link
            to="/today"
            className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-sm font-bold text-white shadow-xs transition-transform hover:scale-[1.03]"
            title="LifeWork · 工作与生活管理"
          >
            LW
          </Link>

          <NavIconLink
            to="/today"
            active={location.pathname === "/today"}
            title="今日"
            icon={CalendarCheck2}
          />
          <NavIconLink
            to="/calendar"
            active={location.pathname === "/calendar"}
            title="月历视图"
            icon={Calendar}
          />
          <NavIconLink
            to="/notes"
            active={location.pathname === "/notes"}
            title="便签与片段"
            icon={StickyNote}
          />
          <NavIconLink
            to="/templates"
            active={location.pathname === "/templates"}
            title="排期模板"
            icon={CalendarClock}
          />
          <NavIconLink
            to="/tools"
            active={location.pathname === "/tools"}
            title="常用百宝箱"
            icon={Wrench}
          />
          <NavIconLink
            to="/work/ledger"
            active={
              location.pathname.startsWith("/work/ledger") ||
              location.pathname.startsWith("/work/task/")
            }
            title="任务台账"
            icon={FolderArchive}
          />
          <NavIconLink
            to="/work/overview"
            active={location.pathname === "/work/overview"}
            title="工作概览"
            icon={Briefcase}
          />
          <NavIconLink
            to="/life/overview"
            active={location.pathname.startsWith("/life/")}
            title="生活概览"
            icon={Heart}
          />
          <NavIconLink
            to="/backup"
            active={location.pathname === "/backup"}
            title="网盘备份"
            icon={CloudUpload}
          />
          <NavIconLink
            to="/tencent-docs"
            active={location.pathname === "/tencent-docs"}
            title="腾讯文档"
            icon={FileUp}
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          <NavIconLink
            to="/api-config"
            active={location.pathname === "/api-config"}
            title="接口与规则"
            icon={SlidersHorizontal}
          />
          <NavIconLink
            to="/settings"
            active={location.pathname === "/settings"}
            title="设置"
            icon={SettingsIcon}
          />
          <button
            type="button"
            onClick={() => navigate("/settings")}
            title={user ? `${user.realName} (${user.user.userErp || ""})` : "DevOps 未登录"}
            className="relative flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
          >
            <UserCircle2 className="h-5 w-5" />
            <span
              className={`absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                user ? "bg-emerald-500" : "bg-gray-400"
              }`}
            />
          </button>
        </div>
      </aside>

      {/* 2. 项目侧栏 (响应式可折叠) */}
      {sidebarOpen && (
        <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200/90 bg-[#fafbfc] xl:w-60">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-xs font-semibold tracking-wide text-slate-500">工作与生活导航</span>
          <button
            type="button"
            onClick={() => {
              setCreateParentId(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>新建项目</span>
          </button>
        </div>

        {/* 固定导航 */}
        <nav className="space-y-0.5 px-2.5 py-2">
          <SidebarLink
            to="/today"
            active={location.pathname === "/today"}
            icon={CalendarCheck2}
            label="今日"
          />
          <SidebarLink
            to="/calendar"
            active={location.pathname === "/calendar"}
            icon={Calendar}
            label="月历视图"
          />
          <SidebarLink
            to="/todos"
            active={location.pathname === "/todos"}
            icon={ListTodo}
            label="全部待办"
          />
          <SidebarLink
            to="/notes"
            active={location.pathname === "/notes"}
            icon={StickyNote}
            label="便签与片段"
          />
          <SidebarLink
            to="/templates"
            active={location.pathname === "/templates"}
            icon={CalendarClock}
            label="排期模板"
          />
          <SidebarLink
            to="/tools"
            active={location.pathname === "/tools"}
            icon={Wrench}
            label="常用百宝箱"
          />
          <SidebarLink
            to="/backup"
            active={location.pathname === "/backup"}
            icon={CloudUpload}
            label="网盘备份"
          />
          <SidebarLink
            to="/tencent-docs"
            active={location.pathname === "/tencent-docs"}
            icon={FileUp}
            label="腾讯文档"
          />
          <SidebarLink
            to="/api-config"
            active={location.pathname === "/api-config"}
            icon={SlidersHorizontal}
            label="接口与规则"
          />
        </nav>

        <div className="mt-2 px-4 text-[11px] font-semibold text-slate-400">
          我的项目空间
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto px-2.5 py-2">
          {(() => {
            const renderProjectTree = (parentId: string | null, depth: number): React.ReactNode => {
              const items = getDirectChildProjects(projects, parentId);
              return items.map((proj) => {
                const isWorkBuiltin = proj.id === "work";
                const isLifeBuiltin = proj.id === "life";
                const childProjects = getDirectChildProjects(projects, proj.id);
                const hasChildren =
                  isWorkBuiltin || isLifeBuiltin || childProjects.length > 0;
                const isOpen = expanded[proj.id] ?? (isWorkBuiltin || childProjects.length > 0);
                const projPath = `/project/${proj.id}`;
                const isCurrentRoute = location.pathname === projPath;

                return (
                  <div key={proj.id}>
                    <div
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCtxMenu({ x: e.clientX, y: e.clientY, project: proj });
                      }}
                      className={`group flex items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                        isCurrentRoute
                          ? "bg-blue-50 text-blue-700"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={isOpen ? "收起子项" : "展开子项"}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpanded((prev) => ({ ...prev, [proj.id]: !isOpen }));
                          }}
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200/70 hover:text-gray-700 ${
                            !hasChildren && depth > 0 ? "opacity-45" : ""
                          }`}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (isWorkBuiltin || isLifeBuiltin) {
                              setExpanded((prev) => ({ ...prev, [proj.id]: !isOpen }));
                            } else {
                              navigate(projPath);
                            }
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: proj.color }}
                          />
                          <span className="truncate">{proj.name}</span>
                        </button>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          title={`在「${proj.name}」下新建子项目`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCreateParentId(proj.id);
                            setCreateOpen(true);
                          }}
                          className="hidden h-5 w-5 items-center justify-center rounded text-slate-400 group-hover:flex hover:bg-blue-100 hover:text-blue-700"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        {isWorkBuiltin && (
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                            {activeWorkCount}
                          </span>
                        )}
                        {!isWorkBuiltin && childProjects.length > 0 && (
                          <span className="lw-nums rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                            {childProjects.length}
                          </span>
                        )}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-0.5 ml-3 space-y-0.5 border-l border-slate-200/80 pl-2">
                        {isWorkBuiltin ? (
                          <>
                            {WORK_SUB_NAV.map((item) => {
                              const active =
                                location.pathname === item.path ||
                                (item.path === "/work/ledger" &&
                                  location.pathname.startsWith("/work/task/"));
                              return (
                                <SidebarLink
                                  key={item.path}
                                  to={item.path}
                                  active={active}
                                  icon={item.icon}
                                  label={item.label}
                                />
                              );
                            })}
                            {childProjects.length > 0 && renderProjectTree(proj.id, depth + 1)}
                          </>
                        ) : isLifeBuiltin ? (
                          <>
                            {LIFE_SUB_NAV.map((item) => (
                              <SidebarLink
                                key={item.path}
                                to={item.path}
                                active={location.pathname === item.path}
                                icon={item.icon}
                                label={item.label}
                              />
                            ))}
                            {childProjects.length > 0 && renderProjectTree(proj.id, depth + 1)}
                          </>
                        ) : (
                          <>
                            <SidebarLink
                              to={projPath}
                              active={location.pathname === projPath}
                              icon={CheckSquare}
                              label="概览 / 文件夹 / 待办"
                            />
                            {childProjects.length > 0 && renderProjectTree(proj.id, depth + 1)}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              });
            };
            return renderProjectTree(null, 0);
          })()}
        </div>

        {/* 侧栏底部登录状态卡片 */}
        <div className="border-t border-slate-200/80 p-3">
          {user ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold text-emerald-900">
                      {user.realName}
                    </span>
                    <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      已连接
                    </span>
                  </div>
                  <div
                    className="mt-0.5 truncate text-[11px] text-emerald-700"
                    title={user.erp || user.user.userErp || user.user.erp || ""}
                  >
                    {user.orgName || user.user.org?.name || user.erp || user.user.userErp || user.user.erp || ""}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={handleLogout}
                  title="退出 DevOps 登录"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                >
                  {authBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <LogOut className="h-3 w-3" />
                  )}
                  <span>退出</span>
                </button>
              </div>
              {user.capacity &&
                user.capacity.personalDeliveryCapacity !== undefined && (
                  <Link
                    to="/work/overview"
                    className="lw-nums mt-2 flex items-center justify-between rounded-lg bg-white/85 px-2 py-1 text-[11px] text-emerald-900 ring-1 ring-emerald-200/70 transition-colors hover:bg-white"
                  >
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Award className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                      <span>个人交付产能</span>
                    </span>
                    <span className="font-semibold">
                      {Number(user.capacity.personalDeliveryCapacity).toFixed(2)} ·{" "}
                      <span
                        className={
                          user.capacity.isQualified ? "text-emerald-700" : "text-amber-600"
                        }
                      >
                        {user.capacity.isQualified ? "达标" : "待达标"}
                      </span>
                    </span>
                  </Link>
                )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs">
              <div className="flex items-center justify-between font-medium text-slate-700">
                <span>DevOps 登录</span>
                <span className="flex items-center gap-1 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] text-slate-600">
                  {authBusy && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                  {loginPending ? "扫码等待中" : "离线可用"}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {loginPending
                  ? "登录窗口已打开：扫码/账号登录成功后将自动同步个人数据并关闭窗口。"
                  : "离线模式：今日、待办、排期模板、项目与任务台账均可直接使用，登录后启用 DevOps 在线功能（可选）。"}
              </p>

              {loginPending ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={handleCaptureLogin}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {authBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <LogIn className="h-3 w-3" />
                    )}
                    <span>完成登录</span>
                  </button>
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={handleCancelLogin}
                    title="关闭已打开的 DevOps 登录弹窗"
                    className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-600 hover:bg-gray-100 disabled:opacity-60"
                  >
                    关闭窗口
                  </button>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    disabled={authBusy}
                    onClick={() => void handleOpenLogin(false)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {authBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogIn className="h-3.5 w-3.5" />
                    )}
                    <span>{authBusy ? "探测内网连通..." : "网页/扫码登录"}</span>
                  </button>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={authBusy}
                      onClick={handleAutoLogin}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                    >
                      <Globe className="h-3 w-3 text-blue-600" />
                      <span>恢复会话</span>
                    </button>
                    <button
                      type="button"
                      disabled={authBusy}
                      onClick={() => setCookieModalOpen(true)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                    >
                      <ClipboardPaste className="h-3 w-3 text-indigo-600" />
                      <span>粘贴 Cookie</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
      )}

      {/* 右侧主区 + 底部日志抽屉 (@container 自适应容器查询) */}
      <div className="@container flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* 顶栏 */}
        <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-slate-200/90 bg-white/95 px-4 backdrop-blur-xs">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
            <button
              type="button"
              aria-label={sidebarOpen ? "收起项目侧栏" : "展开项目侧栏"}
              title={sidebarOpen ? "收起侧边导航栏" : "展开侧边导航栏"}
              onClick={() => setSidebarOpen((v) => !v)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <nav
              aria-label="面包屑导航"
              className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-sm text-slate-500"
            >
              {breadcrumb.map((part, idx) => {
                const isLast = idx === breadcrumb.length - 1;
                return (
                  <span
                    key={idx}
                    className={`flex items-center gap-1.5 ${
                      isLast ? "min-w-0" : "hidden shrink-0 @[560px]:inline-flex"
                    }`}
                  >
                    {idx > 0 && (
                      <span className="hidden text-slate-300 @[560px]:inline" aria-hidden="true">
                        /
                      </span>
                    )}
                    <span
                      className={
                        isLast
                          ? "truncate font-semibold text-slate-900"
                          : "shrink-0 text-slate-500"
                      }
                    >
                      {part}
                    </span>
                  </span>
                );
              })}
            </nav>

            <AlmanacPopover today={today} todayCnInfo={todayCnInfo} />

            <MonthlyMissBadge />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* 专注番茄钟与久坐护眼提醒（隔离订阅，避免全局每秒重绘） */}
            <FocusTimerPill />

            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              title="快捷键与速记语法指南 (按 ?)"
              aria-label="快捷键与速记语法指南"
            >
              <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              title="全局命令面板 (Ctrl+K)"
            >
              <Command className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="lw-kbd hidden @[740px]:inline">Ctrl+K</span>
            </button>

            <button
              type="button"
              onClick={() => setScratchpadOpen((v) => !v)}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                scratchpadOpen
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              title="全局随手草稿板 (快捷键 Alt+S)"
            >
              <NotebookPen className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
              <span className="hidden @[740px]:inline">随手贴</span>
            </button>

            <button
              type="button"
              onClick={() => setQuickCaptureOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-blue-700"
              title="全局快速添加待办 (快捷键 Alt+N)"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>速记</span>
              <span className="hidden rounded bg-blue-500/80 px-1 font-mono text-[10px] @[1040px]:inline">
                Alt+N
              </span>
            </button>

            {/* 全局搜索 */}
            <div className="relative w-36 shrink-0 transition-[width] duration-150 @[680px]:w-44 @[960px]:w-56 @[1180px]:w-68">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchText}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索任务/待办/片段…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
            {searchFocused && searchText.trim() && (
              <div className="lw-popover-panel absolute right-0 z-40 mt-1.5 max-h-80 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 sm:w-80">
                {searchResults.matchedTasks.length === 0 &&
                searchResults.matchedTodos.length === 0 &&
                searchResults.matchedNotes.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-gray-400">
                    无匹配的任务、待办或便签
                  </div>
                ) : (
                  <>
                    {searchResults.matchedTasks.length > 0 && (
                      <div className="mb-1">
                        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase">
                          离线任务台账
                        </div>
                        {searchResults.matchedTasks.map((t) => (
                          <button
                            key={t.code}
                            type="button"
                            onMouseDown={() => {
                              setSearchText("");
                              navigate(`/work/task/${encodeURIComponent(t.code)}`);
                            }}
                            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-blue-50"
                          >
                            <span className="truncate font-medium text-gray-800">
                              <span className="mr-1.5 font-mono text-blue-600">{t.code}</span>
                              {t.name}
                            </span>
                            <span className="ml-2 shrink-0 text-[10px] text-gray-400">
                              {t.status}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchResults.matchedTodos.length > 0 && (
                      <div className="mb-1">
                        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase">
                          待办事项
                        </div>
                        {searchResults.matchedTodos.map((td) => (
                          <button
                            key={td.id}
                            type="button"
                            onMouseDown={() => {
                              setSearchText("");
                              navigate("/todos");
                            }}
                            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-blue-50"
                          >
                            <span
                              className={`truncate ${
                                td.done ? "text-gray-400 line-through" : "text-gray-800"
                              }`}
                            >
                              {td.title}
                            </span>
                            <span className="ml-2 shrink-0">
                              <DateBadge
                                date={td.date}
                                done={td.done}
                                variant="inline"
                                showIcon={false}
                                emptyLabel="收集箱"
                              />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchResults.matchedNotes.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase">
                          便签与片段（点击复制并打开）
                        </div>
                        {searchResults.matchedNotes.map((nt) => (
                          <button
                            key={nt.id}
                            type="button"
                            onMouseDown={() => {
                              setSearchText("");
                              if (nt.kind === "snippet") {
                                void navigator.clipboard
                                  .writeText(nt.content)
                                  .then(() => {
                                    void incrementNoteCopy(nt.id).catch(() => {});
                                    toast.success(`已复制片段「${nt.title}」`);
                                  })
                                  .catch(() => navigate("/notes"));
                              } else {
                                navigate("/notes");
                              }
                            }}
                            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-blue-50"
                          >
                            <span className="truncate font-medium text-gray-800">
                              {nt.title}
                            </span>
                            <span className="ml-2 shrink-0 font-mono text-[10px] text-gray-400">
                              {nt.kind === "snippet" ? `${nt.language} · 复制` : "便签"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
            <span className="lw-nums hidden whitespace-nowrap text-slate-400 @[1100px]:inline">
              更新于 {lastUpdated}
            </span>
            <button
              type="button"
              title={`刷新数据（更新于 ${lastUpdated}）`}
              onClick={() => refreshAll()}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              <span className="hidden @[600px]:inline">刷新</span>
            </button>
          </div>
          </div>
        </header>

        {/* 主内容区 */}
        <main className="min-h-0 flex-1 overflow-y-auto p-4 @[900px]:p-5">
          <Outlet />
        </main>

        {/* 底部可折叠运行日志抽屉（隔离订阅与批量渲染） */}
        <LogDrawer />
      </div>

      {/* 项目右键菜单 */}
      {ctxMenu && (
        <div
          className="fixed z-50 w-40 rounded-xl border border-gray-200 bg-white py-1 text-xs shadow-lg"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              const p = ctxMenu.project;
              setCtxMenu(null);
              setCreateParentId(p.id);
              setCreateOpen(true);
            }}
            className="block w-full px-3 py-1.5 text-left font-medium text-blue-600 hover:bg-blue-50"
          >
            + 新建子项目
          </button>
          <button
            type="button"
            onClick={() => {
              const p = ctxMenu.project;
              setCtxMenu(null);
              navigate(`/project/${p.id}`);
            }}
            className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            进入项目空间
          </button>
          <button
            type="button"
            onClick={() => {
              const p = ctxMenu.project;
              setCtxMenu(null);
              void api.projectFsOpen(p.id).catch((err) => toast.error(String(err)));
            }}
            className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            打开本地文件夹
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button
            type="button"
            onClick={() => {
              setRenameTarget(ctxMenu.project);
              setRenameValue(ctxMenu.project.name);
              setCtxMenu(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            重命名
          </button>
          <button
            type="button"
            onClick={() => {
              const p = ctxMenu.project;
              setCtxMenu(null);
              void handleDeleteProject(p);
            }}
            className={`block w-full px-3 py-1.5 text-left ${
              ctxMenu.project.builtin
                ? "cursor-not-allowed text-gray-300"
                : "text-red-600 hover:bg-red-50"
            }`}
          >
            删除项目
          </button>
        </div>
      )}

      {/* 重命名弹窗 */}
      {renameTarget && (
        <div
          className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenameTarget(null);
          }}
        >
          <form
            onSubmit={handleRenameSubmit}
            className="lw-modal-panel w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5"
          >
            <h3 className="text-sm font-semibold text-slate-900">重命名项目</h3>
            <input
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {offlineLoginModal && (
        <div
          className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOfflineLoginModal(null);
          }}
        >
          <div className="lw-modal-panel w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                  <WifiOff className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    无法连接 DevOps 内网
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    已自动拦截空白网页弹窗 · 支持全程离线使用本软件
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setOfflineLoginModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">目标地址</span>
                <code className="rounded bg-white px-2 py-0.5 font-mono text-[11px] font-medium text-gray-800 ring-1 ring-amber-200/80">
                  {offlineLoginModal.url}
                </code>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500">探测结果</span>
                <span className="font-mono text-[11px] text-amber-800">
                  {offlineLoginModal.reasonKind} · {offlineLoginModal.latencyMs}ms
                </span>
              </div>
              <div className="border-t border-amber-200/70 pt-2 leading-relaxed text-amber-900">
                {offlineLoginModal.message}
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-gray-600">
              您可以直接点击「继续离线使用」（今日工作台、待办、排期模板、离线任务台账、日记记账均不受影响）；若服务器 IP 或端口已变更，请点击前往修改后保存即可立即生效。
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOfflineLoginModal(null)}
                className="rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                继续离线使用
              </button>
              <button
                type="button"
                onClick={() => {
                  setOfflineLoginModal(null);
                  navigate("/api-config");
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>修改接口 IP / 配置</span>
              </button>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void handleOpenLogin(false)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {authBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>重试连接</span>
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2.5 text-[11px] text-gray-400">
              <button
                type="button"
                onClick={() => {
                  setOfflineLoginModal(null);
                  setCookieModalOpen(true);
                }}
                className="inline-flex items-center gap-1 hover:text-gray-700"
              >
                <ClipboardPaste className="h-3 w-3" />
                <span>手动粘贴 Cookie</span>
              </button>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void handleOpenLogin(true)}
                className="inline-flex items-center gap-1 hover:text-gray-700"
              >
                <ExternalLink className="h-3 w-3" />
                <span>忽略检测强制打开网页窗口</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {cookieModalOpen && (
        <div
          className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCookieModalOpen(false);
          }}
        >
          <form
            onSubmit={handleSubmitCookie}
            className="lw-modal-panel w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">粘贴 DevOps Cookie</h3>
              <button
                type="button"
                aria-label="关闭弹窗"
                onClick={() => setCookieModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              从浏览器开发者工具 (F12 → Network → Request Headers → Cookie) 复制整段 Cookie 文本。
            </p>
            <textarea
              rows={4}
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder="例如: SESSION=...; devops_token=..."
              className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCookieModalOpen(false)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={authBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {authBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>验证并连接</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {createOpen && (
        <CreateProjectModal
          open={createOpen}
          onClose={() => {
            setCreateOpen(false);
            setCreateParentId(null);
          }}
          defaultParentId={createParentId}
          onCreated={(created) => {
            if (created.parentId) {
              setExpanded((prev) => ({ ...prev, [created.parentId!]: true }));
            }
            navigate(`/project/${created.id}`);
          }}
        />
      )}
      {quickCaptureOpen && (
        <QuickCaptureModal
          open={quickCaptureOpen}
          onClose={() => setQuickCaptureOpen(false)}
          defaultProjectId={location.pathname.startsWith("/life") ? "life" : "work"}
        />
      )}
      {cmdOpen && (
        <CommandPaletteModal
          open={cmdOpen}
          onClose={() => setCmdOpen(false)}
          onOpenQuickCapture={() => setQuickCaptureOpen(true)}
          onOpenScratchpad={() => setScratchpadOpen(true)}
        />
      )}
      {scratchpadOpen && (
        <ScratchpadDrawer
          open={scratchpadOpen}
          onClose={() => setScratchpadOpen(false)}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}

function NavIconLink({
  to,
  active,
  title,
  icon: Icon,
}: {
  to: string;
  active: boolean;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      to={to}
      title={title}
      className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
        active
          ? "bg-blue-50 text-blue-600"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      <Icon className="h-5 w-5" />
    </Link>
  );
}

function SidebarLink({
  to,
  active,
  icon: Icon,
  label,
}: {
  to: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition ${
        active
          ? "bg-blue-50 font-medium text-blue-700"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-blue-600" : "text-gray-400"}`} />
      <span className="truncate">{label}</span>
    </Link>
  );
}
