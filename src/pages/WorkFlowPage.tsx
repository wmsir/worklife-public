import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileEdit,
  FolderOpen,
  GitBranch,
  GitMerge,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Search,
  Square,
  Tag,
  UserCheck,
  Workflow,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  AttachmentUploader,
  type AttachmentType,
  type UploadedAttachInfo,
} from "../components/AttachmentUploader";
import { DatePicker } from "../components/DatePicker";
import { MemberSelect } from "../components/MemberSelect";
import { TagsDialog } from "../components/TagsDialog";
import { api, wtCall } from "../lib/api";
import {
  appendTaskMd,
  ensureLedgerTask,
  getConst,
  nowDateTimeStr,
  ymdToLocalMs,
  type MemberOption,
} from "../lib/wtx";
import { useAppStore } from "../store/appStore";

interface TaskSummary {
  card_id: number;
  space_id?: number;
  code: string;
  name: string;
  type?: string;
  stage?: string;
  status_name?: string;
  card_status_id?: number | null;
  sprint?: string;
  creator?: string;
  developers?: string;
  handler_name?: string;
  plan_test_date_str?: string;
  declared_days?: number;
}

interface ChecklistStageDef {
  key: string;
  name: string;
  stageId: number;
  count: number;
  desc: string;
}

interface ChecklistItem {
  checkId?: number;
  checkPointName?: string;
  checkContent?: string;
  checkResult?: number;
  [k: string]: unknown;
}

interface FlowStepDef {
  id: number;
  key: string;
  name: string;
  desc: string;
}

type StageRunStatus = "idle" | "running" | "success" | "fail" | "skipped";

interface HandlerDict {
  userName: string;
  sex: number;
  name: string;
  email: string;
  erp: string;
  orgTierCode: string;
  orgTierName: string;
  positionName: string;
  isLeader: boolean;
  type: number;
  role: string;
  [k: string]: unknown;
}

const DEFAULT_STAGES: ChecklistStageDef[] = [
  { key: "review", name: "评审", stageId: 30, count: 10, desc: "需求规格说明书与方案合理性规范检查 (10项)" },
  { key: "design", name: "设计", stageId: 70, count: 21, desc: "设计文档、系统架构与原型正确性检查 (21项)" },
  { key: "dev", name: "开发", stageId: 90, count: 16, desc: "代码评审规范性与自测检查 (16项)" },
  { key: "test", name: "测试", stageId: 110, count: 8, desc: "测试设计覆盖度与执行结果检查 (8项)" },
];

const DEFAULT_FLOW_STEPS: FlowStepDef[] = [
  { id: 50, key: "design", name: "方案设计", desc: "需求分析与方案设计" },
  { id: 60, key: "design_review", name: "设计评审", desc: "设计评审文档" },
  { id: 70, key: "dev", name: "开发", desc: "进入开发阶段 (需设置计划提测日期)" },
  { id: 90, key: "dev_test", name: "开发自测", desc: "编码实现与单元自测" },
  { id: 130, key: "uat_update", name: "UAT更新", desc: "部署更新至UAT验证环境" },
  { id: 110, key: "test_audit", name: "测试审核", desc: "测试审核验收 (需研发附件)" },
  { id: 140, key: "uat_verify", name: "UAT验收", desc: "转测试/业务验收 (自动转经办人)" },
];

function buildHandlerFromMember(m: MemberOption, fallback?: Partial<HandlerDict>): HandlerDict {
  const raw = m.raw || {};
  return {
    userName: m.name,
    sex: typeof raw.sex === "number" ? raw.sex : (fallback?.sex ?? 2),
    name: m.name,
    email: String(m.email || raw.email || fallback?.email || ""),
    erp: m.erp || String(fallback?.erp || ""),
    orgTierCode: String(
      raw.orgTierCode ||
        fallback?.orgTierCode ||
        "/00000000/00990000/00999900/00000071/00007160/00007167",
    ),
    orgTierName: String(raw.orgTierName || raw.orgName || fallback?.orgTierName || ""),
    positionName: String(
      m.positionName || raw.positionName || fallback?.positionName || "专职研发工程师",
    ),
    isLeader: Boolean(raw.isLeader ?? false),
    type: typeof raw.type === "number" ? raw.type : 1,
    role: String(raw.role || "member"),
  };
}

