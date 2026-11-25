import { useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, Sparkles, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { wtCall } from "../lib/api";
import { extractTaskCode } from "../lib/wtx";
import { useAppStore } from "../store/appStore";

export interface SpaceTag {
  id: number;
  name: string;
  color?: string;
  [k: string]: unknown;
}

interface TagsDialogProps {
  open: boolean;
  cardIdOrCode: string | number;
  projects?: string[];
  onClose: () => void;
  onApplied?: (tags: SpaceTag[]) => void;
}

const CORE_TAG_IDS = new Set([98, 99, 100, 101, 102]);

export function TagsDialog({
  open,
  cardIdOrCode,
  projects,
  onClose,
  onApplied,
}: TagsDialogProps) {
  const { user, taskUpdate } = useAppStore(
    useShallow((s) => ({ user: s.user, taskUpdate: s.taskUpdate })),
  );

  const [allTags, setAllTags] = useState<SpaceTag[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [matchedIds, setMatchedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [targetInput, setTargetInput] = useState(String(cardIdOrCode || ""));

  useEffect(() => {
    if (!open) return;
    setTargetInput(String(cardIdOrCode || ""));
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      try {
        const [spaceTags, matched] = await Promise.all([
          wtCall<SpaceTag[]>("get_space_tags", { force_refresh: false }),
          projects && projects.length > 0
            ? wtCall<Array<{ id: number; name: string }>>("match_tags_by_projects", {
                projects,
              }).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const list = Array.isArray(spaceTags) ? spaceTags : [];
        setAllTags(list);
        const mIds = Array.isArray(matched)
          ? matched.map((m) => Number(m.id)).filter((n) => !Number.isNaN(n))
          : [];
        setMatchedIds(mIds);
        setSelectedIds(mIds);
      } catch (e) {
        if (!cancelled) toast.error(`获取空间标签失败: ${String(e)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [open, cardIdOrCode, projects]);

  if (!open) return null;

  const toggleId = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleRefreshTags = async () => {
    setLoading(true);
    try {
      const list = await wtCall<SpaceTag[]>("get_space_tags", { force_refresh: true });
      setAllTags(Array.isArray(list) ? list : []);
      toast.success("已从 DevOps 刷新标签列表");
    } catch (e) {
      toast.error(`刷新标签失败: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    const rawTarget = targetInput.trim();
    if (!rawTarget) {
      toast.error("请输入有效的任务号或卡片 ID");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("请至少选择一个标签");
      return;
    }

    setApplying(true);
    try {
      const cid = await wtCall<number>("resolve_card_id", {
        task_or_card_id: rawTarget,
      });
      const res = await wtCall<Record<string, [boolean, string]>>(
        "set_card_tags_batch",
        {
          card_id: cid,
          tags: selectedIds,
        },
      );
      const entries = Object.entries(res || {});
      const okCount = entries.filter(([, v]) => Array.isArray(v) && v[0]).length;
      const chosen = allTags.filter((t) => selectedIds.includes(t.id));
      const names = chosen.map((t) => t.name);

      const maybeCode = extractTaskCode(rawTarget) || rawTarget;
      await taskUpdate(maybeCode, { tags: names }).catch(() => {});

      if (okCount === entries.length && entries.length > 0) {
        toast.success(`成功为卡片 [${cid}] 打上 ${okCount} 个标签`);
      } else {
        toast.warning(`打标签完成：成功 ${okCount} / ${entries.length} 个`);
      }
      onApplied?.(chosen);
      onClose();
    } catch (e) {
      toast.error(`打标签失败: ${String(e)}`);
    } finally {
      setApplying(false);
    }
  };

  const coreTags = allTags.filter((t) => CORE_TAG_IDS.has(t.id));
  const otherTags = allTags.filter((t) => !CORE_TAG_IDS.has(t.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-gray-900">任务卡片打标签</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            <span className="shrink-0 font-medium text-gray-600">目标任务/卡片:</span>
            <input
              type="text"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              placeholder="例如 TASK-0001 或数字 CardID"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            disabled={!user || loading}
            onClick={handleRefreshTags}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>刷新标签</span>
          </button>
        </div>

        {matchedIds.length > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-1.5 text-[11px] text-blue-700">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>
              已根据涉及代码仓库智能预选推荐标签：
              {allTags
                .filter((t) => matchedIds.includes(t.id))
                .map((t) => t.name)
                .join("、") || matchedIds.join(", ")}
            </span>
          </div>
        )}

        <div className="mt-3 max-h-80 space-y-4 overflow-y-auto pr-1">
          {loading && allTags.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <span>正在加载空间标签列表...</span>
            </div>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between text-xs font-medium text-gray-700">
                  <span>代码仓库核心标签 (C / P / I / MQ / M)</span>
                  <div className="flex gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedIds((prev) =>
                          Array.from(new Set([...prev, ...coreTags.map((t) => t.id)])),
                        )
                      }
                      className="text-blue-600 hover:underline"
                    >
                      全选仓库标签
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedIds([])}
                      className="text-gray-500 hover:underline"
                    >
                      清空已选
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {coreTags.map((t) => {
                    const active = selectedIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleId(t.id)}
                        style={{
                          borderColor: active ? t.color || "#2695F1" : undefined,
                          backgroundColor: active ? `${t.color || "#2695F1"}18` : undefined,
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                          active
                            ? "text-gray-900 shadow-xs"
                            : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: t.color || "#2695F1" }}
                        />
                        <span>{t.name}</span>
                        <span className="font-mono text-[10px] text-gray-400">#{t.id}</span>
                        {active && <Check className="h-3 w-3 text-blue-600" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium text-gray-700">
                  其他业务 / 规范 / 发版标签
                </div>
                <div className="flex flex-wrap gap-2">
                  {otherTags.map((t) => {
                    const active = selectedIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleId(t.id)}
                        style={{
                          borderColor: active ? t.color || "#0ED396" : undefined,
                          backgroundColor: active ? `${t.color || "#0ED396"}18` : undefined,
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                          active
                            ? "font-medium text-gray-900 shadow-xs"
                            : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: t.color || "#6c757d" }}
                        />
                        <span>{t.name}</span>
                        {active && <Check className="h-3 w-3 text-emerald-600" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-xs text-gray-500">已选择 {selectedIds.length} 个标签</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!user || applying || selectedIds.length === 0}
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{applying ? "打标签中..." : "应用到卡片"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
