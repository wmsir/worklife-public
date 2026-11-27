import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Coffee,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  FolderSearch,
  Import,
  Info,
  Loader2,
  Lock,
  RotateCcw,
  Save,
  ScrollText,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { WechatPreviewCard } from "../components/WechatPreviewCard";
import { api, wtCall } from "../lib/api";
import type { CookieRec, Settings, WechatConfig } from "../lib/types";
import { APP_RELEASE_DATE, APP_VERSION } from "../lib/version";
import {
  WECHAT_TEMPLATE_FIELDS,
  WECHAT_TEMPLATE_PRESETS,
  type WechatTemplateKey,
  type WechatTemplatePreset,
  fillMissingWechatTemplates,
  formatWechatSampleText,
} from "../lib/wechatTemplates";
import { useAppStore } from "../store/appStore";
import { useFocusStore, useLogStore } from "../store/runtimeStore";

function cloneSettings(s: Settings): Settings {
  return JSON.parse(JSON.stringify(s)) as Settings;
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { settings, saveSettings, chooseDataRoot, setUser, pushLog } = useAppStore(
    useShallow((s) => ({
      settings: s.settings,
      saveSettings: s.saveSettings,
      chooseDataRoot: s.chooseDataRoot,
      setUser: s.setUser,
      pushLog: s.pushLog,
    })),
  );

  const [prefilledTplBanner, setPrefilledTplBanner] = useState(() =>
    Boolean(settings && fillMissingWechatTemplates(settings.worktime.wechat_config).filledAny),
  );
  const [draft, setDraft] = useState<Settings | null>(() => {
    if (!settings) return null;
    const cloned = cloneSettings(settings);
    const { next } = fillMissingWechatTemplates(cloned.worktime.wechat_config);
    cloned.worktime.wechat_config = next;
    return cloned;
  });
  const [reviewersJson, setReviewersJson] = useState<string>(() =>
    settings
      ? JSON.stringify(settings.worktime.branch_default_reviewers ?? {}, null, 2)
      : "{}",
  );
  const [saving, setSaving] = useState(false);
  const [resettingTpl, setResettingTpl] = useState(false);
  const [showSysIdPass, setShowSysIdPass] = useState(false);
  const [tplPreviewMode, setTplPreviewMode] = useState(true);

  const {
    breakReminderMins,
    breakDurationMins,
    breakLockEnabled,
    breakStrictMode,
    breakCompletedToday,
    setBreakConfig,
    resetBreakTimer,
    triggerBreakNow,
  } = useFocusStore(
    useShallow((s) => ({
      breakReminderMins: s.breakReminderMins,
      breakDurationMins: s.breakDurationMins,
      breakLockEnabled: s.breakLockEnabled,
      breakStrictMode: s.breakStrictMode,
      breakCompletedToday: s.breakCompletedToday,
      setBreakConfig: s.setBreakConfig,
      resetBreakTimer: s.resetBreakTimer,
      triggerBreakNow: s.triggerBreakNow,
    })),
  );

  useEffect(() => {
    if (settings) {
      const cloned = cloneSettings(settings);
      const { next, filledAny } = fillMissingWechatTemplates(cloned.worktime.wechat_config);
      cloned.worktime.wechat_config = next;
      setDraft(cloned);
      setPrefilledTplBanner(filledAny);
      setReviewersJson(
        JSON.stringify(settings.worktime.branch_default_reviewers ?? {}, null, 2),
      );
    }
  }, [settings]);

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        正在读取系统配置...
      </div>
    );
  }

  const wt = draft.worktime;
  const wx = wt.wechat_config;

  const updateWt = <K extends keyof typeof wt>(key: K, val: (typeof wt)[K]) => {
    setDraft((prev) =>
      prev ? { ...prev, worktime: { ...prev.worktime, [key]: val } } : prev,
    );
  };

  const updateWx = <K extends keyof WechatConfig>(key: K, val: WechatConfig[K]) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            worktime: {
              ...prev.worktime,
              wechat_config: { ...prev.worktime.wechat_config, [key]: val },
            },
          }
        : prev,
    );
  };

  const handleChooseDataRoot = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择 LifeWork 本地数据根目录",
      });
      if (typeof selected === "string" && selected.trim()) {
        const updated = await chooseDataRoot(selected);
        setDraft(cloneSettings(updated));
        toast.success(`数据根目录已切换为: ${updated.dataRoot}`);
      }
    } catch (e) {
      toast.error(`切换目录失败: ${String(e)}`);
    }
  };

  const handleImportOldConfig = async () => {
    try {
      const picked = await open({
        multiple: false,
        title: "选择旧版 worktime 的 config.json",
        filters: [{ name: "JSON 配置文件", extensions: ["json"] }],
      });
      if (typeof picked !== "string" || !picked) return;

      const raw = await api.readTextFile(picked);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("config.json 格式不是合法的 JSON 对象");
      }

      // Support both flat legacy config.json and nested worktime key
      const src =
        parsed.worktime && typeof parsed.worktime === "object"
          ? (parsed.worktime as Record<string, unknown>)
          : parsed;

      const nextWt = { ...draft.worktime };
      if (typeof src.ip === "string") nextWt.ip = src.ip.trim();
      if (src.space_id !== undefined && src.space_id !== null) {
        nextWt.space_id = String(src.space_id);
      }
      if (typeof src.role_name === "string") nextWt.role_name = src.role_name;
      if (typeof src.branch_ref === "string") nextWt.branch_ref = src.branch_ref;

      if (Array.isArray(src.branch_projects)) {
        nextWt.branch_projects = src.branch_projects.map((p) => String(p)).filter(Boolean);
      }
      if (
        src.branch_default_reviewers &&
        typeof src.branch_default_reviewers === "object" &&
        !Array.isArray(src.branch_default_reviewers)
      ) {
        const revMap: Record<string, string> = {};
        for (const [k, v] of Object.entries(
          src.branch_default_reviewers as Record<string, unknown>,
        )) {
          revMap[k] = String(v ?? "");
        }
        nextWt.branch_default_reviewers = revMap;
        setReviewersJson(JSON.stringify(revMap, null, 2));
      }
      if (Array.isArray(src.miss_check_members)) {
        nextWt.miss_check_members = src.miss_check_members
          .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === "object"))
          .map((m) => ({
            name: String(m.name ?? ""),
            erp: String(m.erp ?? ""),
          }));
      }
      if (
        src.uat_default_handler &&
        typeof src.uat_default_handler === "object" &&
        !Array.isArray(src.uat_default_handler)
      ) {
        nextWt.uat_default_handler = src.uat_default_handler as Record<string, unknown>;
      }
      if (
        src.wechat_config &&
        typeof src.wechat_config === "object" &&
        !Array.isArray(src.wechat_config)
      ) {
        nextWt.wechat_config = {
          ...nextWt.wechat_config,
          ...(src.wechat_config as Partial<WechatConfig>),
        };
      }

      const defaultDomain = nextWt.ip.split(":")[0] || nextWt.ip || "devops.example.local";
      let nextCookies: CookieRec[] = draft.cookies;
      const rawCookies = parsed.saved_cookies ?? parsed.cookies;
      if (Array.isArray(rawCookies)) {
        nextCookies = rawCookies
          .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
          .map((c) => ({
            name: String(c.name ?? "").trim(),
            value: String(c.value ?? ""),
            domain: String(c.domain ?? "").trim() || defaultDomain,
            path: String(c.path ?? "/").trim() || "/",
          }))
          .filter((c) => c.name.length > 0);
      } else if (rawCookies && typeof rawCookies === "object") {
        nextCookies = Object.entries(rawCookies as Record<string, unknown>)
          .map(([name, value]) => ({
            name: name.trim(),
            value: String(value ?? ""),
            domain: defaultDomain,
            path: "/",
          }))
          .filter((c) => c.name.length > 0);
      }

      setDraft({
        ...draft,
        cookies: nextCookies,
        worktime: nextWt,
      });
      toast.success("已导入旧版 config.json 到编辑区，请确认后点击「保存设置」生效");
    } catch (e) {
      toast.error(`导入 config.json 失败: ${String(e)}`);
    }
  };

  const handleResetTemplates = async () => {
    setResettingTpl(true);
    try {
      const [rep, mr, test, miss] = await Promise.all([
        wtCall<string>("__const", { name: "DEFAULT_TEMPLATE_REPORT" }),
        wtCall<string>("__const", { name: "DEFAULT_TEMPLATE_MR" }),
        wtCall<string>("__const", { name: "DEFAULT_TEMPLATE_TEST" }),
        wtCall<string>("__const", { name: "DEFAULT_TEMPLATE_MISS" }),
      ]);
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              worktime: {
                ...prev.worktime,
                wechat_config: {
                  ...prev.worktime.wechat_config,
                  template_report: rep ?? prev.worktime.wechat_config.template_report,
                  template_mr: mr ?? prev.worktime.wechat_config.template_mr,
                  template_test: test ?? prev.worktime.wechat_config.template_test,
                  template_miss: miss ?? prev.worktime.wechat_config.template_miss,
                },
              },
            }
          : prev,
      );
      toast.success("已恢复 4 个默认企微模板（记得保存设置）");
    } catch (e) {
      toast.error(`读取默认模板失败: ${String(e)}`);
    } finally {
      setResettingTpl(false);
    }
  };

  const handleSave = async () => {
    let parsedReviewers: Record<string, string> = {};
    try {
      const rawRev = JSON.parse(reviewersJson.trim() || "{}") as unknown;
      if (!rawRev || typeof rawRev !== "object" || Array.isArray(rawRev)) {
        throw new Error("默认评审人映射必须是 JSON 对象，例如 {\"repo\": \"姓名\"}");
      }
      for (const [k, v] of Object.entries(rawRev as Record<string, unknown>)) {
        parsedReviewers[k] = String(v ?? "");
      }
    } catch (e) {
      toast.error(`默认评审人 JSON 无效: ${String(e)}`);
      return;
    }

    const toSave: Settings = {
      ...draft,
      worktime: {
        ...draft.worktime,
        branch_default_reviewers: parsedReviewers,
      },
    };

    setSaving(true);
    try {
      const saved = await saveSettings(toSave);
      await api.wtRestart();

      if (saved.cookies.length > 0) {
        try {
          const who = await api.whoami();
          setUser(who);
        } catch (err) {
          pushLog(`⚠️ 重启后校验登录态失败（Cookie 可能已过期）: ${String(err)}`);
        }
      }

      try {
        await wtCall("__set_wechat_config", { cfg: saved.worktime.wechat_config });
      } catch {
        // Ignore if sidecar isn't ready for optional push config sync
      }

      toast.success("设置已保存并已立即生效");
    } catch (e) {
      toast.error(`保存设置失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (preset: WechatTemplatePreset) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            worktime: {
              ...prev.worktime,
              wechat_config: {
                ...prev.worktime.wechat_config,
                ...preset.templates,
              },
            },
          }
        : prev,
    );
    setPrefilledTplBanner(true);
    toast.success(`已应用「${preset.name}」通知模板（记得点击顶部「保存设置」）`);
  };

  const appendTemplateVar = (key: WechatTemplateKey, token: string) => {
    const cur = wx[key] || "";
    const sep = cur && !cur.endsWith(" ") && !cur.endsWith("\n") ? " " : "";
    updateWx(key, `${cur}${sep}${token}`);
  };

  const handleExportSanitizedConfig = async () => {
    const sanitized = {
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      dataRoot: draft.dataRoot,
      worktime: {
        ...draft.worktime,
        wechat_config: {
          ...draft.worktime.wechat_config,
          sys_id_pass: draft.worktime.wechat_config.sys_id_pass ? "***" : "",
          webhook_url: draft.worktime.wechat_config.webhook_url ? "***" : "",
        },
      },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(sanitized, null, 2));
      toast.success("已复制脱敏后的系统配置 JSON（不含 Cookie 与密钥）");
    } catch (e) {
      toast.error(`导出失败: ${String(e)}`);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      {/* 系统版本与运行诊断卡 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Info className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">LifeWork v{APP_VERSION}</span>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                {draft.portable ? "单文件便携模式" : "标准桌面模式"}
              </span>
              <span className="text-[11px] text-slate-400">构建日期 {APP_RELEASE_DATE}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              所有任务台账、SQL 脚本、附件模板与待办数据均存储于本地数据根目录。
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => useLogStore.getState().setLogDrawerOpen(true)}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <ScrollText className="h-3.5 w-3.5 text-slate-500" />
            <span>查看运行日志</span>
          </button>
          <button
            type="button"
            onClick={() => void handleExportSanitizedConfig()}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-blue-600" />
            <span>复制脱敏配置 JSON</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">系统设置</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            配置离线台账存储目录、DevOps 服务参数、Git 默认仓库及企业微信通知。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleImportOldConfig}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Import className="h-3.5 w-3.5 text-blue-600" />
            <span>从旧 worktime config.json 导入</span>
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
            <span>{saving ? "保存并重启中..." : "保存设置"}</span>
          </button>
        </div>
      </div>

      {/* 强制定时休息锁屏设置 */}
      <section className="rounded-2xl border border-teal-200/80 bg-white p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
              <Coffee className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">强制定时休息锁屏提醒</h2>
              <p className="text-[11px] text-gray-500">
                连续工作到达设定时间后自动弹出置顶全屏休息界面（提前 60 秒气泡预警，即时保存生效）。今日已完成休息{" "}
                <strong className="text-teal-700">{breakCompletedToday}</strong> 次。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                resetBreakTimer();
                toast.info(
                  breakReminderMins > 0
                    ? `已重置计时：${breakReminderMins} 分钟后进入休息锁屏`
                    : "当前未开启定时休息提醒",
                );
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>重置计时</span>
            </button>
            <button
              type="button"
              onClick={() => triggerBreakNow()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>立即进入休息锁屏</span>
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="block text-xs font-medium text-gray-700">
              工作提醒周期（分钟，0=关闭）
            </span>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={240}
                value={breakReminderMins}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) {
                    setBreakConfig({ breakReminderMins: val });
                  }
                }}
                className="w-24 rounded-xl border border-gray-200 px-3 py-1.5 font-mono text-xs text-gray-800 focus:border-teal-500 focus:outline-none"
              />
              <div className="flex gap-1">
                {[30, 45, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBreakConfig({ breakReminderMins: m })}
                    className={`rounded-lg px-2 py-1 text-[11px] font-medium ${
                      breakReminderMins === m
                        ? "bg-teal-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-gray-700">
              每次休息时长（1~30 分钟）
            </span>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={30}
                value={breakDurationMins}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val) && val > 0) {
                    setBreakConfig({ breakDurationMins: val });
                  }
                }}
                className="w-24 rounded-xl border border-gray-200 px-3 py-1.5 font-mono text-xs text-gray-800 focus:border-teal-500 focus:outline-none"
              />
              <div className="flex gap-1">
                {[3, 5, 10].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBreakConfig({ breakDurationMins: m })}
                    className={`rounded-lg px-2 py-1 text-[11px] font-medium ${
                      breakDurationMins === m
                        ? "bg-teal-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-xs">
            <input
              type="checkbox"
              checked={breakLockEnabled}
              onChange={(e) => setBreakConfig({ breakLockEnabled: e.target.checked })}
              className="mt-0.5 rounded border-gray-300 text-teal-600"
            />
            <div>
              <div className="flex items-center gap-1 font-medium text-gray-800">
                <Lock className="h-3.5 w-3.5 text-teal-600" />
                <span>到期置顶全屏锁屏</span>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-500">
                关闭后仅在右上角弹出温和休息气泡提醒，不强制占满全屏。
              </p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-xs">
            <input
              type="checkbox"
              checked={breakStrictMode}
              onChange={(e) => setBreakConfig({ breakStrictMode: e.target.checked })}
              className="mt-0.5 rounded border-gray-300 text-rose-600"
            />
            <div>
              <div className="flex items-center gap-1 font-medium text-gray-800">
                <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                <span>严格模式防误关</span>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-500">
                拦截 Esc 键，紧急情况需长按「紧急解锁」按钮 3 秒才能提前退出。
              </p>
            </div>
          </label>
        </div>
      </section>

      {/* 本地数据根目录 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">本地数据根目录</h2>
              {draft.portable && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  便携模式
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              工作任务离线文件夹、需求描述 Markdown、项目与排期模板均保存在此目录下。
            </p>
            {draft.portable && (
              <p className="mt-1 text-[11px] text-emerald-700">
                配置与数据默认保存在程序目录 LifeWorkData 下，可整体拷贝迁移
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            readOnly
            value={draft.dataRoot}
            className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700"
          />
          <button
            type="button"
            onClick={handleChooseDataRoot}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <FolderSearch className="h-3.5 w-3.5 text-blue-600" />
            <span>选择目录</span>
          </button>
          <button
            type="button"
            onClick={() => api.openDataRoot().catch((e) => toast.error(String(e)))}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <FolderOpen className="h-3.5 w-3.5 text-amber-600" />
            <span>打开目录</span>
          </button>
        </div>
        {draft.dataRootResolved && draft.dataRootResolved !== draft.dataRoot && (
          <div className="mt-1.5 font-mono text-[11px] text-gray-500">
            实际路径：{draft.dataRootResolved}
          </div>
        )}
        <div className="mt-2 text-[11px] text-gray-400">
          当前已缓存 DevOps Cookie 数量：{draft.cookies.length} 条
        </div>
      </section>

      {/* DevOps 与 Git 分支配置 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">DevOps 与 Git 默认配置</h2>
          <button
            type="button"
            onClick={() => navigate("/api-config")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>查看 / 编辑全部接口与参数规则 →</span>
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-gray-700">DevOps 地址 / IP:Port</span>
            <input
              type="text"
              value={wt.ip}
              onChange={(e) => updateWt("ip", e.target.value)}
              placeholder="devops.example.local:8880"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Space ID (项目空间 ID)</span>
            <input
              type="text"
              value={wt.space_id}
              onChange={(e) => updateWt("space_id", e.target.value)}
              placeholder="26"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">默认填报角色</span>
            <select
              value={wt.role_name || "开发"}
              onChange={(e) => updateWt("role_name", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="开发">开发</option>
              <option value="测试">测试</option>
              <option value="产品">产品</option>
              <option value="运维">运维</option>
              {!["开发", "测试", "产品", "运维"].includes(wt.role_name) && wt.role_name && (
                <option value={wt.role_name}>{wt.role_name}</option>
              )}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">默认基准分支 (branch_ref)</span>
            <input
              type="text"
              value={wt.branch_ref}
              onChange={(e) => updateWt("branch_ref", e.target.value)}
              placeholder="UAT"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-gray-700">
              常用代码库列表（branch_projects，每行一个）
            </span>
            <textarea
              rows={6}
              value={(wt.branch_projects ?? []).join("\n")}
              onChange={(e) =>
                updateWt(
                  "branch_projects",
                  e.target.value
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              placeholder={"GROUP!TEAM/repo-name\n"}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">
              默认代码评审人映射（branch_default_reviewers, JSON）
            </span>
            <textarea
              rows={6}
              value={reviewersJson}
              onChange={(e) => setReviewersJson(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>
      </section>

      {/* 企业微信通知配置 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">企业微信推送配置</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              支持内网 WebService 私聊通知与群机器人 Webhook 两种模式。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTplPreviewMode((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                tplPreviewMode
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              <span>{tplPreviewMode ? "隐藏预览" : "显示企微效果预览"}</span>
            </button>
            <button
              type="button"
              disabled={resettingTpl}
              onClick={handleResetTemplates}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
            >
              {resettingTpl ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              <span>恢复默认模板</span>
            </button>
          </div>
        </div>

        {/* 预设样式选择 */}
        <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              <span>通知模板样式预设（点击一键套用 4 套精美 Markdown 卡片）</span>
            </div>
            {prefilledTplBanner && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                已预填样式模板，记得点击页面右上角「保存设置」
              </span>
            )}
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2 md:grid-cols-3">
            {WECHAT_TEMPLATE_PRESETS.map((preset) => {
              const isActive =
                wx.template_report.trim() === preset.templates.template_report.trim() &&
                wx.template_miss.trim() === preset.templates.template_miss.trim();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${
                    isActive
                      ? "border-blue-400 bg-blue-50/80 ring-1 ring-blue-200"
                      : "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-semibold text-gray-900">{preset.name}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isActive ? "当前使用" : preset.badge}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">{preset.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6 text-xs text-gray-700">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={wx.enabled}
              onChange={(e) => updateWx("enabled", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <span className="font-medium">启用企业微信通知</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={wx.auto_notify_report}
              onChange={(e) => updateWx("auto_notify_report", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <span>工时提报完成后自动推送</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={wx.auto_notify_mr}
              onChange={(e) => updateWx("auto_notify_mr", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <span>MR 创建/合并后自动推送</span>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-700">推送模式 (mode)</span>
            <select
              value={wx.mode}
              onChange={(e) =>
                updateWx("mode", e.target.value as "webservice" | "webhook")
              }
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="webservice">webservice (内网私聊)</option>
              <option value="webhook">webhook (群机器人)</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-medium text-gray-700">WebService URL</span>
            <input
              type="text"
              value={wx.url}
              onChange={(e) => updateWx("url", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">sys_flag</span>
            <input
              type="text"
              value={wx.sys_flag}
              onChange={(e) => updateWx("sys_flag", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">sys_id</span>
            <input
              type="text"
              value={wx.sys_id}
              onChange={(e) => updateWx("sys_id", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">sys_id_pass</span>
            <div className="relative mt-1">
              <input
                type={showSysIdPass ? "text" : "password"}
                value={wx.sys_id_pass}
                onChange={(e) => updateWx("sys_id_pass", e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 pr-9 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowSysIdPass((v) => !v)}
                aria-label={showSysIdPass ? "隐藏 sys_id_pass" : "显示 sys_id_pass"}
                title={showSysIdPass ? "隐藏密码" : "显示密码"}
                className="absolute inset-y-0 right-1.5 flex items-center rounded-md px-1.5 text-gray-400 hover:text-gray-700"
              >
                {showSysIdPass ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">user_type</span>
            <input
              type="text"
              value={wx.user_type}
              onChange={(e) => updateWx("user_type", e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">
              默认接收人 (target_erp，留空发当前账号)
            </span>
            <input
              type="text"
              value={wx.target_erp}
              onChange={(e) => updateWx("target_erp", e.target.value)}
              placeholder="姓名或 ERP 工号"
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block md:col-span-3">
            <span className="text-xs font-medium text-gray-700">Webhook URL</span>
            <input
              type="text"
              value={wx.webhook_url}
              onChange={(e) => updateWx("webhook_url", e.target.value)}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {WECHAT_TEMPLATE_FIELDS.map((field) => {
            const val = wx[field.key] || "";
            return (
              <div
                key={field.key}
                className="flex flex-col rounded-xl border border-gray-200/90 bg-gray-50/30 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-800">{field.title}</span>
                  <span className="text-[10px] text-gray-400">支持企微 Markdown</span>
                </div>
                <textarea
                  rows={6}
                  value={val}
                  onChange={(e) => updateWx(field.key, e.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-gray-800 focus:border-blue-500 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-gray-400">变量：</span>
                  {field.vars.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      onClick={() => appendTemplateVar(field.key, v.token)}
                      title={`点击追加 ${v.token} (${v.desc})`}
                      className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                      {v.token}
                    </button>
                  ))}
                </div>
                {tplPreviewMode && (
                  <div className="mt-2.5">
                    <div className="mb-1 text-[10px] font-medium text-emerald-700">
                      企微渲染效果预览
                    </div>
                    <WechatPreviewCard
                      content={formatWechatSampleText(val, field.sampleVars)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
