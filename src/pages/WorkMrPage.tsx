import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitMerge,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Square,
  Tag,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { MemberSelect } from "../components/MemberSelect";
import { TagsDialog } from "../components/TagsDialog";
import { api, wtCall } from "../lib/api";
import type { TaskBranchRecord } from "../lib/types";
import {
  appendTaskMd,
  extractTaskCode,
  fmtTpl,
  getConst,
  getTaskBranches,
  nowDateTimeStr,
  resolveTaskCode,
  sendWechat,
  shortRepoName,
} from "../lib/wtx";
import { useAppStore } from "../store/appStore";

const STD_DESTS = ["SIT", "UAT", "PRD", "PROD"];

interface MrRowStatus {
  projectPath: string;
  projectName: string;
  dest: string;
  status: string;
  url: string;
  reviewId: string;
}

interface SubmitMrItemResult {
  project?: string;
  project_path?: string;
  dest?: string;
  url?: string;
  is_new?: boolean;
}

interface MatchedTag {
  id: number;
  name: string;
}

function parseReviewInfoFromInput(
  rawInput: string,
  fallbackProj: string,
): { project: string; reviewId: string } {
  const s = rawInput.trim();
  if (!s) return { project: fallbackProj, reviewId: "" };
  if (/^\d+$/.test(s)) return { project: fallbackProj, reviewId: s };

  const apiMatch = s.match(/\/projects\/(.+?)\/reviews\/(\d+)/);
  if (apiMatch) {
    return {
      project: apiMatch[1].replace(/%2F/gi, "!").replace(/\//, "!"),
      reviewId: apiMatch[2],
    };
  }
  const webMatch = s.match(/\/codingRoot\/(.+?)\/merges\/(\d+)/);
  if (webMatch) {
    const segs = webMatch[1].replace(/%2F/gi, "!").split("/");
    const proj =
      segs.length > 2
        ? `${segs.slice(0, -1).join("!")}/${segs[segs.length - 1]}`
        : segs.join("/");
    return { project: proj, reviewId: webMatch[2] };
  }
  return { project: fallbackProj, reviewId: s };
}

function computeDefaultReviewers(
  dests: string[],
  revMap: Record<string, string> | undefined,
): string[] {
  if (!revMap) return [];
  const res: string[] = [];
  const seen = new Set<string>();
  const upperMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(revMap)) {
    upperMap[k.toUpperCase()] = v;
  }
  for (const d of dests) {
    const raw = upperMap[d.toUpperCase()] || revMap[d] || "";
    for (const part of raw.split(/[,，、\s]+/)) {
      const name = part.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        res.push(name);
      }
    }
  }
  return res;
}

