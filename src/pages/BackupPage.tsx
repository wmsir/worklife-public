import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  Edit2,
  Eye,
  EyeOff,
  FolderOpen,
  FolderSync,
  HelpCircle,
  Loader2,
  Play,
  PlugZap,
  Plus,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { confirmDialog } from "../components/ConfirmDialog";
import { api, onBackupProgress } from "../lib/api";
import { formatIsoTimeZh } from "../lib/date";
import type { BackupProgress, BackupTask } from "../lib/types";
import { useAppStore } from "../store/appStore";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "scanning":
      return "正在扫描目录";
    case "copying":
      return "增量同步文件";
    case "zipping":
      return "生成 UTF-8 ZIP 快照";
    case "uploading":
      return "WebDAV 上传中";
    case "pruning":
      return "清理过期旧版本";
    default:
      return phase;
  }
}

const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  "target",
  "*.tmp",
  "Thumbs.db",
  ".DS_Store",
];

interface TaskModalProps {
  open: boolean;
  initial: BackupTask | null;
  dataRootPath: string;
  onClose: () => void;
  onSave: (task: BackupTask) => Promise<void>;
}

function BackupTaskModal({ open, initial, dataRootPath, onClose, onSave }: TaskModalProps) {
  const [name, setName] = useState("");
  const [sourceDir, setSourceDir] = useState("$DATA_ROOT");
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<"zip" | "mirror">("zip");
  const [targetType, setTargetType] = useState<"local_sync" | "webdav">("local_sync");
  const [localTargetDir, setLocalTargetDir] = useState("");
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavPass, setWebdavPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [webdavRemoteDir, setWebdavRemoteDir] = useState("LifeWorkBackups");
  const [excludesText, setExcludesText] = useState(DEFAULT_EXCLUDES.join("\n"));
  const [keepVersions, setKeepVersions] = useState(10);
  const [autoIntervalMinutes, setAutoIntervalMinutes] = useState(0);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setShowPass(false);
    if (initial) {
      setName(initial.name);
      setSourceDir(initial.sourceDir || "$DATA_ROOT");
      setEnabled(initial.enabled);
      setMode(initial.mode === "mirror" ? "mirror" : "zip");
      setTargetType(initial.targetType === "webdav" ? "webdav" : "local_sync");
      setLocalTargetDir(initial.localTargetDir || "");
      setWebdavUrl(initial.webdavUrl || "");
      setWebdavUser(initial.webdavUser || "");
      setWebdavPass(initial.webdavPass || "");
      setWebdavRemoteDir(initial.webdavRemoteDir || "LifeWorkBackups");
      setExcludesText((initial.excludePatterns || DEFAULT_EXCLUDES).join("\n"));
      setKeepVersions(initial.keepVersions || 10);
      setAutoIntervalMinutes(initial.autoIntervalMinutes || 0);
    } else {
      setName("");
      setSourceDir("$DATA_ROOT");
      setEnabled(true);
      setMode("zip");
      setTargetType("local_sync");
      setLocalTargetDir("");
      setWebdavUrl("");
      setWebdavUser("");
      setWebdavPass("");
      setWebdavRemoteDir("LifeWorkBackups");
      setExcludesText(DEFAULT_EXCLUDES.join("\n"));
      setKeepVersions(10);
      setAutoIntervalMinutes(0);
    }
  }, [open, initial]);

  if (!open) return null;

  const pickDirectory = async (title: string, onPick: (dir: string) => void) => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title,
      });
      if (typeof selected === "string" && selected.trim()) {
        onPick(selected.trim());
      }
    } catch (err) {
      toast.error(`选择目录失败: ${err}`);
    }
  };

  const handleTestWebdav = async () => {
    if (!webdavUrl.trim()) {
      toast.error("请先填写 WebDAV 服务器地址");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const msg = await api.testWebdavConnection(
        webdavUrl.trim(),
        webdavUser.trim(),
        webdavPass,
        webdavRemoteDir.trim(),
      );
      setTestResult({ ok: true, msg });
      toast.success(msg);
    } catch (err) {
      const msg = String(err);
      setTestResult({ ok: false, msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("请输入备份任务名称");
      return;
    }
    if (!sourceDir.trim()) {
      toast.error("请选择需要备份的源文件夹");
      return;
    }
    if (targetType === "local_sync" && !localTargetDir.trim()) {
      toast.error("请选择网盘同步文件夹或移动盘目标目录");
      return;
    }
    if (targetType === "webdav" && !webdavUrl.trim()) {
      toast.error("请填写 WebDAV 服务器地址");
      return;
    }

    const patterns = excludesText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      await onSave({
        id: initial?.id || "",
        name: name.trim(),
        sourceDir: sourceDir.trim(),
        enabled,
        mode,
        targetType,
        localTargetDir: localTargetDir.trim(),
        webdavUrl: webdavUrl.trim(),
        webdavUser: webdavUser.trim(),
        webdavPass,
        webdavRemoteDir: webdavRemoteDir.trim(),
        excludePatterns: patterns,
        keepVersions: Math.max(1, Number(keepVersions) || 10),
        autoIntervalMinutes: Number(autoIntervalMinutes) || 0,
        lastRunAt: initial?.lastRunAt || null,
        lastStatus: initial?.lastStatus || null,
        lastSummary: initial?.lastSummary || null,
      });
      onClose();
    } catch (err) {
      toast.error(`保存备份任务失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">
            {initial ? "编辑网盘备份任务" : "新建文件夹网盘备份任务"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block font-medium text-gray-700">任务名称 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：LifeWork 全部数据 / 工作任务归档 / 生活照片资料"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-gray-700">定时自动备份</label>
              <select
                value={autoIntervalMinutes}
                onChange={(e) => setAutoIntervalMinutes(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              >
                <option value={0}>仅手动触发</option>
                <option value={30}>每 30 分钟</option>
                <option value={60}>每 1 小时</option>
                <option value={180}>每 3 小时</option>
                <option value={360}>每 6 小时</option>
                <option value={1440}>每天一次</option>
              </select>
            </div>
          </div>

          {/* 源文件夹 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="font-medium text-gray-700">需要备份的本地源文件夹 *</label>
              <button
                type="button"
                onClick={() => setSourceDir("$DATA_ROOT")}
                className="text-[11px] font-medium text-blue-600 hover:underline"
              >
                使用 LifeWork 全部数据 ($DATA_ROOT)
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={sourceDir}
                onChange={(e) => setSourceDir(e.target.value)}
                placeholder="选择本地文件夹或填写 $DATA_ROOT"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() =>
                  pickDirectory("选择需要备份的本地文件夹", (dir) => setSourceDir(dir))
                }
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>浏览目录...</span>
              </button>
            </div>
            {sourceDir.trim() === "$DATA_ROOT" && dataRootPath && (
              <p className="mt-1 font-mono text-[11px] text-gray-400">
                当前实际解析目录: {dataRootPath}
              </p>
            )}
          </div>

          {/* 目标方式切换 */}
          <div>
            <label className="mb-1.5 block font-medium text-gray-700">网盘目标方式</label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setTargetType("local_sync")}
                className={`rounded-xl border p-3 text-left transition ${
                  targetType === "local_sync"
                    ? "border-blue-500 bg-blue-50/70"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                  <FolderSync className="h-4 w-4 text-blue-600" />
                  <span>本地网盘同步目录 / 移动盘</span>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  写入百度/阿里/夸克/OneDrive 客户端同步盘或 NAS 共享映射盘
                </p>
              </button>
              <button
                type="button"
                onClick={() => setTargetType("webdav")}
                className={`rounded-xl border p-3 text-left transition ${
                  targetType === "webdav"
                    ? "border-indigo-500 bg-indigo-50/70"
                    : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                  <CloudUpload className="h-4 w-4 text-indigo-600" />
                  <span>WebDAV 直连云盘</span>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  直连坚果云、Alist/OpenList 网关、群晖/飞牛 NAS 或 Nextcloud
                </p>
              </button>
            </div>
          </div>

          {targetType === "local_sync" ? (
            <div>
              <label className="mb-1 block font-medium text-gray-700">
                目标同步文件夹路径 *
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localTargetDir}
                  onChange={(e) => setLocalTargetDir(e.target.value)}
                  placeholder="例如：D:\BaiduNetdiskSync\LifeWorkBackups 或 D:\OneDrive\Backups"
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    pickDirectory("选择网盘同步文件夹", (dir) => setLocalTargetDir(dir))
                  }
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>浏览目录...</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-indigo-950">WebDAV 连接配置</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setWebdavUrl("https://dav.jianguoyun.com/dav/");
                      setTestResult(null);
                    }}
                    className="rounded-md border border-indigo-200 bg-white px-2 py-0.5 text-[11px] text-indigo-700 hover:bg-indigo-50"
                  >
                    预设：坚果云
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWebdavUrl("http://127.0.0.1:5244/dav");
                      setTestResult(null);
                    }}
                    className="rounded-md border border-indigo-200 bg-white px-2 py-0.5 text-[11px] text-indigo-700 hover:bg-indigo-50"
                  >
                    预设：Alist / OpenList
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-gray-700">WebDAV 地址 *</label>
                  <input
                    type="text"
                    value={webdavUrl}
                    onChange={(e) => setWebdavUrl(e.target.value)}
                    placeholder="https://dav.jianguoyun.com/dav/"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-mono text-xs text-gray-800 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-gray-700">远端子目录</label>
                  <input
                    type="text"
                    value={webdavRemoteDir}
                    onChange={(e) => setWebdavRemoteDir(e.target.value)}
                    placeholder="LifeWorkBackups"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-mono text-xs text-gray-800 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-gray-700">账号 / 用户名</label>
                  <input
                    type="text"
                    value={webdavUser}
                    onChange={(e) => setWebdavUser(e.target.value)}
                    placeholder="邮箱或 WebDAV 用户名"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-800 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-gray-700">
                    应用密码 / Token
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"}
                      value={webdavPass}
                      onChange={(e) => setWebdavPass(e.target.value)}
                      placeholder="坚果云请填第三方应用密码"
                      className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pr-8 pl-3 text-xs text-gray-800 focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPass ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={testing}
                  onClick={handleTestWebdav}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlugZap className="h-3.5 w-3.5" />
                  )}
                  <span>{testing ? "正在检测..." : "测试 WebDAV 连接"}</span>
                </button>
                {testResult && (
                  <span
                    className={`text-xs font-medium ${
                      testResult.ok ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {testResult.msg}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 备份模式与版本保留 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block font-medium text-gray-700">备份模式</label>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${
                    mode === "zip" ? "border-blue-500 bg-blue-50/50" : "border-gray-200"
                  }`}
                >
                  <input
                    type="radio"
                    checked={mode === "zip"}
                    onChange={() => setMode("zip")}
                    className="mt-0.5 text-blue-600"
                  />
                  <div>
                    <div className="font-medium text-gray-900">ZIP 压缩快照</div>
                    <div className="text-[11px] text-gray-500">
                      按时间戳生成单文件快照并滚动保留版本
                    </div>
                  </div>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${
                    mode === "mirror" ? "border-blue-500 bg-blue-50/50" : "border-gray-200"
                  }`}
                >
                  <input
                    type="radio"
                    checked={mode === "mirror"}
                    onChange={() => setMode("mirror")}
                    className="mt-0.5 text-blue-600"
                  />
                  <div>
                    <div className="font-medium text-gray-900">增量镜像同步</div>
                    <div className="text-[11px] text-gray-500">
                      按文件大小/修改时间跳过未变化文件
                    </div>
                  </div>
                </label>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block font-medium text-gray-700">
                保留历史快照数量
              </label>
              <input
                type="number"
                min={1}
                max={200}
                value={keepVersions}
                disabled={mode !== "zip"}
                onChange={(e) => setKeepVersions(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-800 disabled:bg-gray-100 disabled:text-gray-400"
              />
              <span className="mt-1 block text-[10px] text-gray-400">
                仅 ZIP 快照模式生效，超出自动清理旧包
              </span>
            </div>
          </div>

          <div>
            <label className="mb-1 block font-medium text-gray-700">
              排除规则（每行一条，支持目录名、文件名及 <code className="rounded bg-gray-100 px-1">*.扩展名</code>）
            </label>
            <textarea
              rows={3}
              value={excludesText}
              onChange={(e) => setExcludesText(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-gray-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>启用此备份任务（参与「全部立即备份」和定时自动备份）</span>
          </label>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存任务配置"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function BackupPage() {
  const {
    settings,
    backupConfig,
    upsertBackupTask,
    deleteBackupTask,
    clearBackupHistory,
    runBackupTask,
  } = useAppStore(
    useShallow((s) => ({
      settings: s.settings,
      backupConfig: s.backupConfig,
      upsertBackupTask: s.upsertBackupTask,
      deleteBackupTask: s.deleteBackupTask,
      clearBackupHistory: s.clearBackupHistory,
      runBackupTask: s.runBackupTask,
    })),
  );

  const [guideOpen, setGuideOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<BackupTask | null>(null);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [runningAll, setRunningAll] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);

  const cfg = backupConfig ?? { tasks: [], history: [] };

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    onBackupProgress((p) => {
      if (active) setProgress(p);
    })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  const dataRootResolved =
    settings?.dataRootResolved || settings?.dataRoot || "";

  const handleRunOne = async (task: BackupTask) => {
    setRunningIds((prev) => ({ ...prev, [task.id]: true }));
    setProgress(null);
    try {
      const rec = await runBackupTask(task.id);
      if (rec.status === "success") {
        toast.success(`「${task.name}」备份完成: ${rec.message}`);
      } else {
        toast.error(`「${task.name}」备份失败: ${rec.message}`);
      }
    } catch (err) {
      toast.error(`执行备份失败: ${err}`);
    } finally {
      setRunningIds((prev) => ({ ...prev, [task.id]: false }));
      setProgress(null);
    }
  };

  const handleRunAll = async () => {
    const enabledTasks = cfg.tasks.filter((t) => t.enabled);
    if (enabledTasks.length === 0) {
      toast.warning("暂无已启用的备份任务，请先编辑目标路径并启用任务");
      return;
    }
    setRunningAll(true);
    let okCount = 0;
    try {
      for (const task of enabledTasks) {
        setRunningIds((prev) => ({ ...prev, [task.id]: true }));
        try {
          const rec = await runBackupTask(task.id);
          if (rec.status === "success") okCount += 1;
          else toast.error(`「${task.name}」失败: ${rec.message}`);
        } finally {
          setRunningIds((prev) => ({ ...prev, [task.id]: false }));
        }
      }
      toast.success(`全部备份执行完成: 成功 ${okCount} / ${enabledTasks.length} 个任务`);
    } finally {
      setRunningAll(false);
      setProgress(null);
    }
  };

  const handleDeleteTask = async (t: BackupTask) => {
    const ok = await confirmDialog({
      title: `确定删除备份任务「${t.name}」吗？`,
      description: "不会删除本地或网盘中已经生成的历史备份文件。",
      confirmText: "删除任务",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteBackupTask(t.id);
      toast.success("已删除备份任务");
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  };

  const handleClearHistory = async () => {
    const ok = await confirmDialog({
      title: "确定清空所有备份历史日志记录吗？",
      description: "清空后无法恢复执行统计记录。",
      confirmText: "清空日志",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await clearBackupHistory();
      toast.success("已清空备份历史");
    } catch (err) {
      toast.error(`清空失败: ${err}`);
    }
  };

  const activeProgressTask = progress
    ? cfg.tasks.find((t) => t.id === progress.taskId)
    : null;
  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

  const autoEnabledCount = cfg.tasks.filter(
    (t) => t.enabled && t.autoIntervalMinutes > 0,
  ).length;

  return (
    <div className="space-y-5">
      {/* 顶部控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CloudUpload className="h-5 w-5 text-blue-600" />
            <h1 className="text-lg font-semibold text-gray-900">指定文件夹网盘备份</h1>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              {cfg.tasks.length} 个任务
            </span>
            {autoEnabledCount > 0 && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                {autoEnabledCount} 个定时自动运行中
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            将 LifeWork 本地数据目录或任意指定文件夹，打包快照或增量镜像同步到网盘本地同步目录 /
            WebDAV 云盘。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setGuideOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <HelpCircle className="h-3.5 w-3.5 text-indigo-600" />
            <span>网盘接入指南</span>
            {guideOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            disabled={runningAll}
            onClick={handleRunAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {runningAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>全部立即备份</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingTask(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建备份任务</span>
          </button>
        </div>
      </div>

      {/* 可折叠接入指南 */}
      {guideOpen && (
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 text-xs md:grid-cols-2">
          <div className="rounded-lg border border-indigo-100 bg-white p-3.5">
            <div className="font-semibold text-gray-900">
              方式 A：本地网盘同步目录（推荐 / 百度·阿里·夸克·OneDrive 零配置）
            </div>
            <p className="mt-1.5 leading-relaxed text-gray-600">
              如果您已在电脑登录了<b>百度网盘同步盘</b>、<b>阿里云盘</b>、<b>夸克网盘</b>、
              <b>OneDrive</b> 或 <b>坚果云客户端</b>，只需要在配置里将「目标目录」选为网盘的本地同步文件夹。LifeWork 会生成标准 UTF-8 ZIP 快照（避免损坏或重名冲突）或直接增量镜像文件，随后由官方客户端静默加密同步至云端。
            </p>
          </div>
          <div className="rounded-lg border border-indigo-100 bg-white p-3.5">
            <div className="font-semibold text-gray-900">
              方式 B：WebDAV 直连云盘（无需安装桌面端）
            </div>
            <ul className="mt-1.5 space-y-1 leading-relaxed text-gray-600">
              <li>
                • <b>坚果云</b>：地址填{" "}
                <code className="rounded bg-gray-100 px-1">https://dav.jianguoyun.com/dav/</code>
                ，密码需到坚果云网页版「账户信息 → 安全选项 → 第三方应用管理」生成应用密码。
              </li>
              <li>
                • <b>Alist / OpenList</b>：本机启动 Alist 后挂载百度/阿里/夸克网盘，地址填{" "}
                <code className="rounded bg-gray-100 px-1">http://127.0.0.1:5244/dav</code>。
              </li>
              <li>
                • <b>群晖 / 飞牛 fnOS / Nextcloud</b>：开启 NAS 的 WebDAV 服务并填写对应地址与账密即可。
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* 实时备份进度条 */}
      {progress && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-blue-900">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <span>
                {activeProgressTask ? `「${activeProgressTask.name}」` : ""}
                {phaseLabel(progress.phase)}
              </span>
            </div>
            <span className="font-mono text-blue-700">
              {progress.current} / {progress.total} ({progressPct}%)
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {progress.currentFile && (
            <div className="mt-1.5 truncate font-mono text-[11px] text-blue-700">
              {progress.currentFile}
            </div>
          )}
        </div>
      )}

      {/* 任务卡片列表 */}
      {cfg.tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-14 text-center text-xs text-gray-400">
          暂无备份任务，点击右上角「新建备份任务」开始配置
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {cfg.tasks.map((task) => {
            const isRunning = Boolean(runningIds[task.id]);
            const resolvedSrc =
              task.sourceDir === "$DATA_ROOT" && dataRootResolved
                ? `$DATA_ROOT (${dataRootResolved})`
                : task.sourceDir;
            const targetDesc =
              task.targetType === "webdav"
                ? `${task.webdavUrl || "未配置 WebDAV"}${task.webdavRemoteDir ? ` → /${task.webdavRemoteDir}` : ""}`
                : task.localTargetDir || "未选择本地/网盘同步目录";

            return (
              <div
                key={task.id}
                className={`rounded-xl border bg-white p-4 transition ${
                  task.enabled ? "border-gray-200" : "border-gray-200 bg-gray-50/60"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{task.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          task.targetType === "webdav"
                            ? "bg-indigo-50 text-indigo-700"
                            : "bg-sky-50 text-sky-700"
                        }`}
                      >
                        {task.targetType === "webdav" ? "WebDAV 云盘" : "本地同步盘"}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                        <Archive className="h-2.5 w-2.5" />
                        {task.mode === "mirror"
                          ? "增量镜像"
                          : `ZIP 快照 · 保留 ${task.keepVersions} 份`}
                      </span>
                      {task.autoIntervalMinutes > 0 && task.enabled && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          每 {task.autoIntervalMinutes} 分钟自动
                        </span>
                      )}
                      {!task.enabled && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-600">
                          已停用
                        </span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px] text-gray-600 md:grid-cols-2">
                      <div className="truncate font-mono" title={resolvedSrc}>
                        <span className="font-sans text-gray-400">源目录：</span>
                        {resolvedSrc}
                      </div>
                      <div className="truncate font-mono" title={targetDesc}>
                        <span className="font-sans text-gray-400">目标地：</span>
                        {targetDesc}
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                      <span>
                        排除规则:{" "}
                        {task.excludePatterns.length > 0
                          ? task.excludePatterns.slice(0, 4).join(", ") +
                            (task.excludePatterns.length > 4
                              ? ` 等 ${task.excludePatterns.length} 项`
                              : "")
                          : "无"}
                      </span>
                      {task.lastRunAt && (
                        <span className="inline-flex items-center gap-1">
                          {task.lastStatus === "success" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-red-500" />
                          )}
                          <span>
                            最近 {task.lastRunAt.replace("T", " ")} · {task.lastSummary}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isRunning || runningAll}
                      onClick={() => handleRunOne(task)}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      <span>{isRunning ? "备份中..." : "立即备份"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        upsertBackupTask({ ...task, enabled: !task.enabled })
                          .then(() =>
                            toast.success(task.enabled ? "已停用该任务" : "已启用该任务"),
                          )
                          .catch((e) => toast.error(String(e)))
                      }
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      {task.enabled ? "停用" : "启用"}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        api.openLocalPath(task.sourceDir).catch((e) => toast.error(String(e)))
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                      title="在资源管理器打开源文件夹"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      <span>源目录</span>
                    </button>

                    {task.targetType === "local_sync" && task.localTargetDir && (
                      <button
                        type="button"
                        onClick={() =>
                          api
                            .openLocalPath(task.localTargetDir)
                            .catch((e) => toast.error(String(e)))
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                        title="在资源管理器打开目标同步目录"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>目标目录</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setEditingTask(task);
                        setModalOpen(true);
                      }}
                      className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-800"
                      title="编辑任务"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task)}
                      className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                      title="删除任务"
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

      {/* 备份历史记录 */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            备份执行历史 ({cfg.history.length})
          </h2>
          {cfg.history.length > 0 && (
            <button
              type="button"
              onClick={handleClearHistory}
              className="text-xs text-gray-500 hover:text-red-600"
            >
              清空历史
            </button>
          )}
        </div>

        {cfg.history.length === 0 ? (
          <div className="py-10 text-center text-xs text-gray-400">
            暂无执行记录，点击上方「立即备份」测试一次快照或同步吧
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50 text-[11px] text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">完成时间</th>
                  <th className="px-4 py-2.5 font-medium">任务名称</th>
                  <th className="px-4 py-2.5 font-medium">方式</th>
                  <th className="px-4 py-2.5 font-medium">文件数 / 跳过</th>
                  <th className="px-4 py-2.5 font-medium">数据量</th>
                  <th className="px-4 py-2.5 font-medium">状态与摘要</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cfg.history.map((rec) => (
                  <tr key={rec.id} className="hover:bg-gray-50/70">
                    <td
                      className="lw-nums px-4 py-2.5 text-[11px] whitespace-nowrap text-slate-500"
                      title={rec.finishedAt.replace("T", " ")}
                    >
                      {formatIsoTimeZh(rec.finishedAt)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      <div>{rec.taskName}</div>
                      {rec.artifactName && (
                        <div className="font-mono text-[10px] text-gray-400">
                          {rec.artifactName}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                      {rec.targetType === "webdav" ? "WebDAV" : "同步盘"} ·{" "}
                      {rec.mode === "mirror" ? "镜像" : "ZIP"}
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap text-gray-700">
                      {rec.filesCopied} 传输 / {rec.filesSkipped} 跳过
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap text-gray-700">
                      {formatBytes(rec.totalBytes)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          rec.status === "success"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {rec.status === "success" ? "成功" : "失败"}
                      </span>
                      <span className="ml-2 text-gray-600">{rec.message}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BackupTaskModal
        open={modalOpen}
        initial={editingTask}
        dataRootPath={dataRootResolved}
        onClose={() => setModalOpen(false)}
        onSave={async (task) => {
          await upsertBackupTask(task);
          toast.success(task.id ? "备份任务已更新" : "新备份任务已创建");
        }}
      />
    </div>
  );
}
