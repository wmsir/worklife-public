import { Suspense, lazy, useEffect, useRef } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { ConfirmDialogHost } from "./components/ConfirmDialog";
import { Layout } from "./components/Layout";
import { api, onBackupDone, onLog } from "./lib/api";
import { TodayPage } from "./pages/TodayPage";
import { useAppStore } from "./store/appStore";
import { useLogStore } from "./store/runtimeStore";

const ApiConfigPage = lazy(() =>
  import("./pages/ApiConfigPage").then((m) => ({ default: m.ApiConfigPage })),
);
const BackupPage = lazy(() =>
  import("./pages/BackupPage").then((m) => ({ default: m.BackupPage })),
);
const CalendarPage = lazy(() =>
  import("./pages/CalendarPage").then((m) => ({ default: m.CalendarPage })),
);
const LifeFinancePage = lazy(() =>
  import("./pages/LifeFinancePage").then((m) => ({ default: m.LifeFinancePage })),
);
const LifeJournalPage = lazy(() =>
  import("./pages/LifeJournalPage").then((m) => ({ default: m.LifeJournalPage })),
);
const LifeOverviewPage = lazy(() =>
  import("./pages/LifeOverviewPage").then((m) => ({ default: m.LifeOverviewPage })),
);
const NotesPage = lazy(() =>
  import("./pages/NotesPage").then((m) => ({ default: m.NotesPage })),
);
const ProjectPage = lazy(() =>
  import("./pages/ProjectPage").then((m) => ({ default: m.ProjectPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const TaskMdPage = lazy(() =>
  import("./pages/TaskMdPage").then((m) => ({ default: m.TaskMdPage })),
);
const TemplatesPage = lazy(() =>
  import("./pages/TemplatesPage").then((m) => ({ default: m.TemplatesPage })),
);
const TencentDocsPage = lazy(() =>
  import("./pages/TencentDocsPage").then((m) => ({ default: m.TencentDocsPage })),
);
const TodosPage = lazy(() =>
  import("./pages/TodosPage").then((m) => ({ default: m.TodosPage })),
);
const ToolboxPage = lazy(() =>
  import("./pages/ToolboxPage").then((m) => ({ default: m.ToolboxPage })),
);
const WorkBranchPage = lazy(() =>
  import("./pages/WorkBranchPage").then((m) => ({ default: m.WorkBranchPage })),
);
const WorkFlowPage = lazy(() =>
  import("./pages/WorkFlowPage").then((m) => ({ default: m.WorkFlowPage })),
);
const WorkLedgerPage = lazy(() =>
  import("./pages/WorkLedgerPage").then((m) => ({ default: m.WorkLedgerPage })),
);
const WorkMissPage = lazy(() =>
  import("./pages/WorkMissPage").then((m) => ({ default: m.WorkMissPage })),
);
const WorkMrPage = lazy(() =>
  import("./pages/WorkMrPage").then((m) => ({ default: m.WorkMrPage })),
);
const WorkOverviewPage = lazy(() =>
  import("./pages/WorkOverviewPage").then((m) => ({ default: m.WorkOverviewPage })),
);
const WorkReportPage = lazy(() =>
  import("./pages/WorkReportPage").then((m) => ({ default: m.WorkReportPage })),
);
const WorkTeamPage = lazy(() =>
  import("./pages/WorkTeamPage").then((m) => ({ default: m.WorkTeamPage })),
);
const WorkWeeklyPage = lazy(() =>
  import("./pages/WorkWeeklyPage").then((m) => ({ default: m.WorkWeeklyPage })),
);

function RouteLoadingFallback() {
  return (
    <div className="flex h-48 items-center justify-center text-xs text-slate-400">
      正在加载页面模块…
    </div>
  );
}

export default function App() {
  const { bootstrap, initialized, settings, setUser, refreshBackupConfig } =
    useAppStore(
      useShallow((s) => ({
        bootstrap: s.bootstrap,
        initialized: s.initialized,
        settings: s.settings,
        setUser: s.setUser,
        refreshBackupConfig: s.refreshBackupConfig,
      })),
    );
  const checkedStartupAuth = useRef(false);

  useEffect(() => {
    bootstrap().catch((err) => {
      console.error("Bootstrap failed:", err);
    });
  }, [bootstrap]);

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | undefined;
    onLog((ev) => {
      if (active) useLogStore.getState().pushLog(ev.line, ev.ts);
    })
      .then((fn) => {
        if (!active) {
          fn();
        } else {
          unlistenFn = fn;
        }
      })
      .catch((err) => {
        console.error("Failed to attach wt-log listener:", err);
      });
    return () => {
      active = false;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | undefined;
    onBackupDone(() => {
      if (active) {
        void refreshBackupConfig().catch(() => {});
      }
    })
      .then((fn) => {
        if (!active) {
          fn();
        } else {
          unlistenFn = fn;
        }
      })
      .catch((err) => {
        console.error("Failed to attach backup-done listener:", err);
      });
    return () => {
      active = false;
      if (unlistenFn) unlistenFn();
    };
  }, [refreshBackupConfig]);

  useEffect(() => {
    if (!initialized || checkedStartupAuth.current) return;
    checkedStartupAuth.current = true;
    if (settings?.cookies?.length) {
      api
        .whoami()
        .then((res) => {
          setUser(res);
        })
        .catch((err) => {
          const msg = String(err);
          const low = msg.toLowerCase();
          const pushLog = useLogStore.getState().pushLog;
          if (
            low.includes("timed out") ||
            low.includes("connect") ||
            low.includes("refused") ||
            low.includes("error sending request")
          ) {
            pushLog(`ℹ️ 当前暂未接入 DevOps 内网（已自动进入离线模式，本地功能可正常使用）`);
          } else {
            pushLog(`⚠️ 登录状态校验未通过：${msg}`);
          }
        });
    }
  }, [initialized, settings, setUser]);

  if (!initialized) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[#f5f7fa] text-sm text-slate-500">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-sm font-bold text-white shadow-sm">
          LW
        </div>
        <span>正在加载 LifeWork 工作与生活管理工作区…</span>
      </div>
    );
  }

  return (
    <>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/today" replace />} />
            <Route path="today" element={<TodayPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="todos" element={<TodosPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="tools" element={<ToolboxPage />} />
            <Route path="project/:id" element={<ProjectPage />} />
            <Route path="work/overview" element={<WorkOverviewPage />} />
            <Route path="work/ledger" element={<WorkLedgerPage />} />
            <Route path="work/task/:code" element={<TaskMdPage />} />
            <Route path="work/report" element={<WorkReportPage />} />
            <Route path="work/flow" element={<WorkFlowPage />} />
            <Route path="work/miss" element={<WorkMissPage />} />
            <Route path="work/team" element={<WorkTeamPage />} />
            <Route path="work/branch" element={<WorkBranchPage />} />
            <Route path="work/mr" element={<WorkMrPage />} />
            <Route path="work/weekly" element={<WorkWeeklyPage />} />
            <Route path="life/overview" element={<LifeOverviewPage />} />
            <Route path="life/journal" element={<LifeJournalPage />} />
            <Route path="life/finance" element={<LifeFinancePage />} />
            <Route path="backup" element={<BackupPage />} />
            <Route path="tencent-docs" element={<TencentDocsPage />} />
            <Route path="api-config" element={<ApiConfigPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Route>
        </Routes>
      </Suspense>
      <ConfirmDialogHost />
    </>
  );
}
