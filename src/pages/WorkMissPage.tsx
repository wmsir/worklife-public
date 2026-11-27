import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckSquare,
  Clock,
  List,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Square,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { DatePicker } from "../components/DatePicker";
import { MemberSelect } from "../components/MemberSelect";
import { WorkMissCalendar } from "../components/WorkMissCalendar";
import { api, wtCall } from "../lib/api";
import { monthRangeYmd, todayYmd } from "../lib/date";
import { formatRelativeElapsed } from "../lib/lunar";
import {
  fmtTpl,
  getConst,
  getMembers,
  nowDateTimeStr,
  sendWechat,
  type MemberOption,
} from "../lib/wtx";
import { useAppStore } from "../store/appStore";
import { useMonthlyMissStore, useWorkQueryCacheStore } from "../store/runtimeStore";

interface DayInfo {
  is_workday?: boolean;
  day_type?: string;
  label?: string;
  weekday_str?: string;
}

type NotReportResult = [
  Record<string, number>,
  Record<string, number>,
  Record<string, DayInfo>,
];

interface SingleMissState {
  targetName: string;
  targetErp: string;
  startDate: string;
  endDate: string;
  dailyMap: Record<string, number>;
  underMap: Record<string, number>;
  dayInfoMap: Record<string, DayInfo>;
}

interface BatchMemberResult {
  name: string;
  erp: string;
  status: "pending" | "running" | "done" | "error";
  missCount: number;
  selected: boolean;
  dailyMap?: Record<string, number>;
  underMap?: Record<string, number>;
  dayInfoMap?: Record<string, DayInfo>;
  error?: string;
}

