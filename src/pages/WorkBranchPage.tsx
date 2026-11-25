import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileEdit,
  FolderOpen,
  GitBranch,
  GitMerge,
  Loader2,
  Plus,
  Save,
  Search,
  Square,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { TagsDialog } from "../components/TagsDialog";
import { TaskCodeSelect } from "../components/TaskCodeSelect";
import { api, wtCall } from "../lib/api";
import {
  appendTaskMd,
  getTaskBranches,
  nowDateTimeStr,
  resolveTaskCode,
  shortRepoName,
} from "../lib/wtx";
import { useAppStore } from "../store/appStore";

interface TaskSummary {
  card_id: number;
  code: string;
  name: string;
  type?: string;
  stage?: string;
  sprint?: string;
  developers?: string;
  declared_hours?: number;
  declared_days?: number;
}

interface BranchRowStatus {
  project: string;
  status: string;
}

interface MatchedTag {
  id: number;
  name: string;
  repo?: string;
  matched_project?: string;
}

interface BranchCreateItemResult {
  project: string;
  project_name?: string;
  ok: boolean;
  existed?: boolean;
  status?: string;
}

export function WorkBranchPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { settings, user, tasks, saveSettings, taskRecordBranch, pushLog } = useAppStore(
    useShallow((s) => ({
      settings: s.settings,
      user: s.user,
      tasks: s.tasks,
      saveSettings: s.saveSettings,
      taskRecordBranch: s.taskRecordBranch,
      pushLog: s.pushLog,
    })),
  );

  const [taskCode, setTaskCode] = useState(searchParams.get("code") || "");
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [querying, setQuerying] = useState(false);

  const [refBranch, setRefBranch] = useState(settings?.worktime.branch_ref || "SIT");
  const [userTag, setUserTag] = useState("DEV");
  const [branchName, setBranchName] = useState("");
  const [autoCompose, setAutoCompose] = useState(true);

  const [allProjects, setAllProjects] = useState<string[]>(
    settings?.worktime.branch_projects ?? [],
  );
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    settings?.worktime.branch_projects ?? [],
  );
  const [newProjectInput, setNewProjectInput] = useState("");

  const [autoTag, setAutoTag] = useState(true);
  const [matchedTags, setMatchedTags] = useState<MatchedTag[]>([]);
  const [creating, setCreating] = useState(false);
  const [rowsStatus, setRowsStatus] = useState<BranchRowStatus[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);

  const autoQueriedRef = useRef("");
  const [refDropdownOpen, setRefDropdownOpen] = useState(false);
  const [refFiltering, setRefFiltering] = useState(false);
  const refBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!refDropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      if (refBoxRef.current && !refBoxRef.current.contains(e.target as Node)) {
        setRefDropdownOpen(false);
        setRefFiltering(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [refDropdownOpen]);

  const refBranchOptions = useMemo(() => {
    const presets: { value: string; note: string }[] = [
      { value: "SIT", note: "测试环境" },
      { value: "UAT", note: "预发环境" },
      { value: "master", note: "主干分支" },
      { value: "PROD", note: "生产分支" },
      { value: "PRD", note: "生产分支" },
    ];
    const seen = new Set(presets.map((p) => p.value));
    const list = [...presets];
    const cfgRef = (settings?.worktime.branch_ref || "").trim();
    if (cfgRef && !seen.has(cfgRef)) {
      seen.add(cfgRef);
      list.push({ value: cfgRef, note: "系统默认" });
    }
    for (const t of tasks) {
      for (const b of t.branches ?? []) {
        const rb = (b.refBranch || "").trim();
        if (rb && !seen.has(rb)) {
          seen.add(rb);
          list.push({ value: rb, note: "历史源分支" });
        }
      }
    }
    return list;
  }, [settings?.worktime.branch_ref, tasks]);

  const visibleRefOptions = useMemo(() => {
    const q = refBranch.trim().toLowerCase();
    if (!refFiltering || !q) return refBranchOptions;
    if (refBranchOptions.some((opt) => opt.value.toLowerCase() === q)) {
      return refBranchOptions;
    }
    return refBranchOptions.filter(
      (opt) =>
        opt.value.toLowerCase().includes(q) || opt.note.toLowerCase().includes(q),
    );
  }, [refBranch, refFiltering, refBranchOptions]);

  useEffect(() => {
    if (settings?.worktime) {
      setRefBranch((prev) => prev || settings.worktime.branch_ref || "SIT");
      const projs = settings.worktime.branch_projects ?? [];
      setAllProjects(projs);
      setSelectedProjects((prev) => (prev.length === 0 ? projs : prev));
    }
  }, [settings]);

  // Suggest branch name matching app.py rule: `${task}-${user}-${ref}`
  const composedBranchName = useMemo(() => {
    return [taskCode.trim(), userTag.trim(), refBranch.trim()]
      .filter(Boolean)
      .join("-");
  }, [taskCode, userTag, refBranch]);

  useEffect(() => {
    if (autoCompose) {
      setBranchName(composedBranchName);
    }
  }, [composedBranchName, autoCompose]);

  // Real-time repo tag preview
  useEffect(() => {
    if (selectedProjects.length === 0) {
      setMatchedTags([]);
      return;
    }
    wtCall<MatchedTag[]>("match_tags_by_projects", { projects: selectedProjects })
      .then((res) => setMatchedTags(Array.isArray(res) ? res : []))
      .catch(() => setMatchedTags([]));
  }, [selectedProjects]);

  const effectiveTaskCode = useMemo(
    () => resolveTaskCode(taskCode || summary?.code || "", branchName, tasks),
    [taskCode, summary?.code, branchName, tasks],
  );

  const matchedLedgerTask = useMemo(
    () =>
      effectiveTaskCode
        ? tasks.find((t) => t.code.toLowerCase() === effectiveTaskCode.toLowerCase())
        : undefined,
    [effectiveTaskCode, tasks],
  );

  const recordedBranches = useMemo(
    () => getTaskBranches(matchedLedgerTask),
    [matchedLedgerTask],
  );

  const handleQueryTask = async (overrideCode?: string) => {
    const code = (overrideCode ?? taskCode).trim();
    if (!code) {
      toast.error("请输入任务号");
      return;
    }
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    setQuerying(true);
    try {
      const info = await wtCall<TaskSummary>("query_task_summary", { task_id: code });
      setSummary(info);
      toast.success(`查询成功：${info?.code || code}`);
    } catch (e) {
      toast.error(`查询任务失败: ${String(e)}`);
    } finally {
      setQuerying(false);
    }
  };

  useEffect(() => {
    const qCode = (searchParams.get("code") || "").trim();
    if (qCode) setTaskCode(qCode);
    if (qCode && user && autoQueriedRef.current !== qCode) {
      autoQueriedRef.current = qCode;
      handleQueryTask(qCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, Boolean(user)]);

  const handleAddProject = () => {
    const p = newProjectInput.trim();
    if (!p) return;
    if (!allProjects.includes(p)) {
      setAllProjects((prev) => [...prev, p]);
    }
    if (!selectedProjects.includes(p)) {
      setSelectedProjects((prev) => [...prev, p]);
    }
    setNewProjectInput("");
  };

  const handleRemoveProject = (proj: string) => {
    setAllProjects((prev) => prev.filter((x) => x !== proj));
    setSelectedProjects((prev) => prev.filter((x) => x !== proj));
  };

  const handleSaveProjectsToSettings = async () => {
    if (!settings) return;
    try {
      await saveSettings({
        ...settings,
        worktime: {
          ...settings.worktime,
          branch_ref: refBranch.trim() || settings.worktime.branch_ref,
          branch_projects: allProjects,
        },
      });
      toast.success(`已保存 ${allProjects.length} 个默认仓库与源分支配置`);
    } catch (e) {
      toast.error(`保存工程列表失败: ${String(e)}`);
    }
  };

  const handleCreateBranch = async () => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    const cleanBranch = branchName.trim();
    const cleanRef = refBranch.trim();
    if (!cleanRef) {
      toast.error("请输入基准源分支 (如 SIT / UAT)");
      return;
    }
    if (!cleanBranch) {
      toast.error("请输入新分支名称");
      return;
    }
    if (selectedProjects.length === 0) {
      toast.error("请至少勾选一个目标代码仓库");
      return;
    }

    setCreating(true);
    const initialRows: BranchRowStatus[] = selectedProjects.map((p) => ({
      project: p,
      status: "等待中...",
    }));
    setRowsStatus(initialRows);

    try {
      const createResults = await wtCall<BranchCreateItemResult[]>(
        "execute_create_branch",
        {
          branch_name: cleanBranch,
          ref_branch: cleanRef,
          projects: selectedProjects,
        },
        (cbName, args) => {
          if (cbName === "update_status_cb" && args.length >= 2) {
            const idx = Number(args[0]);
            const statusText = String(args[1] ?? "");
            setRowsStatus((prev) =>
              prev.map((r, i) => (i === idx ? { ...r, status: statusText } : r)),
            );
          }
        },
      );

      toast.success("批量创建分支执行完成，请查看各仓库状态与日志");

      const resultsArr = Array.isArray(createResults) ? createResults : [];
      const succeededProjects =
        resultsArr.length > 0
          ? resultsArr.filter((r) => r.ok || r.existed).map((r) => r.project)
          : selectedProjects;

      // Resolve effective task code for auto-tag & offline ledger
      const resolvedCode = resolveTaskCode(
        taskCode.trim() || summary?.code || "",
        cleanBranch,
        useAppStore.getState().tasks,
      );

      let appliedTagNames: string[] = [];
      if (autoTag && (summary?.card_id || resolvedCode)) {
        try {
          const cid =
            summary?.card_id ||
            (await wtCall<number>("resolve_card_id", {
              task_or_card_id: resolvedCode || cleanBranch,
            }));
          const tags =
            matchedTags.length > 0
              ? matchedTags
              : await wtCall<MatchedTag[]>("match_tags_by_projects", {
                  projects: succeededProjects.length > 0 ? succeededProjects : selectedProjects,
                });
          if (cid && Array.isArray(tags) && tags.length > 0) {
            await wtCall("set_card_tags_batch", { card_id: cid, tags });
            appliedTagNames = tags.map((t) => t.name);
            pushLog(`🏷️ 已自动为卡片 [${cid}] 打标签: ${appliedTagNames.join("、")}`);
          }
        } catch (tagErr) {
          pushLog(`⚠️ 创建分支后自动打标签提示: ${String(tagErr)}`);
        }
      }

      if (resolvedCode && succeededProjects.length > 0) {
        const latestMatch = useAppStore
          .getState()
          .tasks.find((t) => t.code.toLowerCase() === resolvedCode.toLowerCase());
        await taskRecordBranch({
          code: resolvedCode,
          name: summary?.name || latestMatch?.name || resolvedCode,
          branch: cleanBranch,
          refBranch: cleanRef,
          repos: succeededProjects,
          tags: appliedTagNames,
          source: "create_branch",
        });
        await appendTaskMd(
          resolvedCode,
          `- ${nowDateTimeStr()} 创建分支 \`${cleanBranch}\` ← \`${cleanRef}\` (${succeededProjects.map(shortRepoName).join(", ")})`,
        );
        pushLog(
          `📌 已将分支 [${cleanBranch}] (${succeededProjects.length} 个仓库) 自动记录到任务 [${resolvedCode}]`,
        );
        toast.success(`已将分支 ${cleanBranch} 自动记录到任务 [${resolvedCode}]`);
      } else if (resolvedCode && resultsArr.length > 0 && succeededProjects.length === 0) {
        toast.warning("所有仓库分支创建均失败，未写入任务分支记录");
      }
    } catch (e) {
      toast.error(`创建分支失败: ${String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  const copyBranch = async () => {
    if (!branchName.trim()) return;
    try {
      await navigator.clipboard.writeText(branchName.trim());
      toast.success(`已复制分支名：${branchName.trim()}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">创建分支</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            根据任务号自动生成分支名并批量创建，完成后自动打仓库标签并记录到离线任务台账。
          </p>
        </div>
        {(effectiveTaskCode || taskCode.trim()) && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!user}
              onClick={() => setTagsOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              <Tag className="h-3.5 w-3.5 shrink-0" />
              <span>手动打标签</span>
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/work/mr?code=${encodeURIComponent(effectiveTaskCode || taskCode.trim())}&branch=${encodeURIComponent(branchName.trim())}`,
                )
              }
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              <GitMerge className="h-3.5 w-3.5 shrink-0 text-pink-600" />
              <span>去提交 MR</span>
            </button>
            <button
              type="button"
              onClick={() =>
                api
                  .taskOpenFolder(effectiveTaskCode || taskCode.trim())
                  .catch((e) => toast.error(String(e)))
              }
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>打开文件夹</span>
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(`/work/task/${encodeURIComponent(effectiveTaskCode || taskCode.trim())}`)
              }
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              <FileEdit className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span>需求描述</span>
            </button>
          </div>
        )}
      </div>

      {!user && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>当前未连接 DevOps，请先在左下角登录账号后再执行查询任务与创建分支。</span>
        </div>
      )}

      {/* 分支参数配置卡 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <span className="text-xs font-medium text-gray-700">
              需求 / 任务号（优先当前版本，支持搜索与全选）
            </span>
            <div className="mt-1 flex items-center gap-2">
              <TaskCodeSelect
                tasks={tasks}
                value={taskCode}
                onChange={setTaskCode}
                onSelectTask={(t) => {
                  setTaskCode(t.code);
                  if (user && !querying) {
                    void handleQueryTask(t.code);
                  }
                }}
                placeholder="搜索任务号 / 名称，或下拉选择当前版本任务..."
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                disabled={!user || querying}
                onClick={() => handleQueryTask()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {querying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5 text-blue-600" />
                )}
                <span>查询详情</span>
              </button>
            </div>
          </div>

          <div ref={refBoxRef} className="relative">
            <span className="text-xs font-medium text-gray-700">基准源分支 (Ref)</span>
            <div className="relative mt-1">
              <input
                type="text"
                role="combobox"
                aria-expanded={refDropdownOpen}
                aria-autocomplete="list"
                value={refBranch}
                placeholder="输入或选择源分支 (如 SIT / UAT / master)"
                onFocus={() => {
                  setRefDropdownOpen(true);
                  setRefFiltering(false);
                }}
                onClick={() => {
                  setRefDropdownOpen(true);
                  setRefFiltering(false);
                }}
                onChange={(e) => {
                  setRefBranch(e.target.value);
                  setRefDropdownOpen(true);
                  setRefFiltering(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || e.key === "Enter") {
                    setRefDropdownOpen(false);
                    setRefFiltering(false);
                  } else if (e.key === "ArrowDown") {
                    setRefDropdownOpen(true);
                    setRefFiltering(false);
                  }
                }}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 pr-8 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                aria-label={refDropdownOpen ? "收起源分支列表" : "展开源分支列表"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setRefDropdownOpen((o) => !o);
                  setRefFiltering(false);
                }}
                className="absolute inset-y-0 right-1 flex items-center rounded-lg px-1.5 text-gray-400 transition hover:text-gray-700"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    refDropdownOpen ? "rotate-180 text-blue-600" : ""
                  }`}
                />
              </button>
            </div>

            {refDropdownOpen && (
              <div className="absolute right-0 left-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {visibleRefOptions.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-slate-400">
                    将直接使用自定义分支 &quot;{refBranch.trim()}&quot;
                  </div>
                ) : (
                  visibleRefOptions.map((opt) => {
                    const active =
                      refBranch.trim().toLowerCase() === opt.value.toLowerCase();
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setRefBranch(opt.value);
                          setRefDropdownOpen(false);
                          setRefFiltering(false);
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition ${
                          active
                            ? "bg-blue-50 font-medium text-blue-700"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono">{opt.value}</span>
                          {opt.note && (
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                              {opt.note}
                            </span>
                          )}
                        </div>
                        {active && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {summary && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs">
            <div className="font-semibold text-gray-900">
              [{summary.code}] {summary.name}
              <span className="ml-2 font-mono text-[11px] font-normal text-gray-500">
                (CardID: {summary.card_id})
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-gray-600">
              <span>迭代：{summary.sprint || "-"}</span>
              <span>状态：{summary.stage || "-"}</span>
              <span>开发人：{summary.developers || "-"}</span>
              <span>已填工时：{summary.declared_hours ?? 0}h ({summary.declared_days ?? 0}d)</span>
            </div>
          </div>
        )}

        {recordedBranches.length > 0 && (
          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-900">
                <GitBranch className="h-3.5 w-3.5 text-emerald-600" />
                <span>该任务已记录分支 ({recordedBranches.length})</span>
              </span>
              <span className="text-[11px] text-emerald-700/80">
                新建或已存在的分支会自动合并保存至任务 [{matchedLedgerTask?.code || effectiveTaskCode}] 下
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {recordedBranches.map((rec) => (
                <div
                  key={`${rec.branch}-${rec.refBranch}`}
                  className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[11px]"
                >
                  <code className="font-mono font-semibold text-slate-800">{rec.branch}</code>
                  {rec.refBranch && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                      ← {rec.refBranch}
                    </span>
                  )}
                  {rec.repos.slice(0, 3).map((r) => (
                    <span
                      key={r}
                      title={r}
                      className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700"
                    >
                      {shortRepoName(r)}
                    </span>
                  ))}
                  {rec.repos.length > 3 && (
                    <span className="text-[10px] text-slate-400">
                      +{rec.repos.length - 3}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(rec.branch);
                      toast.success(`已复制分支：${rec.branch}`);
                    }}
                    title="复制分支名"
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/work/mr?code=${encodeURIComponent(
                          matchedLedgerTask?.code || effectiveTaskCode,
                        )}&branch=${encodeURIComponent(rec.branch)}`,
                      )
                    }
                    className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded bg-pink-50 px-1.5 py-0.5 text-[10px] font-medium text-pink-700 hover:bg-pink-100"
                  >
                    <GitMerge className="h-2.5 w-2.5 shrink-0" />
                    <span>去提交 MR</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-700">个人标识</span>
            <input
              type="text"
              value={userTag}
              onChange={(e) => setUserTag(e.target.value)}
              placeholder="如 DEV"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <div className="md:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">新分支名称</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500">
                <input
                  type="checkbox"
                  checked={autoCompose}
                  onChange={(e) => setAutoCompose(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                />
                <span>自动拼接 (任务号-标识-源分支)</span>
              </label>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={branchName}
                onChange={(e) => {
                  setAutoCompose(false);
                  setBranchName(e.target.value);
                }}
                placeholder="例如 TASK-0001-DEV-SIT"
                className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={copyBranch}
                disabled={!branchName.trim()}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>复制分支名</span>
              </button>
            </div>
          </div>
        </div>

        {/* 目标工程列表 */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-800">
              目标代码仓库 ({selectedProjects.length}/{allProjects.length})
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedProjects([...allProjects])}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => setSelectedProjects([])}
                className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
              >
                全不选
              </button>
              <button
                type="button"
                onClick={handleSaveProjectsToSettings}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-blue-600 hover:bg-blue-50"
              >
                <Save className="h-3 w-3" />
                <span>保存到系统配置</span>
              </button>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {allProjects.map((proj) => {
              const checked = selectedProjects.includes(proj);
              const isPc = proj.toLowerCase().includes("printcenter");
              return (
                <div
                  key={proj}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${
                    checked ? "border-blue-200 bg-blue-50/40" : "border-gray-200 bg-white"
                  }`}
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedProjects((prev) =>
                          prev.includes(proj)
                            ? prev.filter((x) => x !== proj)
                            : [...prev, proj],
                        )
                      }
                      className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-blue-600"
                    />
                    <span className="truncate font-mono text-[11px] text-gray-800" title={proj}>
                      {proj}
                      {isPc ? " (单证打印)" : ""}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleRemoveProject(proj)}
                    title="从列表移除"
                    className="ml-2 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <input
              type="text"
              value={newProjectInput}
              onChange={(e) => setNewProjectInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddProject();
              }}
              placeholder="新增工程路径，例如 GROUP!TEAM/repo-name"
              className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-1.5 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddProject}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5 text-blue-600" />
              <span>添加工程</span>
            </button>
          </div>
        </div>

        {/* 自动打标签 + 提交按钮 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={autoTag}
                onChange={(e) => setAutoTag(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <span>创建分支后按仓库自动打标签</span>
            </label>
            {matchedTags.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
                <Tag className="h-3 w-3" />
                匹配标签：{matchedTags.map((t) => t.name).join(" / ")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {creating && (
              <button
                type="button"
                onClick={() => api.wtStop().catch(() => {})}
                className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>中止</span>
              </button>
            )}
            <button
              type="button"
              disabled={!user || creating}
              onClick={handleCreateBranch}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitBranch className="h-3.5 w-3.5" />
              )}
              <span>{creating ? "创建中..." : "创建分支"}</span>
            </button>
          </div>
        </div>
      </section>

      {/* 执行结果状态表 */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50/70 px-4 py-2.5 text-xs font-semibold text-gray-800">
          创建分支执行结果
        </div>
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-gray-50 text-[11px] font-semibold text-gray-500">
            <tr className="border-b border-gray-200">
              <th className="px-4 py-2">仓库路径</th>
              <th className="w-60 px-4 py-2">执行状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rowsStatus.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-8 text-center text-gray-400">
                  点击「创建分支」后将在此实时展示每个工程的分支创建状态。
                </td>
              </tr>
            ) : (
              rowsStatus.map((r) => (
                <tr key={r.project} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-gray-800">{r.project}</td>
                  <td className="px-4 py-2.5">
                    {r.status.includes("成功") ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                        {r.status}
                      </span>
                    ) : r.status.includes("已存在") ? (
                      <span className="inline-flex items-center gap-1 font-medium text-blue-700">
                        {r.status}
                      </span>
                    ) : r.status.includes("失败") ? (
                      <span className="font-medium text-red-600">{r.status}</span>
                    ) : (
                      <span className="text-gray-600">{r.status}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <TagsDialog
        open={tagsOpen}
        cardIdOrCode={summary?.card_id || taskCode.trim()}
        projects={selectedProjects}
        onClose={() => setTagsOpen(false)}
      />
    </div>
  );
}
