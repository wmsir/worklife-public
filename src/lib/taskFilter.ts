import { isValidYmd, todayYmd } from "./date";
import type { TaskRecord } from "./types";

/**
 * 判断任务的计划发版日期是否早于今日（发版日期 < today 表示已做完）
 */
export function isTaskPastRelease(t: TaskRecord, today = todayYmd()): boolean {
  return Boolean(isValidYmd(t.releaseDate) && t.releaseDate < today);
}

/**
 * 判断任务是否已实质完成（已发版 / 已关闭 / 计划发版日期早于今日）
 */
export function isTaskEffectivelyDone(t: TaskRecord, today = todayYmd()): boolean {
  return t.status === "已发版" || t.status === "已关闭" || isTaskPastRelease(t, today);
}

/**
 * 判断任务是否落在指定日期范围 [startDate, endDate] 内：
 * - 若任务配有任意排期日期（startDate / planTestDate / releaseDate），按日期点或跨度重叠判断，不再被 updatedAt 干扰；
 * - 若任务完全没有排期日期，才退回到 updatedAt 或进行中状态。
 */
export function isTaskInDateRange(
  t: TaskRecord,
  startDate: string,
  endDate: string,
): boolean {
  if (!startDate && !endDate) return true;
  const lo = startDate || "0000-01-01";
  const hi = endDate || "9999-12-31";
  const inRange = (d?: string | null) => Boolean(d && isValidYmd(d) && d >= lo && d <= hi);

  const scheduleDates = [t.startDate, t.planTestDate, t.releaseDate].filter((d) =>
    isValidYmd(d),
  );
  if (scheduleDates.length > 0) {
    if (scheduleDates.some((d) => inRange(d))) {
      return true;
    }
    const sorted = [...scheduleDates].sort();
    const spanStart = sorted[0];
    const spanEnd = sorted[sorted.length - 1];
    return spanStart <= hi && spanEnd >= lo;
  }

  return (
    inRange(t.updatedAt?.slice(0, 10)) ||
    t.status === "进行中" ||
    t.status === "已提测"
  );
}