export function WorkMrPage() {
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
  const [srcBranch, setSrcBranch] = useState(searchParams.get("branch") || "");

  const [checkedDests, setCheckedDests] = useState<string[]>(["UAT"]);
  const [customDestsText, setCustomDestsText] = useState("");

  const [allProjects, setAllProjects] = useState<string[]>(
    settings?.worktime.branch_projects ?? [],
  );
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    settings?.worktime.branch_projects ?? [],
  );
  const [newProjInput, setNewProjInput] = useState("");

  const [reviewers, setReviewers] = useState<string[]>(() =>
    computeDefaultReviewers(["UAT"], settings?.worktime.branch_default_reviewers),
  );
  const [reviewersTouched, setReviewersTouched] = useState(false);
  const [reviewerInput, setReviewerInput] = useState("");

  const [autoApprovePc, setAutoApprovePc] = useState(false);
  const [autoTag, setAutoTag] = useState(true);
  const [matchedTags, setMatchedTags] = useState<MatchedTag[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<MrRowStatus[]>([]);
  const [defaultMrTpl, setDefaultMrTpl] = useState("");
  const [myReviewerId, setMyReviewerId] = useState("");
  const [manualMergeOpen, setManualMergeOpen] = useState(false);

  // Standalone one-click merge section
  const [mergeProject, setMergeProject] = useState(
    () => settings?.worktime.branch_projects?.[0] || "",
  );
  const [mergeReviewInput, setMergeReviewInput] = useState("");
  const [mergeUserId, setMergeUserId] = useState("");
  const [merging, setMerging] = useState(false);

  const [tagsOpen, setTagsOpen] = useState(false);

  useEffect(() => {
    getConst<string>("DEFAULT_TEMPLATE_MR")
      .then((t) => {
        if (typeof t === "string") setDefaultMrTpl(t);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (settings?.worktime) {
      const projs = settings.worktime.branch_projects ?? [];
      setAllProjects((prev) => (prev.length === 0 ? projs : prev));
      setSelectedProjects((prev) => (prev.length === 0 ? projs : prev));
    }
  }, [settings]);

  const derivedTaskCode = useMemo(
    () => resolveTaskCode(taskCode, srcBranch, tasks),
    [taskCode, srcBranch, tasks],
  );

  const matchedTask = useMemo(
    () =>
      derivedTaskCode
        ? tasks.find((t) => t.code.toLowerCase() === derivedTaskCode.toLowerCase())
        : undefined,
    [derivedTaskCode, tasks],
  );

  const taskBranches = useMemo(
    () => getTaskBranches(matchedTask),
    [matchedTask],
  );

  const applyRecordedBranch = (rec: TaskBranchRecord, silent = false) => {
    setSrcBranch(rec.branch);
    if (rec.repos.length > 0) {
      const baseAll = allProjects;
      const nextAll = [...baseAll];
      const nextSelected: string[] = [];
      for (const repo of rec.repos) {
        const targetShort = shortRepoName(repo);
        const matched =
          baseAll.find((p) => p === repo) ||
          baseAll.find((p) => shortRepoName(p) === targetShort);
        if (matched) {
          if (!nextSelected.includes(matched)) nextSelected.push(matched);
        } else if (repo.trim()) {
          nextAll.push(repo);
          nextSelected.push(repo);
        }
      }
      if (nextAll.length !== baseAll.length) {
        setAllProjects(nextAll);
      }
      if (nextSelected.length > 0) {
        setSelectedProjects(nextSelected);
      }
    }
    if (!silent) {
      toast.success(
        rec.repos.length > 0
          ? `已填充分支 ${rec.branch} 并勾选 ${rec.repos.length} 个关联仓库`
          : `已填充分支 ${rec.branch}`,
      );
    }
  };

  const lastAppliedQueryRef = useRef("");
  useEffect(() => {
    const queryKey = searchParams.toString();
    if (!queryKey || lastAppliedQueryRef.current === queryKey) return;
    const qCode = (searchParams.get("code") || "").trim();
    const qBranch = (searchParams.get("branch") || "").trim();
    if (qCode) setTaskCode(qCode);
    const hit = qCode
      ? tasks.find((t) => t.code.toLowerCase() === qCode.toLowerCase())
      : undefined;
    if (!hit && tasks.length === 0 && qCode && !qBranch) {
      return;
    }
    lastAppliedQueryRef.current = queryKey;
    const branches = getTaskBranches(hit);
    if (qBranch) {
      const matchedRec = branches.find((b) => b.branch === qBranch);
      if (matchedRec) {
        applyRecordedBranch(matchedRec, true);
      } else {
        setSrcBranch(qBranch);
      }
    } else if (branches.length > 0) {
      applyRecordedBranch(branches[0], true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, tasks]);

  useEffect(() => {
    if (!user) return;
    wtCall<string>("get_current_user_reviewer_id", {
      user_name: user.realName || "",
      default_id: "",
    })
      .then((rid) => {
        const clean = String(rid || "").trim();
        if (!clean) return;
        setMyReviewerId(clean);
        setMergeUserId((prev) => (!prev ? clean : prev));
      })
      .catch(() => {});
  }, [user]);

  const effectiveDests = useMemo(() => {
    const custom = customDestsText
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set([...checkedDests, ...custom]));
  }, [checkedDests, customDestsText]);

  useEffect(() => {
    if (!reviewersTouched) {
      setReviewers(
        computeDefaultReviewers(
          effectiveDests,
          settings?.worktime.branch_default_reviewers,
        ),
      );
    }
  }, [effectiveDests, settings?.worktime.branch_default_reviewers, reviewersTouched]);

  useEffect(() => {
    if (selectedProjects.length === 0) {
      setMatchedTags([]);
      return;
    }
    wtCall<MatchedTag[]>("match_tags_by_projects", { projects: selectedProjects })
      .then((res) => setMatchedTags(Array.isArray(res) ? res : []))
      .catch(() => setMatchedTags([]));
  }, [selectedProjects]);

  const handleAddCustomProject = () => {
    const p = newProjInput.trim();
    if (!p) return;
    if (!allProjects.includes(p)) setAllProjects((prev) => [...prev, p]);
    if (!selectedProjects.includes(p)) setSelectedProjects((prev) => [...prev, p]);
    setNewProjInput("");
  };

  const handleSaveProjects = async () => {
    if (!settings) return;
    try {
      await saveSettings({
        ...settings,
        worktime: { ...settings.worktime, branch_projects: allProjects },
      });
      toast.success("已保存常用工程列表到系统设置");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const addReviewer = (nameVal: string) => {
    const clean = nameVal.trim();
    if (!clean) return;
    setReviewersTouched(true);
    setReviewers((prev) => (prev.includes(clean) ? prev : [...prev, clean]));
    setReviewerInput("");
  };

  const removeReviewer = (nameVal: string) => {
    setReviewersTouched(true);
    setReviewers((prev) => prev.filter((x) => x !== nameVal));
  };

  const handleSubmitMr = async () => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    const cleanSrc = srcBranch.trim();
    if (!cleanSrc) {
      toast.error("请填写源分支 (例如 TASK-0001-DEV-SIT)");
      return;
    }
    if (effectiveDests.length === 0) {
      toast.error("请至少选择或输入一个目标分支环境");
      return;
    }
    if (selectedProjects.length === 0) {
      toast.error("请至少勾选一个目标代码仓库");
      return;
    }
    if (reviewers.length === 0) {
      toast.error("提交 MR 必须至少指定一位评审人员");
      return;
    }
    if (autoApprovePc && !myReviewerId.trim()) {
      toast.error("已勾选自动通过合并，请先填写当前评审人员 ID");
      return;
    }

    // Build initial rows matching core loop order: for dest in dest_branches: for proj in projects
    const initialRows: MrRowStatus[] = [];
    for (const d of effectiveDests) {
      for (const p of selectedProjects) {
        initialRows.push({
          projectPath: p,
          projectName: p.split("/").pop() || p,
          dest: d,
          status: "等待中...",
          url: "",
          reviewId: "",
        });
      }
    }
    setRows(initialRows);
    setSubmitting(true);

    try {
      const curName = user.realName || String(user.user.name || "");
      const mrResults = await wtCall<SubmitMrItemResult[]>(
        "execute_submit_mr",
        {
          src_branch: cleanSrc,
          dest_branches: effectiveDests,
          projects: selectedProjects,
          reviewer_names: reviewers,
          auto_approve_printcenter: autoApprovePc,
          current_user_reviewer_id: autoApprovePc ? myReviewerId.trim() : "",
          current_user_name: curName,
        },
        (cbName, args) => {
          if (cbName === "update_status_cb" && args.length >= 2) {
            const idx = Number(args[0]);
            const statusText = String(args[1] ?? "");
            const url = String(args[2] ?? "");
            const ridMatch = url.match(/\/(?:merges|reviews)\/(\d+)/);
            setRows((prev) =>
              prev.map((r, i) =>
                i === idx
                  ? {
                      ...r,
                      status: statusText,
                      url: url || r.url,
                      reviewId: ridMatch ? ridMatch[1] : r.reviewId,
                    }
                  : r,
              ),
            );
          }
        },
      );

      toast.success("批量提交 MR 处理完成");

      // Auto-tag card based on modified repositories
      let appliedTags: string[] = [];
      if (autoTag && derivedTaskCode) {
        try {
          const cid = await wtCall<number>("resolve_card_id", {
            task_or_card_id: derivedTaskCode,
          });
          const tags =
            matchedTags.length > 0
              ? matchedTags
              : await wtCall<MatchedTag[]>("match_tags_by_projects", {
                  projects: selectedProjects,
                });
          if (cid && Array.isArray(tags) && tags.length > 0) {
            await wtCall("set_card_tags_batch", { card_id: cid, tags });
            appliedTags = tags.map((t) => t.name);
            pushLog(`🏷️ 已自动为卡片 [${cid}] 打标签: ${appliedTags.join("、")}`);
          }
        } catch (tagErr) {
          pushLog(`⚠️ 提交 MR 后自动打标签提示: ${String(tagErr)}`);
        }
      }

      // Update offline ledger & task md
      const resultsArr = Array.isArray(mrResults) ? mrResults : [];
      const resolvedCode = resolveTaskCode(
        taskCode,
        cleanSrc,
        useAppStore.getState().tasks,
      );
      if (resolvedCode) {
        const latestMatch = useAppStore
          .getState()
          .tasks.find((t) => t.code.toLowerCase() === resolvedCode.toLowerCase());
        await taskRecordBranch({
          code: resolvedCode,
          name: latestMatch?.name || resolvedCode,
          branch: cleanSrc,
          repos: selectedProjects,
          tags: appliedTags,
          source: "submit_mr",
        });

        for (const item of resultsArr) {
          const rUrl = item.url || "";
          const ridMatch = rUrl.match(/\/(?:merges|reviews)\/(\d+)/);
          const ridTag = ridMatch ? ` #${ridMatch[1]}` : "";
          await appendTaskMd(
            resolvedCode,
            `- ${nowDateTimeStr()} MR ${item.project || item.project_path || ""} ${cleanSrc}→${item.dest || ""}${ridTag} ${rUrl}`,
          );
        }
      }

      // Send WeChat MR summary notice if enabled
      const wx = settings?.worktime.wechat_config;
      if (wx?.enabled && wx?.auto_notify_mr) {
        const mrLinksList = resultsArr
          .filter((it) => Boolean(it.url))
          .map(
            (it) =>
              `* **${it.project}** (-> \`${it.dest}\`): [点击直接审查](${it.url})\n  ${it.url}`,
          );
        const mrLinksStr =
          mrLinksList.length > 0 ? mrLinksList.join("\n") : "（无可用审查链接）";
        const tpl = wx.template_mr || defaultMrTpl;
        const userErp = user.user.userErp || user.user.erp || "";
        let msg = fmtTpl(tpl, {
          user_name: curName || "研发人员",
          user_erp: userErp,
          src_branch: cleanSrc,
          dest_branches: effectiveDests.join(", "),
          project_count: String(selectedProjects.length),
          reviewers: reviewers.join(", "),
          time: nowDateTimeStr(),
          mr_links: mrLinksStr,
        });
        if (!tpl.includes("{mr_links}") && mrLinksList.length > 0) {
          msg += `\n\n🔗 **合并审查链接**:\n${mrLinksStr}`;
        }
        try {
          const [ok, wxMsg] = await sendWechat(msg);
          if (ok) {
            toast.success("已推送 MR 提交通知到企业微信");
          } else {
            pushLog(`⚠️ 企微 MR 通知未成功: ${wxMsg}`);
          }
        } catch (wxErr) {
          pushLog(`⚠️ 发送企微 MR 通知失败: ${String(wxErr)}`);
        }
      }
    } catch (e) {
      toast.error(`提交 MR 失败: ${String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOneClickMerge = async (
    overrideProject?: string,
    overrideReview?: string,
    rowIdx?: number,
  ) => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    const parsed = parseReviewInfoFromInput(
      overrideReview ?? mergeReviewInput,
      overrideProject ?? mergeProject,
    );
    const targetProject = (
      overrideProject ||
      parsed.project ||
      settings?.worktime.branch_projects?.[0] ||
      ""
    ).trim();
    const targetReviewId = (parsed.reviewId || "").trim();
    const targetReviewerUid = (mergeUserId.trim() || myReviewerId.trim()).trim();
    if (!targetProject || !targetReviewId || !targetReviewerUid) {
      setManualMergeOpen(true);
    }
    if (!targetProject) {
      toast.error("请先选择目标代码仓库或输入完整 MR 链接");
      return;
    }
    if (!targetReviewId) {
      toast.error("请输入 Review ID（如 34）或完整的 MR 页面链接");
      return;
    }
    if (!targetReviewerUid) {
      toast.error("请展开「指定 MR 一键通过」并填写评审人员 ID");
      return;
    }

    setMerging(true);
    try {
      const [ok, msg] = await wtCall<[boolean, string]>(
        "execute_one_click_approve_and_merge",
        {
          project: targetProject,
          review_id: targetReviewId,
          user_id: targetReviewerUid,
          user_name: user.realName || "",
        },
      );
      if (ok) {
        toast.success(`一键通过并合并成功 (#${targetReviewId})`);
        if (rowIdx !== undefined) {
          setRows((prev) =>
            prev.map((r, i) =>
              i === rowIdx ? { ...r, status: "🎉 已一键通过并合并" } : r,
            ),
          );
        }
      } else {
        toast.error(`一键通过未完全成功: ${msg}`);
      }
    } catch (e) {
      toast.error(`执行一键通过合并异常: ${String(e)}`);
    } finally {
      setMerging(false);
    }
  };

  const handleOpenMrUrl = async (url: string) => {
    if (!url) return;
    try {
      await openUrl(url);
    } catch (e) {
      toast.error(`打开链接失败: ${String(e)}`);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">提交 MR</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            批量提交多仓库多环境合并请求，支持单证打印一键加自己为评审人 → 通过 → 合并、自动打标签与离线台账记录。
          </p>
        </div>
        {derivedTaskCode && (
          <button
            type="button"
            disabled={!user}
            onClick={() => setTagsOpen(true)}
            className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            <Tag className="h-3.5 w-3.5" />
            <span>手动打标签 ({derivedTaskCode})</span>
          </button>
        )}
      </div>

      {!user && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>当前未连接 DevOps，请先在左下角登录账号后提交 MR 或执行一键通过合并。</span>
        </div>
      )}

      {/* 批量提交 MR 主配置卡片 */}
      <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block md:col-span-2">
            <span className="text-xs font-medium text-gray-700">源分支 (src_branch)</span>
            <input
              type="text"
              value={srcBranch}
              onChange={(e) => setSrcBranch(e.target.value)}
              placeholder="例如 TASK-0001-DEV-SIT"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">
              关联任务号（可选，用于台账与标签）
            </span>
            <input
              type="text"
              list="mr-ledger-tasks"
              value={taskCode}
              onChange={(e) => setTaskCode(e.target.value)}
              placeholder={extractTaskCode(srcBranch) || "如 TASK-0001"}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
            <datalist id="mr-ledger-tasks">
              {tasks.map((t) => (
                <option
                  key={t.code}
                  value={t.code}
                  label={t.name ? `${t.code} · ${t.name}` : t.code}
                />
              ))}
            </datalist>
          </label>
        </div>

        {taskBranches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200/70 bg-violet-50/50 px-3 py-2 text-xs">
            <span className="inline-flex shrink-0 items-center gap-1 font-medium text-violet-900">
              <GitBranch className="h-3.5 w-3.5 text-violet-600" />
              <span>该任务已建分支 (点击自动填入分支与关联仓库)：</span>
            </span>
            {taskBranches.map((rec) => {
              const isCurrent = srcBranch.trim() === rec.branch;
              return (
                <button
                  key={`${rec.branch}-${rec.refBranch}`}
                  type="button"
                  onClick={() => applyRecordedBranch(rec)}
                  title={
                    rec.repos.length > 0
                      ? `关联仓库: ${rec.repos.map(shortRepoName).join(", ")}`
                      : "点击填入该分支"
                  }
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 font-mono text-[11px] transition ${
                    isCurrent
                      ? "border-violet-500 bg-violet-600 font-semibold text-white shadow-2xs"
                      : "border-violet-200 bg-white text-violet-800 hover:border-violet-300 hover:bg-violet-100/70"
                  }`}
                >
                  <span>{rec.branch}</span>
                  {rec.refBranch && (
                    <span
                      className={`rounded px-1 text-[10px] ${
                        isCurrent ? "bg-violet-500/70 text-white" : "bg-violet-50 text-violet-600"
                      }`}
                    >
                      ← {rec.refBranch}
                    </span>
                  )}
                  {rec.repos.length > 0 && (
                    <span
                      className={`text-[10px] ${
                        isCurrent ? "text-violet-100" : "text-slate-400"
                      }`}
                    >
                      ({rec.repos.length}仓)
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 目标分支环境 */}
        <div>
          <span className="text-xs font-medium text-gray-700">目标分支环境 (dest_branches)</span>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {STD_DESTS.map((d) => {
              const checked = checkedDests.includes(d);
              return (
                <label key={d} className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setCheckedDests((prev) =>
                        prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
                      )
                    }
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                  />
                  <span className="font-mono font-medium text-gray-800">{d}</span>
                </label>
              );
            })}
            <input
              type="text"
              value={customDestsText}
              onChange={(e) => setCustomDestsText(e.target.value)}
              placeholder="其他自定义目标分支（逗号或空格分隔）"
              className="min-w-[220px] flex-1 rounded-xl border border-gray-200 px-3 py-1.5 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* 评审人员 */}
        <div className="border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-700">评审人员 (reviewers)</span>
            <button
              type="button"
              onClick={() => {
                setReviewersTouched(false);
                setReviewers(
                  computeDefaultReviewers(
                    effectiveDests,
                    settings?.worktime.branch_default_reviewers,
                  ),
                );
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              <RotateCcw className="h-3 w-3" />
              <span>应用环境默认评审人</span>
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {reviewers.length === 0 ? (
              <span className="text-[11px] text-gray-400">尚未指定评审人，请在下方添加。</span>
            ) : (
              reviewers.map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800"
                >
                  <span>{r}</span>
                  <button
                    type="button"
                    onClick={() => removeReviewer(r)}
                    className="rounded-full p-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-900"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <MemberSelect
              value={reviewerInput}
              onChange={setReviewerInput}
              onPick={(m) => addReviewer(m.name)}
              placeholder="选择或输入评审人姓名..."
              className="max-w-xs flex-1"
            />
            <button
              type="button"
              onClick={() => addReviewer(reviewerInput)}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5 text-blue-600" />
              <span>添加评审人</span>
            </button>
          </div>
        </div>

        {/* 目标工程列表 */}
        <div className="border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-700">
              目标项目 ({selectedProjects.length}/{allProjects.length})
            </span>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedProjects([...allProjects])}
                className="rounded-lg border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => setSelectedProjects([])}
                className="rounded-lg border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50"
              >
                全不选
              </button>
              <button
                type="button"
                onClick={handleSaveProjects}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-blue-600 hover:bg-blue-50"
              >
                <Save className="h-3 w-3" />
                <span>保存工程列表</span>
              </button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {allProjects.map((proj) => {
              const checked = selectedProjects.includes(proj);
              const isPc = proj.toLowerCase().includes("printcenter");
              return (
                <label
                  key={proj}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                    checked ? "border-blue-200 bg-blue-50/40" : "border-gray-200 bg-white"
                  }`}
                >
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
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={newProjInput}
              onChange={(e) => setNewProjInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCustomProject();
              }}
              placeholder="临时添加工程路径..."
              className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-1.5 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddCustomProject}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5 text-blue-600" />
              <span>添加工程</span>
            </button>
          </div>
        </div>

        {/* 提交选项与主按钮 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-700">
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={autoApprovePc}
                onChange={(e) => setAutoApprovePc(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <span>单证打印提交后自动通过合并 (3 接口)</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={autoTag}
                onChange={(e) => setAutoTag(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              <span>按修改仓库自动打标签</span>
            </label>
            {matchedTags.length > 0 && (
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
                匹配：{matchedTags.map((t) => t.name).join(" / ")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {submitting && (
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
              disabled={!user || submitting}
              onClick={handleSubmitMr}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitMerge className="h-3.5 w-3.5" />
              )}
              <span>{submitting ? "正在提交 MR..." : "批量提交 MR"}</span>
            </button>
          </div>
        </div>

        {autoApprovePc && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3.5 py-2.5 text-xs">
            <div className="text-[11px] text-emerald-800">
              已启用提交后自动自评并合并（3 接口：加自己为评审人 → 通过 → 合并），请确认当前评审人 ID：
            </div>
            <label className="flex items-center gap-2">
              <span className="shrink-0 font-medium text-emerald-900">当前评审人 ID *</span>
              <input
                type="text"
                value={myReviewerId}
                onChange={(e) => setMyReviewerId(e.target.value)}
                placeholder="输入评审人用户 ID"
                className="w-40 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 font-mono text-xs text-gray-800 focus:border-emerald-500 focus:outline-none"
              />
            </label>
          </div>
        )}
      </section>

      {/* MR 结果列表 */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50/70 px-4 py-2.5 text-xs font-semibold text-gray-800">
          MR 提交状态列表
        </div>
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-gray-50 text-[11px] font-semibold text-gray-500">
            <tr className="border-b border-gray-200">
              <th className="px-4 py-2">项目</th>
              <th className="w-24 px-3 py-2">目标分支</th>
              <th className="px-3 py-2">状态</th>
              <th className="w-56 px-4 py-2 text-right">快捷操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-gray-400">
                  提交 MR 后将在此实时展示各个仓库与目标分支的创建和自动合并结果。
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={`${r.dest}-${r.projectPath}`} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-gray-800">{r.projectName}</td>
                  <td className="px-3 py-2.5 font-mono font-medium text-indigo-700">
                    {r.dest}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{r.status}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {r.url && (
                        <button
                          type="button"
                          onClick={() => handleOpenMrUrl(r.url)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-blue-600 hover:bg-blue-50"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>打开审查页</span>
                        </button>
                      )}
                      {r.reviewId && (
                        <button
                          type="button"
                          disabled={!user || merging}
                          onClick={() =>
                            handleOneClickMerge(r.projectPath, r.reviewId, idx)
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Zap className="h-3 w-3" />
                          <span>一键通过并合并</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* 独立：单证打印 / 任意 MR 一键通过三个接口并合并（默认折叠，按需展开填写） */}
      <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/40">
        <button
          type="button"
          onClick={() => setManualMergeOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition hover:bg-emerald-50/80"
        >
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Zap className="h-4 w-4 text-emerald-600" />
              <span>单证打印 / 指定 MR 一键通过三个接口并合并</span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                按需展开
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {manualMergeOpen
                ? "依次执行：① POST .../reviewers/{uid} (加自己为评审人) → ② POST .../opinion (通过 score:2) → ③ POST .../manualMerge (合并)"
                : "默认不启用，点击展开后填写目标工程、Review ID 与评审人员 ID 执行 3 接口自动合并"}
            </p>
          </div>
          {manualMergeOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-emerald-700" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-emerald-700" />
          )}
        </button>

        {manualMergeOpen && (
          <div className="border-t border-emerald-200/70 px-5 pb-5 pt-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className="block md:col-span-2">
                <span className="text-xs font-medium text-gray-700">目标工程 (project)</span>
                <input
                  type="text"
                  list="mr-merge-proj-list"
                  value={mergeProject}
                  onChange={(e) => setMergeProject(e.target.value)}
                  placeholder="如 GROUP!TEAM/repo-name"
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800 focus:border-emerald-500 focus:outline-none"
                />
                <datalist id="mr-merge-proj-list">
                  {allProjects.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Review ID 或 MR 链接</span>
                <input
                  type="text"
                  value={mergeReviewInput}
                  onChange={(e) => setMergeReviewInput(e.target.value)}
                  placeholder="如 34 或粘贴 merges/34 链接"
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800 focus:border-emerald-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">评审人员 ID</span>
                <input
                  type="text"
                  value={mergeUserId}
                  onChange={(e) => setMergeUserId(e.target.value)}
                  placeholder="评审人用户 ID"
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800 focus:border-emerald-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={!user || merging}
                onClick={() => handleOneClickMerge()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {merging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                <span>{merging ? "正在执行 3 个接口..." : "一键添加自己为评审人 → 通过 → 合并"}</span>
              </button>
            </div>
          </div>
        )}
      </section>

      <TagsDialog
        open={tagsOpen}
        cardIdOrCode={derivedTaskCode}
        projects={selectedProjects}
        onClose={() => setTagsOpen(false)}
      />
    </div>
  );
}
