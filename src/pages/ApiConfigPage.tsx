import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  AlertCircle,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileJson,
  Link2,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type {
  ApiConfig,
  ApiEndpointRule,
  ApiParamRules,
  ApiParamSpec,
  ProbeResult,
  RepoTagRule,
  StatusFlowStepRule,
} from "../lib/types";
import { useAppStore } from "../store/appStore";

const GROUP_META: { id: string; label: string }[] = [
  { id: "all", label: "全部接口" },
  { id: "auth", label: "认证与保活" },
  { id: "hours", label: "工时与卡片" },
  { id: "git_mr", label: "代码分支与 MR" },
  { id: "flow", label: "检查单与流转" },
  { id: "tags_files", label: "附件与标签" },
  { id: "wechat", label: "企业微信通知" },
];

const METHOD_BADGE: Record<string, string> = {
  GET: "border-emerald-200 bg-emerald-50 text-emerald-700",
  POST: "border-blue-200 bg-blue-50 text-blue-700",
  PUT: "border-amber-200 bg-amber-50 text-amber-700",
  DELETE: "border-rose-200 bg-rose-50 text-rose-700",
  PATCH: "border-violet-200 bg-violet-50 text-violet-700",
  WEB: "border-gray-200 bg-gray-100 text-gray-700",
};

const PARAM_LOC_META: Record<string, { label: string; badgeCls: string }> = {
  query: { label: "Query", badgeCls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  body: { label: "Body", badgeCls: "border-blue-200 bg-blue-50 text-blue-700" },
  path: { label: "Path", badgeCls: "border-amber-200 bg-amber-50 text-amber-700" },
  header: { label: "Header", badgeCls: "border-violet-200 bg-violet-50 text-violet-700" },
  form: { label: "Form", badgeCls: "border-cyan-200 bg-cyan-50 text-cyan-700" },
};

const LOCATION_ORDER = ["path", "query", "body", "header", "form"] as const;

function cloneCfg(c: ApiConfig): ApiConfig {
  return JSON.parse(JSON.stringify(c)) as ApiConfig;
}

function cloneParams(list: ApiParamSpec[] | undefined): ApiParamSpec[] {
  return JSON.parse(JSON.stringify(list ?? [])) as ApiParamSpec[];
}

function normalizeParamSpec(raw: Partial<ApiParamSpec>): ApiParamSpec {
  return {
    key: typeof raw.key === "string" ? raw.key : "",
    location: typeof raw.location === "string" ? raw.location : "query",
    valueType: typeof raw.valueType === "string" ? raw.valueType : "string",
    value: typeof raw.value === "string" ? raw.value : "",
    sourceKey: typeof raw.sourceKey === "string" ? raw.sourceKey : "",
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    required: Boolean(raw.required),
    description: typeof raw.description === "string" ? raw.description : "",
    linkedRule: typeof raw.linkedRule === "string" ? raw.linkedRule : "",
  };
}

function origParamKey(p: ApiParamSpec): string {
  const sk = (p.sourceKey || "").trim();
  return sk || (p.key || "").trim();
}

function findDefaultParam(
  defEp: ApiEndpointRule | undefined,
  location: string,
  origKey: string,
): ApiParamSpec | undefined {
  if (!defEp?.params?.length) return undefined;
  return defEp.params.find(
    (d) =>
      d.location === location &&
      (d.key === origKey || (Boolean(d.sourceKey) && d.sourceKey === origKey)),
  );
}

function isParamModified(p: ApiParamSpec, defEp?: ApiEndpointRule): boolean {
  if (!p.sourceKey) return true;
  const defP = findDefaultParam(defEp, p.location, origParamKey(p));
  if (!defP) return true;
  return (
    defP.key !== p.key ||
    defP.location !== p.location ||
    defP.valueType !== p.valueType ||
    defP.value !== p.value ||
    defP.enabled !== p.enabled
  );
}

function isEndpointModified(ep: ApiEndpointRule, defEp?: ApiEndpointRule): boolean {
  if (!defEp) return true;
  if (ep.method !== defEp.method || ep.pathTemplate !== defEp.pathTemplate) {
    return true;
  }
  return JSON.stringify(ep.params ?? []) !== JSON.stringify(defEp.params ?? []);
}

function containsTemplatePlaceholder(s: string): boolean {
  return /\{[A-Za-z_][A-Za-z0-9_.]*\}/.test(s);
}

function previewBaseHost(cfg: ApiConfig): string {
  const scheme = cfg.scheme?.trim().toLowerCase() === "https" ? "https" : "http";
  let rawIp = (cfg.ip || "").trim().replace(/\/+$/, "");
  let port = (cfg.port || "").trim();

  if (rawIp.startsWith("http://") || rawIp.startsWith("https://")) {
    try {
      const u = new URL(rawIp);
      rawIp = u.hostname;
      if (u.port) port = u.port;
    } catch {
      // Fallback below
    }
  } else {
    const m = /^\[?([^\]]+)\]:(\d+)$/.exec(rawIp);
    if (m) {
      rawIp = m[1];
      port = m[2];
    }
  }

  if (!rawIp) rawIp = "devops.example.local";
  const formattedHost = rawIp.includes(":") && !rawIp.startsWith("[") ? `[${rawIp}]` : rawIp;
  return port ? `${scheme}://${formattedHost}:${port}` : `${scheme}://${formattedHost}`;
}

