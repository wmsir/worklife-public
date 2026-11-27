import type { ReactNode } from "react";

interface PageHeaderProps {
  icon?: React.ComponentType<{ className?: string }>;
  iconBgClass?: string;
  iconColorClass?: string;
  title: ReactNode;
  badges?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Unified page hero/header card following Operate-mode clarity rules. */
export function PageHeader({
  icon: Icon,
  iconBgClass = "bg-blue-50 border-blue-100",
  iconColorClass = "text-blue-600",
  title,
  badges,
  subtitle,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <section className={`lw-card px-5 py-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconBgClass}`}
              aria-hidden="true"
            >
              <Icon className={`h-5 w-5 ${iconColorClass}`} />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                {title}
              </h1>
              {badges}
            </div>
            {subtitle && (
              <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
                {subtitle}
              </div>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  );
}

export interface SegmentedTabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
}

interface SegmentedTabsProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  items: ReadonlyArray<SegmentedTabItem<T>>;
  className?: string;
}

/** Shared segmented control pill bar. */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  items,
  className = "",
}: SegmentedTabsProps<T>) {
  return (
    <div
      className={`inline-flex flex-wrap items-center gap-0.5 rounded-xl border border-slate-200/80 bg-slate-100/80 p-0.5 ${className}`}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              active
                ? "bg-white font-semibold text-blue-600 shadow-2xs"
                : "font-medium text-slate-600 hover:text-slate-900"
            }`}
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span>{item.label}</span>
            {typeof item.count === "number" && (
              <span
                className={`lw-nums rounded-full px-1.5 py-0 text-[10px] ${
                  active ? "bg-blue-50 text-blue-600" : "bg-white/80 text-slate-500"
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Actionable empty state placeholder. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-8 text-center ${className}`}
    >
      {Icon && (
        <div
          className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-2xs"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="text-xs font-medium text-slate-700">{title}</div>
      {description && (
        <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-slate-400">
          {description}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