export function WorkFlowPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { settings, user, saveSettings, taskUpdate, pushLog } = useAppStore(
    useShallow((s) => ({
      settings: s.settings,
      user: s.user,
      saveSettings: s.saveSettings,
      taskUpdate: s.taskUpdate,
      pushLog: s.pushLog,
    })),
  );

  const [codeInput, setCodeInput] = useState(searchParams.get("code") || "");
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [querying, setQuerying] = useState(false);

  const [stagesDef, setStagesDef] = useState<ChecklistStageDef[]>(DEFAULT_STAGES);
  const [flowStepsDef, setFlowStepsDef] = useState<FlowStepDef[]>(DEFAULT_FLOW_STEPS);
  const [templatesMap, setTemplatesMap] = useState<Record<string, ChecklistItem[]>>({});
  const [cardChecklist, setCardChecklist] = useState<Record<string, ChecklistItem[]>>({});
  const [selectedStages, setSelectedStages] = useState<string[]>([
    "review",
    "design",
    "dev",
    "test",
  ]);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [stageStatus, setStageStatus] = useState<
    Record<string, { state: StageRunStatus; msg: string }>
  >({});
  const [checklistBusy, setChecklistBusy] = useState(false);

  const [planDate, setPlanDate] = useState("");
  const [autoSetDate, setAutoSetDate] = useState(true);
  const [autoSetHandler, setAutoSetHandler] = useState(true);
  const [targetStatusId, setTargetStatusId] = useState<number>(140);
  const [flowStepState, setFlowStepState] = useState<
    Record<number, { state: StageRunStatus; msg: string }>
  >({});
  const [flowBusy, setFlowBusy] = useState(false);

  const [uatHandler, setUatHandler] = useState<HandlerDict>({
    userName: "",
    sex: 1,
    name: "",
    email: "",
    erp: "",
    orgTierCode: "",
    orgTierName: "",
    positionName: "",
    isLeader: false,
    type: 1,
    role: "member",
  });
  const [defaultDevHandler, setDefaultDevHandler] = useState<HandlerDict | null>(null);

  const [uploadedAttachments, setUploadedAttachments] = useState<
    Partial<Record<AttachmentType, UploadedAttachInfo>>
  >({});
  const [tagsOpen, setTagsOpen] = useState(false);

  const autoQueriedCodeRef = useRef<string>("");

  // Load constants and defaults from sidecar / settings
  useEffect(() => {
    let active = true;
    const initConsts = async () => {
      try {
        const [stgs, steps, tpls, defUat, defDev, calcDate] = await Promise.all([
          getConst<ChecklistStageDef[]>("CHECKLIST_STAGES").catch(() => DEFAULT_STAGES),
          getConst<FlowStepDef[]>("STATUS_FLOW_STEPS").catch(() => DEFAULT_FLOW_STEPS),
          getConst<Record<string, ChecklistItem[]>>("CHECKLIST_TEMPLATES").catch(
            () => ({}) as Record<string, ChecklistItem[]>,
          ),
          getConst<HandlerDict>("DEFAULT_UAT_HANDLER").catch(() => null),
          getConst<HandlerDict>("DEFAULT_DEV_HANDLER").catch(() => null),
          wtCall<[string, number, string]>("calculate_plan_test_date", { workdays: 2 }).catch(
            () => null,
          ),
        ]);
        if (!active) return;
        if (Array.isArray(stgs) && stgs.length) setStagesDef(stgs);
        if (Array.isArray(steps) && steps.length) setFlowStepsDef(steps);
        if (tpls && typeof tpls === "object") setTemplatesMap(tpls);
        if (defDev) setDefaultDevHandler(defDev);

        const cfgUat = settings?.worktime.uat_default_handler;
        if (cfgUat && typeof cfgUat === "object" && (cfgUat as HandlerDict).name) {
          setUatHandler((prev) => ({ ...prev, ...(cfgUat as Partial<HandlerDict>) }));
        } else if (defUat) {
          setUatHandler(defUat);
        }

        if (Array.isArray(calcDate) && calcDate.length >= 1) {
          const dStr = String(calcDate[2] || calcDate[0] || "");
          setPlanDate((prev) => prev || dStr);
        }
      } catch {
        // Constants already have clean fallback defaults
      }
    };
    initConsts();
    return () => {
      active = false;
    };
  }, [settings?.worktime.uat_default_handler]);

  const currentDevHandler = useMemo<HandlerDict | undefined>(() => {
    if (!user) return defaultDevHandler ?? undefined;
    const u = user.user;
    return {
      userName: user.realName || String(u.name || u.userName || ""),
      sex: 2,
      name: user.realName || String(u.name || u.userName || ""),
      email: String(u.email || defaultDevHandler?.email || ""),
      erp: String(u.userErp || u.erp || defaultDevHandler?.erp || ""),
      orgTierCode: String(
        defaultDevHandler?.orgTierCode ||
          "/00000000/00990000/00999900/00000071/00007160/00007164",
      ),
      orgTierName: String(u.org?.name || defaultDevHandler?.orgTierName || ""),
      positionName: String(defaultDevHandler?.positionName || "研发运维工程师"),
      isLeader: false,
      type: 1,
      role: "member",
    };
  }, [user, defaultDevHandler]);

  const applyChecklistSelectionsFromApi = (chkData: Record<string, ChecklistItem[]>) => {
    const unchecked: string[] = [];
    for (const s of stagesDef) {
      const items = Array.isArray(chkData[s.key]) ? chkData[s.key] : [];
      const doneCount = items.filter((it) => Number(it.checkResult) === 2).length;
      if (items.length === 0 || doneCount < items.length) {
        unchecked.push(s.key);
      }
    }
    setSelectedStages(unchecked.length > 0 ? unchecked : stagesDef.map((s) => s.key));
  };

  const handleQuery = async (overrideCode?: string) => {
    const raw = (overrideCode ?? codeInput).trim();
    if (!raw) {
      toast.error("请输入任务号或卡片 ID");
      return;
    }
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }

    setQuerying(true);
    try {
      const info = await wtCall<TaskSummary>("query_task_summary", { task_id: raw });
      let cid = Number(info?.card_id || 0);
      if (!cid || Number.isNaN(cid)) {
        cid = await wtCall<number>("resolve_card_id", { task_or_card_id: raw });
      }
      const normalized: TaskSummary = {
        ...info,
        card_id: cid,
        code: info?.code || raw,
        name: info?.name || "",
      };
      setSummary(normalized);
      if (normalized.plan_test_date_str) {
        setPlanDate(normalized.plan_test_date_str);
      }

      if (cid) {
        const chkRes = await wtCall<Record<string, ChecklistItem[]>>(
          "fetch_card_checklist_from_api",
          { card_id: cid },
        );
        if (chkRes && typeof chkRes === "object") {
          setCardChecklist(chkRes);
          applyChecklistSelectionsFromApi(chkRes);
        }
      }

      toast.success(`已获取卡片详情：${normalized.code} (#${cid})`);
    } catch (e) {
      toast.error(`查询任务失败: ${String(e)}`);
      pushLog(`❌ [流转页] 查询任务 [${raw}] 失败: ${String(e)}`);
    } finally {
      setQuerying(false);
    }
  };

  // Auto-prefill & query when jumped with `?code=`
  useEffect(() => {
    const qCode = (searchParams.get("code") || "").trim();
    if (qCode) {
      setCodeInput(qCode);
    }
    if (qCode && user && autoQueriedCodeRef.current !== qCode) {
      autoQueriedCodeRef.current = qCode;
      handleQuery(qCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, Boolean(user)]);

  const ensureCardId = async (): Promise<number> => {
    if (summary?.card_id) return summary.card_id;
    const raw = codeInput.trim();
    if (!raw) {
      throw new Error("请先在上方输入任务号或卡片 ID");
    }
    if (/^\d+$/.test(raw)) return Number(raw);
    const cid = await wtCall<number>("resolve_card_id", { task_or_card_id: raw });
    if (!cid) throw new Error(`未能将 [${raw}] 解析为有效卡片 ID`);
    return cid;
  };

  const handleSubmitChecklist = async () => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    if (selectedStages.length === 0) {
      toast.error("请至少勾选一个要提交的检查单阶段");
      return;
    }

    setChecklistBusy(true);
    setStageStatus({});
    try {
      const cid = await ensureCardId();
      const userErp = user.user.userErp || user.user.erp || "";
      const results = await wtCall<Record<string, { success: boolean; msg: string }>>(
        "execute_checklist_workflow",
        {
          card_id: cid,
          selected_stages: selectedStages,
          user_erp: userErp,
          user_name: user.realName || "",
        },
        (cbName, args) => {
          if (cbName === "status_cb" && args.length >= 3) {
            const skey = String(args[0] ?? "");
            const st = String(args[1] ?? "idle") as StageRunStatus;
            const msg = String(args[2] ?? "");
            setStageStatus((prev) => ({ ...prev, [skey]: { state: st, msg } }));
          }
        },
      );

      const vals = Object.values(results || {});
      const succ = vals.filter((r) => r?.success).length;
      const fail = vals.filter((r) => !r?.success).length;
      if (fail === 0 && succ > 0) {
        toast.success(`检查单提交完成：${succ} 个阶段全部成功`);
      } else {
        toast.warning(`检查单提交完成：成功 ${succ} 个，失败 ${fail} 个`);
      }

      const refreshed = await wtCall<Record<string, ChecklistItem[]>>(
        "fetch_card_checklist_from_api",
        { card_id: cid },
      ).catch(() => null);
      if (refreshed) {
        setCardChecklist(refreshed);
      }

      const taskCode = summary?.code || codeInput.trim();
      if (taskCode && !/^\d+$/.test(taskCode)) {
        await ensureLedgerTask(taskCode, summary?.name || taskCode);
        await appendTaskMd(
          taskCode,
          `- ${nowDateTimeStr()} 提交检查单 [${selectedStages.join(", ")}] -> 成功 ${succ}/${vals.length}`,
        );
      }
    } catch (e) {
      const msg = String(e);
      pushLog(`❌ 检查单提交异常: ${msg}`);
      toast.error(`提交检查单失败: ${msg}`);
    } finally {
      setChecklistBusy(false);
    }
  };

  const resolvePlanMs = async (dStr: string): Promise<number> => {
    const localMs = ymdToLocalMs(dStr);
    if (localMs !== undefined) return localMs;
    return wtCall<number>("date_str_to_ms", { date_str: dStr });
  };

  const handleSavePlanDate = async () => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    if (!planDate.trim()) {
      toast.error("请先选择计划提测日期");
      return;
    }
    setFlowBusy(true);
    try {
      const cid = await ensureCardId();
      const dateMs = await resolvePlanMs(planDate.trim());
      await wtCall("set_card_plan_test_date", { card_id: cid, date_ms: dateMs });

      const taskCode = summary?.code || codeInput.trim();
      if (taskCode && !/^\d+$/.test(taskCode)) {
        await ensureLedgerTask(taskCode, summary?.name || taskCode);
        await taskUpdate(taskCode, { planTestDate: planDate.trim() }).catch(() => {});
      }
      toast.success(`已设置计划提测日期为 ${planDate.trim()}`);
      await handleQuery(summary?.code || codeInput);
    } catch (e) {
      toast.error(`保存计划提测日期失败: ${String(e)}`);
    } finally {
      setFlowBusy(false);
    }
  };

  const handleSaveDefaultUat = async () => {
    if (!settings) return;
    try {
      await saveSettings({
        ...settings,
        worktime: {
          ...settings.worktime,
          uat_default_handler: uatHandler,
        },
      });
      toast.success(`默认 UAT 验收人已保存：${uatHandler.name}`);
    } catch (e) {
      toast.error(`保存默认验收人失败: ${String(e)}`);
    }
  };

  const handleChangeHandler = async () => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    if (!uatHandler.name || !uatHandler.erp) {
      toast.error("请先从成员列表选择或完整填写经办人姓名及 ERP");
      return;
    }
    setFlowBusy(true);
    try {
      const cid = await ensureCardId();
      await wtCall("set_card_handler", { card_id: cid, handler: uatHandler });
      toast.success(`卡片 [${cid}] 经办人已变更为 ${uatHandler.name}`);
      await handleQuery(summary?.code || codeInput);
    } catch (e) {
      toast.error(`变更经办人失败: ${String(e)}`);
    } finally {
      setFlowBusy(false);
    }
  };

  const syncLedgerOnFlowSuccess = async (reachedSid: number, label: string) => {
    const taskCode = summary?.code || codeInput.trim();
    if (!taskCode || /^\d+$/.test(taskCode)) return;
    await ensureLedgerTask(taskCode, summary?.name || taskCode);
    if (reachedSid >= 110) {
      await taskUpdate(taskCode, { status: "已提测" }).catch(() => {});
    }
    await appendTaskMd(taskCode, `- ${nowDateTimeStr()} ${label}`);
  };

  const handleSingleStepFlow = async (step: FlowStepDef) => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    setFlowBusy(true);
    setFlowStepState((prev) => ({
      ...prev,
      [step.id]: { state: "running", msg: `正在流转至 ${step.name}...` },
    }));

    try {
      const cid = await ensureCardId();
      if ((step.id === 70 || step.id === 90) && autoSetDate && planDate.trim()) {
        try {
          const dateMs = await resolvePlanMs(planDate.trim());
          await wtCall("set_card_plan_test_date", { card_id: cid, date_ms: dateMs });
        } catch (de) {
          pushLog(`⚠️ 前置设置计划提测日期提示: ${String(de)}`);
        }
      }

      const useHandler = step.id === 140 ? uatHandler : currentDevHandler;
      await wtCall("flow_card_status", {
        card_id: cid,
        target_status_id: step.id,
        handler: useHandler,
        dev_handler: currentDevHandler,
      });

      if (step.id === 140 && autoSetHandler && uatHandler.erp) {
        await wtCall("set_card_handler", { card_id: cid, handler: uatHandler });
      }

      setFlowStepState((prev) => ({
        ...prev,
        [step.id]: { state: "success", msg: `已流转至【${step.name}】` },
      }));
      await syncLedgerOnFlowSuccess(step.id, `单步流转至【${step.name} (${step.id})】`);
      toast.success(`卡片 [${cid}] 已流转至【${step.name}】`);
      await handleQuery(summary?.code || codeInput);
    } catch (e) {
      const msg = String(e);
      setFlowStepState((prev) => ({
        ...prev,
        [step.id]: { state: "fail", msg },
      }));
      toast.error(`流转至【${step.name}】失败: ${msg}`);
    } finally {
      setFlowBusy(false);
    }
  };

  const handlePipelineFlow = async () => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    setFlowBusy(true);
    setFlowStepState({});

    try {
      const cid = await ensureCardId();
      const dateMs = planDate.trim() ? await resolvePlanMs(planDate.trim()) : undefined;
      const res = await wtCall<{
        skipped?: boolean;
        message?: string;
        [sid: string]: unknown;
      }>(
        "execute_status_flow_pipeline",
        {
          card_id: cid,
          target_status_id: targetStatusId,
          plan_date_ms: dateMs,
          uat_handler: uatHandler,
          dev_handler: currentDevHandler,
          current_status_id: summary?.card_status_id ?? undefined,
          auto_set_date: autoSetDate,
          auto_set_handler: autoSetHandler,
          rd_file_info: uploadedAttachments.dev,
          prod_file_info: uploadedAttachments.design,
        },
        (cbName, args) => {
          if (cbName === "step_cb" && args.length >= 3) {
            const sid = Number(args[0]);
            const st = String(args[1] ?? "idle") as StageRunStatus;
            const msg = String(args[2] ?? "");
            setFlowStepState((prev) => ({ ...prev, [sid]: { state: st, msg } }));
          }
        },
      );

      if (res?.skipped) {
        toast.info(res.message || "当前状态已达到或超越目标状态");
      } else {
        const tgtName =
          flowStepsDef.find((s) => s.id === targetStatusId)?.name || String(targetStatusId);
        const stepEntry = res?.[String(targetStatusId)] as
          | { success?: boolean; error?: string }
          | undefined;
        if (stepEntry && stepEntry.success === false) {
          toast.warning(`流水线在【${tgtName}】前停止：${stepEntry.error || "请查看日志"}`);
        } else {
          toast.success(`状态流转流水线执行完成！`);
          await syncLedgerOnFlowSuccess(
            targetStatusId,
            `流水线流转至【${tgtName} (${targetStatusId})】`,
          );
        }
      }
      await handleQuery(summary?.code || codeInput);
    } catch (e) {
      toast.error(`流水线流转失败: ${String(e)}`);
    } finally {
      setFlowBusy(false);
    }
  };

  const handleStop = async () => {
    try {
      await api.wtStop();
      toast.info("已发送中止信号，将在当前步骤完成后停止");
    } catch (e) {
      toast.error(String(e));
    }
  };

  const targetRefStr = summary?.code || codeInput.trim() || String(summary?.card_id || "");

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">任务流转与检查单</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            查询任务卡片状态、批量提交阶段检查单、上传并绑定研发/设计/测试附件、执行状态流转流水线与打标签。
          </p>
        </div>
        {summary && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!user}
              onClick={() => setTagsOpen(true)}
              className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              <Tag className="h-3.5 w-3.5" />
              <span>打标签</span>
            </button>
            <button
              type="button"
              onClick={() =>
                api
                  .taskOpenFolder(summary.code)
                  .catch((e) => toast.error(`打开文件夹失败: ${String(e)}`))
              }
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              <FolderOpen className="h-3.5 w-3.5 text-amber-600" />
              <span>打开任务文件夹</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`/work/task/${encodeURIComponent(summary.code)}`)}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              <FileEdit className="h-3.5 w-3.5 text-emerald-600" />
              <span>编辑需求描述</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`/work/branch?code=${encodeURIComponent(summary.code)}`)}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              <GitBranch className="h-3.5 w-3.5 text-violet-600" />
              <span>创建分支</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`/work/mr?code=${encodeURIComponent(summary.code)}`)}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              <GitMerge className="h-3.5 w-3.5 text-pink-600" />
              <span>提交 MR</span>
            </button>
          </div>
        )}
      </div>

      {!user && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>当前未连接 DevOps，请先在左下角登录后执行查询、检查单提交、附件绑定与状态流转。</span>
        </div>
      )}

      {/* 任务查询与摘要区 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && user && !querying) handleQuery();
            }}
            placeholder="输入任务号 (如 TASK-0001) 或数字卡片 ID..."
            className="min-w-[260px] flex-1 rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={!user || querying || checklistBusy || flowBusy}
            onClick={() => handleQuery()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {querying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            <span>{querying ? "查询中..." : "查询详情"}</span>
          </button>
        </div>

        {summary && (
          <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-blue-100 px-2 py-0.5 font-mono font-semibold text-blue-800">
                {summary.code}
              </span>
              <span className="font-semibold text-gray-900">{summary.name}</span>
              <span className="font-mono text-[11px] text-gray-500">
                (CardID: {summary.card_id})
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-600">
              <span>
                当前状态：
                <strong className="text-emerald-700">
                  {summary.status_name || "-"} (ID: {summary.card_status_id ?? "-"})
                </strong>
              </span>
              <span>
                当前经办人：<strong className="text-gray-800">{summary.handler_name || "-"}</strong>
              </span>
              <span>
                计划提测日：
                <strong className="text-gray-800">{summary.plan_test_date_str || "未设置"}</strong>
              </span>
              <span>
                所属迭代：<strong className="text-gray-800">{summary.sprint || "-"}</strong>
              </span>
              <span>
                类型：<strong className="text-gray-800">{summary.type || "-"}</strong>
              </span>
            </div>
          </div>
        )}
      </section>

      {/* 检查单批量提交区 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-900">阶段检查单</h2>
            <span className="text-xs text-gray-400">
              (先获取卡片原生检查项再更新 checkResult=2，不产生重复项)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedStages(stagesDef.map((s) => s.key))}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              全选阶段
            </button>
            <button
              type="button"
              onClick={() => setStageStatus({})}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
            >
              <RotateCcw className="h-3 w-3" />
              <span>重置状态</span>
            </button>
            {checklistBusy && (
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>中止</span>
              </button>
            )}
            <button
              type="button"
              disabled={!user || checklistBusy}
              onClick={handleSubmitChecklist}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checklistBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span>{checklistBusy ? "正在依次提交..." : "依次提交检查单"}</span>
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {stagesDef.map((stg) => {
            const checked = selectedStages.includes(stg.key);
            const nativeItems = cardChecklist[stg.key] || [];
            const tplItems = templatesMap[stg.key] || [];
            const displayItems = nativeItems.length > 0 ? nativeItems : tplItems;
            const doneCnt = nativeItems.filter((it) => Number(it.checkResult) === 2).length;
            const runInfo = stageStatus[stg.key];
            const isExpanded = expandedStage === stg.key;

            return (
              <div
                key={stg.key}
                className={`rounded-xl border p-3 transition ${
                  checked ? "border-blue-200 bg-blue-50/30" : "border-gray-200 bg-gray-50/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <label className="flex cursor-pointer items-start gap-2.5 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={checklistBusy}
                      onChange={() =>
                        setSelectedStages((prev) =>
                          prev.includes(stg.key)
                            ? prev.filter((k) => k !== stg.key)
                            : [...prev, stg.key],
                        )
                      }
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
                    />
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-gray-900">
                        <span>{stg.name}阶段</span>
                        <span className="font-mono text-[10px] text-gray-400">
                          stageId:{stg.stageId}
                        </span>
                        {nativeItems.length > 0 && (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                              doneCnt === nativeItems.length
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            已查 {doneCnt}/{nativeItems.length}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-gray-500">{stg.desc}</p>
                    </div>
                  </label>

                  <button
                    type="button"
                    onClick={() => setExpandedStage(isExpanded ? null : stg.key)}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    <span>明细 ({displayItems.length || stg.count})</span>
                  </button>
                </div>

                {runInfo && (
                  <div
                    className={`mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] ${
                      runInfo.state === "success"
                        ? "bg-emerald-100 text-emerald-800"
                        : runInfo.state === "fail"
                          ? "bg-red-100 text-red-800"
                          : runInfo.state === "running"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {runInfo.state === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                    {runInfo.state === "success" && <CheckCircle2 className="h-3 w-3" />}
                    {runInfo.state === "fail" && <XCircle className="h-3 w-3" />}
                    <span className="truncate">{runInfo.msg}</span>
                  </div>
                )}

                {isExpanded && (
                  <div className="mt-2.5 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 text-[11px]">
                    {displayItems.length === 0 ? (
                      <div className="py-2 text-center text-gray-400">暂无模板明细</div>
                    ) : (
                      displayItems.map((it, i) => (
                        <div
                          key={`${stg.key}-${it.checkId ?? i}`}
                          className="flex items-start justify-between gap-2 border-b border-gray-100 py-1 last:border-0"
                        >
                          <span className="text-gray-700">
                            <span className="mr-1 font-mono text-gray-400">
                              #{it.checkId ?? i + 1}
                            </span>
                            {it.checkPointName && (
                              <span className="mr-1 font-medium text-gray-900">
                                [{it.checkPointName}]
                              </span>
                            )}
                            {it.checkContent}
                          </span>
                          {nativeItems.length > 0 && (
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                                Number(it.checkResult) === 2
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {Number(it.checkResult) === 2 ? "已查" : "待查"}
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 附件上传与卡片绑定 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              需求 / 研发 / 测试附件上传与卡片绑定
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              上传文件后自动调用 bindingAttach 绑定当前卡片，确保原页面展示并满足流转至「测试审核 (110)」的前置校验。
            </p>
          </div>
          <span className="font-mono text-[11px] text-gray-500">
            目标：{targetRefStr || "未指定卡片"}
          </span>
        </div>
        <AttachmentUploader
          cardIdOrCode={targetRefStr}
          onDone={(attType, info) =>
            setUploadedAttachments((prev) => ({ ...prev, [attType]: info }))
          }
        />
      </section>

      {/* 状态流转流水线 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-gray-900">任务状态流转流水线</h2>
          </div>
          {flowBusy && (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <Square className="h-3 w-3 fill-current" />
              <span>中止流转</span>
            </button>
          )}
        </div>

        {/* 7 步流程指示器 + 单步操作 */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-7">
          {flowStepsDef.map((step) => {
            const isCurrent = summary?.card_status_id === step.id;
            const stepRun = flowStepState[step.id];
            return (
              <div
                key={step.id}
                className={`flex flex-col justify-between rounded-xl border p-2.5 text-xs transition ${
                  stepRun?.state === "success"
                    ? "border-emerald-300 bg-emerald-50/70"
                    : stepRun?.state === "fail"
                      ? "border-red-300 bg-red-50/70"
                      : stepRun?.state === "running"
                        ? "border-blue-400 bg-blue-50/70"
                        : isCurrent
                          ? "border-indigo-400 bg-indigo-50/70 shadow-xs"
                          : "border-gray-200 bg-gray-50/50"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-gray-900">{step.name}</span>
                    <span className="font-mono text-[10px] text-gray-400">{step.id}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10px] text-gray-500" title={step.desc}>
                    {step.desc}
                  </p>
                  {isCurrent && (
                    <span className="mt-1.5 inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                      当前状态
                    </span>
                  )}
                  {stepRun && (
                    <div className="mt-1 truncate text-[10px] font-medium text-gray-700" title={stepRun.msg}>
                      {stepRun.msg}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!user || flowBusy}
                  onClick={() => handleSingleStepFlow(step)}
                  className="mt-2.5 w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-40"
                >
                  流转到 {step.name}
                </button>
              </div>
            );
          })}
        </div>

        {/* 提测日期与经办人配置 + 一键流水线执行 */}
        <div className="mt-5 grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4 md:grid-cols-2">
          <div className="space-y-2.5 text-xs">
            <div className="font-semibold text-gray-800">计划提测日期 (dateKey1)</div>
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker
                value={planDate}
                onChange={setPlanDate}
                size="sm"
                clearable
                placeholder="选择计划提测日期"
              />
              <button
                type="button"
                disabled={!user || flowBusy}
                onClick={handleSavePlanDate}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                <CalendarCheck className="h-3.5 w-3.5 text-blue-600" />
                <span>保存计划提测日期</span>
              </button>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-gray-600">
              <input
                type="checkbox"
                checked={autoSetDate}
                onChange={(e) => setAutoSetDate(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
              />
              <span>流转到「开发 (70)/开发自测 (90)」前自动提交提测日期</span>
            </label>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="font-semibold text-gray-800">
              UAT 验收人 / 经办人
              {uatHandler.erp && (
                <span className="ml-2 font-mono text-[11px] font-normal text-gray-500">
                  ERP: {uatHandler.erp}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MemberSelect
                value={uatHandler.name}
                disabled={flowBusy}
                onChange={(name) =>
                  setUatHandler((prev) => ({ ...prev, name, userName: name }))
                }
                onPick={(m) => setUatHandler((prev) => buildHandlerFromMember(m, prev))}
                placeholder="选择 UAT 验收人..."
                className="min-w-[190px] flex-1"
              />
              <button
                type="button"
                disabled={!user || flowBusy}
                onClick={handleChangeHandler}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>变更经办人</span>
              </button>
              <button
                type="button"
                onClick={handleSaveDefaultUat}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100"
              >
                <Save className="h-3.5 w-3.5 text-indigo-600" />
                <span>设为默认验收人</span>
              </button>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-gray-600">
              <input
                type="checkbox"
                checked={autoSetHandler}
                onChange={(e) => setAutoSetHandler(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
              />
              <span>流转至「UAT验收 (140)」后自动转经办人为上方人员</span>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <label className="flex items-center gap-2 text-xs">
            <span className="font-medium text-gray-700">一键流水线目标状态：</span>
            <select
              value={targetStatusId}
              disabled={flowBusy}
              onChange={(e) => setTargetStatusId(Number(e.target.value))}
              className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            >
              {flowStepsDef.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={!user || flowBusy}
            onClick={handlePipelineFlow}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {flowBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Workflow className="h-3.5 w-3.5" />
            )}
            <span>{flowBusy ? "流水线流转中..." : "一键流转到目标状态"}</span>
          </button>
        </div>
      </section>

      <TagsDialog
        open={tagsOpen}
        cardIdOrCode={summary?.card_id || codeInput}
        onClose={() => setTagsOpen(false)}
      />
    </div>
  );
}
