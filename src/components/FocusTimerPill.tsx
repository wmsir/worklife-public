import { useEffect, useRef, useState } from "react";
import {
  Check,
  Coffee,
  Lock,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "../store/appStore";
import { useFocusStore } from "../store/runtimeStore";

function playFocusBeep() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch {
    // Ignore audio context blocked errors
  }
}

function formatMmSs(totalSecs: number): string {
  const safe = Math.max(0, Math.floor(totalSecs));
  const m = String(Math.floor(safe / 60)).padStart(2, "0");
  const s = String(safe % 60).padStart(2, "0");
  return `${m}:${s}`;
}

const FOCUS_PRESETS = [
  { mins: 25, label: "25 分钟", desc: "深度专注" },
  { mins: 45, label: "45 分钟", desc: "编码冲刺" },
  { mins: 15, label: "15 分钟", desc: "快速处理" },
  { mins: 5, label: "5 分钟", desc: "护眼休息" },
] as const;

export function FocusTimerPill() {
  const focusTodoId = useFocusStore((s) => s.focusTodoId);
  const focusTitle = useFocusStore((s) => s.focusTitle);
  const focusSecondsLeft = useFocusStore((s) => s.focusSecondsLeft);
  const focusRunning = useFocusStore((s) => s.focusRunning);
  const breakReminderMins = useFocusStore((s) => s.breakReminderMins);
  const breakDurationMins = useFocusStore((s) => s.breakDurationMins);
  const breakLockEnabled = useFocusStore((s) => s.breakLockEnabled);
  const breakStrictMode = useFocusStore((s) => s.breakStrictMode);
  const breakNextDueAt = useFocusStore((s) => s.breakNextDueAt);
  const breakPaused = useFocusStore((s) => s.breakPaused);
  const breakPausedRemainMs = useFocusStore((s) => s.breakPausedRemainMs);
  const breakActive = useFocusStore((s) => s.breakActive);

  const startFocus = useFocusStore((s) => s.startFocus);
  const pauseFocus = useFocusStore((s) => s.pauseFocus);
  const resumeFocus = useFocusStore((s) => s.resumeFocus);
  const stopFocus = useFocusStore((s) => s.stopFocus);
  const tickFocus = useFocusStore((s) => s.tickFocus);
  const setBreakConfig = useFocusStore((s) => s.setBreakConfig);
  const toggleBreakPaused = useFocusStore((s) => s.toggleBreakPaused);
  const resetBreakTimer = useFocusStore((s) => s.resetBreakTimer);
  const triggerBreakNow = useFocusStore((s) => s.triggerBreakNow);
  const incrementTodoPomodoro = useAppStore((s) => s.incrementTodoPomodoro);

  const [menuOpen, setMenuOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const boxRef = useRef<HTMLDivElement>(null);
  const warnedDueAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // 1-second timer only active while a Pomodoro countdown is running
  useEffect(() => {
    if (!focusRunning) return;
    const timer = window.setInterval(() => {
      const done = tickFocus();
      if (done) {
        playFocusBeep();
        const st = useFocusStore.getState();
        const tid = st.focusTodoId;
        const title = st.focusTitle;
        if (tid) {
          incrementTodoPomodoro(tid).catch(() => {});
        }
        toast.success(`🍅 完成 1 个专注时段：${title || "专注计时"}`);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focusRunning, tickFocus, incrementTodoPomodoro]);

  // Break-lock scheduler: 60s pre-warning + auto trigger fullscreen lock (or toast)
  useEffect(() => {
    if (breakReminderMins <= 0 || breakPaused || breakActive) return;

    const timer = window.setInterval(() => {
      const st = useFocusStore.getState();
      if (st.breakReminderMins <= 0 || st.breakPaused || st.breakActive) return;
      const now = Date.now();
      setNowMs(now);
      const dueAt = st.breakNextDueAt;
      if (!dueAt) return;
      const remainMs = dueAt - now;

      if (
        remainMs > 0 &&
        remainMs <= 60_000 &&
        st.breakReminderMins >= 2 &&
        warnedDueAtRef.current !== dueAt
      ) {
        warnedDueAtRef.current = dueAt;
        toast.warning(
          st.breakLockEnabled
            ? "⏳ 1 分钟后将进入全屏强制休息锁屏，请及时保存当前操作"
            : "⏳ 再过 1 分钟将提醒休息",
          {
            duration: 12000,
            action: {
              label: "推迟 5 分钟",
              onClick: () => {
                useFocusStore.getState().snoozeBreak(5);
                toast.info("已顺延 5 分钟后提醒休息");
              },
            },
          },
        );
      }

      if (remainMs <= 0) {
        warnedDueAtRef.current = null;
        if (st.breakLockEnabled) {
          st.triggerBreakNow();
        } else {
          st.resetBreakTimer();
          toast.info(`👀 已连续工作 ${st.breakReminderMins} 分钟，起来喝口水、远眺放松吧`, {
            duration: 10000,
            action: {
              label: `休息 ${st.breakDurationMins} 分钟`,
              onClick: () => {
                useFocusStore.getState().triggerBreakNow();
              },
            },
          });
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [breakReminderMins, breakPaused, breakActive]);

  const remainMs =
    breakReminderMins <= 0
      ? 0
      : breakPaused
        ? breakPausedRemainMs
        : Math.max(0, (breakNextDueAt ?? nowMs) - nowMs);
  const remainSecs = Math.ceil(remainMs / 1000);
  const remainMinsBadge = Math.max(1, Math.ceil(remainSecs / 60));
  const isAlmostDue = breakReminderMins > 0 && !breakPaused && remainSecs <= 60;

  if (focusTitle || focusSecondsLeft > 0) {
    return (
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50/80 px-2.5 py-1 text-xs">
        <span>🍅</span>
        <span className="lw-nums font-mono font-semibold text-rose-700">
          {String(Math.floor(focusSecondsLeft / 60)).padStart(2, "0")}:
          {String(focusSecondsLeft % 60).padStart(2, "0")}
        </span>
        <span className="max-w-28 truncate text-rose-900 @[1040px]:max-w-36" title={focusTitle}>
          {focusTitle}
        </span>
        <button
          type="button"
          aria-label={focusRunning ? "暂停专注" : "继续专注"}
          onClick={() => (focusRunning ? pauseFocus() : resumeFocus())}
          className="rounded p-0.5 text-rose-700 hover:bg-rose-100"
          title={focusRunning ? "暂停" : "继续"}
        >
          {focusRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={async () => {
            if (focusTodoId) {
              await incrementTodoPomodoro(focusTodoId).catch(() => {});
            }
            stopFocus();
            toast.success("已记录 +1 🍅 专注");
          }}
          className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-700"
          title="提前完成并记录 1 个番茄"
        >
          <Check className="h-2.5 w-2.5" />
          <span>完成</span>
        </button>
        <button
          type="button"
          aria-label="结束专注计时"
          onClick={stopFocus}
          className="rounded p-0.5 text-slate-500 hover:bg-rose-100 hover:text-rose-700"
          title="取消"
        >
          <Square className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setNowMs(Date.now());
          setMenuOpen((o) => !o);
        }}
        title={
          breakReminderMins > 0
            ? `定时${breakLockEnabled ? "强制休息锁屏" : "护眼提醒"}：每 ${breakReminderMins} 分钟（${
                breakPaused ? "已暂停" : `剩余 ${formatMmSs(remainSecs)}`
              }），点击管理或立即休息`
            : "开启专注番茄钟 / 设置定时休息锁屏"
        }
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          breakReminderMins <= 0
            ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            : isAlmostDue
              ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              : breakPaused
                ? "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                : "border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100/70"
        }`}
      >
        <Timer
          className={`h-3.5 w-3.5 shrink-0 ${
            breakReminderMins > 0 && !breakPaused ? "text-emerald-600" : "text-rose-500"
          }`}
          aria-hidden="true"
        />
        <span className="hidden @[1040px]:inline">专注</span>
        {breakReminderMins > 0 && (
          <span
            className={`lw-nums rounded px-1 py-0 text-[10px] font-semibold ${
              isAlmostDue
                ? "bg-amber-200/80 text-amber-900"
                : breakPaused
                  ? "bg-slate-200 text-slate-600"
                  : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {breakPaused ? "暂停" : `${remainMinsBadge}m`}
          </span>
        )}
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-40 mt-1.5 w-76 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl">
          <div className="text-xs font-semibold text-slate-900">快速开启专注计时</div>
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="专注事项（可选，如：代码评审）"
            className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          />
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {FOCUS_PRESETS.map((p) => (
              <button
                key={p.mins}
                type="button"
                onClick={() => {
                  startFocus(null, customTitle.trim() || p.desc, p.mins);
                  setCustomTitle("");
                  setMenuOpen(false);
                }}
                className="flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/70 px-2.5 py-1.5 text-left text-[11px] transition hover:border-blue-300 hover:bg-blue-50"
              >
                <span className="font-semibold text-slate-800">{p.label}</span>
                <span className="text-slate-500">{p.desc}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 border-t border-slate-100 pt-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-800">
                <Coffee className="h-3.5 w-3.5 text-emerald-600" />
                <span>强制定时休息锁屏</span>
              </div>
              {breakReminderMins > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setNowMs(Date.now());
                      toggleBreakPaused();
                    }}
                    title={breakPaused ? "继续倒计时" : "暂停倒计时"}
                    className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
                  >
                    {breakPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNowMs(Date.now());
                      resetBreakTimer();
                      toast.info(`已重置为 ${breakReminderMins} 分钟后提醒休息`);
                    }}
                    title="重新开始计时"
                    className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-100"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            {breakReminderMins > 0 && (
              <div className="lw-nums mt-1.5 flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
                <span>{breakPaused ? "计时已暂停" : "距下次休息锁屏"}</span>
                <span className="font-mono font-semibold text-emerald-700">
                  {formatMmSs(remainSecs)}
                </span>
              </div>
            )}

            <div className="mt-2 grid grid-cols-4 gap-1">
              {[0, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setNowMs(Date.now());
                    setBreakConfig({ breakReminderMins: m });
                    toast.success(
                      m === 0 ? "已关闭定时休息锁屏" : `已设置每 ${m} 分钟自动提示休息`,
                    );
                  }}
                  className={`rounded-lg py-1 text-[11px] font-medium transition ${
                    breakReminderMins === m
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {m === 0 ? "关闭" : `${m}分`}
                </button>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
              <label className="flex items-center justify-between gap-1 rounded-lg border border-slate-200/80 px-2 py-1">
                <span>工作间隔(分)</span>
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={breakReminderMins}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (Number.isFinite(val)) {
                      setNowMs(Date.now());
                      setBreakConfig({ breakReminderMins: val });
                    }
                  }}
                  className="w-12 rounded border border-slate-200 px-1 py-0.5 text-right font-mono text-slate-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex items-center justify-between gap-1 rounded-lg border border-slate-200/80 px-2 py-1">
                <span>休息时长(分)</span>
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
                  className="w-12 rounded border border-slate-200 px-1 py-0.5 text-right font-mono text-slate-800 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-2 space-y-1 text-[11px] text-slate-600">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={breakLockEnabled}
                  onChange={(e) => setBreakConfig({ breakLockEnabled: e.target.checked })}
                  className="rounded border-slate-300 text-emerald-600"
                />
                <Lock className="h-3 w-3 text-teal-600" />
                <span>到期自动置顶全屏锁屏</span>
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={breakStrictMode}
                  onChange={(e) => setBreakConfig({ breakStrictMode: e.target.checked })}
                  className="rounded border-slate-300 text-emerald-600"
                />
                <ShieldAlert className="h-3 w-3 text-rose-500" />
                <span>强制模式（长按 3 秒才可跳过）</span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                triggerBreakNow();
              }}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal-600 py-1.5 text-[11px] font-medium text-white transition hover:bg-teal-700"
            >
              <Lock className="h-3 w-3" />
              <span>立即进入休息锁屏（预览）</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