export function WorkMissPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { settings, user, saveSettings, pushLog } = useAppStore(
    useShallow((s) => ({
      settings: s.settings,
      user: s.user,
      saveSettings: s.saveSettings,
      pushLog: s.pushLog,
    })),
  );
  const monthlySummary = useMonthlyMissStore((s) => s.summary);
  const { miss, patchMiss, clearMissData } = useWorkQueryCacheStore(
    useShallow((s) => ({
      miss: s.miss,
      patchMiss: s.patchMiss,
      clearMissData: s.clearMissData,
    })),
  );
  const defMonth = useMemo(() => monthRangeYmd(), []);
  const defToday = useMemo(() => todayYmd(), []);
  const prevMonthRange = useMemo(() => {
    const now = new Date();
    return monthRangeYmd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }, []);

  const [viewMode, setViewMode] = useState<"calendar" | "list">(() =>
    searchParams.get("view") === "list" ? "list" : "calendar",
  );
  const [timeWork, setTimeWork] = useState(7);
  const [defaultMissTpl, setDefaultMissTpl] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const startDate = miss.startDate;
  const endDate = miss.endDate;
  const singleResult = miss.singleResult as SingleMissState | null;
  const batchResults = miss.batchResults as BatchMemberResult[];
  const setStartDate = (val: string) => patchMiss({ startDate: val });
  const setEndDate = (val: string) => patchMiss({ endDate: val });
  const setBatchResults = (
    updater:
      | BatchMemberResult[]
      | ((prev: BatchMemberResult[]) => BatchMemberResult[]),
  ) => {
    patchMiss((prev) => ({
      batchResults:
        typeof updater === "function"
          ? updater(prev.batchResults as BatchMemberResult[])
          : updater,
    }));
  };

  useEffect(() => {
    if (miss.queriedAtMs === null) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [miss.queriedAtMs]);

  const [targetName, setTargetName] = useState("");
  const [targetErp, setTargetErp] = useState("");

  const [checkingSingle, setCheckingSingle] = useState(false);
  const [sendingSingle, setSendingSingle] = useState(false);

  // Batch members list (editable draft synced from settings.worktime.miss_check_members)
  const [memberList, setMemberList] = useState<Array<{ name: string; erp: string }>>([]);
  const [addMemberName, setAddMemberName] = useState("");
  const [addMemberPicked, setAddMemberPicked] = useState<MemberOption | null>(null);
  const [savingMembers, setSavingMembers] = useState(false);

  const [batchCalendarRow, setBatchCalendarRow] = useState<BatchMemberResult | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  const abortBatchRef = useRef(false);

  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "calendar" || v === "list") {
      setViewMode(v);
    }
  }, [searchParams]);

  useEffect(() => {
    getConst<number>("TIME_WORK")
      .then((v) => {
        if (typeof v === "number" && v > 0) setTimeWork(v);
      })
      .catch(() => {});
    getConst<string>("DEFAULT_TEMPLATE_MISS")
      .then((v) => {
        if (typeof v === "string") setDefaultMissTpl(v);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user && !targetName) {
      const erp = user.user.userErp || user.user.erp || "";
      setTargetName(user.realName || "");
      setTargetErp(erp);
    }
  }, [user, targetName]);

  useEffect(() => {
    if (settings?.worktime.miss_check_members) {
      setMemberList(settings.worktime.miss_check_members.map((m) => ({ ...m })));
    }
  }, [settings?.worktime.miss_check_members]);

  const buildMissDetails = (
    underMap: Record<string, number>,
    dayInfoMap: Record<string, DayInfo>,
  ) => {
    return Object.entries(underMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, h]) => {
        const wStr = dayInfoMap[d]?.weekday_str || "";
        const gap = Math.max(0, Number((timeWork - h).toFixed(1)));
        if (h <= 0.001) {
          return `  • ${d} (${wStr}): 缺报 (已填 0.0h, 缺 ${timeWork.toFixed(1)}h)`;
        }
        return `  • ${d} (${wStr}): 不足 (已填 ${Number(h).toFixed(1)}h, 缺 ${gap}h)`;
      })
      .join("\n");
  };

  const handleSingleCheck = async () => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    const queryErpOrName =
      targetErp.trim() || targetName.trim() || user.user.userErp || user.user.erp || "";
    if (!queryErpOrName) {
      toast.error("请指定要排查的人员姓名或 ERP");
      return;
    }

    setCheckingSingle(true);
    try {
      const res = await wtCall<NotReportResult>("not_report", {
        start_date: startDate || null,
        end_date: endDate || null,
        erp: queryErpOrName,
      });
      const [dailyMap = {}, underMap = {}, dayInfoMap = {}] = Array.isArray(res)
        ? res
        : [{}, {}, {}];

      const nextResult: SingleMissState = {
        targetName: targetName.trim() || queryErpOrName,
        targetErp: targetErp.trim() || queryErpOrName,
        startDate,
        endDate,
        dailyMap,
        underMap,
        dayInfoMap,
      };
      const fetchedAt = nowDateTimeStr();
      const fetchedAtMs = Date.now();
      setNowMs(fetchedAtMs);
      patchMiss({
        singleResult: nextResult as unknown as Record<string, unknown>,
        queriedAt: fetchedAt,
        queriedAtMs: fetchedAtMs,
      });

      const selfErp = (user.erp || user.user.userErp || user.user.erp || "").trim();
      const isSelf =
        (selfErp && nextResult.targetErp === selfErp) ||
        nextResult.targetName === user.realName;
      if (isSelf) {
        useMonthlyMissStore.getState().setSummaryFromCheck({
          startDate,
          endDate,
          targetName: nextResult.targetName,
          targetErp: nextResult.targetErp,
          timeWork,
          dailyMap,
          underMap,
          dayInfoMap,
        });
      }

      const missCnt = Object.keys(underMap).length;
      if (missCnt === 0) {
        toast.success(`[${targetName || queryErpOrName}] 所选时段内工时全部达标！`);
      } else {
        toast.warning(`[${targetName || queryErpOrName}] 存在 ${missCnt} 个缺报/不足工作日`);
      }
    } catch (e) {
      toast.error(`查询缺报失败: ${String(e)}`);
    } finally {
      setCheckingSingle(false);
    }
  };

  const activeSingleResult: SingleMissState | null = useMemo(() => {
    if (singleResult) return singleResult;
    if (monthlySummary) {
      return {
        targetName: monthlySummary.targetName,
        targetErp: monthlySummary.targetErp,
        startDate: monthlySummary.startDate,
        endDate: monthlySummary.endDate,
        dailyMap: monthlySummary.dailyMap,
        underMap: monthlySummary.underMap,
        dayInfoMap: monthlySummary.dayInfoMap,
      };
    }
    return null;
  }, [singleResult, monthlySummary]);

  const handleSendSingleNotice = async () => {
    if (!activeSingleResult) return;
    const underEntries = Object.entries(activeSingleResult.underMap);
    if (underEntries.length === 0) {
      toast.info("当前人员工时已全部达标，无需发送缺报提醒");
      return;
    }

    const wx = settings?.worktime.wechat_config;
    const tpl = wx?.template_miss || defaultMissTpl;
    const content = fmtTpl(tpl, {
      user_name: activeSingleResult.targetName,
      user_erp: activeSingleResult.targetErp,
      start_date: activeSingleResult.startDate,
      end_date: activeSingleResult.endDate,
      miss_count: String(underEntries.length),
      miss_details: buildMissDetails(
        activeSingleResult.underMap,
        activeSingleResult.dayInfoMap,
      ),
      time: nowDateTimeStr(),
    });

    setSendingSingle(true);
    try {
      const [ok, msg] = await sendWechat(content, activeSingleResult.targetErp);
      if (ok) {
        toast.success(`已向 [${activeSingleResult.targetName}] 发送企业微信缺报提醒`);
      } else {
        toast.error(`企微提醒发送失败: ${msg}`);
      }
    } catch (e) {
      toast.error(`企微提醒发送异常: ${String(e)}`);
    } finally {
      setSendingSingle(false);
    }
  };

  const handleAddMember = () => {
    const rawName = addMemberName.trim();
    if (!rawName && !addMemberPicked) {
      toast.error("请输入或选择要添加的人员");
      return;
    }
    const name = addMemberPicked?.name || rawName;
    const erp = addMemberPicked?.erp || "";
    if (!erp) {
      toast.error("请从成员下拉中选择完整人员以获取其 ERP 工号");
      return;
    }
    if (memberList.some((m) => m.erp === erp)) {
      toast.info(`成员 [${name}] (${erp}) 已在名单中`);
      return;
    }
    setMemberList((prev) => [...prev, { name, erp }]);
    setAddMemberName("");
    setAddMemberPicked(null);
  };

  const handleImportTeam = async () => {
    if (!user) {
      toast.error("请先登录 DevOps 后导入团队成员");
      return;
    }
    try {
      const all = await getMembers(false);
      const existing = new Set(memberList.map((m) => m.erp));
      let added = 0;
      const next = [...memberList];
      for (const m of all) {
        if (m.erp && !existing.has(m.erp)) {
          existing.add(m.erp);
          next.push({ name: m.name, erp: m.erp });
          added += 1;
        }
      }
      setMemberList(next);
      toast.success(`已导入 ${added} 位成员到名单（点击「保存名单配置」持久化）`);
    } catch (e) {
      toast.error(`导入成员失败: ${String(e)}`);
    }
  };

  const handleSaveMembers = async () => {
    if (!settings) return;
    setSavingMembers(true);
    try {
      await saveSettings({
        ...settings,
        worktime: {
          ...settings.worktime,
          miss_check_members: memberList,
        },
      });
      toast.success(`待排查名单已保存（共 ${memberList.length} 人）`);
    } catch (e) {
      toast.error(`保存名单失败: ${String(e)}`);
    } finally {
      setSavingMembers(false);
    }
  };

  const handleBatchCheck = async () => {
    if (!user) {
      toast.error("请先登录 DevOps");
      return;
    }
    if (memberList.length === 0) {
      toast.error("待排查人员名单为空，请先添加或导入成员");
      return;
    }

    abortBatchRef.current = false;
    setBatchRunning(true);
    const initial: BatchMemberResult[] = memberList.map((m) => ({
      name: m.name,
      erp: m.erp,
      status: "pending",
      missCount: 0,
      selected: false,
    }));
    setBatchResults(initial);

    for (let i = 0; i < initial.length; i += 1) {
      if (abortBatchRef.current) {
        pushLog("⏹ 用户中止了批量缺报排查");
        break;
      }
      const m = initial[i];
      setBatchResults((prev) =>
        prev.map((row, idx) => (idx === i ? { ...row, status: "running" } : row)),
      );
      try {
        const res = await wtCall<NotReportResult>("not_report", {
          start_date: startDate || null,
          end_date: endDate || null,
          erp: m.erp || m.name,
        });
        const [dailyMap = {}, underMap = {}, dayInfoMap = {}] = Array.isArray(res)
          ? res
          : [{}, {}, {}];
        const missCount = Object.keys(underMap).length;
        setBatchResults((prev) =>
          prev.map((row, idx) =>
            idx === i
              ? {
                  ...row,
                  status: "done",
                  missCount,
                  selected: missCount > 0,
                  dailyMap,
                  underMap,
                  dayInfoMap,
                }
              : row,
          ),
        );
      } catch (e) {
        setBatchResults((prev) =>
          prev.map((row, idx) =>
            idx === i
              ? { ...row, status: "error", error: String(e), selected: false }
              : row,
          ),
        );
      }
    }

    setBatchRunning(false);
    const doneAt = nowDateTimeStr();
    const doneAtMs = Date.now();
    setNowMs(doneAtMs);
    patchMiss({ queriedAt: doneAt, queriedAtMs: doneAtMs });
    toast.success("批量缺报排查完成");
  };

  const handleStopBatch = async () => {
    abortBatchRef.current = true;
    await api.wtStop().catch(() => {});
    toast.info("正在中止批量排查...");
  };

  const handleBatchSendNotices = async () => {
    const targets = batchResults.filter(
      (r) => r.selected && r.missCount > 0 && r.underMap && r.dayInfoMap,
    );
    if (targets.length === 0) {
      toast.error("未勾选任何存在缺报的人员");
      return;
    }

    const wx = settings?.worktime.wechat_config;
    const tpl = wx?.template_miss || defaultMissTpl;
    setBatchSending(true);
    let okCnt = 0;
    let failCnt = 0;

    try {
      for (const t of targets) {
        const content = fmtTpl(tpl, {
          user_name: t.name,
          user_erp: t.erp,
          start_date: startDate,
          end_date: endDate,
          miss_count: String(t.missCount),
          miss_details: buildMissDetails(t.underMap!, t.dayInfoMap!),
          time: nowDateTimeStr(),
        });
        try {
          const [ok, msg] = await sendWechat(content, t.erp);
          if (ok) {
            okCnt += 1;
            pushLog(`✅ 已向 [${t.name}] 发送缺报提醒`);
          } else {
            failCnt += 1;
            pushLog(`❌ 向 [${t.name}] 发送缺报提醒失败: ${msg}`);
          }
        } catch (err) {
          failCnt += 1;
          pushLog(`❌ 向 [${t.name}] 发送缺报提醒异常: ${String(err)}`);
        }
      }
      toast.success(`批量企微提醒完成：成功 ${okCnt} 人，失败 ${failCnt} 人`);
    } finally {
      setBatchSending(false);
    }
  };

  const dailyRows = useMemo(() => {
    if (!activeSingleResult) return [];
    return Object.keys(activeSingleResult.dailyMap)
      .sort()
      .map((d) => {
        const hours = Number(activeSingleResult.dailyMap[d] ?? 0);
        const info = activeSingleResult.dayInfoMap[d] ?? {};
        const isWork = info.is_workday ?? true;
        const dType = info.day_type ?? "workday";
        const isMiss = isWork && d in activeSingleResult.underMap;
        return {
          date: d,
          hours,
          isWork,
          dType,
          label: info.label || (isWork ? "工作日" : "休息日"),
          weekday: info.weekday_str || "",
          isMiss,
        };
      });
  }, [activeSingleResult]);

  const singleSummary = useMemo(() => {
    const totalHours = dailyRows.reduce((s, r) => s + r.hours, 0);
    const workDays = dailyRows.filter((r) => r.isWork).length;
    const missDays = dailyRows.filter((r) => r.isMiss).length;
    return { totalDays: dailyRows.length, workDays, missDays, totalHours };
  }, [dailyRows]);

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900">缺报提醒</h1>
        <p className="mt-0.5 text-xs text-gray-500">
          按日历检查单人或关注名单的每日工时填报情况（标准 {timeWork}h/工作日），一键发送企业微信提醒。
        </p>
      </div>

      {!user && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>当前未连接 DevOps，请先在左下角登录账号后查询每日工时。</span>
        </div>
      )}

      {/* 筛选与单人查询栏 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="mb-1 block text-[11px] font-medium text-slate-500">开始日期</span>
            <DatePicker value={startDate} onChange={setStartDate} size="sm" />
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-medium text-slate-500">结束日期</span>
            <DatePicker value={endDate} onChange={setEndDate} size="sm" />
          </div>
          <div className="flex items-center gap-1 self-end pb-0.5">
            <button
              type="button"
              onClick={() => {
                setStartDate(defMonth.start);
                setEndDate(defToday);
              }}
              className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                startDate === defMonth.start && endDate === defToday
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              本月至今
            </button>
            <button
              type="button"
              onClick={() => {
                setStartDate(defMonth.start);
                setEndDate(defMonth.end);
              }}
              className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                startDate === defMonth.start && endDate === defMonth.end
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              整个本月
            </button>
            <button
              type="button"
              onClick={() => {
                setStartDate(prevMonthRange.start);
                setEndDate(prevMonthRange.end);
              }}
              className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                startDate === prevMonthRange.start && endDate === prevMonthRange.end
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              上个月
            </button>
          </div>
          <div className="min-w-[220px] flex-1">
            <span className="text-[11px] font-medium text-gray-500">排查人员（默认本人）</span>
            <MemberSelect
              value={targetName}
              onChange={(val) => {
                setTargetName(val);
                if (!val.trim()) setTargetErp("");
              }}
              onPick={(m) => {
                setTargetName(m.name);
                setTargetErp(m.erp);
              }}
              placeholder="输入姓名或选择空间成员..."
              className="mt-1"
            />
          </div>

          <button
            type="button"
            disabled={!user || checkingSingle || batchRunning}
            onClick={handleSingleCheck}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {checkingSingle ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            <span>{checkingSingle ? "查询中..." : "查询单人缺报"}</span>
          </button>

          <button
            type="button"
            disabled={
              !user ||
              sendingSingle ||
              !activeSingleResult ||
              Object.keys(activeSingleResult.underMap).length === 0
            }
            onClick={handleSendSingleNotice}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"
          >
            {sendingSingle ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            <span>发送企微缺报提醒</span>
          </button>

          {miss.queriedAt && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="lw-nums inline-flex items-center gap-1 rounded-xl border border-blue-100 bg-blue-50/70 px-2.5 py-1.5 text-[11px] text-blue-700">
                <Clock className="h-3 w-3 shrink-0" />
                <span>
                  上次排查：{miss.queriedAt}（{formatRelativeElapsed(miss.queriedAtMs, nowMs)} · 切换页面自动保留）
                </span>
              </span>
              <button
                type="button"
                disabled={checkingSingle || batchRunning}
                onClick={() => {
                  clearMissData();
                  toast.info("已清空缺报排查缓存");
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                <span>清空</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 单人每日工时日历 / 明细表 */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50/70 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 font-semibold text-gray-800">
            <Bell className="h-4 w-4 text-amber-600" />
            <span>
              每日填报情况
              {activeSingleResult ? `（${activeSingleResult.targetName}）` : ""}
            </span>
            {!singleResult && monthlySummary && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                登录后自动核对
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {activeSingleResult && (
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                <span>共 {singleSummary.totalDays} 天</span>
                <span>工作日 {singleSummary.workDays} 天</span>
                <span>
                  累计{" "}
                  <strong className="text-gray-900">
                    {singleSummary.totalHours.toFixed(1)}h
                  </strong>
                </span>
                <span>
                  缺报/不足{" "}
                  <strong
                    className={singleSummary.missDays > 0 ? "text-red-600" : "text-emerald-600"}
                  >
                    {singleSummary.missDays} 天
                  </strong>
                </span>
              </div>
            )}

            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setViewMode("calendar")}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                  viewMode === "calendar"
                    ? "bg-blue-600 text-white shadow-2xs"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <CalendarDays className="h-3 w-3" />
                <span>日历视图</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                  viewMode === "list"
                    ? "bg-blue-600 text-white shadow-2xs"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <List className="h-3 w-3" />
                <span>列表视图</span>
              </button>
            </div>
          </div>
        </div>

        {viewMode === "calendar" ? (
          activeSingleResult ? (
            <WorkMissCalendar
              dailyMap={activeSingleResult.dailyMap}
              underMap={activeSingleResult.underMap}
              dayInfoMap={activeSingleResult.dayInfoMap}
              timeWork={timeWork}
              startDate={activeSingleResult.startDate}
              endDate={activeSingleResult.endDate}
              personName={activeSingleResult.targetName}
              onGoReport={() => navigate("/work/report")}
            />
          ) : (
            <div className="py-12 text-center text-xs text-gray-400">
              {user
                ? "点击上方「查询单人缺报」或等待登录自动核对本月工时日历。"
                : "连接 DevOps 后将自动核对当月每日报工日历。"}
            </div>
          )
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-gray-50 text-[11px] font-semibold text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2">日期</th>
                  <th className="px-3 py-2">星期</th>
                  <th className="px-3 py-2">日期类型</th>
                  <th className="px-3 py-2 text-right">已填工时</th>
                  <th className="px-4 py-2">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dailyRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-gray-400">
                      点击上方「查询单人缺报」查看逐日工时情况。
                    </td>
                  </tr>
                ) : (
                  dailyRows.map((r) => {
                    let statusText = "✅ 达标";
                    let badgeCls = "bg-emerald-100 text-emerald-700";
                    let rowCls = "bg-white";
                    if (r.isWork) {
                      if (r.isMiss) {
                        statusText =
                          r.hours <= 0.001 ? "❌ 缺报 (0.0h)" : `⚠️ 不足 ${timeWork}h`;
                        badgeCls =
                          r.hours <= 0.001
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-800";
                        rowCls = "bg-red-50/50";
                      }
                    } else if (r.hours > 0) {
                      statusText = `🔥 加班 (${r.hours.toFixed(1)}h)`;
                      badgeCls = "bg-blue-100 text-blue-700";
                      rowCls = "bg-blue-50/40";
                    } else if (r.dType === "holiday") {
                      statusText = "🎉 节假日休息";
                      badgeCls = "bg-gray-100 text-gray-600";
                      rowCls = "bg-gray-50/60";
                    } else {
                      statusText = "🏖️ 周末休息";
                      badgeCls = "bg-gray-100 text-gray-500";
                      rowCls = "bg-gray-50/40";
                    }

                    return (
                      <tr key={r.date} className={rowCls}>
                        <td className="px-4 py-2 font-mono text-gray-800">{r.date}</td>
                        <td className="px-3 py-2 text-gray-600">{r.weekday}</td>
                        <td className="px-3 py-2 text-gray-600">{r.label}</td>
                        <td className="px-3 py-2 text-right font-mono font-medium text-gray-800">
                          {r.hours.toFixed(1)}h
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeCls}`}>
                            {statusText}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 待排查人员名单管理 + 批量排查 */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Users className="h-4 w-4 text-blue-600" />
              <span>关注名单 ({memberList.length})</span>
            </div>
            <button
              type="button"
              disabled={savingMembers}
              onClick={handleSaveMembers}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {savingMembers ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              <span>保存名单配置</span>
            </button>
          </div>

          <div className="mt-3 flex items-center gap-1.5">
            <MemberSelect
              value={addMemberName}
              onChange={(v) => {
                setAddMemberName(v);
                setAddMemberPicked(null);
              }}
              onPick={(m) => {
                setAddMemberName(m.name);
                setAddMemberPicked(m);
              }}
              placeholder="选择成员加入排查名单..."
              className="flex-1"
            />
            <button
              type="button"
              onClick={handleAddMember}
              className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5 text-blue-600" />
              <span>添加</span>
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!user}
              onClick={handleImportTeam}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <UserPlus className="h-3 w-3 text-indigo-600" />
              <span>导入团队全部成员</span>
            </button>
            <button
              type="button"
              disabled={memberList.length === 0}
              onClick={() => setMemberList([])}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" />
              <span>清空名单</span>
            </button>
          </div>

          <div className="mt-3 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200">
            {memberList.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">
                暂无关注成员，可在上方添加或一键导入。
              </div>
            ) : (
              memberList.map((m) => (
                <div
                  key={m.erp}
                  className="flex items-center justify-between px-3 py-1.5 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-gray-800">{m.name}</span>
                    <span className="ml-2 font-mono text-[11px] text-gray-400">{m.erp}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setMemberList((prev) => prev.filter((x) => x.erp !== m.erp))
                    }
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50/70 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
              <CheckSquare className="h-4 w-4 text-indigo-600" />
              <span>批量排查结果</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={batchResults.length === 0}
                onClick={() =>
                  setBatchResults((prev) => prev.map((r) => ({ ...r, selected: true })))
                }
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100 disabled:opacity-40"
              >
                全选
              </button>
              <button
                type="button"
                disabled={batchResults.length === 0}
                onClick={() =>
                  setBatchResults((prev) => prev.map((r) => ({ ...r, selected: false })))
                }
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100 disabled:opacity-40"
              >
                全不选
              </button>
              {batchRunning && (
                <button
                  type="button"
                  onClick={handleStopBatch}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700"
                >
                  <Square className="h-3 w-3 fill-current" />
                  <span>中止</span>
                </button>
              )}
              <button
                type="button"
                disabled={!user || batchRunning || memberList.length === 0}
                onClick={handleBatchCheck}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {batchRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                <span>{batchRunning ? "批量排查中..." : "开始批量排查"}</span>
              </button>
              <button
                type="button"
                disabled={
                  !user ||
                  batchRunning ||
                  batchSending ||
                  !batchResults.some((r) => r.selected && r.missCount > 0)
                }
                onClick={handleBatchSendNotices}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {batchSending && <Loader2 className="h-3 w-3 animate-spin" />}
                <span>批量发送提醒</span>
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-gray-50 text-[11px] font-semibold text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className="w-9 px-3 py-2 text-center">选</th>
                  <th className="px-3 py-2">姓名</th>
                  <th className="px-3 py-2">ERP</th>
                  <th className="px-3 py-2 text-right">缺报天数</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="w-20 px-3 py-2 text-right">日历</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batchResults.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-gray-400">
                      点击「开始批量排查」依次检查名单中所有成员的工时达标情况。
                    </td>
                  </tr>
                ) : (
                  batchResults.map((row) => (
                    <tr
                      key={row.erp}
                      className={row.missCount > 0 ? "bg-amber-50/70" : "bg-white"}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={() =>
                            setBatchResults((prev) =>
                              prev.map((x) =>
                                x.erp === row.erp ? { ...x, selected: !x.selected } : x,
                              ),
                            )
                          }
                          className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-800">{row.name}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-gray-500">
                        {row.erp}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-gray-800">
                        {row.missCount}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        {row.status === "pending" && (
                          <span className="text-gray-400">等待中</span>
                        )}
                        {row.status === "running" && (
                          <span className="inline-flex items-center gap-1 text-blue-600">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            查询中...
                          </span>
                        )}
                        {row.status === "error" && (
                          <span className="text-red-600" title={row.error}>
                            ❌ 失败
                          </span>
                        )}
                        {row.status === "done" &&
                          (row.missCount > 0 ? (
                            <span className="font-medium text-amber-700">
                              ⚠️ {row.missCount} 天缺报/不足
                            </span>
                          ) : (
                            <span className="text-emerald-700">✅ 全部达标</span>
                          ))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.status === "done" && row.dailyMap && (
                          <button
                            type="button"
                            onClick={() => setBatchCalendarRow(row)}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/70 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                          >
                            <CalendarDays className="h-3 w-3" />
                            <span>日历</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 成员日历弹窗 */}
      {batchCalendarRow && batchCalendarRow.dailyMap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <CalendarDays className="h-4 w-4 text-blue-600" />
                <span>{batchCalendarRow.name} 的报工日历</span>
                <span className="font-mono text-xs text-gray-400">
                  {startDate} ~ {endDate}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setBatchCalendarRow(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <WorkMissCalendar
              dailyMap={batchCalendarRow.dailyMap}
              underMap={batchCalendarRow.underMap || {}}
              dayInfoMap={batchCalendarRow.dayInfoMap || {}}
              timeWork={timeWork}
              startDate={startDate}
              endDate={endDate}
              personName={batchCalendarRow.name}
            />
          </div>
        </div>
      )}
    </div>
  );
}
