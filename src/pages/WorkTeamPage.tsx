import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  Award,
  BarChart3,
  Clock,
  Loader2,
  RotateCcw,
  Search,
  Square,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { api, wtCall } from "../lib/api";
import { formatRelativeElapsed } from "../lib/lunar";
import { nowDateTimeStr } from "../lib/wtx";
import { useAppStore } from "../store/appStore";
import {
  useWorkQueryCacheStore,
  type TeamSortKey,
  type TeamWorkTimeResultCache,
} from "../store/runtimeStore";

type TeamWorkTimeResult = TeamWorkTimeResultCache;
type SortKey = TeamSortKey;

export function WorkTeamPage() {
  const user = useAppStore((s) => s.user);
  const { team, patchTeam, clearTeamData } = useWorkQueryCacheStore(
    useShallow((s) => ({
      team: s.team,
      patchTeam: s.patchTeam,
      clearTeamData: s.clearTeamData,
    })),
  );
  const { nameFilter, sortKey, sortAsc, result, queriedAt, queriedAtMs } = team;

  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (queriedAtMs === null) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [queriedAtMs]);

  const declareErp = user?.user.userErp || user?.user.erp || "";
  const cap = user?.capacity;

  const handleCountTeam = async () => {
    if (!user || !declareErp) {
      toast.error("请先登录 DevOps");
      return;
    }
    setLoading(true);
    try {
      const res = await wtCall<TeamWorkTimeResult>("count_work_time", {
        declare_erp: declareErp,
        user: user.user,
        name_filter: nameFilter.trim() || null,
      });
      const fetchedAt = nowDateTimeStr();
      const fetchedAtMs = Date.now();
      setNowMs(fetchedAtMs);
      patchTeam({
        result: res,
        queriedAt: fetchedAt,
        queriedAtMs: fetchedAtMs,
      });
      toast.success(`团队统计完成：共 ${res?.members?.length ?? 0} 名成员`);
    } catch (e) {
      toast.error(`团队统计失败: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    await api.wtStop().catch(() => {});
    toast.info("已发送中止信号");
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      patchTeam({ sortAsc: !sortAsc });
    } else {
      patchTeam({ sortKey: key, sortAsc: key === "name" });
    }
  };

  const sortedMembers = useMemo(() => {
    const list = [...(result?.members ?? [])];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name, "zh-CN");
      } else {
        cmp = Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0);
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [result, sortKey, sortAsc]);

  const chartData = useMemo(
    () =>
      sortedMembers.map((m) => ({
        name: m.name,
        rate: Math.round(Number(m.achieve || 0) * 100),
        total: m.total,
        target: m.target,
      })),
    [sortedMembers],
  );

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900">团队统计</h1>
        <p className="mt-0.5 text-xs text-gray-500">
          展示个人当期交付能力指标，并按当前季度所有迭代统计团队成员任务工作量与目标达成率。
        </p>
      </div>

      {!user && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>当前未连接 DevOps，请先在左下角登录查看个人交付能力与执行团队统计。</span>
        </div>
      )}

      {/* 个人交付能力概览卡 */}
      {cap && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-900">
                个人交付能力 ({cap.userName || user?.realName})
              </h2>
              <span className="text-xs text-gray-400">
                周期：{cap.startMonth || "-"} ~ {cap.month || "-"}
              </span>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                cap.isQualified
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {cap.isQualified ? "✅ 已达标" : "⚠️ 暂未达标"}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-[11px] text-gray-500">个人交付能力</div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {cap.personalDeliveryCapacity ?? "-"}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-[11px] text-gray-500">达标线基准</div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {cap.personalDeliveryCapacityStandard ?? "-"}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-[11px] text-gray-500">统计卡片数</div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {cap.cardCount ?? "-"}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-[11px] text-gray-500">研发工时系数</div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {cap.devWorkCoefficient ?? "-"}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 统计过滤与触发 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => patchTeam({ nameFilter: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && user && !loading) handleCountTeam();
            }}
            placeholder="姓名或 ERP 关键词过滤（留空统计当前团队全部成员）..."
            className="min-w-[260px] flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
          />
          {loading && (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>中止统计</span>
            </button>
          )}
          <button
            type="button"
            disabled={!user || loading}
            onClick={handleCountTeam}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            <span>{loading ? "并行统计中..." : "开始季度团队统计"}</span>
          </button>
        </div>
        {result && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                统计范围：<strong className="text-gray-800">{result.org}</strong>
              </span>
              <span>纳入迭代：{result.sprints.join("、") || "无"}</span>
            </div>
            {queriedAt && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="lw-nums inline-flex items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50/70 px-2.5 py-1 text-[11px] text-blue-700">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span>
                    上次统计：<strong>{queriedAt}</strong>（
                    {formatRelativeElapsed(queriedAtMs, nowMs)} · 切换页面自动保留）
                  </span>
                </span>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    clearTeamData();
                    toast.info("已清空团队统计缓存");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>清空结果</span>
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 图表展示 */}
      {chartData.length > 0 && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            <span>成员季度工作量达成率 (%)（虚线为 90% 达标基准）</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis unit="%" tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value) => [`${String(value ?? 0)}%`, "达成率"]}
                  labelFormatter={(label) => `成员：${String(label)}`}
                />
                <ReferenceLine y={90} stroke="#10b981" strokeDasharray="4 4" label="90%" />
                <Bar dataKey="rate" radius={[6, 6, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell
                      key={d.name}
                      fill={
                        d.rate >= 90
                          ? "#10b981"
                          : d.rate >= 70
                            ? "#f59e0b"
                            : "#ef4444"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* 可排序明细表 */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-gray-50 text-[11px] font-semibold text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                  >
                    <span>成员姓名</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("total")}
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                  >
                    <span>实际工作量(d)</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("target")}
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                  >
                    <span>目标工时(d)</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("achieve")}
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                  >
                    <span>达成率</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("gap")}
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                  >
                    <span>差额(d)</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-2.5">各迭代分布</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedMembers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-gray-400">
                    点击「开始季度团队统计」汇总团队成员工作量。
                  </td>
                </tr>
              ) : (
                sortedMembers.map((m) => {
                  const pct = (Number(m.achieve || 0) * 100).toFixed(0);
                  const cls =
                    m.achieve >= 0.9
                      ? "bg-emerald-100 text-emerald-700"
                      : m.achieve >= 0.7
                        ? "bg-amber-100 text-amber-800"
                        : "bg-red-100 text-red-700";
                  const sprintTxt = Object.entries(m.sprints || {})
                    .filter(([, d]) => Number(d) > 0)
                    .map(([sp, d]) => `${sp}:${d}d`)
                    .join(" · ");
                  return (
                    <tr key={m.name} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{m.name}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-800">
                        {m.total.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-600">
                        {m.target.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${cls}`}
                        >
                          {pct}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-700">
                        {m.gap.toFixed(2)}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-[11px] text-gray-500" title={sprintTxt}>
                        {sprintTxt || "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
