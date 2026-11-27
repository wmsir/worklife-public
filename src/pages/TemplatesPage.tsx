import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ApplyTemplateModal } from "../components/ApplyTemplateModal";
import { DatePicker } from "../components/DatePicker";
import { api } from "../lib/api";
import { formatDateZh, todayYmd } from "../lib/date";
import type { PreviewStepItem, Template, TemplateStep } from "../lib/types";
import { useAppStore } from "../store/appStore";

function emptyTemplate(): Template {
  return {
    id: "",
    name: "新排期模板",
    kind: "work",
    description: "",
    workdaysOnly: true,
    steps: [{ title: "第一步", offsetDays: 0, durationDays: 1, time: null }],
  };
}

export function TemplatesPage() {
  const { templates, upsertTemplate, deleteTemplate } = useAppStore(
    useShallow((s) => ({
      templates: s.templates,
      upsertTemplate: s.upsertTemplate,
      deleteTemplate: s.deleteTemplate,
    })),
  );
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<Template>(emptyTemplate());
  const [previewStart, setPreviewStart] = useState(todayYmd());
  const [previewItems, setPreviewItems] = useState<PreviewStepItem[]>([]);
  const [previewEndDate, setPreviewEndDate] = useState("");
  const [applyOpen, setApplyOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedId && templates.length > 0) {
      setSelectedId(templates[0].id);
      setDraft(structuredClone(templates[0]));
    }
  }, [templates, selectedId]);

  const selectTemplate = (t: Template) => {
    setSelectedId(t.id);
    setDraft(structuredClone(t));
  };

  useEffect(() => {
    if (!draft.id) {
      setPreviewItems([]);
      setPreviewEndDate("");
      return;
    }
    let cancelled = false;
    api
      .previewTemplate(draft.id, previewStart)
      .then((res) => {
        if (!cancelled) {
          setPreviewItems(res.steps);
          setPreviewEndDate(res.endDate);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [draft.id, previewStart, templates]);

  const updateStep = (idx: number, patch: Partial<TemplateStep>) => {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  };

  const addStep = () => {
    setDraft((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        {
          title: `步骤 ${prev.steps.length + 1}`,
          offsetDays: prev.steps.length,
          durationDays: 1,
          time: null,
        },
      ],
    }));
  };

  const removeStep = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== idx),
    }));
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= draft.steps.length) return;
    setDraft((prev) => {
      const copy = [...prev.steps];
      [copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]];
      return { ...prev, steps: copy };
    });
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast.error("模板名称不能为空");
      return;
    }
    setSaving(true);
    try {
      const saved = await upsertTemplate(draft);
      setSelectedId(saved.id);
      setDraft(structuredClone(saved));
      toast.success("模板已保存");
    } catch (err) {
      toast.error(`保存模板失败: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.id) return;
    try {
      await deleteTemplate(draft.id);
      toast.success("模板已删除");
      const rest = templates.filter((t) => t.id !== draft.id);
      if (rest.length > 0) {
        selectTemplate(rest[0]);
      } else {
        setSelectedId("");
        setDraft(emptyTemplate());
      }
    } catch (err) {
      toast.error(`删除失败: ${err}`);
    }
  };

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 lg:grid-cols-12">
      {/* 左侧列表 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <CalendarClock className="h-4 w-4 text-blue-600" />
            <span>排期模板 ({templates.length})</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedId("");
              setDraft(emptyTemplate());
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建</span>
          </button>
        </div>

        <div className="space-y-1.5">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTemplate(t)}
              className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                selectedId === t.id
                  ? "border-blue-500 bg-blue-50/70"
                  : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">{t.name}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    t.kind === "work"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {t.kind === "work" ? "工作" : "生活"}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                {t.steps.length} 个步骤 · {t.workdaysOnly ? "仅工作日" : "自然日"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧编辑器 + 预览 */}
      <div className="space-y-5 lg:col-span-8">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">
              {draft.id ? "编辑模板" : "创建新模板"}
            </h2>
            <div className="flex items-center gap-2">
              {draft.id && (
                <>
                  <button
                    type="button"
                    onClick={() => setApplyOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>套用</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>删除</span>
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? "保存中..." : "保存模板"}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600">模板名称</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">类型</label>
              <select
                value={draft.kind}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as "work" | "life" })
                }
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="work">工作</option>
                <option value="life">生活</option>
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="模板说明..."
              className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            />
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
              <input
                type="checkbox"
                checked={draft.workdaysOnly}
                onChange={(e) => setDraft({ ...draft, workdaysOnly: e.target.checked })}
                className="rounded border-gray-300 text-blue-600"
              />
              <span>仅计算工作日（自动跳过周六、周日）</span>
            </label>
          </div>

          {/* 步骤表 */}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">
                步骤列表 ({draft.steps.length})
              </span>
              <button
                type="button"
                onClick={addStep}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                <Plus className="h-3 w-3" />
                <span>添加步骤</span>
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">步骤名称</th>
                    <th className="w-24 px-3 py-2 font-medium">偏移(天)</th>
                    <th className="w-24 px-3 py-2 font-medium">持续(天)</th>
                    <th className="w-28 px-3 py-2 font-medium">时间</th>
                    <th className="w-24 px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {draft.steps.map((s, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={s.title}
                          onChange={(e) => updateStep(idx, { title: e.target.value })}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          value={s.offsetDays}
                          onChange={(e) =>
                            updateStep(idx, { offsetDays: Number(e.target.value) || 0 })
                          }
                          className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={1}
                          value={s.durationDays}
                          onChange={(e) =>
                            updateStep(idx, {
                              durationDays: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="time"
                          value={s.time || ""}
                          onChange={(e) =>
                            updateStep(idx, { time: e.target.value || null })
                          }
                          className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveStep(idx, -1)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStep(idx, 1)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeStep(idx)}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 排期日期推演预览 */}
        {draft.id && (
          <div className="lw-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="lw-nums text-sm font-semibold text-slate-900">
                实际排期日历推演（结束日：
                {previewEndDate ? formatDateZh(previewEndDate, { showWeekday: true }) : "-"}）
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">按开始日期预览：</span>
                <DatePicker
                  value={previewStart}
                  onChange={setPreviewStart}
                  size="sm"
                  align="right"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {previewItems.map((it, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs"
                >
                  <span className="font-medium text-slate-800">{it.title}</span>
                  <span className="lw-nums font-medium text-blue-600" title={it.startDate}>
                    {formatDateZh(it.startDate, { showWeekday: true })}
                    {it.time ? ` ${it.time}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ApplyTemplateModal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        defaultTemplateId={draft.id}
        defaultProjectId={draft.kind === "work" ? "work" : "life"}
        defaultStartDate={previewStart}
      />
    </div>
  );
}
