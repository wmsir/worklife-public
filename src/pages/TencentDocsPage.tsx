import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileUp,
  History,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  StickyNote,
  Table2,
  Trash2,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { confirmDialog } from "../components/ConfirmDialog";
import { api } from "../lib/api";
import { formatIsoTimeZh } from "../lib/date";
import type {
  JournalSummary,
  McpConnectionTestResult,
  McpToolInfo,
  SmartsheetWebhookProfile,
  TencentDocPublishRecord,
  TencentDocsConfig,
  WebhookFieldMapping,
  WebhookFieldValueType,
  WebhookPayloadMode,
  WebhookPushResult,
  WeeklyReportSummary,
} from "../lib/types";
import { useShallow } from "zustand/react/shallow";
import { sendWechat } from "../lib/wtx";
import { useAppStore } from "../store/appStore";

const MCP_AUTH_URL = "https://docs.qq.com/open/auth/mcp.html";
const OPEN_API_DOC_URL = "https://docs.qq.com/open/document/app/openapi/v2";

const TASK_SOURCE_OPTIONS = [
  { key: "code", label: "任务号 (code)" },
  { key: "name", label: "需求名称 (name)" },
  { key: "status", label: "状态 (status)" },
  { key: "sprint", label: "所属迭代 (sprint)" },
  { key: "startDate", label: "开始日期 (startDate)" },
  { key: "planTestDate", label: "计划提测 (planTestDate)" },
  { key: "releaseDate", label: "发版日期 (releaseDate)" },
  { key: "branch", label: "代码分支 (branch)" },
  { key: "repos", label: "代码仓库 (repos)" },
];

function guessTaskSourceKey(fieldName: string): string {
  const s = fieldName.toLowerCase();
  if (s.includes("code") || s.includes("任务号") || s.includes("编号")) return "code";
  if (s.includes("name") || s.includes("title") || s.includes("需求") || s.includes("标题"))
    return "name";
  if (s.includes("status") || s.includes("状态")) return "status";
  if (s.includes("sprint") || s.includes("迭代")) return "sprint";
  if (s.includes("start") || s.includes("开始")) return "startDate";
  if (s.includes("test") || s.includes("提测")) return "planTestDate";
  if (s.includes("release") || s.includes("发版") || s.includes("上线")) return "releaseDate";
  if (s.includes("branch") || s.includes("分支")) return "branch";
  if (s.includes("repo") || s.includes("仓库") || s.includes("工程")) return "repos";
  return "";
}

function inferFieldTypeFromSample(val: unknown, key: string): WebhookFieldValueType {
  if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && val[0] !== null) {
    return "text_rich";
  }
  if (typeof val === "number") return "number";
  if (typeof val === "boolean") return "checkbox";
  const kl = key.toLowerCase();
  if (kl.includes("日期") || kl.includes("date") || kl.includes("time")) return "date";
  return "text";
}

function parseTencentSampleJson(raw: string): {
  mode: WebhookPayloadMode;
  fields: WebhookFieldMapping[];
} {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("示例 JSON 顶层必须是对象");
  }
  const obj = parsed as Record<string, unknown>;
  let mode: WebhookPayloadMode = "raw_object";
  let valuesObj: Record<string, unknown> = obj;

  if (Array.isArray(obj.add_records) && obj.add_records.length > 0) {
    mode = "add_records";
    const first = obj.add_records[0] as Record<string, unknown> | undefined;
    if (first && typeof first.values === "object" && first.values && !Array.isArray(first.values)) {
      valuesObj = first.values as Record<string, unknown>;
    }
  } else if (obj.fields && typeof obj.fields === "object" && !Array.isArray(obj.fields)) {
    mode = "fields";
    valuesObj = obj.fields as Record<string, unknown>;
  }

  const fields: WebhookFieldMapping[] = Object.entries(valuesObj).map(([k, v]) => ({
    fieldKey: k,
    label: k,
    sourceKey: guessTaskSourceKey(k),
    valueType: inferFieldTypeFromSample(v, k),
    defaultValue: "",
  }));

  if (fields.length === 0) {
    throw new Error("未能从示例 JSON 中识别出任何字段键");
  }
  return { mode, fields };
}

function buildSkeletonArgs(tool: McpToolInfo): Record<string, unknown> {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string; default?: unknown; description?: string }>;
    required?: string[];
  };
  const props = schema?.properties;
  if (!props || typeof props !== "object") return {};
  const requiredSet = new Set(schema.required ?? []);
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(props)) {
    if (!requiredSet.has(k) && Object.keys(props).length > 4) continue;
    if (def?.default !== undefined) {
      out[k] = def.default;
    } else if (def?.type === "number" || def?.type === "integer") {
      out[k] = 0;
    } else if (def?.type === "boolean") {
      out[k] = false;
    } else if (def?.type === "array") {
      out[k] = [];
    } else if (def?.type === "object") {
      out[k] = {};
    } else {
      out[k] = "";
    }
  }
  return out;
}

