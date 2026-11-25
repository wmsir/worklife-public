import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ApiConfig,
  BackupConfig,
  BackupProgress,
  BackupRecord,
  BackupTask,
  CnDayInfo,
  Countdown,
  FinanceData,
  FinanceTransaction,
  Habit,
  JournalEntry,
  JournalSummary,
  LoginWindowResult,
  McpConnectionTestResult,
  McpToolCallResult,
  NoteItem,
  PreviewStepItem,
  ProbeResult,
  Project,
  ProjectFsEntry,
  ProjectFsListing,
  ProjectKind,
  RecordTaskBranchInput,
  RecurringBill,
  Settings,
  SmartsheetWebhookProfile,
  TaskRecord,
  TaskSyncItem,
  TasksBatchReleaseResult,
  TasksSyncResult,
  Template,
  TencentDocPublishRecord,
  TencentDocsConfig,
  Todo,
  ToggleTodoResult,
  WebhookPushResult,
  WeeklyReportSummary,
  WhoamiResult,
} from "./types";

export interface WtCallbackEvent {
  event: "callback";
  id: string;
  name: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
}

export interface WtLogEvent {
  line: string;
  ts: string;
}

export const api = {
  // Settings
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  chooseDataRoot: (path: string) => invoke<Settings>("choose_data_root", { path }),
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),

  // Projects
  listProjects: () => invoke<Project[]>("list_projects"),
  createProject: (input: {
    name: string;
    kind: ProjectKind;
    icon?: string;
    color?: string;
    parentId?: string | null;
  }) =>
    invoke<Project>("create_project", {
      input: {
        name: input.name,
        kind: input.kind,
        icon: input.icon ?? "",
        color: input.color ?? "",
        parentId: input.parentId ?? null,
      },
    }),
  updateProject: (project: Project) => invoke<Project>("update_project", { project }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),

  // Project Folders & Files
  projectFsList: (projectId: string, relPath?: string | null) =>
    invoke<ProjectFsListing>("project_fs_list", {
      projectId,
      relPath: relPath ?? null,
    }),
  projectFsCreateFolder: (
    projectId: string,
    parentRelPath: string | null,
    folderName: string,
  ) =>
    invoke<ProjectFsEntry>("project_fs_create_folder", {
      projectId,
      parentRelPath: parentRelPath || null,
      folderName,
    }),
  projectFsCreateFile: (
    projectId: string,
    parentRelPath: string | null,
    fileName: string,
    content?: string | null,
  ) =>
    invoke<ProjectFsEntry>("project_fs_create_file", {
      projectId,
      parentRelPath: parentRelPath || null,
      fileName,
      content: content ?? null,
    }),
  projectFsReadFile: (projectId: string, relPath: string) =>
    invoke<string>("project_fs_read_file", { projectId, relPath }),
  projectFsWriteFile: (projectId: string, relPath: string, content: string) =>
    invoke<ProjectFsEntry>("project_fs_write_file", {
      projectId,
      relPath,
      content,
    }),
  projectFsImportFiles: (
    projectId: string,
    parentRelPath: string | null,
    sourcePaths: string[],
  ) =>
    invoke<ProjectFsEntry[]>("project_fs_import_files", {
      projectId,
      parentRelPath: parentRelPath || null,
      sourcePaths,
    }),
  projectFsRename: (projectId: string, relPath: string, newName: string) =>
    invoke<ProjectFsEntry>("project_fs_rename", {
      projectId,
      relPath,
      newName,
    }),
  projectFsDelete: (projectId: string, relPath: string) =>
    invoke<void>("project_fs_delete", { projectId, relPath }),
  projectFsOpen: (projectId: string, relPath?: string | null) =>
    invoke<void>("project_fs_open", {
      projectId,
      relPath: relPath ?? null,
    }),

  // Todos
  listTodos: (query?: {
    projectId?: string;
    dateFrom?: string;
    dateTo?: string;
    includeDone?: boolean;
  }) =>
    invoke<Todo[]>("list_todos", {
      query: query
        ? {
            projectId: query.projectId ?? null,
            dateFrom: query.dateFrom ?? null,
            dateTo: query.dateTo ?? null,
            includeDone: query.includeDone ?? true,
          }
        : null,
    }),
  upsertTodo: (todo: Partial<Todo> & { projectId: string; title: string }) =>
    invoke<Todo>("upsert_todo", {
      todo: {
        id: todo.id ?? "",
        projectId: todo.projectId,
        title: todo.title,
        note: todo.note ?? "",
        date: todo.date ?? null,
        time: todo.time ?? null,
        priority: todo.priority ?? 2,
        done: todo.done ?? false,
        taskCode: todo.taskCode ?? null,
        templateId: todo.templateId ?? null,
        createdAt: todo.createdAt ?? "",
        doneAt: todo.doneAt ?? null,
        tags: todo.tags ?? [],
        repeat: todo.repeat ?? "none",
        subtasks: todo.subtasks ?? [],
        pomodoros: todo.pomodoros ?? 0,
        spawnedNext: todo.spawnedNext ?? false,
      },
    }),
  deleteTodo: (id: string) => invoke<void>("delete_todo", { id }),
  toggleTodo: (id: string) => invoke<ToggleTodoResult>("toggle_todo", { id }),
  toggleSubtask: (todoId: string, subtaskId: string) =>
    invoke<Todo>("toggle_subtask", { todoId, subtaskId }),
  incrementTodoPomodoro: (todoId: string) =>
    invoke<Todo>("increment_todo_pomodoro", { todoId }),
  batchRescheduleTodos: (ids: string[], newDate: string | null) =>
    invoke<Todo[]>("batch_reschedule_todos", { ids, newDate }),
  clearDoneTodos: (projectId?: string | null) =>
    invoke<number>("clear_done_todos", { projectId: projectId ?? null }),

  // Templates
  listTemplates: () => invoke<Template[]>("list_templates"),
  upsertTemplate: (template: Template) => invoke<Template>("upsert_template", { template }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),
  previewTemplate: (templateId: string, startDate: string) =>
    invoke<{ steps: PreviewStepItem[]; endDate: string }>("preview_template", {
      templateId,
      startDate,
    }),
  applyTemplate: (input: {
    templateId: string;
    projectId: string;
    startDate: string;
    taskCode?: string | null;
  }) =>
    invoke<{ created: Todo[]; endDate: string }>("apply_template", {
      input: {
        templateId: input.templateId,
        projectId: input.projectId,
        startDate: input.startDate,
        taskCode: input.taskCode ?? null,
      },
    }),

  // Tasks / Offline Ledger
  tasksSync: (items: TaskSyncItem[]) => invoke<TasksSyncResult>("tasks_sync", { items }),
  tasksList: () => invoke<TaskRecord[]>("tasks_list"),
  taskCreate: (code: string, name: string) => invoke<TaskRecord>("task_create", { code, name }),
  taskUpdate: (code: string, patch: Partial<TaskRecord>) =>
    invoke<TaskRecord>("task_update", { code, patch }),
  tasksConfirmReleased: (codes?: string[]) =>
    invoke<TasksBatchReleaseResult>("tasks_confirm_released", { codes: codes ?? null }),
  taskRecordBranch: (input: RecordTaskBranchInput) =>
    invoke<TaskRecord>("task_record_branch", { input }),
  taskReadMd: (code: string) => invoke<string>("task_read_md", { code }),
  taskWriteMd: (code: string, content: string) =>
    invoke<void>("task_write_md", { code, content }),
  taskOpenFolder: (code: string) => invoke<void>("task_open_folder", { code }),
  taskOpenMd: (code: string) => invoke<void>("task_open_md", { code }),
  openDataRoot: () => invoke<void>("open_data_root"),

  // Auth & Worktime Engine
  openLoginWindow: (force = false) =>
    invoke<LoginWindowResult>("open_login_window", { force }),
  closeLoginWindow: () => invoke<boolean>("close_login_window"),
  captureLoginCookies: () => invoke<WhoamiResult>("capture_login_cookies"),
  setCookieString: (cookieStr: string) => invoke<WhoamiResult>("set_cookie_string", { s: cookieStr }),
  autoLogin: () => invoke<WhoamiResult>("auto_login"),
  logout: () => invoke<void>("logout"),
  whoami: () => invoke<WhoamiResult>("whoami"),
  wtStop: () => invoke<void>("wt_stop"),
  wtRestart: () => invoke<void>("wt_restart"),

  // Dynamic API & Rules Registry
  getApiConfig: () => invoke<ApiConfig>("get_api_config"),
  getDefaultApiConfig: () => invoke<ApiConfig>("get_default_api_config"),
  saveApiConfig: (config: ApiConfig) => invoke<ApiConfig>("save_api_config", { config }),
  resetApiConfig: () => invoke<ApiConfig>("reset_api_config"),
  probeDevopsConnection: (overrideUrl?: string | null, timeoutMs?: number | null) =>
    invoke<ProbeResult>("probe_devops_connection", {
      overrideUrl: overrideUrl ?? null,
      timeoutMs: timeoutMs ?? null,
    }),

  // Life Workspace (Habits, Countdowns, Journals)
  listHabits: () => invoke<Habit[]>("list_habits"),
  upsertHabit: (habit: Partial<Habit> & { name: string }) =>
    invoke<Habit>("upsert_habit", {
      habit: {
        id: habit.id ?? "",
        name: habit.name,
        icon: habit.icon ?? "✅",
        color: habit.color ?? "#10b981",
        frequency: habit.frequency ?? "daily",
        targetPerWeek: habit.targetPerWeek ?? 7,
        reminderTime: habit.reminderTime ?? null,
        archived: habit.archived ?? false,
        createdAt: habit.createdAt ?? "",
        checkins: habit.checkins ?? [],
      },
    }),
  deleteHabit: (id: string) => invoke<void>("delete_habit", { id }),
  toggleHabitCheckin: (id: string, date: string) =>
    invoke<Habit>("toggle_habit_checkin", { id, date }),

  listCountdowns: () => invoke<Countdown[]>("list_countdowns"),
  upsertCountdown: (item: Partial<Countdown> & { title: string; targetDate: string }) =>
    invoke<Countdown>("upsert_countdown", {
      item: {
        id: item.id ?? "",
        title: item.title,
        targetDate: item.targetDate,
        category: item.category ?? "重要日程",
        annual: item.annual ?? false,
        note: item.note ?? "",
        color: item.color ?? "#6366f1",
        createdAt: item.createdAt ?? "",
      },
    }),
  deleteCountdown: (id: string) => invoke<void>("delete_countdown", { id }),

  listJournals: () => invoke<JournalSummary[]>("list_journals"),
  readJournal: (date: string) => invoke<JournalEntry>("read_journal", { date }),
  saveJournal: (entry: JournalEntry) => invoke<JournalSummary>("save_journal", { entry }),
  openJournalDir: () => invoke<void>("open_journal_dir"),

  // Folder Cloud Backup
  getBackupConfig: () => invoke<BackupConfig>("get_backup_config"),
  upsertBackupTask: (task: BackupTask) => invoke<BackupConfig>("upsert_backup_task", { task }),
  deleteBackupTask: (id: string) => invoke<BackupConfig>("delete_backup_task", { id }),
  clearBackupHistory: () => invoke<BackupConfig>("clear_backup_history"),
  testWebdavConnection: (url: string, user: string, pass: string, remoteDir: string) =>
    invoke<string>("test_webdav_connection", { url, user, pass, remoteDir }),
  runBackupTask: (id: string) => invoke<BackupRecord>("run_backup_task", { id }),
  openLocalPath: (path: string) => invoke<void>("open_local_path", { path }),

  // Notes & Snippets
  listNotes: () => invoke<NoteItem[]>("list_notes"),
  upsertNote: (note: Partial<NoteItem> & { title: string; content: string }) =>
    invoke<NoteItem>("upsert_note", {
      note: {
        id: note.id ?? "",
        title: note.title,
        content: note.content,
        kind: note.kind ?? "note",
        area: note.area ?? "work",
        language: note.language ?? "text",
        color: note.color ?? "#ffffff",
        tags: note.tags ?? [],
        pinned: note.pinned ?? false,
        copyCount: note.copyCount ?? 0,
        createdAt: note.createdAt ?? "",
        updatedAt: note.updatedAt ?? "",
      },
    }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),
  incrementNoteCopy: (id: string) => invoke<NoteItem>("increment_note_copy", { id }),

  // Personal Finance & Recurring Bills
  getFinanceData: () => invoke<FinanceData>("get_finance_data"),
  setMonthlyBudget: (budget: number) => invoke<FinanceData>("set_monthly_budget", { budget }),
  upsertTransaction: (tx: Partial<FinanceTransaction> & { date: string; amount: number }) =>
    invoke<FinanceData>("upsert_transaction", {
      tx: {
        id: tx.id ?? "",
        date: tx.date,
        kind: tx.kind ?? "expense",
        amount: tx.amount,
        category: tx.category ?? "餐饮",
        account: tx.account ?? "微信",
        note: tx.note ?? "",
        createdAt: tx.createdAt ?? "",
      },
    }),
  deleteTransaction: (id: string) => invoke<FinanceData>("delete_transaction", { id }),
  upsertRecurringBill: (
    bill: Partial<RecurringBill> & { name: string; amount: number; dueDay: number },
  ) =>
    invoke<FinanceData>("upsert_recurring_bill", {
      bill: {
        id: bill.id ?? "",
        name: bill.name,
        amount: bill.amount,
        category: bill.category ?? "居住",
        dueDay: bill.dueDay,
        account: bill.account ?? "银行卡",
        note: bill.note ?? "",
        active: bill.active ?? true,
        lastRecordedMonth: bill.lastRecordedMonth ?? null,
      },
    }),
  deleteRecurringBill: (id: string) => invoke<FinanceData>("delete_recurring_bill", { id }),
  recordRecurringBillForMonth: (billId: string, month: string) =>
    invoke<FinanceData>("record_recurring_bill_for_month", { billId, month }),
  exportFinanceCsv: (month?: string | null) =>
    invoke<string>("export_finance_csv", { month: month ?? null }),

  // Weekly / Monthly Reports
  listWeeklyReports: () => invoke<WeeklyReportSummary[]>("list_weekly_reports"),
  readWeeklyReport: (key: string) => invoke<string>("read_weekly_report", { key }),
  saveWeeklyReport: (key: string, content: string) =>
    invoke<WeeklyReportSummary>("save_weekly_report", { key, content }),
  openWeeklyReportsDir: () => invoke<void>("open_weekly_reports_dir"),

  // CN Calendar Helpers
  getCalendarMonthInfo: (year: number, month: number) =>
    invoke<Record<string, CnDayInfo>>("get_calendar_month_info", { year, month }),
  getTodayCnInfo: () => invoke<CnDayInfo>("get_today_cn_info"),

  // Tencent Docs (Official MCP + Smartsheet Webhook)
  getTencentDocsConfig: () => invoke<TencentDocsConfig>("get_tencent_docs_config"),
  saveTencentDocsConfig: (config: TencentDocsConfig) =>
    invoke<TencentDocsConfig>("save_tencent_docs_config", { config }),
  upsertSmartsheetWebhook: (profile: SmartsheetWebhookProfile) =>
    invoke<TencentDocsConfig>("upsert_smartsheet_webhook", { profile }),
  deleteSmartsheetWebhook: (id: string) =>
    invoke<TencentDocsConfig>("delete_smartsheet_webhook", { id }),
  clearTencentDocsHistory: () =>
    invoke<TencentDocsConfig>("clear_tencent_docs_history"),
  testTencentMcpConnection: (overrideUrl?: string | null, overrideToken?: string | null) =>
    invoke<McpConnectionTestResult>("test_tencent_mcp_connection", {
      overrideUrl: overrideUrl ?? null,
      overrideToken: overrideToken ?? null,
    }),
  publishMarkdownToTencentDoc: (input: {
    title: string;
    markdown: string;
    parentId?: string | null;
    toolName?: string | null;
    sourceLabel?: string | null;
  }) =>
    invoke<TencentDocPublishRecord>("publish_markdown_to_tencent_doc", {
      title: input.title,
      markdown: input.markdown,
      parentId: input.parentId ?? null,
      toolName: input.toolName ?? null,
      sourceLabel: input.sourceLabel ?? null,
    }),
  callTencentMcpTool: (
    toolName: string,
    args: Record<string, unknown>,
    sourceLabel?: string | null,
  ) =>
    invoke<McpToolCallResult>("call_tencent_mcp_tool", {
      toolName,
      arguments: args,
      sourceLabel: sourceLabel ?? null,
    }),
  pushSmartsheetWebhook: (
    profileId: string,
    rows: Record<string, unknown>[],
    sourceLabel?: string | null,
  ) =>
    invoke<WebhookPushResult>("push_smartsheet_webhook", {
      profileId,
      rows,
      sourceLabel: sourceLabel ?? null,
    }),
  openExternalUrl: (url: string) => invoke<void>("open_external_url", { url }),
};

