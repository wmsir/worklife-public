import { create } from "zustand";
import { api } from "../lib/api";
import { getProjectDescendantIds } from "../lib/projects";
import { useFocusStore, useLogStore } from "./runtimeStore";
import type {
  BackupConfig,
  BackupRecord,
  BackupTask,
  Countdown,
  FinanceData,
  FinanceTransaction,
  Habit,
  NoteItem,
  Project,
  ProjectKind,
  RecordTaskBranchInput,
  RecurringBill,
  Settings,
  TaskRecord,
  TaskSyncItem,
  TasksBatchReleaseResult,
  TasksSyncResult,
  Template,
  Todo,
  ToggleTodoResult,
  WhoamiResult,
} from "../lib/types";

interface AppState {
  initialized: boolean;
  loading: boolean;
  busy: boolean;
  lastUpdated: string;

  settings: Settings | null;
  user: WhoamiResult | null;
  projects: Project[];
  todos: Todo[];
  templates: Template[];
  tasks: TaskRecord[];
  habits: Habit[];
  countdowns: Countdown[];
  backupConfig: BackupConfig | null;
  notes: NoteItem[];
  finance: FinanceData | null;

  setBusy: (busy: boolean) => void;
  setUser: (user: WhoamiResult | null) => void;
  setLogDrawerOpen: (open: boolean) => void;
  pushLog: (line: string, ts?: string) => void;
  clearLogs: () => void;

  bootstrap: () => Promise<void>;
  refreshAll: () => Promise<void>;

  refreshSettings: () => Promise<void>;
  saveSettings: (settings: Settings) => Promise<Settings>;
  chooseDataRoot: (path: string) => Promise<Settings>;

  refreshProjects: () => Promise<void>;
  createProject: (input: {
    name: string;
    kind: ProjectKind;
    icon?: string;
    color?: string;
    parentId?: string | null;
  }) => Promise<Project>;
  updateProject: (project: Project) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;

  refreshTodos: () => Promise<void>;
  upsertTodo: (todo: Partial<Todo> & { projectId: string; title: string }) => Promise<Todo>;
  deleteTodo: (id: string) => Promise<void>;
  toggleTodo: (id: string) => Promise<ToggleTodoResult>;
  toggleSubtask: (todoId: string, subtaskId: string) => Promise<Todo>;
  incrementTodoPomodoro: (todoId: string) => Promise<Todo>;
  batchRescheduleTodos: (ids: string[], newDate: string | null) => Promise<Todo[]>;
  clearDoneTodos: (projectId?: string | null) => Promise<number>;

  refreshTemplates: () => Promise<void>;
  upsertTemplate: (template: Template) => Promise<Template>;
  deleteTemplate: (id: string) => Promise<void>;
  applyTemplate: (input: {
    templateId: string;
    projectId: string;
    startDate: string;
    taskCode?: string | null;
  }) => Promise<{ created: Todo[]; endDate: string }>;

  refreshTasks: () => Promise<void>;
  tasksSync: (items: TaskSyncItem[]) => Promise<TasksSyncResult>;
  taskCreate: (code: string, name: string) => Promise<TaskRecord>;
  taskUpdate: (code: string, patch: Partial<TaskRecord>) => Promise<TaskRecord>;
  tasksConfirmReleased: (codes?: string[]) => Promise<TasksBatchReleaseResult>;
  taskRecordBranch: (input: RecordTaskBranchInput) => Promise<TaskRecord>;

  upsertHabit: (habit: Partial<Habit> & { name: string }) => Promise<Habit>;
  deleteHabit: (id: string) => Promise<void>;
  toggleHabitCheckin: (id: string, date: string) => Promise<Habit>;

  upsertCountdown: (item: Partial<Countdown> & { title: string; targetDate: string }) => Promise<Countdown>;
  deleteCountdown: (id: string) => Promise<void>;

  refreshBackupConfig: () => Promise<void>;
  upsertBackupTask: (task: BackupTask) => Promise<BackupConfig>;
  deleteBackupTask: (id: string) => Promise<BackupConfig>;
  clearBackupHistory: () => Promise<BackupConfig>;
  runBackupTask: (id: string) => Promise<BackupRecord>;

  upsertNote: (note: Partial<NoteItem> & { title: string; content: string }) => Promise<NoteItem>;
  deleteNote: (id: string) => Promise<void>;
  incrementNoteCopy: (id: string) => Promise<NoteItem>;

