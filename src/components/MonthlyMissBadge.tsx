import { BellRing, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import { useMonthlyMissStore } from "../store/runtimeStore";

export function MonthlyMissBadge() {
  const user = useAppStore((s) => s.user);
  const checking = useMonthlyMissStore((s) => s.checking);
  const summary = useMonthlyMissStore((s) => s.summary);

  if (!user) return null;

  if (checking && !summary) {
    return (
      <Link
        to="/work/miss?view=calendar"
        title="正在自动核对本月工时填报情况..."
        className="hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500 @[1080px]:inline-flex"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>核对报工...</span>
      </Link>
    );
  }

  if (!summary) return null;

  const pastCnt = summary.pastMissDates.length;
  if (pastCnt > 0) {
    return (
      <Link
        to="/work/miss?view=calendar"
        title={`点击查看本月报工日历（截至昨日有 ${pastCnt} 个工作日缺报/不足）`}
        className="lw-nums inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100"
      >
        <BellRing className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>缺报 {pastCnt} 天</span>
      </Link>
    );
  }

  if (summary.todayNeedsReport) {
    return (
      <Link
        to="/work/miss?view=calendar"
        title={`本月历史工作日已达标（累计 ${summary.totalReportedHours.toFixed(1)}h），今日待填报`}
        className="lw-nums hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 transition hover:bg-amber-100 @[980px]:inline-flex"
      >
        <BellRing className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>今日待报</span>
      </Link>
    );
  }

  return (
    <Link
      to="/work/miss?view=calendar"
      title={`本月工时已达标，累计已报 ${summary.totalReportedHours.toFixed(1)}h（点击查看日历）`}
      className="lw-nums hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100 @[1080px]:inline-flex"
    >
      <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>本月已报 {summary.totalReportedHours.toFixed(1)}h</span>
    </Link>
  );
}
