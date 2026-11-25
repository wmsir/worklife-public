import { useEffect, useMemo, useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { flattenProjectTree } from "../lib/projects";
import type { Project, ProjectKind } from "../lib/types";
import { useAppStore } from "../store/appStore";

interface Props {
  open: boolean;
  onClose: () => void;
  defaultParentId?: string | null;
  defaultKind?: ProjectKind;
  onCreated?: (project: Project) => void;
}

const PRESET_COLORS = [
  "#2563eb",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#06b6d4",
];

export function CreateProjectModal({
  open,
  onClose,
  defaultParentId = null,
  defaultKind,
  onCreated,
}: Props) {
  const { projects, createProject } = useAppStore(
    useShallow((s) => ({ projects: s.projects, createProject: s.createProject })),
  );
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>(defaultParentId ?? "");
  const [kind, setKind] = useState<ProjectKind>(defaultKind ?? "life");
  const [color, setColor] = useState("#10b981");
  const [saving, setSaving] = useState(false);

  const flatProjects = useMemo(() => flattenProjectTree(projects), [projects]);
  const selectedParent = useMemo(
    () => (parentId ? projects.find((p) => p.id === parentId) ?? null : null),
    [projects, parentId],
  );

  useEffect(() => {
    if (!open) return;
    const initPid = (defaultParentId ?? "").trim();
    const pObj = initPid ? projects.find((p) => p.id === initPid) : null;
    const initKind: ProjectKind = pObj?.kind ?? defaultKind ?? "life";
    setName("");
    setParentId(initPid);
    setKind(initKind);
    setColor(pObj?.color || (initKind === "work" ? "#2563eb" : "#10b981"));
  }, [open, defaultParentId, defaultKind, projects]);

  if (!open) return null;

  const handleParentChange = (nextPid: string) => {
    setParentId(nextPid);
    const pObj = nextPid ? projects.find((p) => p.id === nextPid) : null;
    if (pObj) {
      setKind(pObj.kind);
      setColor(pObj.color || (pObj.kind === "work" ? "#2563eb" : "#10b981"));
    }
  };

  const handleKindChange = (nextKind: ProjectKind) => {
    setKind(nextKind);
    setColor(nextKind === "work" ? "#2563eb" : "#10b981");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("请输入项目名称");
      return;
    }
    setSaving(true);
    try {
      const created = await createProject({
        name: name.trim(),
        kind,
        color,
        parentId: parentId || null,
      });
      toast.success(
        selectedParent
          ? `已在「${selectedParent.name}」下创建子项目「${created.name}」`
          : `已创建项目「${created.name}」`,
      );
      setName("");
      onCreated?.(created);
      onClose();
    } catch (err) {
      toast.error(`创建项目失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lw-modal-panel w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-blue-600" />
            <div>
              <div className="text-base font-semibold text-gray-900">
                {selectedParent ? "新建子项目" : "新建项目"}
              </div>
              {selectedParent && (
                <div className="text-[11px] text-gray-500">
                  隶属于「{selectedParent.name}」（同步创建本地子目录）
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">所属上级项目</label>
            <select
              value={parentId}
              onChange={(e) => handleParentChange(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="">无（作为顶级项目）</option>
              {flatProjects.map((item) => (
                <option key={item.project.id} value={item.project.id}>
                  {item.indentedLabel} ({item.project.kind === "work" ? "工作" : "生活"})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              {selectedParent ? "子项目名称" : "项目名称"}
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                selectedParent
                  ? "例如：2026年Q4复盘、月度总结、核心模块..."
                  : "例如：工作总结、健身打卡、副业项目..."
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">项目类型</label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => handleKindChange("work")}
                className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                  kind === "work"
                    ? "border-blue-600 bg-blue-50/70 font-medium text-blue-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                💼 工作项目
                <div className="mt-0.5 text-[11px] font-normal text-gray-500">
                  工作事项与排期管理
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleKindChange("life")}
                className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                  kind === "life"
                    ? "border-emerald-600 bg-emerald-50/70 font-medium text-emerald-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                🌿 生活项目
                <div className="mt-0.5 text-[11px] font-normal text-gray-500">
                  习惯、健康、兴趣与日常
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600">主题色</label>
            <div className="flex items-center gap-2.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full transition ${
                    color === c ? "ring-2 ring-gray-900 ring-offset-2" : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "创建中..." : selectedParent ? "创建子项目" : "创建项目"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
