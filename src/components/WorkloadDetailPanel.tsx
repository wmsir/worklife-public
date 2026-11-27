import { Fragment, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleX,
  Code2,
  HelpCircle,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  formatCodeLines,
  formatDays,
  formatRatioPct,
  parseWorkloadDetail,
} from "../lib/workloadParser";

interface WorkloadDetailPanelProps {
  cardCode: string;
  cardName: string;
  cardId: number;
  currentUserErp?: string;
  loading: boolean;
  error?: string;
  own: unknown;
  actual: unknown;
  detailRaw?: unknown;
  fallbackDeclaredDays?: number;
  fallbackRequiredDays?: number;
  onRefresh: () => void;
  onClose: () => void;
}

interface MetricCellProps {
  label: string;
  value: string;
  unit?: string;
  tone?: "default" | "green" | "orange";
  showCheckBadge?: boolean;
  helpText?: string;
}

function MetricCell({
  label,
  value,
  unit,
  tone = "default",
  showCheckBadge = false,
  helpText,
}: MetricCellProps) {
  const labelCls =
    tone === "green"
      ? "bg-emerald-50/90 text-emerald-700 border-emerald-200/80"
      : tone === "orange"
        ? "bg-orange-50/90 text-orange-700 border-orange-200/80"
        : "bg-slate-50 text-slate-600 border-slate-200/80";

  const valueCls =
    tone === "green"
      ? "text-emerald-700 font-semibold"
      : tone === "orange"
        ? "text-orange-600 font-semibold"
        : "text-slate-900 font-medium";

  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-slate-200/90 bg-white text-xs">
      <div
        className={`w-28 shrink-0 border-r px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap ${labelCls}`}
      >
        {label}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-1.5">
        <span className={`lw-nums truncate font-mono ${valueCls}`}>
          {value}
          {unit && <span className="ml-1 font-sans text-[11px] font-normal text-slate-500">{unit}</span>}
        </span>
        {(showCheckBadge || helpText) && (
          <span className="flex shrink-0 items-center gap-1">
            {showCheckBadge && (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            )}
            {helpText && (
              <span title={helpText} className="text-slate-400 hover:text-slate-600">
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export function WorkloadDetailPanel({
  cardCode,
  cardName,
  cardId,
  currentUserErp,
  loading,
  error,
  own,
  actual,
  detailRaw,
  fallbackDeclaredDays,
  fallbackRequiredDays,
  onRefresh,
  onClose,
}: WorkloadDetailPanelProps) {
  const [showRawJson, setShowRawJson] = useState(false);

  const parsed = useMemo(
    () =>
      parseWorkloadDetail({
        own,
        actual,
        detailRaw,
        fallbackDeclaredDays,
        fallbackRequiredDays,
      }),
    [own, actual, detailRaw, fallbackDeclaredDays, fallbackRequiredDays],
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      {/* 顶部栏：刷新 + 卡片信息 + 右侧说明/原始JSON/收起 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-blue-600" : ""}`} />
            <span>刷新</span>
          </button>
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="font-semibold text-slate-900">工作量明细</span>
            <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono font-semibold text-blue-700">
              {cardCode}
            </span>
            <span className="max-w-md truncate text-slate-600" title={cardName}>
              {cardName}
            </span>
            <span className="font-mono text-[11px] text-slate-400">#{cardId}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-[11px] text-slate-400 lg:inline">
            仅卡片创建人、开发负责人、测试负责人可编辑
          </span>
          <button
            type="button"
            onClick={() => setShowRawJson((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] transition ${
              showRawJson
                ? "border-blue-200 bg-blue-50 font-medium text-blue-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            <Code2 className="h-3 w-3" />
            <span>{showRawJson ? "隐藏原始 JSON" : "原始 JSON"}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭工作量明细"
            className="rounded-lg border border-slate-200 p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <span>正在拉取 DevOps 工作量明细与实际填报数据...</span>
        </div>
      ) : error ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          查询工作量明细失败：{error}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {/* 3 行指标卡片网格 */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCell
              label="评估预计人月"
              value={formatDays(parsed.estimatedManMonths, 2)}
              showCheckBadge={parsed.estimatedManMonths > 0}
              helpText="按 21.75 人天/月折算的评估预计人月"
            />
            <MetricCell label="评估预计人天" value={formatDays(parsed.estimatedDays, 4)} />
            <MetricCell label="甲方预计人天" value={formatDays(parsed.partyADays, 4)} />
            <MetricCell label="乙方预计人天" value={formatDays(parsed.partyBDays, 4)} />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCell label="需求预计人天" value={formatDays(parsed.reqDays, 4)} />
            <MetricCell label="设计预计人天" value={formatDays(parsed.designDays, 4)} />
            <MetricCell label="开发预计人天" value={formatDays(parsed.devDays, 4)} />
            <MetricCell label="测试预计人天" value={formatDays(parsed.testDays, 4)} />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <MetricCell
              label="实际填报人天"
              value={formatDays(parsed.actualReportDays, 4)}
              helpText="卡片实际已填报工时折算人天（按 7 小时/天）"
            />
            <MetricCell
              label="新增代码行数"
              value={formatCodeLines(parsed.addedCodeLines)}
              unit={parsed.addedCodeLines !== null ? "行" : undefined}
              tone="green"
            />
            <MetricCell
              label="删除代码行数"
              value={formatCodeLines(parsed.deletedCodeLines)}
              unit={parsed.deletedCodeLines !== null ? "行" : undefined}
              tone="orange"
            />
          </div>

          {/* 未保存提示条 */}
          {parsed.unsaved && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200/80 bg-rose-50/90 px-3 py-2 text-xs text-rose-700">
              <CircleX className="h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />
              <span>{parsed.unsavedMessage}</span>
            </div>
          )}

          {/* 6 列工作量拆解明细表 */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-center text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="border-r border-slate-200/70 px-3 py-2.5">工作类型</th>
                  <th className="border-r border-slate-200/70 px-3 py-2.5">
                    工作类型投入占比 (%)
                  </th>
                  <th className="border-r border-slate-200/70 px-3 py-2.5">
                    工作类型工作量 (人天)
                  </th>
                  <th className="border-r border-slate-200/70 px-3 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      <span>投入人员</span>
                      <HelpCircle className="h-3 w-3 text-slate-400" aria-hidden="true" />
                    </span>
                  </th>
                  <th className="border-r border-slate-200/70 px-3 py-2.5">个人投入占比 (%)</th>
                  <th className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      <span>个人工作量 (人天)</span>
                      <HelpCircle className="h-3 w-3 text-slate-400" aria-hidden="true" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 bg-white">
                {parsed.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      该卡片暂未拆解角色工作量明细，可展开右上角「原始 JSON」核对接口返回结构。
                    </td>
                  </tr>
                ) : (
                  parsed.rows.map((cat, cIdx) => {
                    const memberCount = cat.members.length;
                    if (memberCount === 0) {
                      return (
                        <tr key={`${cat.workType}-${cIdx}`} className="hover:bg-slate-50/70">
                          <td className="border-r border-slate-200/70 px-3 py-2.5 font-medium text-slate-800">
                            {cat.workType}
                          </td>
                          <td className="lw-nums border-r border-slate-200/70 px-3 py-2.5 font-mono text-slate-700">
                            {formatRatioPct(cat.typeRatio)}
                          </td>
                          <td className="lw-nums border-r border-slate-200/70 px-3 py-2.5 font-mono text-slate-700">
                            {formatDays(cat.typeWorkload, 4)}
                          </td>
                          <td className="border-r border-slate-200/70 px-3 py-2.5 text-slate-400">
                            -
                          </td>
                          <td className="border-r border-slate-200/70 px-3 py-2.5 text-slate-400">
                            -
                          </td>
                          <td className="px-3 py-2.5 text-slate-400">-</td>
                        </tr>
                      );
                    }

                    return (
                      <Fragment key={`${cat.workType}-${cIdx}`}>
                        {cat.members.map((mem, mIdx) => {
                          const isSelf = Boolean(
                            currentUserErp &&
                              mem.erp &&
                              mem.erp.toLowerCase() === currentUserErp.toLowerCase(),
                          );
                          return (
                            <tr
                              key={`${cat.workType}-${cIdx}-${mem.erp || mem.name}-${mIdx}`}
                              className={isSelf ? "bg-blue-50/35" : "hover:bg-slate-50/60"}
                            >
                              {mIdx === 0 && (
                                <>
                                  <td
                                    rowSpan={memberCount}
                                    className="border-r border-slate-200/70 px-3 py-2.5 align-middle font-medium text-slate-800"
                                  >
                                    {cat.workType}
                                  </td>
                                  <td
                                    rowSpan={memberCount}
                                    className="lw-nums border-r border-slate-200/70 px-3 py-2.5 align-middle font-mono text-slate-700"
                                  >
                                    {formatRatioPct(cat.typeRatio)}
                                  </td>
                                  <td
                                    rowSpan={memberCount}
                                    className="lw-nums border-r border-slate-200/70 px-3 py-2.5 align-middle font-mono text-slate-700"
                                  >
                                    {formatDays(cat.typeWorkload, 4)}
                                  </td>
                                </>
                              )}
                              <td className="border-r border-slate-200/70 px-3 py-2">
                                <div className="inline-flex items-center gap-2">
                                  <span
                                    className={
                                      isSelf
                                        ? "font-semibold text-blue-700"
                                        : "text-slate-800"
                                    }
                                    title={mem.erp ? `ERP: ${mem.erp}` : undefined}
                                  >
                                    {mem.name}
                                  </span>
                                  {mem.party && (
                                    <span
                                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                                        mem.party === "甲"
                                          ? "border-sky-300 bg-sky-50 text-sky-600"
                                          : "border-amber-300 bg-amber-50 text-amber-700"
                                      }`}
                                    >
                                      {mem.party}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="border-r border-slate-200/70 px-3 py-1.5">
                                {mem.ratio !== null ? (
                                  <span className="lw-nums inline-block min-w-20 rounded-md border border-slate-200 bg-slate-100/90 px-3 py-1 font-mono text-xs font-semibold text-slate-800">
                                    {formatRatioPct(mem.ratio)}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>
                              <td className="lw-nums px-3 py-2 font-mono text-slate-800">
                                {formatDays(mem.workload, 4)}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
              {parsed.rows.length > 0 && (
                <tfoot className="border-t border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                  <tr>
                    <td className="border-r border-slate-200/70 px-3 py-2.5">总计</td>
                    <td className="lw-nums border-r border-slate-200/70 px-3 py-2.5 font-mono">
                      {formatRatioPct(parsed.totalTypeRatio)}
                    </td>
                    <td className="lw-nums border-r border-slate-200/70 px-3 py-2.5 font-mono">
                      {formatDays(parsed.totalTypeWorkload, 4)}
                    </td>
                    <td className="lw-nums border-r border-slate-200/70 px-3 py-2.5 font-mono">
                      {parsed.uniqueMemberCount}
                    </td>
                    <td className="lw-nums border-r border-slate-200/70 px-3 py-2.5 font-mono">
                      {formatRatioPct(parsed.totalPersonalRatio)}
                    </td>
                    <td className="lw-nums px-3 py-2.5 font-mono">
                      {formatDays(parsed.totalPersonalWorkload, 4)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* 原始 JSON 折叠调试区 */}
          {showRawJson && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-700">
                  卡片角色工作量 (get_own_workload)
                </div>
                <pre className="max-h-60 overflow-auto rounded-lg bg-white p-2 font-mono text-[10px] text-slate-700">
                  {JSON.stringify(own, null, 2)}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-slate-700">
                  实际填报工时 (get_actual_report_hours)
                </div>
                <pre className="max-h-60 overflow-auto rounded-lg bg-white p-2 font-mono text-[10px] text-slate-700">
                  {JSON.stringify(actual, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
