import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Columns2,
  Copy,
  ExternalLink,
  Eye,
  File,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate, useParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ApplyTemplateModal } from "../components/ApplyTemplateModal";
import { confirmDialog } from "../components/ConfirmDialog";
import { CreateProjectModal } from "../components/CreateProjectModal";
import { TodoEditModal } from "../components/TodoEditModal";
import { TodoRow } from "../components/TodoRow";
import { parseQuickTodo, todayYmd } from "../lib/date";
import {
  getDirectChildProjects,
  getProjectAncestors,
  getProjectDescendantIds,
} from "../lib/projects";
import { api } from "../lib/api";
import type { Project, ProjectFsEntry, ProjectFsListing, Todo } from "../lib/types";
import { useAppStore } from "../store/appStore";

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileIcon(entry: ProjectFsEntry) {
  if (entry.isDir) return Folder;
  const ext = entry.ext.toLowerCase();
  if (["json", "yml", "yaml", "toml", "ini", "sql", "xml", "js", "ts", "css", "html"].includes(ext)) {
    return FileCode2;
  }
  if (["md", "markdown", "txt", "log", "csv"].includes(ext)) {
    return FileText;
  }
  return File;
}

export function ProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const {
    projects,
    todos,
    upsertTodo,
    toggleTodo,
    deleteTodo,
    clearDoneTodos,
    deleteProject,
  } = useAppStore(
    useShallow((s) => ({
      projects: s.projects,
      todos: s.todos,
      upsertTodo: s.upsertTodo,
      toggleTodo: s.toggleTodo,
      deleteTodo: s.deleteTodo,
      clearDoneTodos: s.clearDoneTodos,
      deleteProject: s.deleteProject,
    })),
  );

  const project = projects.find((p) => p.id === id);

  // Todos state
  const [quickInput, setQuickInput] = useState("");
  const [showDone, setShowDone] = useState(true);
  const [includeChildTodos, setIncludeChildTodos] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [tplOpen, setTplOpen] = useState(false);

  // Sub-project creation modal state
  const [createSubOpen, setCreateSubOpen] = useState(false);
  const [createSubParentId, setCreateSubParentId] = useState<string>(id);

  // Folder & Document workspace state
  const [currentRelPath, setCurrentRelPath] = useState("");
  const [listing, setListing] = useState<ProjectFsListing | null>(null);
  const [fsLoading, setFsLoading] = useState(false);
  const [creatorMode, setCreatorMode] = useState<"none" | "folder" | "file">("none");
  const [creatorName, setCreatorName] = useState("");
  const [creatingFs, setCreatingFs] = useState(false);
  const [renamingRelPath, setRenamingRelPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Inline text/Markdown document editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorRelPath, setEditorRelPath] = useState("");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [editorSavedContent, setEditorSavedContent] = useState("");
  const [editorMode, setEditorMode] = useState<"edit" | "split" | "preview">("split");
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);

  const ancestors = useMemo(() => getProjectAncestors(projects, id), [projects, id]);
  const directChildren = useMemo(() => getDirectChildProjects(projects, id), [projects, id]);
  const descendantIds = useMemo(() => getProjectDescendantIds(projects, id), [projects, id]);
  const projectMap = useMemo(
    () => new Map<string, Project>(projects.map((p) => [p.id, p])),
    [projects],
  );

  const loadListing = useCallback(
    async (relPath: string) => {
      if (!id) return;
      setFsLoading(true);
      try {
        const res = await api.projectFsList(id, relPath || null);
        setListing(res);
      } catch (err) {
        toast.error(`读取项目目录失败: ${String(err)}`);
      } finally {
        setFsLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    setCurrentRelPath("");
    setCreatorMode("none");
    setCreatorName("");
    setRenamingRelPath(null);
    setEditorOpen(false);
    setCreateSubParentId(id);
  }, [id]);

  useEffect(() => {
    if (!project) return;
    void loadListing(currentRelPath);
  }, [project, currentRelPath, loadListing]);

  const projectTodos = useMemo(() => {
    const scopeIds =
      includeChildTodos && directChildren.length > 0 ? descendantIds : new Set([id]);
    return todos
      .filter((t) => scopeIds.has(t.projectId) && (showDone || !t.done))
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const da = a.date || "9999-99-99";
        const db = b.date || "9999-99-99";
        if (da !== db) return da.localeCompare(db);
        return a.priority - b.priority;
      });
  }, [todos, id, showDone, includeChildTodos, directChildren.length, descendantIds]);

  const handleOpenEditor = useCallback(
    async (entry: ProjectFsEntry) => {
      setEditorOpen(true);
      setEditorRelPath(entry.relPath);
      setEditorTitle(entry.name);
      setEditorLoading(true);
      try {
        const content = await api.projectFsReadFile(id, entry.relPath);
        setEditorContent(content);
        setEditorSavedContent(content);
      } catch (err) {
        toast.error(`读取文件失败: ${String(err)}`);
        setEditorOpen(false);
      } finally {
        setEditorLoading(false);
      }
    },
    [id],
  );

  const handleSaveEditor = useCallback(async () => {
    if (!editorRelPath) return;
    setEditorSaving(true);
    try {
      await api.projectFsWriteFile(id, editorRelPath, editorContent);
      setEditorSavedContent(editorContent);
      toast.success(`已保存「${editorTitle}」`);
      await loadListing(currentRelPath);
    } catch (err) {
      toast.error(`保存文件失败: ${String(err)}`);
    } finally {
      setEditorSaving(false);
    }
  }, [id, editorRelPath, editorContent, editorTitle, loadListing, currentRelPath]);

  const editorDirty = editorContent !== editorSavedContent;

  const handleCloseEditor = useCallback(async () => {
    if (editorDirty) {
      const ok = await confirmDialog({
        title: `放弃对「${editorTitle}」的未保存修改？`,
        description: "关闭编辑器后未保存的文本更改将会丢失。",
        confirmText: "放弃修改",
        tone: "warning",
      });
      if (!ok) return;
    }
    setEditorOpen(false);
  }, [editorDirty, editorTitle]);

  useEffect(() => {
    if (!editorOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveEditor();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorOpen, handleSaveEditor]);

  if (!project) {
    return (
      <div className="mx-auto max-w-4xl rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
        未找到该项目，请从左侧选择一个项目。
      </div>
    );
  }

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;
    const { title, date, time, priority, tags, repeat } = parseQuickTodo(quickInput);
    if (!title) return;
    try {
      await upsertTodo({
        projectId: project.id,
        title,
        date: date ?? todayYmd(),
        time,
        priority,
        tags,
        repeat,
      });
      setQuickInput("");
      toast.success("已添加待办");
    } catch (err) {
      toast.error(`添加失败: ${err}`);
    }
  };

  const handleToggle = async (tid: string) => {
    try {
      const res = await toggleTodo(tid);
      if (res.spawned) {
        toast.success(
          `已完成「${res.todo.title}」，已生成下一次重复待办 (${res.spawned.date ?? ""})`,
        );
      }
    } catch (err) {
      toast.error(`操作失败: ${err}`);
    }
  };

  const handleClearDone = async () => {
    try {
      const removed = await clearDoneTodos(project.id);
      if (removed === 0) {
        toast.info("当前项目没有可清理的已完成待办");
      } else {
        toast.success(`已清理 ${removed} 条已完成待办`);
      }
    } catch (err) {
      toast.error(`清理失败: ${err}`);
    }
  };

  const handleCreateFsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = creatorName.trim();
    if (!raw) {
      toast.error(creatorMode === "folder" ? "请输入文件夹名称" : "请输入文档名称");
      return;
    }
    setCreatingFs(true);
    try {
      if (creatorMode === "folder") {
        const created = await api.projectFsCreateFolder(
          project.id,
          currentRelPath || null,
          raw,
        );
        toast.success(`已创建文件夹「${created.name}」`);
        setCreatorMode("none");
        setCreatorName("");
        await loadListing(currentRelPath);
      } else {
        const created = await api.projectFsCreateFile(
          project.id,
          currentRelPath || null,
          raw,
          null,
        );
        toast.success(`已创建文档「${created.name}」`);
        setCreatorMode("none");
        setCreatorName("");
        await loadListing(currentRelPath);
        if (created.isTextEditable) {
          void handleOpenEditor(created);
        }
      }
    } catch (err) {
      toast.error(`创建失败: ${String(err)}`);
    } finally {
      setCreatingFs(false);
    }
  };

  const handleImportFiles = async () => {
    try {
      const picked = await open({
        multiple: true,
        title: `导入文件到「${project.name}${currentRelPath ? `/${currentRelPath}` : ""}」`,
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      if (paths.length === 0) return;
      const imported = await api.projectFsImportFiles(
        project.id,
        currentRelPath || null,
        paths,
      );
      toast.success(`已导入 ${imported.length} 个文件到当前文件夹`);
      await loadListing(currentRelPath);
    } catch (err) {
      toast.error(`导入文件失败: ${String(err)}`);
    }
  };

  const handleRenameFsSubmit = async (e: React.FormEvent, entry: ProjectFsEntry) => {
    e.preventDefault();
    const next = renameValue.trim();
    if (!next || next === entry.name) {
      setRenamingRelPath(null);
      return;
    }
    try {
      await api.projectFsRename(project.id, entry.relPath, next);
      toast.success("重命名成功");
      setRenamingRelPath(null);
      await loadListing(currentRelPath);
    } catch (err) {
      toast.error(`重命名失败: ${String(err)}`);
    }
  };

  const handleDeleteFsEntry = async (entry: ProjectFsEntry) => {
    const ok = await confirmDialog({
      title: `确定删除${entry.isDir ? "文件夹" : "文件"}「${entry.name}」吗？`,
      description: entry.isDir
        ? "删除后该文件夹内的所有文件也会一并移除，此操作不可恢复。"
        : "该文件将从本地项目目录永久删除，不可恢复。",
      confirmText: "确认删除",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.projectFsDelete(project.id, entry.relPath);
      toast.success(`已删除「${entry.name}」`);
      await loadListing(currentRelPath);
    } catch (err) {
      toast.error(`删除失败: ${String(err)}`);
    }
  };

  const handleDeleteChildProject = async (child: Project) => {
    const descendants = getProjectDescendantIds(projects, child.id);
    const nestedCount = Math.max(0, descendants.size - 1);
    const ok = await confirmDialog({
      title: `确定删除子项目「${child.name}」吗？`,
      description:
        nestedCount > 0
          ? `该子项目包含 ${nestedCount} 个下级子项目，删除后关联待办将被清理，本地目录将移至备份回收站。`
          : "子项目下的关联待办将被清理，本地目录将移至备份回收站。",
      confirmText: "删除子项目",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteProject(child.id);
      toast.success(`已删除子项目「${child.name}」`);
      await loadListing(currentRelPath);
    } catch (err) {
      toast.error(`删除失败: ${String(err)}`);
    }
  };

  const entries = listing?.entries ?? [];
  const pathSegments = currentRelPath ? currentRelPath.split("/").filter(Boolean) : [];
  const parentRelPath =
    pathSegments.length > 1 ? pathSegments.slice(0, -1).join("/") : "";

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8">
      {/* 1. 项目概览头部 + 层级面包屑 */}
      <div className="lw-card p-5">
        {ancestors.length > 1 && (
          <div className="mb-2.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            <span>所属路径：</span>
            {ancestors.map((anc, idx) => {
              const isLast = idx === ancestors.length - 1;
              return (
                <span key={anc.id} className="inline-flex items-center gap-1">
                  {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
                  {isLast ? (
                    <span className="font-semibold text-slate-700">{anc.name}</span>
                  ) : (
                    <Link
                      to={`/project/${anc.id}`}
                      className="rounded px-1.5 py-0.5 hover:bg-slate-100 hover:text-blue-600"
                    >
                      {anc.name}
                    </Link>
                  )}
                </span>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-4 shrink-0 rounded-full"
              style={{ backgroundColor: project.color }}
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">{project.name}</h1>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    project.kind === "work"
                      ? "bg-blue-50 text-blue-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {project.kind === "work" ? "工作项目" : "生活项目"}
                </span>
              </div>
              <p className="lw-nums mt-0.5 text-xs text-slate-500">
                子项目 {directChildren.length} 个 · 当前目录 {entries.length} 项 · 未完成待办{" "}
                {projectTodos.filter((t) => !t.done).length} 项
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCreateSubParentId(project.id);
                setCreateSubOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span>新建子项目</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatorMode("folder");
                setCreatorName("");
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5 text-amber-600" />
              <span>新建文件夹</span>
            </button>
            <button
              type="button"
              onClick={() =>
                api.projectFsOpen(project.id, null).catch((e) => toast.error(String(e)))
              }
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
              <span>打开本地目录</span>
            </button>
            <button
              type="button"
              onClick={() => setTplOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <span>套用排期模板</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. 子项目区 */}
      <section className="lw-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              下级子项目 ({directChildren.length})
            </h2>
            <p className="text-[11px] text-slate-500">
              可在「{project.name}」下拆分多个子项目（例如季度总结、年度述职、专项复盘），每个子项目自动建立独立子目录与待办空间
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreateSubParentId(project.id);
              setCreateSubOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>添加子项目</span>
          </button>
        </div>

        {directChildren.length === 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-500">
            <span>当前「{project.name}」下还没有子项目，点击右侧即可创建。</span>
            <button
              type="button"
              onClick={() => {
                setCreateSubParentId(project.id);
                setCreateSubOpen(true);
              }}
              className="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建子项目</span>
            </button>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {directChildren.map((child) => {
              const subChildrenCount = getDirectChildProjects(projects, child.id).length;
              const childScope = getProjectDescendantIds(projects, child.id);
              const pendingTodosCount = todos.filter(
                (t) => childScope.has(t.projectId) && !t.done,
              ).length;

              return (
                <div
                  key={child.id}
                  onClick={() => navigate(`/project/${child.id}`)}
                  className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-3.5 transition hover:border-blue-300 hover:shadow-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: child.color }}
                      />
                      <span className="truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                        {child.name}
                      </span>
                    </div>
                    <div
                      className="flex shrink-0 items-center gap-1 opacity-75 group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        title={`在「${child.name}」下继续新建子项目`}
                        onClick={() => {
                          setCreateSubParentId(child.id);
                          setCreateSubOpen(true);
                        }}
                        className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="打开本地文件夹"
                        onClick={() =>
                          api.projectFsOpen(child.id, null).catch((e) => toast.error(String(e)))
                        }
                        className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="删除子项目"
                        onClick={() => void handleDeleteChildProject(child)}
                        className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="lw-nums mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>
                      子项目 {subChildrenCount} · 未完成待办 {pendingTodosCount}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-blue-600">
                      <span>进入</span>
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. 本地文件夹与文档空间 */}
      <section className="lw-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              项目文件夹与文档 ({entries.length})
            </h2>
            <p
              className="mt-0.5 truncate font-mono text-[11px] text-slate-400"
              title={listing?.rootAbsPath}
            >
              本地目录：{listing?.rootAbsPath || `项目/${project.folderName || project.name}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setCreatorMode("folder");
                setCreatorName("");
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <FolderPlus className="h-3.5 w-3.5 text-amber-600" />
              <span>新建文件夹</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatorMode("file");
                setCreatorName("");
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <FilePlus2 className="h-3.5 w-3.5 text-blue-600" />
              <span>新建文档 (.md)</span>
            </button>
            <button
              type="button"
              onClick={() => void handleImportFiles()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Upload className="h-3.5 w-3.5 text-emerald-600" />
              <span>导入文件</span>
            </button>
            <button
              type="button"
              onClick={() => void loadListing(currentRelPath)}
              title="刷新当前目录"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${fsLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* 目录导航面包屑 */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {currentRelPath && (
              <button
                type="button"
                onClick={() => setCurrentRelPath(parentRelPath)}
                className="mr-1 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
              >
                <ArrowLeft className="h-3 w-3" />
                <span>返回上级</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setCurrentRelPath("")}
              className={`rounded px-1.5 py-0.5 font-medium ${
                currentRelPath === ""
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-600 hover:bg-slate-200/70"
              }`}
            >
              {project.name}（根目录）
            </button>
            {pathSegments.map((seg, idx) => {
              const targetRel = pathSegments.slice(0, idx + 1).join("/");
              const isLast = idx === pathSegments.length - 1;
              return (
                <span key={targetRel} className="inline-flex items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setCurrentRelPath(targetRel)}
                    className={`rounded px-1.5 py-0.5 ${
                      isLast
                        ? "bg-blue-100 font-semibold text-blue-700"
                        : "text-slate-600 hover:bg-slate-200/70"
                    }`}
                  >
                    {seg}
                  </button>
                </span>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() =>
              api
                .projectFsOpen(project.id, currentRelPath || null)
                .catch((e) => toast.error(String(e)))
            }
            className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-blue-600"
          >
            <ExternalLink className="h-3 w-3" />
            <span>资源管理器中打开</span>
          </button>
        </div>

        {/* 内联新建文件夹 / 文档栏 */}
        {creatorMode !== "none" && (
          <form
            onSubmit={handleCreateFsSubmit}
            className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/50 p-2.5"
          >
            <span className="shrink-0 text-xs font-medium text-blue-800">
              {creatorMode === "folder" ? "新建文件夹：" : "新建文档："}
            </span>
            <input
              type="text"
              autoFocus
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreatorMode("none");
                  setCreatorName("");
                }
              }}
              placeholder={
                creatorMode === "folder"
                  ? "例如：2026年Q4总结 或 2026年/周报归档（支持斜杠创建多级目录）"
                  : "例如：年终总结（未填后缀自动保存为 .md 并打开编辑器）"
              }
              className="min-w-[220px] flex-1 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={creatingFs}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {creatingFs && <Loader2 className="h-3 w-3 animate-spin" />}
              <span>确定创建</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatorMode("none");
                setCreatorName("");
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              取消
            </button>
          </form>
        )}

        {/* 目录条目清单 */}
        <div className="mt-3">
          {fsLoading && entries.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span>正在读取目录...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400">
              当前文件夹为空，可点击上方「新建文件夹」「新建文档 (.md)」或「导入文件」整理项目资料
            </div>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {entries.map((entry) => {
                const Icon = getFileIcon(entry);
                const isLinkedSub = Boolean(entry.linkedProjectId);
                const isRenaming = renamingRelPath === entry.relPath;

                return (
                  <div
                    key={entry.relPath}
                    className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs transition hover:bg-slate-50"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          entry.isDir
                            ? isLinkedSub
                              ? "text-blue-600"
                              : "text-amber-500"
                            : entry.isTextEditable
                              ? "text-blue-600"
                              : "text-slate-400"
                        }`}
                      />

                      {isRenaming ? (
                        <form
                          onSubmit={(e) => void handleRenameFsSubmit(e, entry)}
                          className="flex min-w-0 flex-1 items-center gap-1.5"
                        >
                          <input
                            type="text"
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setRenamingRelPath(null);
                            }}
                            className="min-w-[160px] flex-1 rounded border border-blue-400 px-2 py-1 text-xs text-slate-900 focus:outline-none"
                          />
                          <button
                            type="submit"
                            className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingRelPath(null)}
                            className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                          >
                            取消
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (entry.isDir) {
                              setCurrentRelPath(entry.relPath);
                            } else if (entry.isTextEditable) {
                              void handleOpenEditor(entry);
                            } else {
                              void api
                                .projectFsOpen(project.id, entry.relPath)
                                .catch((e) => toast.error(String(e)));
                            }
                          }}
                          className="truncate text-left font-medium text-slate-800 hover:text-blue-600"
                        >
                          {entry.name}
                        </button>
                      )}

                      {isLinkedSub && (
                        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          子项目目录
                        </span>
                      )}
                      {!entry.isDir && entry.isTextEditable && (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          在线可编辑
                        </span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-3 text-[11px] text-slate-400">
                      <span className="lw-nums hidden sm:inline">
                        {entry.isDir ? "文件夹" : formatFileSize(entry.size)}
                      </span>
                      <span className="lw-nums hidden md:inline">{entry.modifiedAt}</span>

                      <div className="flex items-center gap-1">
                        {isLinkedSub && entry.linkedProjectId && (
                          <button
                            type="button"
                            onClick={() => navigate(`/project/${entry.linkedProjectId}`)}
                            className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                          >
                            进入子项目
                          </button>
                        )}
                        {!entry.isDir && entry.isTextEditable && (
                          <button
                            type="button"
                            onClick={() => void handleOpenEditor(entry)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            编辑
                          </button>
                        )}
                        <button
                          type="button"
                          title="使用系统默认应用打开"
                          onClick={() =>
                            api
                              .projectFsOpen(project.id, entry.relPath)
                              .catch((e) => toast.error(String(e)))
                          }
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isLinkedSub}
                          title={
                            isLinkedSub
                              ? "子项目目录请在左侧栏或子项目卡片中重命名"
                              : "重命名"
                          }
                          onClick={() => {
                            setRenamingRelPath(entry.relPath);
                            setRenameValue(entry.name);
                          }}
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isLinkedSub}
                          title={
                            isLinkedSub
                              ? "子项目目录请通过删除对应子项目来移除"
                              : "删除"
                          }
                          onClick={() => void handleDeleteFsEntry(entry)}
                          className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 4. 项目待办事项区 */}
      <form
        onSubmit={handleQuickAdd}
        className="lw-card flex flex-wrap items-center gap-2.5 p-3 sm:flex-nowrap"
      >
        <input
          type="text"
          value={quickInput}
          onChange={(e) => setQuickInput(e.target.value)}
          placeholder={`快速向「${project.name}」添加待办（支持 明天 @09:30 !1 #标签 /每周）...`}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setEditingTodo(null);
            setModalOpen(true);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>详细新建</span>
        </button>
        <button
          type="submit"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          <span>添加</span>
        </button>
      </form>

      <div className="lw-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            项目待办 ({projectTodos.length})
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            {directChildren.length > 0 && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={includeChildTodos}
                  onChange={(e) => setIncludeChildTodos(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>包含子项目待办</span>
              </label>
            )}
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={showDone}
                onChange={(e) => setShowDone(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>显示已完成</span>
            </label>
            <button
              type="button"
              onClick={handleClearDone}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              <Trash2 className="h-3.5 w-3.5 text-slate-400" />
              <span>清理已完成</span>
            </button>
          </div>
        </div>

        {projectTodos.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            当前项目暂无待办事项
          </div>
        ) : (
          <div className="space-y-2">
            {projectTodos.map((td) => (
              <TodoRow
                key={td.id}
                todo={td}
                project={projectMap.get(td.projectId) ?? project}
                showDate
                onToggle={handleToggle}
                onEdit={(item) => {
                  setEditingTodo(item);
                  setModalOpen(true);
                }}
                onDelete={async (tid) => {
                  await deleteTodo(tid);
                  toast.success("已删除待办");
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 5. 在线文本 / Markdown 文档编辑器弹窗 */}
      {editorOpen && (
        <div className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
          <div className="lw-modal-panel flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-blue-600" />
                <span className="truncate text-sm font-semibold text-slate-900">
                  {editorTitle}
                </span>
                <code className="hidden rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 sm:inline">
                  {editorRelPath}
                </code>
                {editorDirty && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    未保存
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setEditorMode("edit")}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                      editorMode === "edit"
                        ? "bg-white font-medium text-blue-600 shadow-2xs"
                        : "text-slate-600"
                    }`}
                  >
                    <Pencil className="h-3 w-3" />
                    <span>源码</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorMode("split")}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                      editorMode === "split"
                        ? "bg-white font-medium text-blue-600 shadow-2xs"
                        : "text-slate-600"
                    }`}
                  >
                    <Columns2 className="h-3 w-3" />
                    <span>双栏</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorMode("preview")}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                      editorMode === "preview"
                        ? "bg-white font-medium text-blue-600 shadow-2xs"
                        : "text-slate-600"
                    }`}
                  >
                    <Eye className="h-3 w-3" />
                    <span>预览</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(editorContent)
                      .then(() => toast.success("已复制文档全文"))
                      .catch(() => toast.error("复制失败"));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="h-3 w-3" />
                  <span>复制</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    api
                      .projectFsOpen(project.id, editorRelPath)
                      .catch((e) => toast.error(String(e)))
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>外部打开</span>
                </button>
                <button
                  type="button"
                  disabled={editorSaving || editorLoading}
                  onClick={() => void handleSaveEditor()}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {editorSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  <span>保存 (Ctrl+S)</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCloseEditor()}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {editorLoading ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span>正在读取文件内容...</span>
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0">
                {editorMode !== "preview" && (
                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    placeholder="支持 Markdown 与纯文本，Ctrl+S 快捷保存..."
                    className={`min-h-0 w-full resize-none p-4 font-mono text-xs leading-relaxed text-slate-800 focus:outline-none ${
                      editorMode === "edit" ? "md:col-span-2" : ""
                    }`}
                  />
                )}
                {editorMode !== "edit" && (
                  <div
                    className={`prose prose-sm max-w-none overflow-y-auto p-5 text-slate-800 ${
                      editorMode === "preview" ? "md:col-span-2" : ""
                    }`}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {editorContent || "*（空白文档）*"}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <CreateProjectModal
        open={createSubOpen}
        onClose={() => setCreateSubOpen(false)}
        defaultParentId={createSubParentId}
        defaultKind={project.kind}
        onCreated={() => {
          void loadListing(currentRelPath);
        }}
      />

      <TodoEditModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        todo={editingTodo}
        defaultProjectId={project.id}
        defaultDate={todayYmd()}
      />

      <ApplyTemplateModal
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        defaultProjectId={project.id}
        defaultStartDate={todayYmd()}
      />
    </div>
  );
}