export function TencentDocsPage() {
  const { tasks, notes } = useAppStore(
    useShallow((s) => ({
      tasks: s.tasks,
      notes: s.notes,
    })),
  );

  const [cfg, setCfg] = useState<TencentDocsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);

  const [tab, setTab] = useState<"doc" | "sheet" | "mcp" | "history">("doc");

  // Tab 1: Publish Markdown Doc
  const [docTitle, setDocTitle] = useState("");
  const [docParentId, setDocParentId] = useState("");
  const [docMarkdown, setDocMarkdown] = useState(
    "# 工作同步文档\n\n- 支持标题、列表、表格与代码块\n- 一键推送生成腾讯在线智能文档并生成分享链接",
  );
  const [docPreview, setDocPreview] = useState(false);
  const deferredDocMarkdown = useDeferredValue(docMarkdown);
  const [publishingDoc, setPublishingDoc] = useState(false);
  const [lastDocRec, setLastDocRec] = useState<TencentDocPublishRecord | null>(null);

  const [weeklyList, setWeeklyList] = useState<WeeklyReportSummary[]>([]);
  const [journalList, setJournalList] = useState<JournalSummary[]>([]);
  const [selectedImportType, setSelectedImportType] = useState<
    "weekly" | "task" | "note" | "journal"
  >("weekly");
  const [selectedImportId, setSelectedImportId] = useState("");

  // Tab 2: Smartsheet Webhook
  const [selectedWhId, setSelectedWhId] = useState<string>("");
  const [whSubMode, setWhSubMode] = useState<"tasks" | "custom">("tasks");
  const [selectedTaskCodes, setSelectedTaskCodes] = useState<string[]>([]);
  const [taskFilterStatus, setTaskFilterStatus] = useState("all");
  const [taskKeyword, setTaskKeyword] = useState("");
  const [customRowValues, setCustomRowValues] = useState<Record<string, string>>({});
  const [pushingWh, setPushingWh] = useState(false);
  const [lastWhRes, setLastWhRes] = useState<WebhookPushResult | null>(null);

  // Webhook Profile Modal
  const [whModalOpen, setWhModalOpen] = useState(false);
  const [whDraft, setWhDraft] = useState<SmartsheetWebhookProfile | null>(null);
  const [sampleJsonOpen, setSampleJsonOpen] = useState(false);
  const [sampleJsonText, setSampleJsonText] = useState("");
  const [savingWh, setSavingWh] = useState(false);

  // Tab 3: MCP Config & Tools
  const [showToken, setShowToken] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testingMcp, setTestingMcp] = useState(false);
  const [mcpTestRes, setMcpTestRes] = useState<McpConnectionTestResult | null>(null);
  const [toolFilter, setToolFilter] = useState("");
  const [activeTool, setActiveTool] = useState<McpToolInfo | null>(null);
  const [toolArgsJson, setToolArgsJson] = useState("{}");
  const [runningTool, setRunningTool] = useState(false);
  const [toolOutput, setToolOutput] = useState<string>("");
  const [toolDocUrl, setToolDocUrl] = useState<string>("");

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingWechatId, setSendingWechatId] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [c, wl, jl] = await Promise.all([
        api.getTencentDocsConfig(),
        api.listWeeklyReports().catch(() => [] as WeeklyReportSummary[]),
        api.listJournals().catch(() => [] as JournalSummary[]),
      ]);
      setCfg(c);
      setDocParentId(c.defaultParentId || "");
      setWeeklyList(wl);
      setJournalList(jl);
      if (c.webhooks.length > 0) {
        setSelectedWhId((prev) =>
          c.webhooks.some((w) => w.id === prev) ? prev : c.webhooks[0].id,
        );
      } else {
        setSelectedWhId("");
      }
      if (!c.mcpToken.trim() && c.webhooks.length > 0) {
        setTab("sheet");
      }
    } catch (e) {
      toast.error(`加载腾讯文档配置失败: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const selectedWebhook = useMemo(
    () => cfg?.webhooks.find((w) => w.id === selectedWhId) ?? null,
    [cfg, selectedWhId],
  );

  useEffect(() => {
    if (!selectedWebhook) return;
    const init: Record<string, string> = {};
    for (const f of selectedWebhook.fields) {
      init[f.fieldKey] = f.defaultValue || "";
    }
    setCustomRowValues(init);
    setLastWhRes(null);
  }, [selectedWebhook?.id]);

  const filteredTasks = useMemo(() => {
    const q = taskKeyword.trim().toLowerCase();
    return tasks.filter((t) => {
      if (taskFilterStatus !== "all" && t.status !== taskFilterStatus) return false;
      if (!q) return true;
      return (
        t.code.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.sprint.toLowerCase().includes(q)
      );
    });
  }, [tasks, taskFilterStatus, taskKeyword]);

  const filteredTools = useMemo(() => {
    const list = mcpTestRes?.tools ?? [];
    const q = toolFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [mcpTestRes, toolFilter]);

  if (loading || !cfg) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        <span>正在加载腾讯文档自动化中心...</span>
      </div>
    );
  }

  const refreshConfigOnly = async () => {
    const next = await api.getTencentDocsConfig();
    setCfg(next);
    return next;
  };

  const handleCopy = async (id: string, text: string, label = "链接") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success(`已复制${label}`);
      setTimeout(() => {
        setCopiedId((p) => (p === id ? null : p));
      }, 1600);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleShareWechat = async (id: string, title: string, url: string, kind: string) => {
    setSendingWechatId(id);
    try {
      const content = [
        `### 🔗 腾讯文档分享：${title}`,
        `* **通道**: ${kind}`,
        url ? `* **在线访问**: [点击打开腾讯文档](${url})\n  ${url}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const [ok, msg] = await sendWechat(content);
      if (ok) toast.success("已将腾讯文档链接推送到企业微信");
      else toast.error(`推送失败: ${msg}`);
    } catch (e) {
      toast.error(`推送异常: ${String(e)}`);
    } finally {
      setSendingWechatId(null);
    }
  };

  const handleImportSource = async () => {
    if (!selectedImportId) {
      toast.error("请先在下拉框中选择要载入的内容");
      return;
    }
    try {
      if (selectedImportType === "weekly") {
        const md = await api.readWeeklyReport(selectedImportId);
        setDocTitle(`研发工作周报 · ${selectedImportId}`);
        setDocMarkdown(md);
        toast.success(`已载入周报 ${selectedImportId}`);
      } else if (selectedImportType === "task") {
        const task = tasks.find((t) => t.code === selectedImportId);
        const md = await api.taskReadMd(selectedImportId);
        setDocTitle(
          task ? `${task.code}-${task.name || "需求说明"}` : selectedImportId,
        );
        setDocMarkdown(md);
        toast.success(`已载入任务 [${selectedImportId}] 需求描述.md`);
      } else if (selectedImportType === "note") {
        const note = notes.find((n) => n.id === selectedImportId);
        if (note) {
          setDocTitle(note.title);
          setDocMarkdown(
            note.kind === "snippet"
              ? `\`\`\`${note.language || ""}\n${note.content}\n\`\`\``
              : note.content,
          );
          toast.success(`已载入便签「${note.title}」`);
        }
      } else if (selectedImportType === "journal") {
        const entry = await api.readJournal(selectedImportId);
        setDocTitle(`个人日记复盘 · ${entry.date}`);
        setDocMarkdown(entry.content);
        toast.success(`已载入 ${entry.date} 日记`);
      }
    } catch (e) {
      toast.error(`载入内容失败: ${String(e)}`);
    }
  };

  const handlePublishDoc = async () => {
    if (!docTitle.trim()) {
      toast.error("请输入文档标题");
      return;
    }
    if (!docMarkdown.trim()) {
      toast.error("请输入或载入 Markdown 内容");
      return;
    }
    setPublishingDoc(true);
    try {
      const rec = await api.publishMarkdownToTencentDoc({
        title: docTitle.trim(),
        markdown: docMarkdown,
        parentId: docParentId.trim() || null,
        sourceLabel: "腾讯文档中心",
      });
      setLastDocRec(rec);
      await refreshConfigOnly();
      toast.success("已成功生成腾讯在线智能文档");
    } catch (e) {
      await refreshConfigOnly().catch(() => {});
      toast.error(String(e));
    } finally {
      setPublishingDoc(false);
    }
  };

  const openNewWebhookModal = () => {
    setSampleJsonOpen(false);
    setSampleJsonText("");
    setWhDraft({
      id: "",
      name: "",
      webhookUrl: "",
      shareUrl: "",
      payloadMode: "add_records",
      fields: [
        {
          fieldKey: "任务号",
          label: "任务号",
          sourceKey: "code",
          valueType: "text_rich",
          defaultValue: "",
        },
        {
          fieldKey: "需求名称",
          label: "需求名称",
          sourceKey: "name",
          valueType: "text_rich",
          defaultValue: "",
        },
        {
          fieldKey: "当前状态",
          label: "当前状态",
          sourceKey: "status",
          valueType: "text",
          defaultValue: "",
        },
        {
          fieldKey: "开始日期",
          label: "开始日期",
          sourceKey: "startDate",
          valueType: "date",
          defaultValue: "",
        },
        {
          fieldKey: "发版日期",
          label: "发版日期",
          sourceKey: "releaseDate",
          valueType: "date",
          defaultValue: "",
        },
      ],
      createdAt: "",
    });
    setWhModalOpen(true);
  };

  const openEditWebhookModal = (profile: SmartsheetWebhookProfile) => {
    setSampleJsonOpen(false);
    setSampleJsonText("");
    setWhDraft(JSON.parse(JSON.stringify(profile)) as SmartsheetWebhookProfile);
    setWhModalOpen(true);
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whDraft) return;
    setSavingWh(true);
    try {
      const next = await api.upsertSmartsheetWebhook(whDraft);
      setCfg(next);
      const picked =
        (whDraft.id && next.webhooks.find((w) => w.id === whDraft.id)) ||
        next.webhooks[next.webhooks.length - 1];
      if (picked) setSelectedWhId(picked.id);
      setWhModalOpen(false);
      toast.success("智能表格 Webhook 模板已保存");
    } catch (err) {
      toast.error(`保存模板失败: ${String(err)}`);
    } finally {
      setSavingWh(false);
    }
  };

  const handleDeleteWebhook = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `确定删除智能表格模板「${name}」吗？`,
      description: "不会影响腾讯文档线上已有数据。",
      confirmText: "删除模板",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const next = await api.deleteSmartsheetWebhook(id);
      setCfg(next);
      if (selectedWhId === id) {
        setSelectedWhId(next.webhooks[0]?.id ?? "");
      }
      toast.success("已删除模板");
    } catch (err) {
      toast.error(`删除失败: ${String(err)}`);
    }
  };

  const handleParseSampleIntoDraft = () => {
    if (!whDraft || !sampleJsonText.trim()) {
      toast.error("请先粘贴腾讯智能表格「接收外部数据」提供的示例 JSON");
      return;
    }
    try {
      const { mode, fields } = parseTencentSampleJson(sampleJsonText);
      setWhDraft({
        ...whDraft,
        payloadMode: mode,
        fields,
      });
      setSampleJsonOpen(false);
      toast.success(`已自动识别 ${fields.length} 个字段（模式：${mode}）`);
    } catch (e) {
      toast.error(`示例 JSON 解析失败: ${String(e)}`);
    }
  };

  const handlePushTasksWebhook = async () => {
    if (!selectedWebhook) return;
    const chosen = tasks.filter((t) => selectedTaskCodes.includes(t.code));
    if (chosen.length === 0) {
      toast.error("请至少勾选 1 个离线任务");
      return;
    }
    setPushingWh(true);
    try {
      const rows = chosen.map((t) => ({
        code: t.code,
        name: t.name,
        status: t.status,
        sprint: t.sprint,
        startDate: t.startDate,
        planTestDate: t.planTestDate,
        releaseDate: t.releaseDate,
        branch: t.branch,
        repos: t.repos,
      }));
      const res = await api.pushSmartsheetWebhook(
        selectedWebhook.id,
        rows,
        "任务台账批量填报",
      );
      setLastWhRes(res);
      await refreshConfigOnly();
      toast.success(res.record.message);
    } catch (e) {
      await refreshConfigOnly().catch(() => {});
      toast.error(String(e));
    } finally {
      setPushingWh(false);
    }
  };

  const handlePushCustomRowWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWebhook) return;
    setPushingWh(true);
    try {
      const row: Record<string, unknown> = { ...customRowValues };
      const res = await api.pushSmartsheetWebhook(
        selectedWebhook.id,
        [row],
        "自定义表单填报",
      );
      setLastWhRes(res);
      await refreshConfigOnly();
      toast.success(res.record.message);
    } catch (err) {
      await refreshConfigOnly().catch(() => {});
      toast.error(String(err));
    } finally {
      setPushingWh(false);
    }
  };

  const handleSaveMcpConfig = async () => {
    setSavingCfg(true);
    try {
      const saved = await api.saveTencentDocsConfig(cfg);
      setCfg(saved);
      toast.success("腾讯文档 MCP 配置已保存");
    } catch (e) {
      toast.error(`保存失败: ${String(e)}`);
    } finally {
      setSavingCfg(false);
    }
  };

  const handleTestMcp = async () => {
    setTestingMcp(true);
    try {
      const saved = await api.saveTencentDocsConfig(cfg);
      setCfg(saved);
      const res = await api.testTencentMcpConnection(saved.mcpUrl, saved.mcpToken);
      setMcpTestRes(res);
      if (res.ok) {
        toast.success(res.message);
        if (res.tools.length > 0 && !activeTool) {
          const t0 =
            res.tools.find((t) => t.name === saved.preferredDocTool) ?? res.tools[0];
          setActiveTool(t0);
          setToolArgsJson(JSON.stringify(buildSkeletonArgs(t0), null, 2));
        }
      } else {
        toast.error(res.message);
      }
    } catch (e) {
      toast.error(`测试失败: ${String(e)}`);
    } finally {
      setTestingMcp(false);
    }
  };

  const handleRunMcpTool = async () => {
    if (!activeTool) return;
    let parsedArgs: Record<string, unknown> = {};
    try {
      const raw = JSON.parse(toolArgsJson.trim() || "{}") as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("参数必须是 JSON 对象");
      }
      parsedArgs = raw as Record<string, unknown>;
    } catch (e) {
      toast.error(`工具参数 JSON 格式无效: ${String(e)}`);
      return;
    }

    setRunningTool(true);
    try {
      const res = await api.callTencentMcpTool(
        activeTool.name,
        parsedArgs,
        "MCP 全能工具台",
      );
      setToolOutput(JSON.stringify(res.rawResult, null, 2));
      setToolDocUrl(res.record.docUrl || "");
      await refreshConfigOnly();
      toast.success(`MCP 工具 [${activeTool.name}] 执行成功`);
    } catch (e) {
      await refreshConfigOnly().catch(() => {});
      toast.error(String(e));
    } finally {
      setRunningTool(false);
    }
  };

  const toggleAllVisibleTasks = () => {
    const visibleCodes = filteredTasks.map((t) => t.code);
    const allSelected =
      visibleCodes.length > 0 &&
      visibleCodes.every((c) => selectedTaskCodes.includes(c));
    if (allSelected) {
      setSelectedTaskCodes((prev) => prev.filter((c) => !visibleCodes.includes(c)));
    } else {
      setSelectedTaskCodes((prev) => Array.from(new Set([...prev, ...visibleCodes])));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      {/* 顶部标题与状态概览 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">腾讯文档自动化中心</h1>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                cfg.mcpToken.trim()
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {cfg.mcpToken.trim() ? "MCP Token 已配置" : "MCP 未配置"}
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
              智能表格模板 {cfg.webhooks.length} 个
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            同时支持「官方 MCP 生成/读写在线文档」与「智能表格 Webhook 批量追加台账记录」，自动回传链接便于一键分享。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              api.openExternalUrl(MCP_AUTH_URL).catch((e) => toast.error(String(e)))
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <KeyRound className="h-3.5 w-3.5 text-amber-600" />
            <span>获取 MCP Token</span>
            <ExternalLink className="h-3 w-3 text-gray-400" />
          </button>
          <button
            type="button"
            onClick={() =>
              api.openExternalUrl(OPEN_API_DOC_URL).catch((e) => toast.error(String(e)))
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <BookOpen className="h-3.5 w-3.5 text-blue-600" />
            <span>开放平台文档</span>
            <ExternalLink className="h-3 w-3 text-gray-400" />
          </button>
        </div>
      </div>

      {/* 四大功能标签页 */}
      <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => setTab("doc")}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition ${
            tab === "doc"
              ? "bg-white text-blue-700 shadow-2xs"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          <FileUp className="h-3.5 w-3.5" />
          <span>1. 生成在线文档 (MCP)</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("sheet")}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition ${
            tab === "sheet"
              ? "bg-white text-blue-700 shadow-2xs"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          <Table2 className="h-3.5 w-3.5" />
          <span>2. 智能表格自动填报 (Webhook)</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("mcp")}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition ${
            tab === "mcp"
              ? "bg-white text-blue-700 shadow-2xs"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          <Wrench className="h-3.5 w-3.5" />
          <span>3. MCP 配置与全能工具箱</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("history")}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition ${
            tab === "history"
              ? "bg-white text-blue-700 shadow-2xs"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          <History className="h-3.5 w-3.5" />
          <span>4. 发布与分享记录 ({cfg.history.length})</span>
        </button>
      </div>

      {/* ================= TAB 1: 生成在线文档 (MCP) ================= */}
      {tab === "doc" && (
        <div className="space-y-4">
          {!cfg.mcpToken.trim() && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900">
              <span>
                💡 请先在「3. MCP 配置与全能工具箱」填入个人 Token（QQ/微信登录腾讯文档即可领取），方可生成在线文档。
              </span>
              <button
                type="button"
                onClick={() => setTab("mcp")}
                className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
              >
                去配置 MCP Token →
              </button>
            </div>
          )}

          {/* 从本地快速载入条 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-gray-700">
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                从本地工作区快速载入：
              </span>

              <select
                value={selectedImportType}
                onChange={(e) => {
                  setSelectedImportType(
                    e.target.value as "weekly" | "task" | "note" | "journal",
                  );
                  setSelectedImportId("");
                }}
                className="rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800"
              >
                <option value="weekly">工作周报</option>
                <option value="task">离线任务需求描述.md</option>
                <option value="note">便签与代码片段</option>
                <option value="journal">生活每日简记</option>
              </select>

              <select
                value={selectedImportId}
                onChange={(e) => setSelectedImportId(e.target.value)}
                className="min-w-60 flex-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800"
              >
                <option value="">-- 请选择要载入的本地文档 --</option>
                {selectedImportType === "weekly" &&
                  weeklyList.map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.title} ({w.key}.md)
                    </option>
                  ))}
                {selectedImportType === "task" &&
                  tasks.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code} · {t.name || "未命名任务"} ({t.status})
                    </option>
                  ))}
                {selectedImportType === "note" &&
                  notes.map((n) => (
                    <option key={n.id} value={n.id}>
                      [{n.kind === "snippet" ? "片段" : "便签"}] {n.title}
                    </option>
                  ))}
                {selectedImportType === "journal" &&
                  journalList.map((j) => (
                    <option key={j.date} value={j.date}>
                      {j.date} · {j.preview}
                    </option>
                  ))}
              </select>

              <button
                type="button"
                onClick={handleImportSource}
                className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-100"
              >
                <span>载入到编辑区</span>
              </button>
            </div>
          </div>

          {/* 编辑器与生成区 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <label className="block sm:col-span-3">
                <span className="text-xs font-medium text-gray-700">腾讯在线文档标题 *</span>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="例如：第47周研发周报 / TASK-0001 修改方案说明"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-900 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-gray-700">目标文件夹 ID（可选）</span>
                <input
                  type="text"
                  value={docParentId}
                  onChange={(e) => setDocParentId(e.target.value)}
                  placeholder="留空则放个人根目录"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">Markdown 文档正文</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDocPreview((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100"
                >
                  <Eye className="h-3 w-3" />
                  <span>{docPreview ? "切回编辑" : "预览效果"}</span>
                </button>
              </div>
            </div>

            {docPreview ? (
              <div className="mt-2 min-h-[280px] max-h-[420px] overflow-y-auto rounded-xl border border-gray-200 bg-gray-50/40 p-4 text-sm leading-relaxed text-gray-800 [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:my-0.5 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-100 [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredDocMarkdown}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                rows={13}
                value={docMarkdown}
                onChange={(e) => setDocMarkdown(e.target.value)}
                className="mt-2 w-full rounded-xl border border-gray-200 p-3 font-mono text-xs leading-relaxed text-gray-800 focus:border-blue-500 focus:outline-none"
              />
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-gray-400">
                调用官方 MCP 工具 <code className="font-mono">{cfg.preferredDocTool}</code> 自动转换 Markdown 为富文本腾讯文档
              </span>
              <button
                type="button"
                disabled={publishingDoc}
                onClick={handlePublishDoc}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {publishingDoc ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileUp className="h-3.5 w-3.5" />
                )}
                <span>{publishingDoc ? "正在发布到腾讯文档..." : "一键生成腾讯文档并获取分享链接"}</span>
              </button>
            </div>

            {lastDocRec && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>生成成功：{lastDocRec.title}</span>
                </div>
                {lastDocRec.docUrl ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] text-blue-700 ring-1 ring-emerald-200">
                      {lastDocRec.docUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy("doc-last", lastDocRec.docUrl, "腾讯文档分享链接")
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
                    >
                      {copiedId === "doc-last" ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span>复制链接</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        api
                          .openExternalUrl(lastDocRec.docUrl)
                          .catch((e) => toast.error(String(e)))
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>浏览器打开</span>
                    </button>
                    <button
                      type="button"
                      disabled={sendingWechatId === "doc-last"}
                      onClick={() =>
                        handleShareWechat(
                          "doc-last",
                          lastDocRec.title,
                          lastDocRec.docUrl,
                          "官方 MCP 在线文档",
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-700"
                    >
                      <Send className="h-3 w-3" />
                      <span>发企微分享</span>
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-emerald-800">{lastDocRec.message}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 2: 智能表格自动填报 (Webhook) ================= */}
      {tab === "sheet" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* 左侧：智能表格 Webhook 模板管理 */}
          <aside className="space-y-3 lg:col-span-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">
                  智能表格 Webhook 模板 ({cfg.webhooks.length})
                </h2>
                <button
                  type="button"
                  onClick={openNewWebhookModal}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="h-3 w-3" />
                  <span>新增表格</span>
                </button>
              </div>

              <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                在腾讯文档智能表格右上角「... → 接收外部数据」生成专属 Webhook，支持粘贴示例 JSON 一键解析列名映射。
              </p>

              <div className="mt-3 space-y-2">
                {cfg.webhooks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-xs text-gray-400">
                    尚未配置智能表格模板，点击右上角「新增表格」开始配置。
                  </div>
                ) : (
                  cfg.webhooks.map((wh) => {
                    const active = wh.id === selectedWhId;
                    return (
                      <div
                        key={wh.id}
                        onClick={() => setSelectedWhId(wh.id)}
                        className={`cursor-pointer rounded-xl border p-3 transition ${
                          active
                            ? "border-blue-400 bg-blue-50/70"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-gray-900">
                              {wh.name}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
                              <span className="rounded bg-white px-1.5 py-0.5 font-mono ring-1 ring-gray-200">
                                {wh.payloadMode}
                              </span>
                              <span>{wh.fields.length} 个字段</span>
                            </div>
                          </div>
                          <div
                            className="flex shrink-0 items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => openEditWebhookModal(wh)}
                              className="rounded p-1 text-gray-400 hover:bg-white hover:text-blue-600"
                              title="编辑模板与字段映射"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteWebhook(wh.id, wh.name)}
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                              title="删除"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {wh.shareUrl && (
                          <div
                            className="mt-2 flex items-center gap-1.5 border-t border-gray-200/70 pt-2 text-[11px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(`wh-${wh.id}`, wh.shareUrl, "在线表格共享链接")
                              }
                              className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                            >
                              <Copy className="h-2.5 w-2.5" />
                              <span>复制分享链接</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                api
                                  .openExternalUrl(wh.shareUrl)
                                  .catch((e) => toast.error(String(e)))
                              }
                              className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-blue-700 ring-1 ring-gray-200 hover:bg-blue-50"
                            >
                              <ExternalLink className="h-2.5 w-2.5" />
                              <span>打开</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          {/* 右侧：数据推送工作台 */}
          <section className="space-y-4 lg:col-span-8">
            {!selectedWebhook ? (
              <div className="flex h-full min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
                <FileSpreadsheet className="h-10 w-10 text-gray-300" />
                <p className="mt-3 text-sm font-medium text-gray-700">
                  先在左侧添加或选择一个腾讯智能表格模板
                </p>
                <p className="mt-1 max-w-md text-xs text-gray-400">
                  配置一次 Webhook 与列映射关系后，即可把离线任务台账、发版日期或自定义工作记录批量填入同一张线上表格，直接共享给团队查看。
                </p>
                <button
                  type="button"
                  onClick={openNewWebhookModal}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>立即创建第一个智能表格模板</span>
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">
                      向「{selectedWebhook.name}」写入数据
                    </h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span>格式：{selectedWebhook.payloadMode}</span>
                      <span>·</span>
                      <span>
                        已映射字段：
                        {selectedWebhook.fields.map((f) => f.label || f.fieldKey).join(" / ") ||
                          "直传"}
                      </span>
                    </div>
                  </div>

                  <div className="inline-flex rounded-xl bg-gray-100 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setWhSubMode("tasks")}
                      className={`rounded-lg px-3 py-1 font-medium ${
                        whSubMode === "tasks"
                          ? "bg-white text-blue-700 shadow-2xs"
                          : "text-gray-600"
                      }`}
                    >
                      从任务台账勾选同步
                    </button>
                    <button
                      type="button"
                      onClick={() => setWhSubMode("custom")}
                      className={`rounded-lg px-3 py-1 font-medium ${
                        whSubMode === "custom"
                          ? "bg-white text-blue-700 shadow-2xs"
                          : "text-gray-600"
                      }`}
                    >
                      自定义单条填报
                    </button>
                  </div>
                </div>

                {whSubMode === "tasks" ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={taskFilterStatus}
                          onChange={(e) => setTaskFilterStatus(e.target.value)}
                          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700"
                        >
                          <option value="all">全部状态</option>
                          <option value="未开始">未开始</option>
                          <option value="进行中">进行中</option>
                          <option value="已提测">已提测</option>
                          <option value="已发版">已发版</option>
                          <option value="已关闭">已关闭</option>
                        </select>
                        <input
                          type="text"
                          value={taskKeyword}
                          onChange={(e) => setTaskKeyword(e.target.value)}
                          placeholder="搜索任务号 / 需求名..."
                          className="w-48 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={toggleAllVisibleTasks}
                          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          全选 / 反选 ({filteredTasks.length})
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={pushingWh || selectedTaskCodes.length === 0}
                        onClick={handlePushTasksWebhook}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {pushingWh ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        <span>
                          写入选中任务 ({selectedTaskCodes.length} 条)
                        </span>
                      </button>
                    </div>

                    <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-200">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 border-b border-gray-200 bg-gray-50 text-gray-500">
                          <tr>
                            <th className="w-9 px-3 py-2">选</th>
                            <th className="px-3 py-2 font-medium">任务号</th>
                            <th className="px-3 py-2 font-medium">名称</th>
                            <th className="px-3 py-2 font-medium">状态</th>
                            <th className="px-3 py-2 font-medium">开始 / 发版日期</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredTasks.map((t) => {
                            const checked = selectedTaskCodes.includes(t.code);
                            return (
                              <tr
                                key={t.code}
                                onClick={() =>
                                  setSelectedTaskCodes((prev) =>
                                    checked
                                      ? prev.filter((x) => x !== t.code)
                                      : [...prev, t.code],
                                  )
                                }
                                className={`cursor-pointer ${
                                  checked ? "bg-blue-50/70" : "hover:bg-gray-50"
                                }`}
                              >
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {}}
                                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                                  />
                                </td>
                                <td className="px-3 py-2 font-mono font-semibold text-blue-600">
                                  {t.code}
                                </td>
                                <td className="max-w-xs truncate px-3 py-2 text-gray-800">
                                  {t.name || "-"}
                                </td>
                                <td className="px-3 py-2 text-gray-600">{t.status}</td>
                                <td className="px-3 py-2 font-mono text-[11px] text-gray-500">
                                  {t.startDate || "-"} → {t.releaseDate || "-"}
                                </td>
                              </tr>
                            );
                          })}
                          {filteredTasks.length === 0 && (
                            <tr>
                              <td colSpan={5} className="py-10 text-center text-gray-400">
                                暂无符合条件的离线台账任务
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handlePushCustomRowWebhook} className="mt-4 space-y-3">
                    {selectedWebhook.fields.length === 0 ? (
                      <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                        该模板未定义字段映射，请点击左侧编辑按钮添加字段（或直接粘贴腾讯示例 JSON 自动识别）。
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {selectedWebhook.fields.map((f) => (
                          <label key={f.fieldKey} className="block text-xs">
                            <span className="font-medium text-gray-700">
                              {f.label || f.fieldKey}{" "}
                              <span className="font-mono text-[10px] text-gray-400">
                                ({f.fieldKey} · {f.valueType})
                              </span>
                            </span>
                            {f.valueType === "checkbox" ? (
                              <select
                                value={customRowValues[f.fieldKey] ?? "false"}
                                onChange={(e) =>
                                  setCustomRowValues((prev) => ({
                                    ...prev,
                                    [f.fieldKey]: e.target.value,
                                  }))
                                }
                                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs"
                              >
                                <option value="false">否 (false)</option>
                                <option value="true">是 (true)</option>
                              </select>
                            ) : (
                              <input
                                type={
                                  f.valueType === "number"
                                    ? "number"
                                    : f.valueType === "date"
                                      ? "date"
                                      : "text"
                                }
                                value={customRowValues[f.fieldKey] ?? ""}
                                onChange={(e) =>
                                  setCustomRowValues((prev) => ({
                                    ...prev,
                                    [f.fieldKey]: e.target.value,
                                  }))
                                }
                                placeholder={`输入${f.label || f.fieldKey}`}
                                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    )}

                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={pushingWh || selectedWebhook.fields.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {pushingWh ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        <span>提交一行到智能表格</span>
                      </button>
                    </div>
                  </form>
                )}

                {lastWhRes && (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>{lastWhRes.record.message}</span>
                    </div>
                    {lastWhRes.record.docUrl && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] text-blue-700 ring-1 ring-emerald-200">
                          {lastWhRes.record.docUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(
                              "wh-last",
                              lastWhRes.record.docUrl,
                              "表格分享链接",
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
                        >
                          <Copy className="h-3 w-3" />
                          <span>复制分享链接</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            api
                              .openExternalUrl(lastWhRes.record.docUrl)
                              .catch((e) => toast.error(String(e)))
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>打开表格</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleShareWechat(
                              "wh-last",
                              selectedWebhook.name,
                              lastWhRes.record.docUrl,
                              "腾讯智能表格更新",
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-700"
                        >
                          <Send className="h-3 w-3" />
                          <span>发企微分享</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================= TAB 3: MCP 配置与全能工具箱 ================= */}
      {tab === "mcp" && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  腾讯文档官方 MCP 服务配置
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  鉴权使用个人授权页领取的 Token，请求头严格通过 <code className="font-mono">Authorization</code> 发送。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={testingMcp}
                  onClick={handleTestMcp}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                >
                  {testingMcp ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>{testingMcp ? "握手中..." : "测试连接并发现全部 MCP 工具"}</span>
                </button>
                <button
                  type="button"
                  disabled={savingCfg}
                  onClick={handleSaveMcpConfig}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingCfg ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>保存配置</span>
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-gray-700">
                  MCP 服务端点 URL (mcpUrl)
                </span>
                <input
                  type="text"
                  value={cfg.mcpUrl}
                  onChange={(e) => setCfg({ ...cfg, mcpUrl: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700">
                    个人 Authorization Token
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      api
                        .openExternalUrl(MCP_AUTH_URL)
                        .catch((e) => toast.error(String(e)))
                    }
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 hover:underline"
                  >
                    <span>打开官网领取 Token</span>
                    <ExternalLink className="h-2.5 w-2.5" />
                  </button>
                </div>
                <div className="relative mt-1">
                  <input
                    type={showToken ? "text" : "password"}
                    value={cfg.mcpToken}
                    onChange={(e) => setCfg({ ...cfg, mcpToken: e.target.value })}
                    placeholder="粘贴从 docs.qq.com/open/auth/mcp.html 获取的个人 Token"
                    className="w-full rounded-xl border border-gray-200 py-2 pr-9 pl-3 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  >
                    {showToken ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-gray-700">
                  默认父级目录 ID (defaultParentId，留空存根目录)
                </span>
                <input
                  type="text"
                  value={cfg.defaultParentId}
                  onChange={(e) =>
                    setCfg({ ...cfg, defaultParentId: e.target.value })
                  }
                  placeholder="可选，空间节点 / 文件夹 ID"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-gray-700">
                  请求超时时间 (秒)
                </span>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={cfg.requestTimeoutSecs}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      requestTimeoutSecs: Number(e.target.value) || 30,
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                {advancedOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span>高级工具名与参数键映射（自动兼容 Schema，一般无需修改）</span>
              </button>

              {advancedOpen && (
                <div className="mt-2.5 grid grid-cols-1 gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3.5 sm:grid-cols-4">
                  <label className="block text-xs">
                    <span className="font-medium text-gray-600">默认生成文档工具名</span>
                    <input
                      type="text"
                      value={cfg.preferredDocTool}
                      onChange={(e) =>
                        setCfg({ ...cfg, preferredDocTool: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-xs"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="font-medium text-gray-600">标题参数名</span>
                    <input
                      type="text"
                      value={cfg.docTitleArg}
                      onChange={(e) =>
                        setCfg({ ...cfg, docTitleArg: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-xs"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="font-medium text-gray-600">正文参数名</span>
                    <input
                      type="text"
                      value={cfg.docContentArg}
                      onChange={(e) =>
                        setCfg({ ...cfg, docContentArg: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-xs"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="font-medium text-gray-600">目录 ID 参数名</span>
                    <input
                      type="text"
                      value={cfg.docParentArg}
                      onChange={(e) =>
                        setCfg({ ...cfg, docParentArg: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-mono text-xs"
                    />
                  </label>
                </div>
              )}
            </div>

            {mcpTestRes && (
              <div
                className={`mt-4 rounded-xl border px-3.5 py-2.5 text-xs ${
                  mcpTestRes.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-rose-200 bg-rose-50 text-rose-900"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{mcpTestRes.message}</span>
                  <span className="font-mono text-[11px]">
                    {mcpTestRes.serverName && `${mcpTestRes.serverName} · `}
                    {mcpTestRes.latencyMs}ms
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* 发现并直接调用全部腾讯文档 MCP 工具 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  MCP 开放工具实时发现与调试台
                </h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  点击上方「测试连接并发现全部 MCP 工具」后，可在此调用官方提供的智能表格读写、Excel 编辑、文档搜索、Mermaid 流程图等所有接口。
                </p>
              </div>
              {mcpTestRes?.tools.length ? (
                <input
                  type="text"
                  value={toolFilter}
                  onChange={(e) => setToolFilter(e.target.value)}
                  placeholder="过滤工具名 / 描述..."
                  className="w-56 rounded-xl border border-gray-200 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                />
              ) : null}
            </div>

            {!mcpTestRes?.tools.length ? (
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 py-10 text-center text-xs text-gray-400">
                暂未加载 MCP 工具列表，请先填写 Token 后点击「测试连接并发现全部 MCP 工具」。
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1 lg:col-span-5">
                  {filteredTools.map((t) => {
                    const selected = activeTool?.name === t.name;
                    return (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => {
                          setActiveTool(t);
                          setToolArgsJson(JSON.stringify(buildSkeletonArgs(t), null, 2));
                          setToolOutput("");
                          setToolDocUrl("");
                        }}
                        className={`w-full rounded-xl border p-2.5 text-left text-xs transition ${
                          selected
                            ? "border-blue-400 bg-blue-50/70"
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <div className="font-mono font-semibold text-blue-700">
                          {t.name}
                        </div>
                        {t.description && (
                          <div className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">
                            {t.description}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-3 lg:col-span-7">
                  {activeTool ? (
                    <>
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
                        <div className="font-mono font-bold text-gray-900">
                          {activeTool.name}
                        </div>
                        <p className="mt-1 text-gray-600">
                          {activeTool.description || "无额外描述"}
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-gray-700">
                            调用参数 (JSON arguments)
                          </span>
                          <button
                            type="button"
                            onClick={handleRunMcpTool}
                            disabled={runningTool}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {runningTool ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            <span>执行工具</span>
                          </button>
                        </div>
                        <textarea
                          rows={7}
                          value={toolArgsJson}
                          onChange={(e) => setToolArgsJson(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-gray-200 p-3 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                        />
                      </div>

                      {toolDocUrl && (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                          <span className="font-medium text-emerald-900">提取到在线链接：</span>
                          <code className="min-w-0 flex-1 truncate font-mono text-blue-700">
                            {toolDocUrl}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopy("mcp-tool-url", toolDocUrl, "在线链接")
                            }
                            className="rounded bg-white px-2 py-0.5 text-[11px] text-emerald-800 ring-1 ring-emerald-200"
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              api
                                .openExternalUrl(toolDocUrl)
                                .catch((e) => toast.error(String(e)))
                            }
                            className="rounded bg-blue-600 px-2 py-0.5 text-[11px] text-white"
                          >
                            打开
                          </button>
                        </div>
                      )}

                      {toolOutput && (
                        <div>
                          <span className="text-xs font-medium text-gray-700">返回结果</span>
                          <pre className="mt-1 max-h-56 overflow-auto rounded-xl bg-gray-900 p-3 font-mono text-[11px] text-emerald-200">
                            {toolOutput}
                          </pre>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-xs text-gray-400">
                      在左侧任选一个 MCP 工具查看 Schema 并调试调用
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ================= TAB 4: 发布与填报历史 ================= */}
      {tab === "history" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                发布与填报记录 ({cfg.history.length})
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                本地离线保留最近 {cfg.history.length} 条记录与生成的腾讯文档/智能表格链接，随时可重新复制或推送给同事。
              </p>
            </div>
            {cfg.history.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  const next = await api.clearTencentDocsHistory();
                  setCfg(next);
                  toast.success("已清空历史记录");
                }}
                className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-red-50 hover:text-red-600"
              >
                清空记录
              </button>
            )}
          </div>

          {cfg.history.length === 0 ? (
            <div className="py-14 text-center text-xs text-gray-400">
              暂无发布或智能表格填报记录
            </div>
          ) : (
            <div className="mt-3 divide-y divide-gray-100">
              {cfg.history.map((h) => (
                <div
                  key={h.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          h.kind === "smartsheet_webhook"
                            ? "bg-violet-50 text-violet-700"
                            : h.kind === "mcp_tool"
                              ? "bg-indigo-50 text-indigo-700"
                              : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {h.kind === "smartsheet_webhook"
                          ? "智能表格"
                          : h.kind === "mcp_tool"
                            ? "MCP 工具"
                            : "MCP 文档"}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          h.status === "success"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {h.status === "success" ? "成功" : "失败"}
                      </span>
                      <span className="font-semibold text-gray-900">{h.title}</span>
                      {h.sourceLabel && (
                        <span className="text-[11px] text-gray-400">
                          来自 {h.sourceLabel}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 truncate text-[11px] text-gray-500">
                      {h.message}
                    </div>
                    {h.docUrl && (
                      <div className="mt-1 truncate font-mono text-[11px] text-blue-600">
                        {h.docUrl}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className="lw-nums mr-2 text-[11px] text-slate-400"
                      title={h.createdAt.replace("T", " ").slice(0, 19)}
                    >
                      {formatIsoTimeZh(h.createdAt)}
                    </span>
                    {h.docUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleCopy(`his-${h.id}`, h.docUrl, "链接")}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                        >
                          {copiedId === `his-${h.id}` ? (
                            <Check className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>复制</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            api
                              .openExternalUrl(h.docUrl)
                              .catch((e) => toast.error(String(e)))
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700 hover:bg-blue-100"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>打开</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleShareWechat(`his-${h.id}`, h.title, h.docUrl, h.sourceLabel)
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100"
                        >
                          <Send className="h-3 w-3" />
                          <span>发企微</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= Webhook 模板新增/编辑弹窗 ================= */}
      {whModalOpen && whDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleSaveWebhook}
            className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-gray-900">
                  {whDraft.id ? "编辑智能表格 Webhook 模板" : "新建智能表格 Webhook 模板"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setWhModalOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="font-medium text-gray-700">模板名称 *</span>
                  <input
                    type="text"
                    required
                    value={whDraft.name}
                    onChange={(e) => setWhDraft({ ...whDraft, name: e.target.value })}
                    placeholder="例如：项目发版排期总表"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-medium text-gray-700">Payload 格式</span>
                  <select
                    value={whDraft.payloadMode}
                    onChange={(e) =>
                      setWhDraft({ ...whDraft, payloadMode: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-xs"
                  >
                    <option value="add_records">add_records (标准智能表格)</option>
                    <option value="fields">fields (通用自动化对象)</option>
                    <option value="raw_object">raw_object (扁平 JSON 行)</option>
                  </select>
                </label>

                <label className="block">
                  <span className="font-medium text-gray-700">在线表格共享 URL（可选）</span>
                  <input
                    type="text"
                    value={whDraft.shareUrl}
                    onChange={(e) =>
                      setWhDraft({ ...whDraft, shareUrl: e.target.value })
                    }
                    placeholder="https://docs.qq.com/smartsheet/..."
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none"
                  />
                </label>
              </div>

              <label className="block">
                <span className="font-medium text-gray-700">
                  Webhook 接收地址 (webhookUrl) *
                </span>
                <input
                  type="text"
                  required
                  value={whDraft.webhookUrl}
                  onChange={(e) =>
                    setWhDraft({ ...whDraft, webhookUrl: e.target.value })
                  }
                  placeholder="https://docs.qq.com/openapi/smartsheet/webhook?key=... 或 https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=..."
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none"
                />
              </label>

              {/* 智能示例 JSON 一键解析工具条 */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-indigo-900">
                    粘贴腾讯「接收外部数据」示例 JSON 一键生成列字段映射
                  </span>
                  <button
                    type="button"
                    onClick={() => setSampleJsonOpen((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
                  >
                    <Wand2 className="h-3 w-3" />
                    <span>{sampleJsonOpen ? "收起" : "粘贴示例 JSON"}</span>
                  </button>
                </div>

                {sampleJsonOpen && (
                  <div className="mt-2.5 space-y-2">
                    <textarea
                      rows={5}
                      value={sampleJsonText}
                      onChange={(e) => setSampleJsonText(e.target.value)}
                      placeholder='{"add_records":[{"values":{"fld1":[{"type":"text","text":"示例"}],"fld2":"2026-11-23"}}]}'
                      className="w-full rounded-xl border border-indigo-200 bg-white p-2.5 font-mono text-[11px]"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleParseSampleIntoDraft}
                        className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
                      >
                        识别字段并覆盖下方列表
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 字段映射列表 */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800">
                    字段映射配置 ({whDraft.fields.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setWhDraft({
                        ...whDraft,
                        fields: [
                          ...whDraft.fields,
                          {
                            fieldKey: "",
                            label: "",
                            sourceKey: "",
                            valueType: "text_rich",
                            defaultValue: "",
                          },
                        ],
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Plus className="h-3 w-3" />
                    <span>增加一列</span>
                  </button>
                </div>

                <div className="mt-2 space-y-2">
                  {whDraft.fields.map((f, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 gap-1.5 rounded-xl border border-gray-200 bg-gray-50/50 p-2 sm:grid-cols-12"
                    >
                      <input
                        type="text"
                        value={f.fieldKey}
                        onChange={(e) => {
                          const next = [...whDraft.fields];
                          next[idx] = { ...f, fieldKey: e.target.value };
                          setWhDraft({ ...whDraft, fields: next });
                        }}
                        placeholder="字段 ID / 列名"
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] sm:col-span-3"
                      />
                      <input
                        type="text"
                        value={f.label}
                        onChange={(e) => {
                          const next = [...whDraft.fields];
                          next[idx] = { ...f, label: e.target.value };
                          setWhDraft({ ...whDraft, fields: next });
                        }}
                        placeholder="显示名称"
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] sm:col-span-2"
                      />
                      <select
                        value={f.sourceKey}
                        onChange={(e) => {
                          const next = [...whDraft.fields];
                          next[idx] = { ...f, sourceKey: e.target.value };
                          setWhDraft({ ...whDraft, fields: next });
                        }}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] sm:col-span-3"
                      >
                        <option value="">(手填 / 默认值)</option>
                        {TASK_SOURCE_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>
                            台账：{opt.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={f.valueType}
                        onChange={(e) => {
                          const next = [...whDraft.fields];
                          next[idx] = { ...f, valueType: e.target.value };
                          setWhDraft({ ...whDraft, fields: next });
                        }}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] sm:col-span-2"
                      >
                        <option value="text_rich">text_rich</option>
                        <option value="text">text</option>
                        <option value="number">number</option>
                        <option value="date">date</option>
                        <option value="checkbox">checkbox</option>
                      </select>
                      <div className="flex items-center gap-1 sm:col-span-2">
                        <input
                          type="text"
                          value={f.defaultValue}
                          onChange={(e) => {
                            const next = [...whDraft.fields];
                            next[idx] = { ...f, defaultValue: e.target.value };
                            setWhDraft({ ...whDraft, fields: next });
                          }}
                          placeholder="默认值"
                          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setWhDraft({
                              ...whDraft,
                              fields: whDraft.fields.filter((_, i) => i !== idx),
                            })
                          }
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setWhModalOpen(false)}
                className="rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={savingWh}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {savingWh && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>保存表格模板</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
