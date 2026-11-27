import { useEffect, useRef, useState } from "react";
import { Check, Coffee, Pause, Play, Square, Timer } from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "../store/appStore";
import { type BreakReminderMins, useFocusStore } from "../store/runtimeStore";

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
  const startFocus = useFocusStore((s) => s.startFocus);
  const pauseFocus = useFocusStore((s) => s.pauseFocus);
  const resumeFocus = useFocusStore((s) => s.resumeFocus);
  const stopFocus = useFocusStore((s) => s.stopFocus);
  const tickFocus = useFocusStore((s) => s.tickFocus);
  const setBreakReminderMins = useFocusStore((s) => s.setBreakReminderMins);
  const incrementTodoPomodoro = useAppStore((s) => s.incrementTodoPomodoro);

  const [menuOpen, setMenuOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const lastBreakAtRef = useRef<number>(Date.now());

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

  // Lightweight 60s check for eye/stretch break reminder when enabled
  useEffect(() => {
    lastBreakAtRef.current = Date.now();
    if (!breakReminderMins) return;
    const interval = window.setInterval(() => {
      const elapsedMins = (Date.now() - lastBreakAtRef.current) / 60_000;
      if (elapsedMins >= breakReminderMins) {
        lastBreakAtRef.current = Date.now();
        toast.info(`👀 已连续工作 ${breakReminderMins} 分钟，起来喝口水、远眺 20 秒吧`, {
          duration: 10000,
          action: {
            label: "休息 5 分钟",
            onClick: () => {
              useFocusStore.getState().startFocus(null, "护眼休息", 5);
            },
          },
        });
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [breakReminderMins]);

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
        onClick={() => setMenuOpen((o) => !o)}
        title="开启专注番茄钟 / 设置久坐护眼提醒"
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          breakReminderMins > 0
            ? "border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100/70"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        }`}
      >
        <Timer className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden="true" />
        <span className="hidden @[1040px]:inline">专注</span>
        {breakReminderMins > 0 && (
          <span className="rounded bg-emerald-100 px-1 py-0 text-[10px] font-semibold text-emerald-700">
            {breakReminderMins}m
          </span>
        )}
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-40 mt-1.5 w-64 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
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
            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <Coffee className="h-3.5 w-3.5 text-emerald-600" />
              <span>久坐 / 护眼提醒</span>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              {([0, 45, 60] as BreakReminderMins[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setBreakReminderMins(m);
                    lastBreakAtRef.current = Date.now();
                    toast.success(
                      m === 0 ? "已关闭久坐护眼提醒" : `已开启每 ${m} 分钟护眼提醒`,
                    );
                  }}
                  className={`rounded-lg py-1 text-[11px] font-medium transition ${
                    breakReminderMins === m
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {m === 0 ? "关闭" : `每 ${m} 分`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
