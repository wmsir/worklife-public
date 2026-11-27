import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, AlertTriangle, HelpCircle, X } from "lucide-react";

export type ConfirmTone = "danger" | "warning" | "default";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

type ConfirmListener = (req: PendingConfirm) => void;

const listeners = new Set<ConfirmListener>();
let seq = 0;

/**
 * In-app accessible confirmation modal replacing browser native `window.confirm`.
 * Always resolves to `true` (confirmed) or `false` (cancelled/dismissed).
 */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions =
    typeof options === "string" ? { title: options, tone: "warning" } : options;
  return new Promise<boolean>((resolve) => {
    const req: PendingConfirm = {
      ...opts,
      id: ++seq,
      resolve,
    };
    if (listeners.size === 0) {
      resolve(window.confirm(opts.description ? `${opts.title}\n\n${opts.description}` : opts.title));
      return;
    }
    for (const fn of listeners) {
      fn(req);
      break;
    }
  });
}

export function ConfirmDialogHost() {
  const [queue, setQueue] = useState<PendingConfirm[]>([]);
  const active = queue[0] ?? null;

  useEffect(() => {
    const handler: ConfirmListener = (req) => {
      setQueue((prev) => [...prev, req]);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const finish = (ok: boolean) => {
    if (!active) return;
    active.resolve(ok);
    setQueue((prev) => prev.slice(1));
  };

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        active.resolve(false);
        setQueue((prev) => prev.slice(1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  if (!active || typeof document === "undefined") return null;

  const tone = active.tone ?? "default";
  const Icon =
    tone === "danger" ? AlertTriangle : tone === "warning" ? AlertCircle : HelpCircle;

  const iconWrapCls =
    tone === "danger"
      ? "bg-rose-50 text-rose-600 ring-1 ring-rose-200/80"
      : tone === "warning"
        ? "bg-amber-50 text-amber-600 ring-1 ring-amber-200/80"
        : "bg-blue-50 text-blue-600 ring-1 ring-blue-200/80";

  const confirmBtnCls =
    tone === "danger"
      ? "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500"
      : tone === "warning"
        ? "bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-500"
        : "bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500";

  return createPortal(
    <div
      className="lw-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lw-confirm-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) finish(false);
      }}
    >
      <div className="lw-modal-panel w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-start gap-3.5 p-5">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconWrapCls}`}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3
                id="lw-confirm-title"
                className="text-sm font-semibold leading-snug text-slate-900"
              >
                {active.title}
              </h3>
              <button
                type="button"
                aria-label="关闭确认框"
                onClick={() => finish(false)}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {active.description && (
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                {active.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <button
            type="button"
            autoFocus={tone === "danger"}
            onClick={() => finish(false)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            {active.cancelText ?? "取消"}
          </button>
          <button
            type="button"
            autoFocus={tone !== "danger"}
            onClick={() => finish(true)}
            className={`rounded-xl px-4 py-1.5 text-xs font-medium shadow-2xs transition-colors ${confirmBtnCls}`}
          >
            {active.confirmText ?? (tone === "danger" ? "确认删除" : "确定")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