function previewLoginPath(cfg: ApiConfig): string {
  const p = (cfg.loginPath || "").trim();
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

function resolveTemplatePreview(cfg: ApiConfig, raw: string): string {
  const base = previewBaseHost(cfg);
  const lp = previewLoginPath(cfg);
  const sid = String(cfg.spaceId || 26);
  const r = cfg.rules;
  return (raw || "")
    .replace(/\{host\}/g, base)
    .replace(/\{spaceId\}/g, sid)
    .replace(/\{loginPath\}/g, lp)
    .replace(/\{rules\.cardPageSize\}/g, String(r.cardPageSize ?? 200))
    .replace(/\{rules\.declareStatus\}/g, String(r.declareStatus ?? 2))
    .replace(/\{rules\.defaultRoleCode\}/g, String(r.defaultRoleCode ?? 1011))
    .replace(/\{rules\.defaultQaRoleCode\}/g, String(r.defaultQaRoleCode ?? 1012))
    .replace(/\{rules\.defaultDeclareDesc\}/g, r.defaultDeclareDesc ?? "")
    .replace(/\{rules\.approveScore\}/g, String(r.approveScore ?? 2))
    .replace(/\{rules\.mergeStrategy\}/g, r.mergeStrategy ?? "DEFAULT")
    .replace(/\{rules\.checklistPassResult\}/g, String(r.checklistPassResult ?? 2))
    .replace(/\{rules\.planTestDateField\}/g, r.planTestDateField ?? "dateKey1")
    .replace(/\{rules\.statusFlowAction\}/g, r.statusFlowAction ?? "statusFlow")
    .replace(/\{rules\.testAuditStatusId\}/g, String(r.testAuditStatusId ?? 110))
    .replace(/\{rules\.uatVerifyStatusId\}/g, String(r.uatVerifyStatusId ?? 140));
}

function previewEndpointUrl(
  cfg: ApiConfig,
  ep: ApiEndpointRule,
  defEp?: ApiEndpointRule,
): string {
  const base = previewBaseHost(cfg);
  let tmpl = ep.pathTemplate || "";
  const params = ep.params ?? [];

  for (const p of params) {
    if (!p.enabled || p.location !== "path") continue;
    const origK = origParamKey(p);
    if (!origK) continue;
    const defP = findDefaultParam(defEp, "path", origK);
    const modified = defP
      ? defP.key !== p.key || defP.value !== p.value || defP.enabled !== p.enabled
      : true;
    if (!modified) continue;
    const resolved = resolveTemplatePreview(cfg, p.value);
    if (!containsTemplatePlaceholder(resolved)) {
      tmpl = tmpl.split(`{${origK}}`).join(resolved);
      const tk = (p.key || "").trim();
      if (tk && tk !== origK) {
        tmpl = tmpl.split(`{${tk}}`).join(resolved);
      }
    }
  }

  let fullUrl = resolveTemplatePreview(cfg, tmpl).trim();
  if (!fullUrl.startsWith("http://") && !fullUrl.startsWith("https://")) {
    if (!fullUrl) fullUrl = base;
    else fullUrl = fullUrl.startsWith("/") ? `${base}${fullUrl}` : `${base}/${fullUrl}`;
  }

  const queryParams = params.filter((p) => p.location === "query");
  if (queryParams.length > 0) {
    const qIdx = fullUrl.indexOf("?");
    const hIdx = fullUrl.indexOf("#");
    const hasRealQuery = qIdx >= 0 && (hIdx < 0 || qIdx < hIdx);
    const basePart = hasRealQuery ? fullUrl.slice(0, qIdx) : fullUrl;
    const afterQ = hasRealQuery ? fullUrl.slice(qIdx + 1) : "";
    const afterH = hasRealQuery && hIdx > qIdx ? fullUrl.slice(hIdx) : "";
    const qRaw = hasRealQuery && hIdx > qIdx ? fullUrl.slice(qIdx + 1, hIdx) : afterQ;

    const pairs: [string, string][] = qRaw
      .split("&")
      .filter(Boolean)
      .map((seg) => {
        const eq = seg.indexOf("=");
        return eq >= 0 ? [seg.slice(0, eq), seg.slice(eq + 1)] : [seg, ""];
      });

    for (const p of queryParams) {
      const targetKey = (p.key || "").trim();
      const origK = origParamKey(p);
      const defP = findDefaultParam(defEp, "query", origK);
      const isCustom = !defP;
      const isModified = defP
        ? defP.key !== p.key || defP.value !== p.value || defP.enabled !== p.enabled
        : true;
      const valueModified = defP ? defP.value !== p.value : true;

      if (!p.enabled) {
        for (let i = pairs.length - 1; i >= 0; i--) {
          if (pairs[i][0] === origK || pairs[i][0] === targetKey) {
            pairs.splice(i, 1);
          }
        }
        continue;
      }
      if (!targetKey) continue;

      const resolved = resolveTemplatePreview(cfg, p.value);
      const matchIdx = pairs.findIndex(([k]) => k === origK || k === targetKey);
      if (matchIdx >= 0) {
        pairs[matchIdx][0] = targetKey;
        if (valueModified) {
          pairs[matchIdx][1] = resolved;
        }
        for (let i = pairs.length - 1; i > matchIdx; i--) {
          if (pairs[i][0] === origK || pairs[i][0] === targetKey) {
            pairs.splice(i, 1);
          }
        }
      } else if (isCustom || isModified) {
        pairs.push([targetKey, resolved]);
      }
    }

    if (pairs.length === 0) {
      fullUrl = `${basePart}${afterH}`;
    } else {
      const joined = pairs.map(([k, v]) => `${k}=${v}`).join("&");
      fullUrl = `${basePart}?${joined}${afterH}`;
    }
  }

  return fullUrl;
}

function parsePreviewValue(cfg: ApiConfig, p: ApiParamSpec): unknown {
  const resolved = resolveTemplatePreview(cfg, p.value);
  const trimmed = resolved.trim();
  if (containsTemplatePlaceholder(resolved)) {
    return resolved;
  }
  const vt = (p.valueType || "string").toLowerCase();
  if (vt === "number") {
    const n = Number(trimmed);
    return trimmed !== "" && Number.isFinite(n) ? n : resolved;
  }
  if (vt === "boolean") {
    if (trimmed.toLowerCase() === "true" || trimmed === "1") return true;
    if (trimmed.toLowerCase() === "false" || trimmed === "0") return false;
    return resolved;
  }
  if (vt === "json") {
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return resolved;
    }
  }
  return resolved;
}

function previewEndpointBody(cfg: ApiConfig, ep: ApiEndpointRule): string | null {
  const bodyParams = (ep.params ?? []).filter((p) => p.enabled && p.location === "body");
  if (bodyParams.length === 0) return null;

  const root: Record<string, unknown> = {};
  for (const p of bodyParams) {
    const rawKey = (p.key || "").trim();
    if (!rawKey) continue;
    // Mirror dynamic planTestDateField when key wasn't customized away from dateKey1
    const effectiveKey =
      ep.key === "card_ext_properties" && rawKey === "dateKey1" && p.sourceKey === "dateKey1"
        ? cfg.rules.planTestDateField?.trim() || rawKey
        : rawKey;
    const parts = effectiveKey.split(".").filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (!cursor[k] || typeof cursor[k] !== "object" || Array.isArray(cursor[k])) {
        cursor[k] = {};
      }
      cursor = cursor[k] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = parsePreviewValue(cfg, p);
  }

  const payload = ep.key === "checklist_save_batch" ? [root] : root;
  return JSON.stringify(payload, null, 2);
}

function isSensitiveParamKey(key: string): boolean {
  return /pass|secret|token|pwd/i.test(key);
}

function getRuleAnchorSection(linkedRule: string): string {
  if (
    [
      "connectCheckTimeoutMs",
      "requestTimeoutSecs",
      "uploadTimeoutSecs",
      "maxRetries",
      "keepAliveIntervalSecs",
      "keepAliveMouseNudge",
      "keepAliveMouseNudgeIntervalSecs",
    ].includes(linkedRule)
  ) {
    return "rule-sec-network";
  }
  if (
    [
      "timeWork",
      "maxDailyHours",
      "dynamicPreferredHours",
      "monthlyWorkdaysFactor",
      "defaultRoleCode",
      "defaultQaRoleCode",
      "workItemTypeCode",
      "skipSprintId",
      "cardPageSize",
      "declareStatus",
      "defaultMemberRate",
      "defaultDeclareDesc",
    ].includes(linkedRule)
  ) {
    return "rule-sec-hours";
  }
  return "rule-sec-mr-flow";
}