export async function wtCall<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  onCallback?: (name: string, args: unknown[], kwargs: Record<string, unknown>) => void,
): Promise<T> {
  const callId = crypto.randomUUID();
  let unlisten: UnlistenFn | undefined;
  if (onCallback) {
    unlisten = await listen<WtCallbackEvent>("wt-callback", (ev) => {
      if (ev.payload?.id === callId) {
        onCallback(ev.payload.name, ev.payload.args ?? [], ev.payload.kwargs ?? {});
      }
    });
  }
  try {
    return await invoke<T>("wt_call", { callId, method, params });
  } finally {
    if (unlisten) unlisten();
  }
}

export function onLog(cb: (ev: WtLogEvent) => void): Promise<UnlistenFn> {
  return listen<WtLogEvent>("wt-log", (ev) => {
    if (ev.payload) cb(ev.payload);
  });
}

export function onBackupProgress(cb: (ev: BackupProgress) => void): Promise<UnlistenFn> {
  return listen<BackupProgress>("backup-progress", (ev) => {
    if (ev.payload) cb(ev.payload);
  });
}

export function onBackupDone(cb: (ev: BackupRecord) => void): Promise<UnlistenFn> {
  return listen<BackupRecord>("backup-done", (ev) => {
    if (ev.payload) cb(ev.payload);
  });
}

export function onLoginWindowClosed(cb: () => void): Promise<UnlistenFn> {
  return listen("login-window-closed", () => {
    cb();
  });
}

export function onLoginSucceeded(cb: (info: WhoamiResult) => void): Promise<UnlistenFn> {
  return listen<WhoamiResult>("login-succeeded", (ev) => {
    if (ev.payload) cb(ev.payload);
  });
}
