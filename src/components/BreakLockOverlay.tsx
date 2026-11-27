import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Coffee, Eye, Lock, ShieldAlert, Unlock } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { api } from "../lib/api";
import { useFocusStore } from "../store/runtimeStore";

const HEALTH_TIPS = [
  "远眺 20 英尺（6 米）外景物至少 20 秒，让睫状肌彻底放松。",
  "起身活动颈肩与腰背，转动手腕和脚踝，喝一杯温水。",
  "闭目深呼吸 5 次，吸气 4 秒、呼气 6 秒，缓解用眼与久坐疲劳。",
  "检查坐姿是否端正，屏幕顶部略低于眼睛水平线约 10°。",
];

function playBreakChime(kind: "start" | "done") {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = kind === "start" ? [523.25, 659.25] : [659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = ctx.currentTime + idx * 0.14;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.06, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    });
  } catch {
    // Ignore blocked audio context
  }
}

export function BreakLockOverlay() {
  const {
    breakActive,
    breakSecondsLeft,
    breakTotalSeconds,
    breakStrictMode,
    breakLockEnabled,
    breakCompletedToday,
    breakReminderMins,
    tickBreak,
    finishBreak,
    snoozeBreak,
  } = useFocusStore(
    useShallow((s) => ({
      breakActive: s.breakActive,
      breakSecondsLeft: s.breakSecondsLeft,
      breakTotalSeconds: s.breakTotalSeconds,
      breakStrictMode: s.breakStrictMode,
      breakLockEnabled: s.breakLockEnabled,
      breakCompletedToday: s.breakCompletedToday,
      breakReminderMins: s.breakReminderMins,
      tickBreak: s.tickBreak,
      finishBreak: s.finishBreak,
      snoozeBreak: s.snoozeBreak,
    })),
  );

  const [clockStr, setClockStr] = useState(() =>
    new Date().toLocaleTimeString("zh-CN", { hour12: false }),
  );
  const [holdPct, setHoldPct] = useState(0);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<number>(0);

  const stopHoldUnlock = () => {
    if (holdTimerRef.current !== null) {
      window.clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldPct(0);
  };

  useEffect(() => {
    if (!breakActive) {
      return;
    }

    if (breakLockEnabled) {
      api.enterBreakLockWindow().catch(() => {});
    }
    playBreakChime("start");

    const tickId = window.setInterval(() => {
      setClockStr(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      const finished = tickBreak();
      if (finished) {
        playBreakChime("done");
      }
    }, 1000);

    return () => {
      window.clearInterval(tickId);
      stopHoldUnlock();
      api.exitBreakLockWindow().catch(() => {});
    };
  }, [breakActive, breakLockEnabled, tickBreak]);

  useEffect(() => {
    if (!breakActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (breakSecondsLeft > 0 && breakStrictMode) {
          e.preventDefault();
          e.stopPropagation();
        } else if (breakSecondsLeft <= 0) {
          finishBreak(true);
        } else {
          finishBreak(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [breakActive, breakSecondsLeft, breakStrictMode, finishBreak]);

  if (!breakActive) return null;

  const isFinished = breakSecondsLeft <= 0;
  const total = Math.max(1, breakTotalSeconds);
  const elapsed = Math.max(0, total - breakSecondsLeft);
  const progress = Math.min(1, elapsed / total);
  const mins = String(Math.floor(breakSecondsLeft / 60)).padStart(2, "0");
  const secs = String(breakSecondsLeft % 60).padStart(2, "0");
  const tip = HEALTH_TIPS[Math.floor(elapsed / 20) % HEALTH_TIPS.length];

  const radius = 104;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  const startHoldUnlock = () => {
    if (holdTimerRef.current !== null) return;
    holdStartRef.current = Date.now();
    setHoldPct(2);
    holdTimerRef.current = window.setInterval(() => {
      const elapsedMs = Date.now() - holdStartRef.current;
      const pct = Math.min(100, Math.round((elapsedMs / 3000) * 100));
      setHoldPct(pct);
      if (elapsedMs >= 3000) {
        stopHoldUnlock();
        finishBreak(false);
        toast.info("已紧急跳过本次休息，计时器已重置");
      }
    }, 40);
  };

  const handleLockOs = async () => {
    try {
      await api.lockWindowsWorkstation();
    } catch (err) {
      toast.error(`系统锁屏失败: ${String(err)}`);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="强制定时休息锁屏"
      className="fixed inset-0 z-[9999] flex flex-col justify-between bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 p-8 text-slate-100 select-none"
    >
      {/* 顶栏状态 */}
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-500/15 px-4 py-1.5 text-xs font-medium text-teal-200">
          <Eye className="h-4 w-4 text-teal-300" />
          <span>
            强制定时休息护眼锁屏（周期：每 {breakReminderMins || 45} 分钟）
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-300">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
            今日已完成休息 <strong className="text-emerald-300">{breakCompletedToday}</strong> 次
          </span>
          <span className="lw-nums font-mono text-sm font-semibold text-slate-200">
            {clockStr}
          </span>
        </div>
      </div>

      {/* 居中倒计时圆环 */}
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <div className="relative flex h-60 w-60 items-center justify-center">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 240 240">
            <circle
              cx="120"
              cy="120"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="10"
            />
            <circle
              cx="120"
              cy="120"
              r={radius}
              fill="none"
              stroke={isFinished ? "#34d399" : "#2dd4bf"}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset] duration-700 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isFinished ? (
              <>
                <CheckCircle2 className="mb-2 h-10 w-10 text-emerald-400" />
                <span className="text-lg font-semibold text-emerald-300">休息完成</span>
              </>
            ) : (
              <>
                <span className="text-xs tracking-widest text-teal-300/90 uppercase">
                  REST BREAK
                </span>
                <span className="lw-nums mt-1 font-mono text-5xl font-bold tracking-tight text-white">
                  {mins}:{secs}
                </span>
              </>
            )}
          </div>
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight text-white">
          {isFinished
            ? "本次护眼休息已结束，精神满满继续工作！"
            : "连续工作时间已到，请离开屏幕休息片刻"}
        </h1>
        <p className="mt-3 max-w-md rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm leading-relaxed text-slate-300">
          <Coffee className="mr-1.5 inline h-4 w-4 text-teal-300" />
          {tip}
        </p>
      </div>

      {/* 底部操作区 */}
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-center gap-3">
        {isFinished ? (
          <button
            type="button"
            onClick={() => finishBreak(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-8 py-3.5 text-sm font-semibold text-slate-950 shadow-lg transition hover:bg-emerald-400"
          >
            <Unlock className="h-4 w-4" />
            <span>结束休息，恢复工作（重新计时）</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleLockOs()}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-5 py-2.5 text-xs font-medium text-slate-100 transition hover:bg-white/20"
            >
              <Lock className="h-3.5 w-3.5 text-teal-300" />
              <span>锁定 Windows 电脑</span>
            </button>

            {breakStrictMode ? (
              <button
                type="button"
                onPointerDown={startHoldUnlock}
                onPointerUp={stopHoldUnlock}
                onPointerLeave={stopHoldUnlock}
                onPointerCancel={stopHoldUnlock}
                className="relative overflow-hidden rounded-2xl border border-rose-400/35 bg-rose-500/15 px-6 py-2.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/25"
                title="严格模式下需持续按住 3 秒才能紧急退出"
              >
                <span
                  className="absolute inset-y-0 left-0 bg-rose-500/45 transition-[width] duration-75"
                  style={{ width: `${holdPct}%` }}
                />
                <span className="relative inline-flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-rose-300" />
                  <span>
                    {holdPct > 0
                      ? `正在解锁 (${holdPct}%)…`
                      : "紧急有事？长按 3 秒解锁"}
                  </span>
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    snoozeBreak(5);
                    toast.info("已推迟 5 分钟后再次提醒休息");
                  }}
                  className="rounded-2xl border border-amber-400/35 bg-amber-500/15 px-5 py-2.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/25"
                >
                  推迟 5 分钟
                </button>
                <button
                  type="button"
                  onClick={() => finishBreak(false)}
                  className="rounded-2xl border border-white/15 bg-white/10 px-5 py-2.5 text-xs font-medium text-slate-200 transition hover:bg-white/20"
                >
                  提前结束休息
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
