import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Award,
  Briefcase,
  Calendar,
  CheckCircle2,
  Layers,
  Loader2,
  RefreshCw,
  Rocket,
  UserCheck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { DateBadge } from "../components/DateBadge";
import { api } from "../lib/api";
import {
  addDaysYmd,
  formatDateRangeZh,
  formatIsoTimeZh,
  isValidYmd,
  todayYmd,
  weekRangeYmd,
} from "../lib/date";
import { isTaskEffectivelyDone } from "../lib/taskFilter";
import { useAppStore } from "../store/appStore";

export function WorkOverviewPage() {
  const { todos, tasks, user, setUser } = useAppStore(
    useShallow((s) => ({
      todos: s.todos,
      tasks: s.tasks,
      user: s.user,
      setUser: s.setUser,
    })),
  );
  const [syncingProfile, setSyncingProfile] = useState(false);
  const today = todayYmd();
  const week = weekRangeYmd();

  const handleSyncProfile = async () => {
    setSyncingProfile(true);
    try {
      const info = await api.whoami();
      setUser(info);
      toast.success(`已同步个人数据与交付产能：${info.realName}`);
    } catch (e) {
      toast.error(`同步失败：${String(e)}`);
    } finally {
      setSyncingProfile(false);
    }
  };

  const todayTodoCount = useMemo(
    () => todos.filter((t) => t.date === today && !t.done).length,
    [todos, today],
  );

  const inProgressTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !isTaskEffectivelyDone(t, today) &&
          (t.status === "进行中" || t.status === "已提测"),
      ).length,
    [tasks, today],
  );

  const weekReleaseTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.releaseDate &&
          t.releaseDate >= week.start &&
          t.releaseDate <= week.end,
      ).length,
    [tasks, week.start, week.end],
  );

  const workloadCounts = useMemo(() => {
    const counts = {
      未开始: 0,
      进行中: 0,
      已提测: 0,
      已发版: 0,
    };
    for (const t of tasks) {
      if (t.status in counts) {
        counts[t.status as keyof typeof counts] += 1;
      }
    }
    return counts;
  }, [tasks]);

  // 未来 6 周每周发版任务数
  const releaseChartData = useMemo(() => {
    const weeks: Array<{ label: string; range: string; count: number }> = [];
    for (let i = 0; i < 6; i++) {
      const start = addDaysYmd(week.start, i * 7);
      const end = addDaysYmd(start, 6);
      const cnt = tasks.filter(
        (t) => t.releaseDate && t.releaseDate >= start && t.releaseDate <= end,
      ).length;
      weeks.push({
        label: i === 0 ? "本周" : `第${i + 1}周`,
        range: `${start.slice(5)}~${end.slice(5)}`,
        count: cnt,
      });
    }
    return weeks;
  }, [tasks, week.start]);

  // Recent activity: merge task history & completed todos
  const recentActivity = useMemo(() => {
    const items: Array<{
      at: string;
      title: string;
      badge: string;
      color: string;
      to?: string;
    }> = [];
    for (const t of tasks) {
      for (const h of t.history || []) {
        items.push({
          at: h.at,
          title: `${t.code} · ${t.name || "未命名"} — ${h.event}`,
          badge: "任务",
          color: "bg-blue-50 text-blue-700",
          to: `/work/task/${encodeURIComponent(t.code)}`,
        });
      }
    }
    for (const td of todos) {
      if (td.done && td.doneAt) {
        items.push({
          at: td.doneAt,
          title: `完成待办：${td.title}`,
          badge: "待办",
          color: "bg-emerald-50 text-emerald-700",
          to: "/todos",
        });
      }
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [tasks, todos]);

  const overdueReleaseCount = useMemo(
    () =>
      tasks.filter(
        (t) =>
          isValidYmd(t.releaseDate) &&
          t.releaseDate < today &&
          t.status !== "已发版" &&
          t.status !== "已关闭",
      ).length,
    [tasks, today],
  );

  const activeSprints = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) {
      if (isTaskEffectivelyDone(t, today)) continue;
      const sp = t.sprint.trim();
      if (sp) {
        map.set(sp, (map.get(sp) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.name.localeCompare(a.name, "zh-CN", { numeric: true }));
  }, [tasks, today]);

  const upcomingReleases = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            t.releaseDate &&
            t.releaseDate >= today &&
            t.status !== "已发版" &&
            t.status !== "已关闭",
        )
        .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
        .slice(0, 5),
    [tasks, today],
  );

  const todayTodos = useMemo(
    () => todos.filter((t) => t.date === today && !t.done).slice(0, 5),
    [todos, today],
  );

  const cap = user?.capacity;
  const hasCapacity = Boolean(
    cap &&
      (cap.personalDeliveryCapacity !== undefined ||
        cap.personalDeliveryCapacityStandard !== undefined ||
        cap.month ||
        cap.cardCount !== undefined),
  );
  const capVal = Number(cap?.personalDeliveryCapacity ?? 0);
  const stdVal = Number(cap?.personalDeliveryCapacityStandard ?? 0);
  const capPct = stdVal > 0 ? Math.min(100, Math.round((capVal / stdVal) * 100)) : 0;
  const orgName = user?.orgName || user?.user?.org?.name || "";
  const userErp = user?.erp || user?.user?.userErp || user?.user?.erp || "";

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 xl:grid-cols-12">
      {/* 左侧主区域 */}
      <div className="space-y-5 xl:col-span-8">
        {overdueReleaseCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-xs text-rose-800">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
              <span>
                检测到 <strong>{overdueReleaseCount}</strong> 个任务已过计划发版日期但尚未确认「已发版」，建议及时核对归档。
              </span>
            </div>
            <Link
              to="/work/ledger?status=__pending_release__"
              className="shrink-0 rounded-xl bg-rose-600 px-3 py-1.5 font-medium text-white hover:bg-rose-700"
            >
              去一键确认已发版 →
            </Link>
          </div>
        )}

        {/* 3 张统计卡 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="lw-card p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>今日待办</span>
              <CheckCircle2 className="h-4 w-4 text-blue-600" aria-hidden="true" />
            </div>
            <div className="lw-nums mt-2 text-2xl font-bold text-slate-900">{todayTodoCount}</div>
            <Link
              to="/today"
              className="mt-1 inline-block text-[11px] font-medium text-blue-600 hover:underline"
            >
              查看今日安排 →
            </Link>
          </div>

          <div className="lw-card p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>进行中任务</span>
              <Briefcase className="h-4 w-4 text-indigo-600" aria-hidden="true" />
            </div>
            <div className="lw-nums mt-2 text-2xl font-bold text-slate-900">{inProgressTasks}</div>
            <Link
              to="/work/ledger"
              className="mt-1 inline-block text-[11px] font-medium text-indigo-600 hover:underline"
            >
              管理离线台账 →
            </Link>
          </div>

          <div className="lw-card p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>本周发版</span>
              <Rocket className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div className="lw-nums mt-2 text-2xl font-bold text-slate-900">{weekReleaseTasks}</div>
            <div className="lw-nums mt-1 text-[11px] text-slate-400">
              {formatDateRangeZh(week.start, week.end)}
            </div>
          </div>
        </div>

        {/* Workload 4 格 */}
        <div className="lw-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">任务状态分布 (Workload)</h2>
            <span className="lw-nums text-xs text-slate-400">共 {tasks.length} 个离线台账任务</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["未开始", "border-slate-200 bg-slate-50 text-slate-700"],
                ["进行中", "border-blue-200 bg-blue-50/60 text-blue-700"],
                ["已提测", "border-amber-200 bg-amber-50/60 text-amber-700"],
                ["已发版", "border-emerald-200 bg-emerald-50/60 text-emerald-700"],
              ] as const
            ).map(([status, cls]) => (
              <Link
                key={status}
                to={`/work/ledger?status=${encodeURIComponent(status)}`}
                className={`rounded-xl border p-3.5 transition-shadow hover:shadow-sm ${cls}`}
              >
                <div className="text-xs font-medium">{status}</div>
                <div className="lw-nums mt-1 text-2xl font-bold">
                  {workloadCounts[status as keyof typeof workloadCounts]}
                </div>
              </Link>
            ))}
          </div>

          {activeSprints.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3.5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <Layers className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                <span>当前在研版本 / 迭代（点击直达台账筛选）</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeSprints.map((sp) => (
                  <Link
                    key={sp.name}
                    to={`/work/ledger?sprint=${encodeURIComponent(sp.name)}`}
                    className="lw-nums inline-flex items-center gap-1.5 rounded-full border border-indigo-200/80 bg-indigo-50/70 px-2.5 py-1 text-[11px] font-medium text-indigo-800 transition hover:bg-indigo-100"
                  >
                    <span>{sp.name}</span>
                    <span className="rounded-full bg-white px-1.5 py-0 text-[10px] font-semibold text-indigo-700">
                      {sp.count}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 未来 6 周发版柱状图 */}
        <div className="lw-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">未来 6 周发版节奏</h2>
              <p className="text-xs text-slate-400">按任务台账中设定的发版日期统计</p>
            </div>
            <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={releaseChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip
                  formatter={(value) => [`${value} 个任务`, "计划发版"]}
                  labelFormatter={(label, payload) => {
                    const range = payload?.[0]?.payload?.range;
                    return `${label} (${range || ""})`;
                  }}
                />
                <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent activity */}
        <div className="lw-card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Activity className="h-4 w-4 text-blue-600" aria-hidden="true" />
            <span>最近动态</span>
          </div>
          {recentActivity.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">暂无活动记录</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentActivity.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-2.5 text-xs">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${item.color}`}>
                      {item.badge}
                    </span>
                    {item.to ? (
                      <Link
                        to={item.to}
                        className="truncate text-slate-800 hover:text-blue-600 hover:underline"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <span className="truncate text-slate-800">{item.title}</span>
                    )}
                  </div>
                  <span
                    className="lw-nums ml-3 shrink-0 text-[11px] text-slate-400"
                    title={item.at.replace("T", " ").slice(0, 19)}
                  >
                    {formatIsoTimeZh(item.at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧信息栏 */}
      <div className="space-y-5 xl:col-span-4">
        {/* 用户与产能卡片 */}
        <div className="lw-card p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                <UserCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-slate-900">
                    {user ? user.realName : "未连接 DevOps"}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      user
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        user ? "bg-emerald-500" : "bg-slate-400"
                      }`}
                    />
                    {user ? "已连接" : "未连接"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {user
                    ? orgName
                      ? `${orgName}${userErp ? ` · ${userErp}` : ""}`
                      : userErp || "已连接 DevOps 工作区"
                    : "离线模式仍可使用台账与生活管理"}
                </div>
              </div>
            </div>

            {user && (
              <button
                type="button"
                disabled={syncingProfile}
                onClick={handleSyncProfile}
                title="立即重新同步个人基础数据与交付产能"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              >
                {syncingProfile ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                )}
                <span>同步</span>
              </button>
            )}
          </div>

          {user && (
            <div className="lw-nums mt-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-2.5 text-[11px]">
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400">所属部门</div>
                <div className="truncate font-medium text-slate-800">{orgName || "-"}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-slate-400">工号 / ERP</div>
                <div className="truncate font-mono font-medium text-slate-800">{userErp || "-"}</div>
              </div>
              {typeof user.memberCount === "number" && user.memberCount > 0 && (
                <div>
                  <div className="text-[10px] text-slate-400">空间成员同步</div>
                  <div className="font-medium text-slate-800">{user.memberCount} 人</div>
                </div>
              )}
              {user.syncedAt && (
                <div>
                  <div className="text-[10px] text-slate-400">最近同步</div>
                  <div className="truncate font-medium text-slate-700" title={user.syncedAt}>
                    {formatIsoTimeZh(user.syncedAt)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-700">
              <span className="flex items-center gap-1.5">
                <Award className="h-4 w-4 text-blue-600" aria-hidden="true" />
                个人交付产能
              </span>
              {hasCapacity && cap && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    cap.isQualified
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {cap.isQualified ? "已达标" : "未达标"}
                </span>
              )}
            </div>

            {hasCapacity && cap ? (
              <div className="lw-nums space-y-2.5 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>考核周期</span>
                  <span className="font-medium text-slate-800">
                    {cap.startMonth && cap.month
                      ? `${cap.startMonth} ~ ${cap.month}`
                      : cap.month || "当前批次"}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${
                      cap.isQualified ? "bg-emerald-500" : "bg-blue-600"
                    }`}
                    style={{ width: `${capPct}%` }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center">
                  <div>
                    <div className="text-[10px] text-slate-400">当前产能</div>
                    <div className="font-semibold text-blue-700">
                      {capVal.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">基准线</div>
                    <div className="font-semibold text-slate-800">
                      {stdVal.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">卡片 / 系数</div>
                    <div className="font-semibold text-slate-800">
                      {cap.cardCount ?? 0} / {Number(cap.devWorkCoefficient ?? 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-400">
                {user
                  ? "已连接 DevOps，但当前批次暂无返回交付产能指标，可点击右上角「同步」重试。"
                  : "连接 DevOps 后将自动同步个人信息并展示当前批次交付产能、达标状态与研发系数"}
              </div>
            )}
          </div>
        </div>

        {/* Upcoming */}
        <div className="lw-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">即将发版 (Upcoming)</h3>
          {upcomingReleases.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-400">
              暂无近期计划发版的任务
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingReleases.map((t) => (
                <Link
                  key={t.code}
                  to={`/work/task/${encodeURIComponent(t.code)}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-xs transition-colors hover:border-blue-200 hover:bg-blue-50/40"
                >
                  <div className="min-w-0">
                    <div className="font-mono font-medium text-blue-600">{t.code}</div>
                    <div className="truncate text-slate-700">{t.name}</div>
                  </div>
                  <DateBadge date={t.releaseDate} showWeekday showIcon={false} />
                </Link>
              ))}
            </div>
          )}

          <h3 className="mt-5 mb-2.5 text-sm font-semibold text-gray-900">今日待办摘要</h3>
          {todayTodos.length === 0 ? (
            <div className="py-3 text-center text-xs text-gray-400">今日待办已全部完成</div>
          ) : (
            <div className="space-y-1.5">
              {todayTodos.map((td) => (
                <div
                  key={td.id}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-700"
                >
                  <span className="truncate">{td.title}</span>
                  {td.time && (
                    <span className="ml-2 font-mono text-[11px] text-blue-600">{td.time}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