  setMonthlyBudget: (budget: number) => Promise<FinanceData>;
  upsertTransaction: (
    tx: Partial<FinanceTransaction> & { date: string; amount: number },
  ) => Promise<FinanceData>;
  deleteTransaction: (id: string) => Promise<FinanceData>;
  upsertRecurringBill: (
    bill: Partial<RecurringBill> & { name: string; amount: number; dueDay: number },
  ) => Promise<FinanceData>;
  deleteRecurringBill: (id: string) => Promise<FinanceData>;
  recordRecurringBillForMonth: (billId: string, month: string) => Promise<FinanceData>;

  startFocus: (todoId: string | null, title: string, minutes?: number) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  stopFocus: () => void;
  tickFocus: () => boolean;
}

function nowTimeStr(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  loading: false,
  busy: false,
  lastUpdated: nowTimeStr(),

  settings: null,
  user: null,
  projects: [],
  todos: [],
  templates: [],
  tasks: [],
  habits: [],
  countdowns: [],
  backupConfig: null,
  notes: [],
  finance: null,

  setBusy: (busy) => set({ busy }),
  setUser: (user) => set({ user }),
  setLogDrawerOpen: (open) => useLogStore.getState().setLogDrawerOpen(open),

  pushLog: (line, ts) => useLogStore.getState().pushLog(line, ts),

  clearLogs: () => useLogStore.getState().clearLogs(),

  bootstrap: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [
        settings,
        projects,
        todos,
        templates,
        tasks,
        habits,
        countdowns,
        backupConfig,
        notes,
        finance,
      ] = await Promise.all([
        api.getSettings(),
        api.listProjects(),
        api.listTodos({ includeDone: true }),
        api.listTemplates(),
        api.tasksList(),
        api.listHabits(),
        api.listCountdowns(),
        api.getBackupConfig(),
        api.listNotes(),
        api.getFinanceData(),
      ]);
      set({
        settings,
        projects,
        todos,
        templates,
        tasks,
        habits,
        countdowns,
        backupConfig,
        notes,
        finance,
        initialized: true,
        lastUpdated: nowTimeStr(),
      });
    } finally {
      set({ loading: false });
    }
  },

  refreshAll: async () => {
    set({ loading: true });
    try {
      const [projects, todos, templates, tasks, habits, countdowns, backupConfig, notes, finance] =
        await Promise.all([
          api.listProjects(),
          api.listTodos({ includeDone: true }),
          api.listTemplates(),
          api.tasksList(),
          api.listHabits(),
          api.listCountdowns(),
          api.getBackupConfig(),
          api.listNotes(),
          api.getFinanceData(),
        ]);
      set({
        projects,
        todos,
        templates,
        tasks,
        habits,
        countdowns,
        backupConfig,
        notes,
        finance,
        lastUpdated: nowTimeStr(),
      });
    } finally {
      set({ loading: false });
    }
  },

  refreshSettings: async () => {
    const settings = await api.getSettings();
    set({ settings });
  },

  saveSettings: async (settings) => {
    const saved = await api.saveSettings(settings);
    set({ settings: saved });
    return saved;
  },

  chooseDataRoot: async (path) => {
    const saved = await api.chooseDataRoot(path);
    set({ settings: saved });
    await get().refreshAll();
    return saved;
  },

  refreshProjects: async () => {
    const projects = await api.listProjects();
    set({ projects, lastUpdated: nowTimeStr() });
  },

  createProject: async (input) => {
    const created = await api.createProject(input);
    set((s) => ({ projects: [...s.projects, created], lastUpdated: nowTimeStr() }));
    return created;
  },

  updateProject: async (project) => {
    const updated = await api.updateProject(project);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === updated.id ? updated : p)),
      lastUpdated: nowTimeStr(),
    }));
    return updated;
  },

  deleteProject: async (id) => {
    await api.deleteProject(id);
    set((s) => {
      const removed = getProjectDescendantIds(s.projects, id);
      return {
        projects: s.projects.filter((p) => !removed.has(p.id)),
        todos: s.todos.filter((t) => !removed.has(t.projectId)),
        lastUpdated: nowTimeStr(),
      };
    });
  },

  refreshTodos: async () => {
    const todos = await api.listTodos({ includeDone: true });
    set({ todos, lastUpdated: nowTimeStr() });
  },

  upsertTodo: async (todo) => {
    const saved = await api.upsertTodo(todo);
    set((s) => {
      const exists = s.todos.some((t) => t.id === saved.id);
      const todos = exists
        ? s.todos.map((t) => (t.id === saved.id ? saved : t))
        : [...s.todos, saved];
      return { todos, lastUpdated: nowTimeStr() };
    });
    return saved;
  },

  deleteTodo: async (id) => {
    await api.deleteTodo(id);
    set((s) => ({
      todos: s.todos.filter((t) => t.id !== id),
      lastUpdated: nowTimeStr(),
    }));
  },

  toggleTodo: async (id) => {
    const res = await api.toggleTodo(id);
    set((s) => {
      const mapped = s.todos.map((t) => (t.id === res.todo.id ? res.todo : t));
      const todos = res.spawned ? [...mapped, res.spawned] : mapped;
      return { todos, lastUpdated: nowTimeStr() };
    });
    return res;
  },

  toggleSubtask: async (todoId, subtaskId) => {
    const updated = await api.toggleSubtask(todoId, subtaskId);
    set((s) => ({
      todos: s.todos.map((t) => (t.id === updated.id ? updated : t)),
      lastUpdated: nowTimeStr(),
    }));
    return updated;
  },

  incrementTodoPomodoro: async (todoId) => {
    const updated = await api.incrementTodoPomodoro(todoId);
    set((s) => ({
      todos: s.todos.map((t) => (t.id === updated.id ? updated : t)),
      lastUpdated: nowTimeStr(),
    }));
    return updated;
  },

  batchRescheduleTodos: async (ids, newDate) => {
    const updatedList = await api.batchRescheduleTodos(ids, newDate);
    const map = new Map(updatedList.map((u) => [u.id, u]));
    set((s) => ({
      todos: s.todos.map((t) => map.get(t.id) ?? t),
      lastUpdated: nowTimeStr(),
    }));
    return updatedList;
  },

  clearDoneTodos: async (projectId) => {
    const removed = await api.clearDoneTodos(projectId);
    set((s) => ({
      todos: s.todos.filter((t) => {
        if (!t.done) return true;
        if (projectId) return t.projectId !== projectId;
        return false;
      }),
      lastUpdated: nowTimeStr(),
    }));
    return removed;
  },

  refreshTemplates: async () => {
    const templates = await api.listTemplates();
    set({ templates, lastUpdated: nowTimeStr() });
  },

  upsertTemplate: async (template) => {
    const saved = await api.upsertTemplate(template);
    set((s) => {
      const exists = s.templates.some((t) => t.id === saved.id);
      const templates = exists
        ? s.templates.map((t) => (t.id === saved.id ? saved : t))
        : [...s.templates, saved];
      return { templates, lastUpdated: nowTimeStr() };
    });
    return saved;
  },

  deleteTemplate: async (id) => {
    await api.deleteTemplate(id);
    set((s) => ({
      templates: s.templates.filter((t) => t.id !== id),
      lastUpdated: nowTimeStr(),
    }));
  },

  applyTemplate: async (input) => {
    const res = await api.applyTemplate(input);
    set((s) => ({
      todos: [...s.todos, ...res.created],
      lastUpdated: nowTimeStr(),
    }));
    return res;
  },

  refreshTasks: async () => {
    const tasks = await api.tasksList();
    set({ tasks, lastUpdated: nowTimeStr() });
  },

  tasksSync: async (items) => {
    const res = await api.tasksSync(items);
    set({ tasks: res.tasks, lastUpdated: nowTimeStr() });
    return res;
  },

  taskCreate: async (code, name) => {
    const rec = await api.taskCreate(code, name);
    await get().refreshTasks();
    return rec;
  },

  taskUpdate: async (code, patch) => {
    const updated = await api.taskUpdate(code, patch);
    set((s) => ({
      tasks: s.tasks.map((t) => (t.code === updated.code ? updated : t)),
      lastUpdated: nowTimeStr(),
    }));
    return updated;
  },

  tasksConfirmReleased: async (codes) => {
    const res = await api.tasksConfirmReleased(codes);
    set({ tasks: res.tasks, lastUpdated: nowTimeStr() });
    return res;
  },

  taskRecordBranch: async (input) => {
    const updated = await api.taskRecordBranch(input);
    const existed = get().tasks.some((t) => t.code === updated.code);
    set((s) => ({
      tasks: existed
        ? s.tasks.map((t) => (t.code === updated.code ? updated : t))
        : [updated, ...s.tasks],
      lastUpdated: nowTimeStr(),
    }));
    if (!existed) {
      await get().refreshTasks();
    }
    return updated;
  },

  upsertHabit: async (habit) => {
    const saved = await api.upsertHabit(habit);
    set((s) => {
      const exists = s.habits.some((h) => h.id === saved.id);
      const habits = exists
        ? s.habits.map((h) => (h.id === saved.id ? saved : h))
        : [...s.habits, saved];
      return { habits, lastUpdated: nowTimeStr() };
    });
    return saved;
  },

  deleteHabit: async (id) => {
    await api.deleteHabit(id);
    set((s) => ({
      habits: s.habits.filter((h) => h.id !== id),
      lastUpdated: nowTimeStr(),
    }));
  },

  toggleHabitCheckin: async (id, date) => {
    const updated = await api.toggleHabitCheckin(id, date);
    set((s) => ({
      habits: s.habits.map((h) => (h.id === updated.id ? updated : h)),
      lastUpdated: nowTimeStr(),
    }));
    return updated;
  },

  upsertCountdown: async (item) => {
    const saved = await api.upsertCountdown(item);
    set((s) => {
      const exists = s.countdowns.some((c) => c.id === saved.id);
      const countdowns = exists
        ? s.countdowns.map((c) => (c.id === saved.id ? saved : c))
        : [...s.countdowns, saved];
      return { countdowns, lastUpdated: nowTimeStr() };
    });
    return saved;
  },

  deleteCountdown: async (id) => {
    await api.deleteCountdown(id);
    set((s) => ({
      countdowns: s.countdowns.filter((c) => c.id !== id),
      lastUpdated: nowTimeStr(),
    }));
  },

  refreshBackupConfig: async () => {
    const backupConfig = await api.getBackupConfig();
    set({ backupConfig, lastUpdated: nowTimeStr() });
  },

  upsertBackupTask: async (task) => {
    const backupConfig = await api.upsertBackupTask(task);
    set({ backupConfig, lastUpdated: nowTimeStr() });
    return backupConfig;
  },

  deleteBackupTask: async (id) => {
    const backupConfig = await api.deleteBackupTask(id);
    set({ backupConfig, lastUpdated: nowTimeStr() });
    return backupConfig;
  },

  clearBackupHistory: async () => {
    const backupConfig = await api.clearBackupHistory();
    set({ backupConfig, lastUpdated: nowTimeStr() });
    return backupConfig;
  },

  runBackupTask: async (id) => {
    const rec = await api.runBackupTask(id);
    await get().refreshBackupConfig();
    return rec;
  },

  upsertNote: async (note) => {
    const saved = await api.upsertNote(note);
    set((s) => {
      const exists = s.notes.some((n) => n.id === saved.id);
      const next = exists
        ? s.notes.map((n) => (n.id === saved.id ? saved : n))
        : [saved, ...s.notes];
      next.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
      return { notes: next, lastUpdated: nowTimeStr() };
    });
    return saved;
  },

  deleteNote: async (id) => {
    await api.deleteNote(id);
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      lastUpdated: nowTimeStr(),
    }));
  },

  incrementNoteCopy: async (id) => {
    const updated = await api.incrementNoteCopy(id);
    set((s) => ({
      notes: s.notes.map((n) => (n.id === updated.id ? updated : n)),
      lastUpdated: nowTimeStr(),
    }));
    return updated;
  },

  setMonthlyBudget: async (budget) => {
    const finance = await api.setMonthlyBudget(budget);
    set({ finance, lastUpdated: nowTimeStr() });
    return finance;
  },

  upsertTransaction: async (tx) => {
    const finance = await api.upsertTransaction(tx);
    set({ finance, lastUpdated: nowTimeStr() });
    return finance;
  },

  deleteTransaction: async (id) => {
    const finance = await api.deleteTransaction(id);
    set({ finance, lastUpdated: nowTimeStr() });
    return finance;
  },

  upsertRecurringBill: async (bill) => {
    const finance = await api.upsertRecurringBill(bill);
    set({ finance, lastUpdated: nowTimeStr() });
    return finance;
  },

  deleteRecurringBill: async (id) => {
    const finance = await api.deleteRecurringBill(id);
    set({ finance, lastUpdated: nowTimeStr() });
    return finance;
  },

  recordRecurringBillForMonth: async (billId, month) => {
    const finance = await api.recordRecurringBillForMonth(billId, month);
    set({ finance, lastUpdated: nowTimeStr() });
    return finance;
  },

  startFocus: (todoId, title, minutes = 25) =>
    useFocusStore.getState().startFocus(todoId, title, minutes),

  pauseFocus: () => useFocusStore.getState().pauseFocus(),

  resumeFocus: () => useFocusStore.getState().resumeFocus(),

  stopFocus: () => useFocusStore.getState().stopFocus(),

  tickFocus: () => useFocusStore.getState().tickFocus(),
}));