export function ApiConfigPage() {
  const refreshSettings = useAppStore((s) => s.refreshSettings);

  const [savedCfg, setSavedCfg] = useState<ApiConfig | null>(null);
  const [defaultCfg, setDefaultCfg] = useState<ApiConfig | null>(null);
  const [draft, setDraft] = useState<ApiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [tab, setTab] = useState<"routes" | "rules">("routes");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyModified, setOnlyModified] = useState(false);
  const [collapsedParams, setCollapsedParams] = useState<Record<string, boolean>>({});
  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>({});
  const [expandedPreviews, setExpandedPreviews] = useState<Record<string, boolean>>({});
  const [secretVisibility, setSecretVisibility] = useState<Record<string, boolean>>({});

  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  // Add-row temporary inputs for mapping tables
  const [newRevName, setNewRevName] = useState("");
  const [newRevId, setNewRevId] = useState("");
  const [newRateName, setNewRateName] = useState("");
  const [newRateVal, setNewRateVal] = useState("0.9");
  const [newTagRule, setNewTagRule] = useState<RepoTagRule>({
    repoKeyword: "",
    tagName: "",
    tagId: 100,
    exampleProject: "",
  });
  const [newStep, setNewStep] = useState<StatusFlowStepRule>({
    id: 150,
    key: "",
    name: "",
    desc: "",
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.getApiConfig(), api.getDefaultApiConfig()])
      .then(([cfg, def]) => {
        if (!active) return;
        setSavedCfg(cfg);
        setDefaultCfg(def);
        setDraft(cloneCfg(cfg));
      })
      .catch((e) => {
        if (active) toast.error(`加载接口配置失败: ${String(e)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const hasUnsaved = useMemo(() => {
    if (!draft || !savedCfg) return false;
    return JSON.stringify(draft) !== JSON.stringify(savedCfg);
  }, [draft, savedCfg]);

  const defaultEpMap = useMemo(() => {
    const map = new Map<string, ApiEndpointRule>();
    for (const ep of defaultCfg?.endpoints ?? []) {
      map.set(ep.key, ep);
    }
    return map;
  }, [defaultCfg]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: draft?.endpoints.length ?? 0 };
    for (const ep of draft?.endpoints ?? []) {
      counts[ep.group] = (counts[ep.group] ?? 0) + 1;
    }
    return counts;
  }, [draft]);

  const filteredEndpoints = useMemo(() => {
    if (!draft) return [];
    const q = searchQuery.trim().toLowerCase();
    return draft.endpoints.filter((ep) => {
      if (groupFilter !== "all" && ep.group !== groupFilter) return false;
      const def = defaultEpMap.get(ep.key);
      const isMod = isEndpointModified(ep, def);
      if (onlyModified && !isMod) return false;
      if (!q) return true;
      const paramHit = (ep.params ?? []).some(
        (p) =>
          p.key.toLowerCase().includes(q) ||
          p.value.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.linkedRule.toLowerCase().includes(q),
      );
      return (
        paramHit ||
        ep.key.toLowerCase().includes(q) ||
        ep.name.toLowerCase().includes(q) ||
        ep.pathTemplate.toLowerCase().includes(q) ||
        ep.description.toLowerCase().includes(q) ||
        ep.queryParamsDoc.toLowerCase().includes(q) ||
        ep.bodyParamsDoc.toLowerCase().includes(q)
      );
    });
  }, [draft, groupFilter, searchQuery, onlyModified, defaultEpMap]);

  if (loading || !draft) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        <span>正在加载接口清单与参数规则...</span>
      </div>
    );
  }

  const baseHostPreview = previewBaseHost(draft);
  const loginEp =
    draft.endpoints.find((e) => e.key === "login_page") ?? {
      key: "login_page",
      group: "auth",
      name: "登录页",
      method: "WEB",
      pathTemplate: "{host}{loginPath}",
      description: "",
      queryParamsDoc: "",
      bodyParamsDoc: "",
      placeholders: [],
      params: [],
    };
  const loginUrlPreview = previewEndpointUrl(draft, loginEp, defaultEpMap.get("login_page"));

  const updateRule = <K extends keyof ApiParamRules>(key: K, val: ApiParamRules[K]) => {
    setDraft((prev) =>
      prev ? { ...prev, rules: { ...prev.rules, [key]: val } } : prev,
    );
  };

  const updateEndpoint = (key: string, patch: Partial<ApiEndpointRule>) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            endpoints: prev.endpoints.map((ep) =>
              ep.key === key ? { ...ep, ...patch } : ep,
            ),
          }
        : prev,
    );
  };

  const updateEndpointParam = (
    epKey: string,
    paramIdx: number,
    patch: Partial<ApiParamSpec>,
  ) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        endpoints: prev.endpoints.map((ep) => {
          if (ep.key !== epKey) return ep;
          const nextParams = [...(ep.params ?? [])];
          if (!nextParams[paramIdx]) return ep;
          nextParams[paramIdx] = { ...nextParams[paramIdx], ...patch };
          return { ...ep, params: nextParams };
        }),
      };
    });
  };

  const addEndpointParam = (ep: ApiEndpointRule) => {
    const defaultLoc =
      ep.method === "GET" || ep.method === "WEB" || ep.method === "DELETE"
        ? "query"
        : "body";
    const newParam: ApiParamSpec = {
      key: "",
      location: defaultLoc,
      valueType: "string",
      value: "",
      sourceKey: "",
      enabled: true,
      required: false,
      description: "自定义扩展参数",
      linkedRule: "",
    };
    updateEndpoint(ep.key, { params: [...(ep.params ?? []), newParam] });
    setCollapsedParams((prev) => ({ ...prev, [ep.key]: false }));
  };

  const removeEndpointParam = (epKey: string, paramIdx: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        endpoints: prev.endpoints.map((ep) =>
          ep.key === epKey
            ? { ...ep, params: (ep.params ?? []).filter((_, idx) => idx !== paramIdx) }
            : ep,
        ),
      };
    });
  };

  const resetSingleParam = (epKey: string, paramIdx: number) => {
    const def = defaultEpMap.get(epKey);
    if (!def) return;
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        endpoints: prev.endpoints.map((ep) => {
          if (ep.key !== epKey) return ep;
          const current = ep.params?.[paramIdx];
          if (!current) return ep;
          const defP = findDefaultParam(def, current.location, origParamKey(current))
            ?? (def.params ?? []).find(
              (d) => d.key === origParamKey(current) || d.sourceKey === origParamKey(current),
            );
          if (!defP) return ep;
          const nextParams = [...(ep.params ?? [])];
          nextParams[paramIdx] = normalizeParamSpec(defP);
          return { ...ep, params: nextParams };
        }),
      };
    });
  };

  const handleResetEndpointParams = (epKey: string) => {
    const def = defaultEpMap.get(epKey);
    if (!def) return;
    updateEndpoint(epKey, { params: cloneParams(def.params) });
    toast.success(`已恢复接口 [${def.name}] 的全部默认参数（保存后生效）`);
  };

  const handleResetEndpoint = (key: string) => {
    const def = defaultEpMap.get(key);
    if (!def) return;
    updateEndpoint(key, {
      method: def.method,
      pathTemplate: def.pathTemplate,
      params: cloneParams(def.params),
    });
    toast.success(`已恢复接口 [${def.name}] 为默认路由与参数（保存后生效）`);
  };

  const jumpToLinkedRule = (linkedRule: string) => {
    setTab("rules");
    const anchor = getRuleAnchorSection(linkedRule);
    toast.info(`已定位到关联全局规则字段: ${linkedRule}`);
    requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      const res = await api.probeDevopsConnection(
        loginUrlPreview,
        draft.rules.connectCheckTimeoutMs || 2500,
      );
      setProbeResult(res);
      if (res.reachable) {
        toast.success(res.message);
      } else {
        toast.warning(res.message);
      }
    } catch (e) {
      toast.error(`探测异常: ${String(e)}`);
    } finally {
      setProbing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await api.saveApiConfig(draft);
      setSavedCfg(saved);
      setDraft(cloneCfg(saved));
      await refreshSettings();
      toast.success("全部接口配置与参数规则已保存，并已实时生效");
    } catch (e) {
      toast.error(`保存失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    setSaving(true);
    try {
      const reset = await api.resetApiConfig();
      setSavedCfg(reset);
      setDraft(cloneCfg(reset));
      setResetConfirmOpen(false);
      setProbeResult(null);
      await refreshSettings();
      toast.success("已恢复全部默认接口与业务参数规则，并即时生效");
    } catch (e) {
      toast.error(`重置失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyText = async (key: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(`已复制${label}`);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      toast.error("复制失败");
    }
  };

  const openJsonModal = () => {
    setJsonText(JSON.stringify(draft, null, 2));
    setJsonModalOpen(true);
  };

  const handleImportJsonFromFile = async () => {
    try {
      const picked = await open({
        multiple: false,
        title: "导入接口与规则 JSON 配置文件",
        filters: [{ name: "JSON 文件", extensions: ["json"] }],
      });
      if (typeof picked !== "string" || !picked) return;
      const content = await api.readTextFile(picked);
      setJsonText(content);
      toast.success("已读取文件内容到编辑框，请点击「应用到当前配置」");
    } catch (e) {
      toast.error(`读取文件失败: ${String(e)}`);
    }
  };

  const handleApplyJsonImport = () => {
    try {
      const parsed = JSON.parse(jsonText) as Partial<ApiConfig>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON 顶层必须是对象");
      }
      if (!parsed.ip || typeof parsed.ip !== "string") {
        throw new Error("缺少有效的 ip 字段");
      }
      const next: ApiConfig = {
        scheme: parsed.scheme || draft.scheme,
        ip: parsed.ip,
        port: parsed.port ?? draft.port,
        loginPath: parsed.loginPath || draft.loginPath,
        spaceId: Number(parsed.spaceId) > 0 ? Number(parsed.spaceId) : draft.spaceId,
        endpoints: Array.isArray(parsed.endpoints)
          ? parsed.endpoints.map((ep) => ({
              ...ep,
              placeholders: Array.isArray(ep.placeholders) ? ep.placeholders : [],
              params: Array.isArray(ep.params)
                ? ep.params.map((raw) => normalizeParamSpec(raw))
                : [],
            }))
          : draft.endpoints,
        rules:
          parsed.rules && typeof parsed.rules === "object"
            ? { ...draft.rules, ...parsed.rules }
            : draft.rules,
        updatedAt: parsed.updatedAt || draft.updatedAt,
      };
      setDraft(next);
      setJsonModalOpen(false);
      toast.success("JSON 配置已导入草稿区（请确认后点击「保存并立即生效」）");
    } catch (e) {
      toast.error(`JSON 解析或校验失败: ${String(e)}`);
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([jsonText || JSON.stringify(draft, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lifework-api-config-${draft.ip || "default"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已导出 JSON 文件");
  };

  const reviewerEntries = Object.entries(draft.rules.builtinReviewers || {});
  const memberRateEntries = Object.entries(draft.rules.memberRates || {});

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      {/* 顶部标题与全局操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">接口配置与参数规则</h1>
            {hasUnsaved && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                有未保存修改
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            查看并逐项编辑全部 {draft.endpoints.length} 个接口的地址模板、Query / Body / Path / Header 参数及全局规则；保存后立即热生效，无需重启。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={probing}
            onClick={handleProbe}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {probing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
            ) : (
              <Activity className="h-3.5 w-3.5 text-blue-600" />
            )}
            <span>{probing ? "探测中..." : "测试连通性"}</span>
          </button>

          <button
            type="button"
            onClick={openJsonModal}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <FileJson className="h-3.5 w-3.5 text-indigo-600" />
            <span>导入 / 导出 JSON</span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => setResetConfirmOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>恢复全部默认</span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            <span>{saving ? "应用中..." : "保存并立即生效"}</span>
          </button>
        </div>
      </div>

      {/* 核心服务器连接参数卡片 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cable className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-900">DevOps 服务主机与基础参数</h2>
          </div>
          {draft.updatedAt && (
            <span className="text-[11px] text-gray-400">
              最近保存：{draft.updatedAt.replace("T", " ")}
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <span className="text-xs font-medium text-gray-700">协议 (scheme)</span>
            <select
              value={draft.scheme}
              onChange={(e) => setDraft({ ...draft, scheme: e.target.value })}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </label>

          <label className="block lg:col-span-2">
            <span className="text-xs font-medium text-gray-700">服务器 IP / 域名 (ip)</span>
            <input
              type="text"
              value={draft.ip}
              onChange={(e) => setDraft({ ...draft, ip: e.target.value })}
              placeholder="devops.example.local"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-700">端口 (port，默认可留空)</span>
            <input
              type="text"
              value={draft.port}
              onChange={(e) => setDraft({ ...draft, port: e.target.value })}
              placeholder="8880"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-700">空间 ID (spaceId)</span>
            <input
              type="number"
              min={1}
              value={draft.spaceId}
              onChange={(e) =>
                setDraft({ ...draft, spaceId: Number(e.target.value) || 26 })
              }
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-700">
              WebView2 登录入口路径 (loginPath)
            </span>
            <input
              type="text"
              value={draft.loginPath}
              onChange={(e) => setDraft({ ...draft, loginPath: e.target.value })}
              placeholder="/"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
              <span>实时解析地址（修改上方参数自动刷新预览）</span>
              <span className="font-mono text-gray-400">
                {"{host}"} · {"{spaceId}"} · {"{loginPath}"}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-xs">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 ring-1 ring-gray-200">
                  API Host
                </span>
                <span className="font-medium text-gray-800">{baseHostPreview}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 ring-1 ring-gray-200">
                  登录入口
                </span>
                <span className="font-medium text-blue-700">{loginUrlPreview}</span>
              </div>
            </div>
          </div>
        </div>

        {probeResult && (
          <div
            className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
              probeResult.reachable
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {probeResult.reachable ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              )}
              <div>
                <span className="font-medium">{probeResult.message}</span>
                <span className="ml-2 font-mono text-[11px] opacity-80">
                  ({probeResult.url})
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              {probeResult.statusCode != null && (
                <span className="rounded bg-white/80 px-1.5 py-0.5 font-semibold">
                  HTTP {probeResult.statusCode}
                </span>
              )}
              <span className="rounded bg-white/80 px-1.5 py-0.5">
                {probeResult.latencyMs}ms
              </span>
            </div>
          </div>
        )}
      </section>

      {/* 双视图切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-2">
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setTab("routes")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
              tab === "routes"
                ? "bg-white text-blue-700 shadow-2xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Cable className="h-3.5 w-3.5" />
            <span>接口路由与逐项参数 ({draft.endpoints.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("rules")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
              tab === "rules"
                ? "bg-white text-blue-700 shadow-2xs"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>全局业务参数与映射规则</span>
          </button>
        </div>

        {tab === "routes" && (
          <div className="text-[11px] text-gray-500">
            每个接口下方已直接展开可编辑 Query / Body / Path / Header 参数；保存后立即在运行时生效。
          </div>
        )}
      </div>

      {tab === "routes" ? (
        <div className="space-y-4">
          {/* 分组与搜索条 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {GROUP_META.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroupFilter(g.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    groupFilter === g.id
                      ? "bg-blue-600 text-white"
                      : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {g.label} ({groupCounts[g.id] ?? 0})
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const anyExpanded = filteredEndpoints.some((ep) => !collapsedParams[ep.key]);
                  const next: Record<string, boolean> = { ...collapsedParams };
                  for (const ep of filteredEndpoints) {
                    next[ep.key] = anyExpanded;
                  }
                  setCollapsedParams(next);
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {filteredEndpoints.some((ep) => !collapsedParams[ep.key]) ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5 text-gray-500" />
                    <span>全部收起参数</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
                    <span>全部展开参数</span>
                  </>
                )}
              </button>

              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={onlyModified}
                  onChange={(e) => setOnlyModified(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                />
                <span>只看已修改</span>
              </label>

              <div className="relative w-64">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索接口名 / key / 参数名..."
                  className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pr-3 pl-8 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {filteredEndpoints.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-12 text-center text-xs text-gray-400">
              未匹配到符合条件的接口条目
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEndpoints.map((ep) => {
                const def = defaultEpMap.get(ep.key);
                const params = ep.params ?? [];
                const isModified = isEndpointModified(ep, def);
                const paramsModified =
                  JSON.stringify(params) !== JSON.stringify(def?.params ?? []);
                const paramsOpen = !collapsedParams[ep.key];
                const docsOpen = Boolean(expandedDocs[ep.key]);
                const previewOpen = Boolean(expandedPreviews[ep.key]);
                const fullUrl = previewEndpointUrl(draft, ep, def);
                const bodyPreview = previewEndpointBody(draft, ep);
                const headerParams = params.filter((p) => p.enabled && p.location === "header");
                const methodCls =
                  METHOD_BADGE[ep.method.toUpperCase()] ?? METHOD_BADGE.GET;

                const locCounts: Record<string, number> = {};
                for (const p of params) {
                  locCounts[p.location] = (locCounts[p.location] ?? 0) + 1;
                }

                return (
                  <div
                    key={ep.key}
                    className={`lw-card p-4 transition ${
                      isModified
                        ? "border-amber-300 ring-1 ring-amber-100"
                        : "border-gray-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <select
                          value={ep.method}
                          onChange={(e) =>
                            updateEndpoint(ep.key, { method: e.target.value })
                          }
                          className={`rounded-lg border px-2 py-0.5 font-mono text-[11px] font-bold focus:outline-none ${methodCls}`}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="DELETE">DELETE</option>
                          <option value="PATCH">PATCH</option>
                          <option value="WEB">WEB</option>
                        </select>

                        <span className="text-xs font-semibold text-gray-900">
                          {ep.name}
                        </span>
                        <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-500">
                          {ep.key}
                        </code>
                        {LOCATION_ORDER.filter((loc) => (locCounts[loc] ?? 0) > 0).map(
                          (loc) => (
                            <span
                              key={loc}
                              className={`lw-nums rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                PARAM_LOC_META[loc]?.badgeCls ??
                                "border-gray-200 bg-gray-50 text-gray-600"
                              }`}
                            >
                              {PARAM_LOC_META[loc]?.label ?? loc} {locCounts[loc]}
                            </span>
                          ),
                        )}
                        {params.length === 0 && (
                          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-400">
                            无默认参数
                          </span>
                        )}
                        {isModified && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                            已自定义
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {isModified && (
                          <button
                            type="button"
                            onClick={() => handleResetEndpoint(ep.key)}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>恢复默认</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedParams((prev) => ({
                              ...prev,
                              [ep.key]: !prev[ep.key],
                            }))
                          }
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                            paramsOpen
                              ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          <span className="lw-nums">
                            {paramsOpen ? `收起参数 (${params.length})` : `展开参数 (${params.length})`}
                          </span>
                          {paramsOpen ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedDocs((prev) => ({
                              ...prev,
                              [ep.key]: !prev[ep.key],
                            }))
                          }
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
                        >
                          <span>{docsOpen ? "收起说明" : "原始说明"}</span>
                        </button>
                      </div>
                    </div>

                    <p className="mt-1.5 text-[11px] text-gray-500">{ep.description}</p>

                    {/* 可编辑路径模板 */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={ep.pathTemplate}
                        onChange={(e) =>
                          updateEndpoint(ep.key, { pathTemplate: e.target.value })
                        }
                        className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-1.5 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyText(`ep-${ep.key}`, fullUrl, "完整接口地址")
                        }
                        title="复制实时拼接后的完整 URL"
                        className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                      >
                        {copiedKey === `ep-${ep.key}` ? (
                          <Check className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>复制完整 URL</span>
                      </button>
                    </div>

                    {/* 实时拼接预览 + 占位符提示 */}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0 truncate font-mono text-gray-500" title={fullUrl}>
                        <span className="text-gray-400">实际请求预览：</span>
                        {fullUrl}
                      </div>
                      {ep.placeholders.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-gray-400">可用变量：</span>
                          {ep.placeholders.map((ph) => (
                            <button
                              key={ph}
                              type="button"
                              title={`点击复制 {${ph}}`}
                              onClick={() =>
                                handleCopyText(
                                  `ph-${ep.key}-${ph}`,
                                  `{${ph}}`,
                                  `变量 {${ph}}`,
                                )
                              }
                              className="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 hover:bg-blue-100"
                            >
                              {`{${ph}}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 直接可见且可逐项编辑的参数面板 */}
                    {paramsOpen && (
                      <div className="mt-3 rounded-xl border border-gray-200/80 bg-gray-50/70 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold text-gray-700">
                              接口请求参数 ({params.filter((p) => p.enabled).length}/{params.length} 项启用)
                            </span>
                            <span className="text-[10px] text-gray-400">
                              可直接改名、改值、改位置或停用，也支持 {"{rules.xxx}"} / {"{spaceId}"} 变量
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {(bodyPreview || headerParams.length > 0) && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedPreviews((prev) => ({
                                    ...prev,
                                    [ep.key]: !prev[ep.key],
                                  }))
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100"
                              >
                                <FileJson className="h-3 w-3 text-indigo-500" />
                                <span>{previewOpen ? "隐藏载荷预览" : "实时载荷预览"}</span>
                              </button>
                            )}
                            {paramsModified && def && (
                              <button
                                type="button"
                                onClick={() => handleResetEndpointParams(ep.key)}
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>重置参数</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => addEndpointParam(ep)}
                              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                            >
                              <Plus className="h-3 w-3" />
                              <span>新增参数</span>
                            </button>
                          </div>
                        </div>

                        {params.length === 0 ? (
                          <div className="mt-2 rounded-lg border border-dashed border-gray-200 bg-white/80 px-3 py-2 text-[11px] text-gray-400">
                            该接口默认无需传参；如需追加自定义 Query / Header 参数，请点击右上角「新增参数」。
                          </div>
                        ) : (
                          <div className="mt-2 space-y-1.5">
                            {params.map((p, idx) => {
                              const pMod = isParamModified(p, def);
                              const renamed =
                                Boolean(p.sourceKey) && p.key.trim() !== p.sourceKey.trim();
                              const locCls =
                                PARAM_LOC_META[p.location]?.badgeCls ??
                                "border-gray-200 bg-gray-100 text-gray-700";

                              return (
                                <div
                                  key={`${ep.key}-p-${idx}`}
                                  className={`rounded-lg border px-2.5 py-2 transition ${
                                    !p.enabled
                                      ? "border-gray-200 bg-gray-100/80 opacity-65"
                                      : pMod
                                        ? "border-amber-200 bg-amber-50/40"
                                        : "border-gray-200 bg-white"
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <label
                                      title={p.enabled ? "已启用：点击停用此参数" : "已停用：请求时移除此参数"}
                                      className="inline-flex cursor-pointer items-center gap-1 pr-1 text-[11px] text-gray-600"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={p.enabled}
                                        onChange={(e) =>
                                          updateEndpointParam(ep.key, idx, {
                                            enabled: e.target.checked,
                                          })
                                        }
                                        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                                      />
                                      <span className="sr-only">启用</span>
                                    </label>

                                    <select
                                      value={p.location}
                                      onChange={(e) =>
                                        updateEndpointParam(ep.key, idx, {
                                          location: e.target.value,
                                        })
                                      }
                                      title="参数位置"
                                      className={`rounded-md border px-1.5 py-1 font-mono text-[10px] font-semibold focus:outline-none ${locCls}`}
                                    >
                                      <option value="query">Query</option>
                                      <option value="body">Body</option>
                                      <option value="path">Path</option>
                                      <option value="header">Header</option>
                                      <option value="form">Form</option>
                                    </select>

                                    <input
                                      type="text"
                                      value={p.key}
                                      onChange={(e) =>
                                        updateEndpointParam(ep.key, idx, {
                                          key: e.target.value,
                                        })
                                      }
                                      placeholder="参数名 (支持 a.b)"
                                      className="w-36 min-w-[110px] rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] text-gray-900 focus:border-blue-500 focus:outline-none"
                                    />

                                    <select
                                      value={p.valueType}
                                      onChange={(e) =>
                                        updateEndpointParam(ep.key, idx, {
                                          valueType: e.target.value,
                                        })
                                      }
                                      title="参数数据类型"
                                      className="rounded-lg border border-gray-200 bg-white px-1.5 py-1 font-mono text-[10px] text-gray-700 focus:border-blue-500 focus:outline-none"
                                    >
                                      <option value="string">string</option>
                                      <option value="number">number</option>
                                      <option value="boolean">boolean</option>
                                      <option value="json">json</option>
                                      <option value="file">file</option>
                                    </select>

                                    {(() => {
                                      const isSecretParam =
                                        isSensitiveParamKey(p.key) &&
                                        !/^\{[^{}]+\}$/.test(p.value.trim());
                                      const secretKey = `${ep.key}:${idx}`;
                                      const revealed = Boolean(secretVisibility[secretKey]);
                                      return isSecretParam ? (
                                        <div className="relative min-w-[150px] flex-1">
                                          <input
                                            type={revealed ? "text" : "password"}
                                            value={p.value}
                                            onChange={(e) =>
                                              updateEndpointParam(ep.key, idx, {
                                                value: e.target.value,
                                              })
                                            }
                                            placeholder="参数值 / 模板 (如 {cardId} 或固定值)"
                                            className="w-full rounded-lg border border-gray-200 bg-white py-1 pr-7 pl-2 font-mono text-[11px] text-gray-800 focus:border-blue-500 focus:outline-none"
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setSecretVisibility((prev) => ({
                                                ...prev,
                                                [secretKey]: !prev[secretKey],
                                              }))
                                            }
                                            aria-label={
                                              revealed
                                                ? `隐藏 ${p.key || "参数"}`
                                                : `显示 ${p.key || "参数"}`
                                            }
                                            title={revealed ? "隐藏敏感值" : "显示敏感值"}
                                            className="absolute inset-y-0 right-1 flex items-center rounded px-1 text-gray-400 hover:text-gray-700"
                                          >
                                            {revealed ? (
                                              <EyeOff className="h-3.5 w-3.5" />
                                            ) : (
                                              <Eye className="h-3.5 w-3.5" />
                                            )}
                                          </button>
                                        </div>
                                      ) : (
                                        <input
                                          type="text"
                                          value={p.value}
                                          onChange={(e) =>
                                            updateEndpointParam(ep.key, idx, {
                                              value: e.target.value,
                                            })
                                          }
                                          placeholder="参数值 / 模板 (如 {cardId} 或固定值)"
                                          className="min-w-[150px] flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] text-gray-800 focus:border-blue-500 focus:outline-none"
                                        />
                                      );
                                    })()}

                                    <div className="flex items-center gap-1">
                                      {p.required && (
                                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 ring-1 ring-rose-200">
                                          必填
                                        </span>
                                      )}
                                      {renamed && (
                                        <span
                                          title={`原内置字段名: ${p.sourceKey}`}
                                          className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-800"
                                        >
                                          原:{p.sourceKey}
                                        </span>
                                      )}
                                      {!p.sourceKey && (
                                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                                          新增
                                        </span>
                                      )}
                                      {p.linkedRule && (
                                        <button
                                          type="button"
                                          onClick={() => jumpToLinkedRule(p.linkedRule)}
                                          title={`点击查看全局规则字段: ${p.linkedRule}`}
                                          className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 hover:bg-blue-100"
                                        >
                                          <Link2 className="h-2.5 w-2.5" />
                                          <span>{p.linkedRule}</span>
                                        </button>
                                      )}
                                      {p.sourceKey && pMod && def && (
                                        <button
                                          type="button"
                                          title="恢复该参数为默认值"
                                          onClick={() => resetSingleParam(ep.key, idx)}
                                          className="rounded p-1 text-amber-600 hover:bg-amber-100"
                                        >
                                          <RotateCcw className="h-3 w-3" />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        title="删除该参数"
                                        onClick={() => removeEndpointParam(ep.key, idx)}
                                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="mt-1.5 flex items-center gap-2 pl-5">
                                    <span className="shrink-0 text-[10px] text-gray-400">说明:</span>
                                    <input
                                      type="text"
                                      value={p.description}
                                      onChange={(e) =>
                                        updateEndpointParam(ep.key, idx, {
                                          description: e.target.value,
                                        })
                                      }
                                      placeholder="填写参数说明（可选）"
                                      className="min-w-0 flex-1 border-b border-transparent bg-transparent py-0.5 text-[11px] text-gray-500 focus:border-blue-300 focus:bg-white focus:px-1.5 focus:text-gray-800 focus:outline-none"
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {previewOpen && (bodyPreview || headerParams.length > 0) && (
                          <div className="mt-2.5 space-y-2 rounded-lg border border-indigo-100 bg-white p-2.5 text-[11px]">
                            {headerParams.length > 0 && (
                              <div>
                                <div className="font-semibold text-gray-700">
                                  附加请求头 (Headers)：
                                </div>
                                <div className="mt-1 space-y-0.5 font-mono text-[10px] text-gray-600">
                                  {headerParams.map((hp, hi) => (
                                    <div key={`hp-${hi}`}>
                                      {hp.key}: {resolveTemplatePreview(draft, hp.value)}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {bodyPreview && (
                              <div>
                                <div className="font-semibold text-gray-700">
                                  {ep.key === "wechat_webservice"
                                    ? "SOAP 字段参数实时预览："
                                    : "Body JSON 结构实时预览："}
                                </div>
                                <pre className="mt-1 max-h-44 overflow-auto rounded bg-gray-50 p-2 font-mono text-[10px] text-gray-700">
                                  {bodyPreview}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {docsOpen && (
                      <div className="mt-2.5 space-y-1.5 rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs">
                        <div>
                          <span className="font-semibold text-gray-700">
                            Query / Path 摘要：
                          </span>
                          <span className="font-mono text-[11px] text-gray-600">
                            {ep.queryParamsDoc || "无"}
                          </span>
                        </div>
                        <div>
                          <span className="font-semibold text-gray-700">
                            Body / 载荷摘要：
                          </span>
                          <span className="font-mono text-[11px] text-gray-600">
                            {ep.bodyParamsDoc || "无"}
                          </span>
                        </div>
                        {def && (
                          <div className="border-t border-gray-200/70 pt-1.5 font-mono text-[11px] text-gray-400">
                            默认路由：[{def.method}] {def.pathTemplate}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Tab 2: 业务参数与映射规则 */
        <div className="space-y-5">
          {/* 1. 网络超时与重试 */}
          <section id="rule-sec-network" className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">1. 网络探活、超时与重试规则</h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <RuleNumberField
                label="登录前连通探测超时 (ms)"
                value={draft.rules.connectCheckTimeoutMs}
                min={400}
                step={100}
                onChange={(v) => updateRule("connectCheckTimeoutMs", Math.round(v))}
              />
              <RuleNumberField
                label="常规接口请求超时 (秒)"
                value={draft.rules.requestTimeoutSecs}
                min={3}
                step={1}
                onChange={(v) => updateRule("requestTimeoutSecs", Math.round(v))}
              />
              <RuleNumberField
                label="附件上传请求超时 (秒)"
                value={draft.rules.uploadTimeoutSecs}
                min={5}
                step={5}
                onChange={(v) => updateRule("uploadTimeoutSecs", Math.round(v))}
              />
              <RuleNumberField
                label="断线自动重试次数 (0~5)"
                value={draft.rules.maxRetries}
                min={0}
                max={5}
                step={1}
                onChange={(v) => updateRule("maxRetries", Math.round(v))}
              />
              <RuleNumberField
                label="后台会话保活间隔 (秒，默认 1200s=20分钟)"
                value={draft.rules.keepAliveIntervalSecs}
                min={30}
                max={7200}
                step={60}
                onChange={(v) => updateRule("keepAliveIntervalSecs", Math.round(v))}
              />
            </div>
            <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium text-gray-800">
                  <input
                    type="checkbox"
                    checked={draft.rules.keepAliveMouseNudge ?? true}
                    onChange={(e) => updateRule("keepAliveMouseNudge", e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>保活时微调鼠标 (±1px) 防止系统判定无人操作</span>
                </label>
                {(draft.rules.keepAliveMouseNudge ?? true) && (
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700">
                    <label className="flex cursor-pointer items-center gap-1.5 font-medium">
                      <input
                        type="checkbox"
                        checked={(draft.rules.keepAliveMouseNudgeIntervalSecs ?? 0) === 0}
                        onChange={(e) =>
                          updateRule(
                            "keepAliveMouseNudgeIntervalSecs",
                            e.target.checked ? 0 : draft.rules.keepAliveIntervalSecs || 1200,
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>频次与保活接口请求一致</span>
                    </label>
                    {(draft.rules.keepAliveMouseNudgeIntervalSecs ?? 0) > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-gray-500">自定义间隔 (秒):</span>
                        <input
                          type="number"
                          min={30}
                          max={7200}
                          step={60}
                          value={draft.rules.keepAliveMouseNudgeIntervalSecs ?? 1200}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n)) {
                              updateRule(
                                "keepAliveMouseNudgeIntervalSecs",
                                Math.max(30, Math.min(7200, Math.round(n))),
                              );
                            }
                          }}
                          className="w-20 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-mono text-gray-800 focus:border-blue-500 focus:outline-none"
                        />
                        <span className="text-[11px] text-gray-500">
                          (约 {Math.round(((draft.rules.keepAliveMouseNudgeIntervalSecs ?? 1200) / 60) * 10) / 10} 分钟)
                        </span>
                      </div>
                    ) : (
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                        当前每 {Math.round(((draft.rules.keepAliveIntervalSecs || 1200) / 60) * 10) / 10} 分钟移动一次
                      </span>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-1 pl-6.5 text-[11px] text-gray-500">
                默认与保活接口请求同频（每 20 分钟 / 1200 秒），也可取消勾选“频次与保活接口请求一致”后单独设置间隔；触发时若检测到空闲超过 5 秒，将静默轻移鼠标 ±1px 并发送防休眠信号（鼠标回到原位、不干扰正常操作）。
              </p>
            </div>
          </section>

          {/* 2. 工时与排期规则 */}
          <section id="rule-sec-hours" className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">2. 工时折算、排期调度与统计规则</h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <RuleNumberField
                label="标准人天折算 (timeWork, h/d)"
                value={draft.rules.timeWork}
                min={0.5}
                step={0.5}
                onChange={(v) => updateRule("timeWork", v)}
              />
              <RuleNumberField
                label="单日最高可排工时 (maxDailyHours)"
                value={draft.rules.maxDailyHours}
                min={1}
                step={0.5}
                onChange={(v) => updateRule("maxDailyHours", v)}
              />
              <RuleNumberField
                label="动态拆解首选单日小时数"
                value={draft.rules.dynamicPreferredHours}
                min={0.5}
                step={0.5}
                onChange={(v) => updateRule("dynamicPreferredHours", v)}
              />
              <RuleNumberField
                label="月度工作日基数 (统计目标用)"
                value={draft.rules.monthlyWorkdaysFactor}
                min={1}
                step={0.25}
                onChange={(v) => updateRule("monthlyWorkdaysFactor", v)}
              />
              <RuleNumberField
                label="默认开发角色编码 (roleCode)"
                value={draft.rules.defaultRoleCode}
                min={1}
                step={1}
                onChange={(v) => updateRule("defaultRoleCode", Math.round(v))}
              />
              <RuleNumberField
                label="默认测试角色编码 (QA roleCode)"
                value={draft.rules.defaultQaRoleCode}
                min={1}
                step={1}
                onChange={(v) => updateRule("defaultQaRoleCode", Math.round(v))}
              />
              <RuleNumberField
                label="卡片类型过滤码 (0=不过滤)"
                value={draft.rules.workItemTypeCode}
                min={0}
                step={1}
                onChange={(v) => updateRule("workItemTypeCode", Math.round(v))}
              />
              <RuleNumberField
                label="需跳过迭代 ID (0=不跳过)"
                value={draft.rules.skipSprintId}
                min={0}
                step={1}
                onChange={(v) => updateRule("skipSprintId", Math.round(v))}
              />
              <RuleNumberField
                label="卡片列表每页拉取数 (pageSize)"
                value={draft.rules.cardPageSize}
                min={10}
                step={10}
                onChange={(v) => updateRule("cardPageSize", Math.round(v))}
              />
              <RuleNumberField
                label="提报状态码 (declareStatus)"
                value={draft.rules.declareStatus}
                min={0}
                step={1}
                onChange={(v) => updateRule("declareStatus", Math.round(v))}
              />
              <RuleNumberField
                label="未配置成员默认工时系数"
                value={draft.rules.defaultMemberRate}
                min={0.1}
                max={2}
                step={0.05}
                onChange={(v) => updateRule("defaultMemberRate", v)}
              />
              <label className="block">
                <span className="text-xs font-medium text-gray-700">默认填报备注文案</span>
                <input
                  type="text"
                  value={draft.rules.defaultDeclareDesc}
                  onChange={(e) => updateRule("defaultDeclareDesc", e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>
          </section>

          {/* 3. MR 审批合并 & 流转检查单 & 企微参数 */}
          <section id="rule-sec-mr-flow" className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">
              3. 代码评审合并、卡片流转与企业微信参数规则
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="text-xs font-medium text-gray-700">默认自评审批人姓名</span>
                <input
                  type="text"
                  value={draft.rules.defaultReviewerName}
                  onChange={(e) => updateRule("defaultReviewerName", e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">默认自评审批人 UserId</span>
                <input
                  type="text"
                  value={draft.rules.defaultReviewerId}
                  onChange={(e) => updateRule("defaultReviewerId", e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <RuleNumberField
                label="MR 审批通过分值 (approveScore)"
                value={draft.rules.approveScore}
                min={0}
                step={1}
                onChange={(v) => updateRule("approveScore", Math.round(v))}
              />
              <label className="block">
                <span className="text-xs font-medium text-gray-700">合并策略 (mergeStrategy)</span>
                <input
                  type="text"
                  value={draft.rules.mergeStrategy}
                  onChange={(e) => updateRule("mergeStrategy", e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">
                  自动一键合批仓库关键字
                </span>
                <input
                  type="text"
                  value={draft.rules.autoApproveKeyword}
                  onChange={(e) => updateRule("autoApproveKeyword", e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">计划提测日期字段名</span>
                <input
                  type="text"
                  value={draft.rules.planTestDateField}
                  onChange={(e) => updateRule("planTestDateField", e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">流转 action 标识</span>
                <input
                  type="text"
                  value={draft.rules.statusFlowAction}
                  onChange={(e) => updateRule("statusFlowAction", e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <RuleNumberField
                label="检查单通过结果码"
                value={draft.rules.checklistPassResult}
                min={0}
                step={1}
                onChange={(v) => updateRule("checklistPassResult", Math.round(v))}
              />
              <label className="block">
                <span className="text-xs font-medium text-gray-700">
                  自动设日期触发状态 (逗号分隔)
                </span>
                <input
                  type="text"
                  value={(draft.rules.planDateTriggerStatuses ?? []).join(", ")}
                  onChange={(e) => {
                    const nums = e.target.value
                      .split(/[,，\s]+/)
                      .map((s) => Number(s.trim()))
                      .filter((n) => Number.isFinite(n) && n > 0);
                    updateRule("planDateTriggerStatuses", nums);
                  }}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <RuleNumberField
                label="测试审核阶段 ID (附件绑定)"
                value={draft.rules.testAuditStatusId}
                min={1}
                step={1}
                onChange={(v) => updateRule("testAuditStatusId", Math.round(v))}
              />
              <RuleNumberField
                label="UAT 验收阶段 ID (转交验收人)"
                value={draft.rules.uatVerifyStatusId}
                min={1}
                step={1}
                onChange={(v) => updateRule("uatVerifyStatusId", Math.round(v))}
              />
              <label className="block">
                <span className="text-xs font-medium text-gray-700">企微 SOAP 命名空间</span>
                <input
                  type="text"
                  value={draft.rules.wechatSoapNamespace}
                  onChange={(e) => updateRule("wechatSoapNamespace", e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>
            <div className="mt-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-700">
                  企微 Webhook Key 自动补全前缀
                </span>
                <input
                  type="text"
                  value={draft.rules.wechatWebhookPrefix}
                  onChange={(e) => updateRule("wechatWebhookPrefix", e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>
          </section>

          {/* 4. 内置评审人 UserId 映射 + 成员工时系数 */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-900">
                4. 内置评审人 UserId 映射 ({reviewerEntries.length})
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">
                提交 MR 时优先从此处直接匹配数字 userId，省去模糊接口查询。
              </p>
              <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {reviewerEntries.map(([name, uid]) => (
                  <div key={name} className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={name}
                      className="w-28 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-800"
                    />
                    <input
                      type="number"
                      value={uid}
                      onChange={(e) => {
                        const next = { ...draft.rules.builtinReviewers };
                        next[name] = Number(e.target.value) || 0;
                        updateRule("builtinReviewers", next);
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...draft.rules.builtinReviewers };
                        delete next[name];
                        updateRule("builtinReviewers", next);
                      }}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                <input
                  type="text"
                  value={newRevName}
                  onChange={(e) => setNewRevName(e.target.value)}
                  placeholder="姓名"
                  className="w-28 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="number"
                  value={newRevId}
                  onChange={(e) => setNewRevId(e.target.value)}
                  placeholder="数字 userId"
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const n = newRevName.trim();
                    const id = Number(newRevId.trim());
                    if (!n || !Number.isFinite(id) || id <= 0) {
                      toast.error("请输入有效的姓名与数字 userId");
                      return;
                    }
                    updateRule("builtinReviewers", {
                      ...draft.rules.builtinReviewers,
                      [n]: Math.round(id),
                    });
                    setNewRevName("");
                    setNewRevId("");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>添加</span>
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-900">
                5. 成员工作量系数 ({memberRateEntries.length})
              </h3>
              <p className="mt-0.5 text-xs text-gray-500">
                团队统计时计算「应完成 = 月数 × 日基数 × 成员系数」。
              </p>
              <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {memberRateEntries.map(([name, rate]) => (
                  <div key={name} className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={name}
                      className="w-28 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-800"
                    />
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={2}
                      value={rate}
                      onChange={(e) => {
                        const next = { ...draft.rules.memberRates };
                        next[name] = Number(e.target.value) || 0;
                        updateRule("memberRates", next);
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...draft.rules.memberRates };
                        delete next[name];
                        updateRule("memberRates", next);
                      }}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                <input
                  type="text"
                  value={newRateName}
                  onChange={(e) => setNewRateName(e.target.value)}
                  placeholder="成员姓名"
                  className="w-28 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="number"
                  step={0.05}
                  value={newRateVal}
                  onChange={(e) => setNewRateVal(e.target.value)}
                  placeholder="系数 (如 0.9)"
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const n = newRateName.trim();
                    const r = Number(newRateVal);
                    if (!n || !Number.isFinite(r) || r <= 0) {
                      toast.error("请输入有效的成员姓名与大于 0 的系数");
                      return;
                    }
                    updateRule("memberRates", {
                      ...draft.rules.memberRates,
                      [n]: r,
                    });
                    setNewRateName("");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>添加</span>
                </button>
              </div>
            </section>
          </div>

          {/* 6. 仓库 → 标签映射 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">
              6. 代码仓库 → 自动标签映射 ({draft.rules.repoToTagMapping.length})
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              根据工程名称关键字自动匹配并打上卡片空间标签。
            </p>
            <div className="mt-3 space-y-2">
              {draft.rules.repoToTagMapping.map((item, idx) => (
                <div
                  key={`${item.repoKeyword}-${idx}`}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-12"
                >
                  <input
                    type="text"
                    value={item.repoKeyword}
                    onChange={(e) => {
                      const next = [...draft.rules.repoToTagMapping];
                      next[idx] = { ...item, repoKeyword: e.target.value };
                      updateRule("repoToTagMapping", next);
                    }}
                    placeholder="仓库关键字"
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-4"
                  />
                  <input
                    type="text"
                    value={item.tagName}
                    onChange={(e) => {
                      const next = [...draft.rules.repoToTagMapping];
                      next[idx] = { ...item, tagName: e.target.value };
                      updateRule("repoToTagMapping", next);
                    }}
                    placeholder="标签名"
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs sm:col-span-2"
                  />
                  <input
                    type="number"
                    value={item.tagId}
                    onChange={(e) => {
                      const next = [...draft.rules.repoToTagMapping];
                      next[idx] = { ...item, tagId: Number(e.target.value) || 0 };
                      updateRule("repoToTagMapping", next);
                    }}
                    placeholder="标签 ID"
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-2"
                  />
                  <input
                    type="text"
                    value={item.exampleProject}
                    onChange={(e) => {
                      const next = [...draft.rules.repoToTagMapping];
                      next[idx] = { ...item, exampleProject: e.target.value };
                      updateRule("repoToTagMapping", next);
                    }}
                    placeholder="示例仓库路径"
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-3"
                  />
                  <div className="flex items-center justify-end sm:col-span-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateRule(
                          "repoToTagMapping",
                          draft.rules.repoToTagMapping.filter((_, i) => i !== idx),
                        )
                      }
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 border-t border-gray-100 pt-3 sm:grid-cols-12">
              <input
                type="text"
                value={newTagRule.repoKeyword}
                onChange={(e) =>
                  setNewTagRule({ ...newTagRule, repoKeyword: e.target.value })
                }
                placeholder="仓库关键字 (如 core-service)"
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-4"
              />
              <input
                type="text"
                value={newTagRule.tagName}
                onChange={(e) =>
                  setNewTagRule({ ...newTagRule, tagName: e.target.value })
                }
                placeholder="标签名称"
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs sm:col-span-2"
              />
              <input
                type="number"
                value={newTagRule.tagId}
                onChange={(e) =>
                  setNewTagRule({ ...newTagRule, tagId: Number(e.target.value) || 0 })
                }
                placeholder="标签 ID"
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-2"
              />
              <input
                type="text"
                value={newTagRule.exampleProject}
                onChange={(e) =>
                  setNewTagRule({ ...newTagRule, exampleProject: e.target.value })
                }
                placeholder="示例路径 (可选)"
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-3"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newTagRule.repoKeyword.trim() || !newTagRule.tagName.trim()) {
                    toast.error("请填写仓库关键字和标签名称");
                    return;
                  }
                  updateRule("repoToTagMapping", [
                    ...draft.rules.repoToTagMapping,
                    {
                      ...newTagRule,
                      repoKeyword: newTagRule.repoKeyword.trim(),
                      tagName: newTagRule.tagName.trim(),
                    },
                  ]);
                  setNewTagRule({
                    repoKeyword: "",
                    tagName: "",
                    tagId: 100,
                    exampleProject: "",
                  });
                }}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 sm:col-span-1"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>

          {/* 7. 卡片状态流转步骤定义 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">
              7. 卡片状态流转顺序表 ({draft.rules.statusFlowSteps.length})
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              卡片一键流转流水线严格按此顺序依次推进状态 ID；若目标空间状态 ID 变化可在此调整。
            </p>
            <div className="mt-3 space-y-2">
              {draft.rules.statusFlowSteps.map((st, idx) => (
                <div
                  key={`${st.id}-${idx}`}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-12"
                >
                  <input
                    type="number"
                    value={st.id}
                    onChange={(e) => {
                      const next = [...draft.rules.statusFlowSteps];
                      next[idx] = { ...st, id: Number(e.target.value) || 0 };
                      updateRule("statusFlowSteps", next);
                    }}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-2"
                  />
                  <input
                    type="text"
                    value={st.key}
                    onChange={(e) => {
                      const next = [...draft.rules.statusFlowSteps];
                      next[idx] = { ...st, key: e.target.value };
                      updateRule("statusFlowSteps", next);
                    }}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-2"
                  />
                  <input
                    type="text"
                    value={st.name}
                    onChange={(e) => {
                      const next = [...draft.rules.statusFlowSteps];
                      next[idx] = { ...st, name: e.target.value };
                      updateRule("statusFlowSteps", next);
                    }}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium sm:col-span-3"
                  />
                  <input
                    type="text"
                    value={st.desc}
                    onChange={(e) => {
                      const next = [...draft.rules.statusFlowSteps];
                      next[idx] = { ...st, desc: e.target.value };
                      updateRule("statusFlowSteps", next);
                    }}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs sm:col-span-4"
                  />
                  <div className="flex items-center justify-end sm:col-span-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateRule(
                          "statusFlowSteps",
                          draft.rules.statusFlowSteps.filter((_, i) => i !== idx),
                        )
                      }
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 border-t border-gray-100 pt-3 sm:grid-cols-12">
              <input
                type="number"
                value={newStep.id}
                onChange={(e) =>
                  setNewStep({ ...newStep, id: Number(e.target.value) || 0 })
                }
                placeholder="状态 ID"
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-2"
              />
              <input
                type="text"
                value={newStep.key}
                onChange={(e) => setNewStep({ ...newStep, key: e.target.value })}
                placeholder="key (如 prod)"
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-xs sm:col-span-2"
              />
              <input
                type="text"
                value={newStep.name}
                onChange={(e) => setNewStep({ ...newStep, name: e.target.value })}
                placeholder="阶段名称"
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs sm:col-span-3"
              />
              <input
                type="text"
                value={newStep.desc}
                onChange={(e) => setNewStep({ ...newStep, desc: e.target.value })}
                placeholder="阶段描述"
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs sm:col-span-4"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newStep.key.trim() || !newStep.name.trim() || newStep.id <= 0) {
                    toast.error("请填写大于 0 的状态 ID、key 和阶段名称");
                    return;
                  }
                  updateRule("statusFlowSteps", [
                    ...draft.rules.statusFlowSteps,
                    {
                      ...newStep,
                      key: newStep.key.trim(),
                      name: newStep.name.trim(),
                    },
                  ]);
                  setNewStep({ id: newStep.id + 10, key: "", name: "", desc: "" });
                }}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 sm:col-span-1"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>
        </div>
      )}

      {/* JSON 导入 / 导出弹窗 */}
      {jsonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  导入 / 导出接口配置 JSON
                </h3>
                <p className="text-[11px] text-gray-500">
                  可直接复制备份、下载为文件，或粘贴/选择团队共享的 JSON 配置切换整套环境。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setJsonModalOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={16}
              className="mt-3 min-h-0 flex-1 rounded-xl border border-gray-200 p-3 font-mono text-[11px] text-gray-800 focus:border-blue-500 focus:outline-none"
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleImportJsonFromFile}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Upload className="h-3.5 w-3.5 text-blue-600" />
                  <span>从文件加载</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-600" />
                  <span>导出 .json</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyText("json-all", jsonText, "配置 JSON")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Copy className="h-3.5 w-3.5 text-gray-600" />
                  <span>复制全部</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setJsonModalOpen(false)}
                  className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  关闭
                </button>
                <button
                  type="button"
                  onClick={handleApplyJsonImport}
                  className="rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  应用到当前配置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 恢复全部默认确认弹窗 */}
      {resetConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-gray-900">
              确认恢复全部默认接口与规则？
            </h3>
            <p className="mt-1.5 text-xs text-gray-500">
              此操作将把服务器地址还原为默认 <code className="font-mono">devops.example.local:8880</code>，并重置全部 32 条接口路径模板与业务参数规则，且立即生效。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleResetAll}
                className="rounded-xl bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {saving ? "恢复中..." : "确认恢复默认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleNumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (val: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}
