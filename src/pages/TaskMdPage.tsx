import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  FileUp,
  FolderOpen,
  GitBranch,
  GitMerge,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { TencentDocPushModal } from "../components/TencentDocPushModal";
import { api } from "../lib/api";
import { getTaskBranches, shortRepoName } from "../lib/wtx";
import { useAppStore } from "../store/appStore";

export function TaskMdPage() {
  const { code: rawCode = "" } = useParams();
  const code = decodeURIComponent(rawCode);
  const navigate = useNavigate();
  const { tasks, taskUpdate } = useAppStore(
    useShallow((s) => ({
      tasks: s.tasks,
      taskUpdate: s.taskUpdate,
    })),
  );

  const task = tasks.find((t) => t.code === code);
  const branches = getTaskBranches(task);
  const commitMsg = task?.name?.trim() ? `#${code} ${task.name.trim()}` : `#${code}`;
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tencentModalOpen, setTencentModalOpen] = useState(false);
  const deferredContent = useDeferredValue(content);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    api
      .taskReadMd(code)
      .then((txt) => {
        setContent(txt);
        setSavedContent(txt);
      })
      .catch((err) => toast.error(`读取需求描述失败: ${err}`))
      .finally(() => setLoading(false));
  }, [code]);

  const handleSave = useCallback(async () => {
    if (!code) return;
    setSaving(true);
    try {
      await api.taskWriteMd(code, content);
      setSavedContent(content);
      toast.success("需求描述.md 已保存");
    } catch (err) {
      toast.error(`保存失败: ${err}`);
    } finally {
      setSaving(false);
    }
  }, [code, content]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const handleRemoveBranch = async (branchName: string, refBranch: string) => {
    if (!task) return;
    const remaining = branches.filter(
      (b) => !(b.branch === branchName && b.refBranch === refBranch),
    );
    try {
      await taskUpdate(code, {
        branches: remaining,
        branch: remaining[0]?.branch || "",
      });
      toast.success(`已移除分支记录：${branchName}`);
    } catch (err) {
      toast.error(`移除失败: ${err}`);
    }
  };

  const dirty = content !== savedContent;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 顶部任务元数据与操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/work/ledger")}
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
            title="返回任务台账"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-blue-600">{code}</span>
              <span className="truncate text-sm font-semibold text-gray-900">
                {task?.name || "需求描述.md"}
              </span>
              {dirty && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                  未保存
                </span>
              )}
            </div>
            {task && (
              <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                <span>迭代: {task.sprint || "-"}</span>
                <span>开始: {task.startDate || "-"}</span>
                <span>提测: {task.planTestDate || "-"}</span>
                <span>发版: {task.releaseDate || "-"}</span>
                <span>状态: {task.status}</span>
                <span>分支: {task.branch || "-"}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(commitMsg)
                .then(() => toast.success(`已复制提交信息：${commitMsg}`))
                .catch((e) => toast.error(`复制失败: ${String(e)}`));
            }}
            title={`复制: ${commitMsg}`}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
          >
            <Copy className="h-3.5 w-3.5 shrink-0 text-violet-600" />
            <span>复制提交信息</span>
          </button>
          <button
            type="button"
            onClick={() => api.taskOpenFolder(code).catch((e) => toast.error(String(e)))}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>打开文件夹</span>
          </button>
          <button
            type="button"
            onClick={() => api.taskOpenMd(code).catch((e) => toast.error(String(e)))}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>外部打开</span>
          </button>
          <button
            type="button"
            onClick={() => setTencentModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            <FileUp className="h-3.5 w-3.5" />
            <span>发腾讯文档</span>
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saving ? "保存中..." : "保存 (Ctrl+S)"}</span>
          </button>
        </div>
      </div>

      {/* 分支与仓库记录卡片 */}
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
            <GitBranch className="h-3.5 w-3.5 text-violet-600" />
            <span>分支与仓库记录 ({branches.length})</span>
            {task?.repos && task.repos.length > 0 && (
              <span className="font-normal text-gray-400">
                · 关联仓库: {task.repos.join(", ")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate(`/work/branch?code=${encodeURIComponent(code)}`)}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
          >
            <Plus className="h-3 w-3 shrink-0" />
            <span>新建分支</span>
          </button>
        </div>

        {branches.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">
            暂无分支记录。点击右上角「新建分支」创建后将自动关联到当前任务下，方便后续直接跳转提交 MR。
          </p>
        ) : (
          <div className="mt-2.5 space-y-1.5">
            {branches.map((rec) => (
              <div
                key={`${rec.branch}-${rec.refBranch}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2 text-xs"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <code className="font-mono font-semibold text-gray-900">{rec.branch}</code>
                  {rec.refBranch && (
                    <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-600 ring-1 ring-gray-200/70">
                      ← {rec.refBranch}
                    </span>
                  )}
                  {rec.repos.map((repo) => (
                    <span
                      key={repo}
                      title={repo}
                      className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700"
                    >
                      {shortRepoName(repo)}
                    </span>
                  ))}
                  {rec.createdAt && (
                    <span className="font-mono text-[10px] text-gray-400">
                      {rec.createdAt.slice(0, 16).replace("T", " ")}
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(rec.branch);
                      toast.success(`已复制分支：${rec.branch}`);
                    }}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100"
                  >
                    <Copy className="h-3 w-3 shrink-0" />
                    <span>复制</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/work/mr?code=${encodeURIComponent(code)}&branch=${encodeURIComponent(rec.branch)}`,
                      )
                    }
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-pink-200 bg-pink-50 px-2 py-0.5 text-[11px] font-medium text-pink-700 hover:bg-pink-100"
                  >
                    <GitMerge className="h-3 w-3 shrink-0" />
                    <span>去提交 MR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemoveBranch(rec.branch, rec.refBranch)}
                    title="移除该条分支记录"
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-3 w-3 shrink-0" />
                    <span>移除</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 左右分栏：编辑与预览 */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-400">
          正在加载 需求描述.md...
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500">
              Markdown 编辑区
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none p-4 font-mono text-xs leading-relaxed text-gray-800 focus:outline-none"
            />
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500">
              实时预览
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 text-sm leading-relaxed text-gray-800 [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mb-3 [&_h1]:border-b [&_h1]:border-gray-200 [&_h1]:pb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-gray-900 [&_pre]:p-3 [&_pre]:text-gray-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:border-gray-200 [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredContent}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      <TencentDocPushModal
        open={tencentModalOpen}
        onClose={() => setTencentModalOpen(false)}
        initialTitle={task?.name ? `${code}-${task.name}` : `${code} 需求说明`}
        initialMarkdown={content}
        sourceLabel="任务需求描述"
      />
    </div>
  );
}
