import { useEffect, useState } from "react";
import { CalendarDays, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { api } from "../lib/api";
import { formatDateZh, todayYmd } from "../lib/date";
import { flattenProjectTree } from "../lib/projects";
import type { PreviewStepItem, TaskRecord } from "../lib/types";
import { useAppStore } from "../store/appStore";
import { DatePicker } from "./DatePicker";

interface Props {
  open: boolean;
  onClose: () => void;
  defaultTemplateId?: string;
  defaultProjectId?: string;
  defaultStartDate?: string;
  defaultTaskCode?: string;
  onApplied?: (result: { endDate: string; count: number; taskCode?: string }) => void;
}

export function ApplyTemplateModal({
  open,
  onClose,
  defaultTemplateId,
  defaultProjectId,
  defaultStartDate,
  defaultTaskCode,
  onApplied,
}: Props) {
  const { templates, projects, tasks, applyTemplate, taskUpdate } = useAppStore(
    useShallow((s) => ({
      templates: s.templates,
      projects: s.projects,
      tasks: s.tasks,
      applyTemplate: s.applyTemplate,
      taskUpdate: s.taskUpdate,
    })),
  );

  const [templateId, setTemplateId] = useState(defaultTemplateId || "");
  const [projectId, setProjectId] = useState(defaultProjectId || "work");
  const [startDate, setStartDate] = useState(defaultStartDate || todayYmd());
  const [taskCode, setTaskCode] = useState(defaultTaskCode || "");
  const [preview, setPreview] = useState<PreviewStepItem[]>([]);
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTemplateId(defaultTemplateId || templates[0]?.id || "");
    setProjectId(defaultProjectId || projects[0]?.id || "work");
    setStartDate(defaultStartDate || todayYmd());
    setTaskCode(defaultTaskCode || "");
  }, [open, defaultTemplateId, defaultProjectId, defaultStartDate, defaultTaskCode, templates, projects]);

  useEffect(() => {
    if (!open || !templateId || !startDate) return;
    let cancelled = false;
    api
      .previewTemplate(templateId, startDate)
      .then((res) => {
        if (!cancelled) {
          setPreview(res.steps);
          setEndDate(res.endDate);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview([]);
          setEndDate("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, templateId, startDate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selectedTemplate = templates.find((t) => t.id === templateId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId || !projectId || !startDate) {
      toast.error("请选择模板、项目与开始日期");
      return;
    }
    setSubmitting(true);
    try {
      const cleanCode = taskCode.trim() || null;
      const res = await applyTemplate({
        templateId,
        projectId,
        startDate,
        taskCode: cleanCode,
      });

      // 如果关联了任务号，且该任务目前发版日期为空，自动回填结束日期
      if (cleanCode && res.endDate) {
        const matchedTask: TaskRecord | undefined = tasks.find((t) => t.code === cleanCode);
        if (matchedTask && !matchedTask.releaseDate.trim()) {
          await taskUpdate(cleanCode, { releaseDate: res.endDate });
          toast.success(
            `已生成 ${res.created.length} 条待办，并已将 [${cleanCode}] 发版日期回填为 ${res.endDate}`,
          );
        } else {
          toast.success(`已成功生成 ${res.created.length} 条排期待办`);
        }
      } else {
        toast.success(`已成功生成 ${res.created.length} 条排期待办`);
      }

      onApplied?.({
        endDate: res.endDate,
        count: res.created.length,
        taskCode: cleanCode ?? undefined,
      });
      onClose();
    } catch (err) {
      toast.error(`套用模板失败: ${err}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="lw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lw-modal-panel flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <CalendarDays className="h-5 w-5 text-blue-600" aria-hidden="true" />
            <span>套用排期模板生成待办</span>
          </div>
          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">排期模板</label>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      [{t.kind === "work" ? "工作" : "生活"}] {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">目标项目</label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                >
                  {flattenProjectTree(projects).map((item) => (
                    <option key={item.project.id} value={item.project.id}>
                      {item.indentedLabel} ({item.project.kind === "work" ? "工作" : "生活"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">开始日期</label>
                <DatePicker
                  value={startDate}
                  onChange={setStartDate}
                  size="md"
                  className="w-full"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  关联任务号 (可选，用于前缀与回填发版日期)
                </label>
                <input
                  type="text"
                  list="lifework-task-codes"
                  value={taskCode}
                  onChange={(e) => setTaskCode(e.target.value)}
                  placeholder="如 TASK-0001"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                />
                <datalist id="lifework-task-codes">
                  {tasks.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>

            {selectedTemplate && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-3.5 py-2.5 text-xs text-blue-800">
                {selectedTemplate.description || "无说明"} ·{" "}
                {selectedTemplate.workdaysOnly ? "仅计算工作日（自动跳过周末）" : "按自然日计算"} · 预计结束日期：
                <span className="lw-nums font-semibold" title={endDate}>
                  {endDate ? formatDateZh(endDate, { showWeekday: true }) : "-"}
                </span>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-xs font-medium text-gray-600">
                排期预览（共 {preview.length} 条待办）
              </div>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">步骤标题</th>
                      <th className="px-3 py-2 font-medium">开始日期</th>
                      <th className="px-3 py-2 font-medium">结束日期</th>
                      <th className="px-3 py-2 font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.map((st, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/70">
                        <td className="px-3 py-2 font-medium text-gray-800">
                          {taskCode.trim() ? `[${taskCode.trim()}] ` : ""}
                          {st.title}
                        </td>
                        <td className="lw-nums px-3 py-2 text-slate-600" title={st.startDate}>
                          {formatDateZh(st.startDate, { showWeekday: true })}
                        </td>
                        <td className="lw-nums px-3 py-2 text-slate-600" title={st.endDate}>
                          {formatDateZh(st.endDate, { showWeekday: true })}
                        </td>
                        <td className="lw-nums px-3 py-2 text-slate-500">{st.time || "-"}</td>
                      </tr>
                    ))}
                    {preview.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-gray-400">
                          暂无步骤预览
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || preview.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              <span>{submitting ? "生成中..." : "确认套用模板"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
