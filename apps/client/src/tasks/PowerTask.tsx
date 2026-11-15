import { useEffect, useMemo, useState } from "react";
import type { PowerCalibrationPublic, PowerSubsystem } from "@sm/shared";
import { clamp } from "./taskTypes";
import type { TaskComponentProps } from "./taskTypes";

type RowStatus = "off" | "under" | "ok" | "over" | "critical-low";

function rowStatus(s: PowerSubsystem, w: number): RowStatus {
  if (w > s.maxWatts) return "over";
  if (w === 0) return "off";
  if (w < s.minWatts) return "under";
  if (s.critical && w < s.maxWatts) return "critical-low";
  return "ok";
}

const STATUS_TEXT: Record<RowStatus, string> = {
  off: "Offline",
  under: "Underpowered",
  ok: "Nominal",
  over: "Over max — power wasted",
  "critical-low": "Critical: needs full power",
};

function Gauge(props: { used: number; available: number }) {
  const { used, available } = props;
  const frac = available > 0 ? used / available : 0;
  const over = used > available;
  // 240° arc gauge
  const start = 150;
  const sweep = 240;
  const R = 80;
  const C = 100;
  const pt = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: C + R * Math.cos(a), y: C + R * Math.sin(a) };
  };
  const arc = (from: number, to: number) => {
    const p1 = pt(from);
    const p2 = pt(to);
    const large = to - from > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${R} ${R} 0 ${large} 1 ${p2.x} ${p2.y}`;
  };
  const shown = clamp(frac, 0, 1.12);
  const needleDeg = start + sweep * Math.min(shown, 1.12) / 1.12;
  const fullDeg = start + sweep / 1.12;
  const needle = pt(needleDeg);
  return (
    <div className={`task-gauge${over ? " task-gauge--over" : ""}`}>
      <svg viewBox="0 0 200 170" aria-hidden="true">
        <path d={arc(start, start + sweep)} className="task-gauge-track" />
        <path d={arc(fullDeg, start + sweep)} className="task-gauge-danger" />
        {used > 0 && <path d={arc(start, Math.max(start + 0.5, needleDeg))} className="task-gauge-fill" />}
        <line x1={C} y1={C} x2={needle.x} y2={needle.y} className="task-gauge-needle" />
        <circle cx={C} cy={C} r={6} className="task-gauge-hub" />
      </svg>
      <div className="task-gauge-readout">
        <span className="task-gauge-used">{used}</span>
        <span className="task-gauge-avail">/ {available} W</span>
        <span className="task-gauge-label">{over ? "OVER BUDGET" : `${available - used} W spare`}</span>
      </div>
    </div>
  );
}

export function PowerTask({ task, onChange }: TaskComponentProps<PowerCalibrationPublic>) {
  const step = task.step > 0 ? task.step : 1;
  const [alloc, setAlloc] = useState<Record<string, number>>(() =>
    Object.fromEntries(task.subsystems.map((s) => [s.id, 0])),
  );

  const used = useMemo(() => Object.values(alloc).reduce((a, b) => a + b, 0), [alloc]);

  useEffect(() => {
    onChange(used > 0 ? { taskId: "power-calibration", allocation: { ...alloc } } : null);
  }, [alloc, used, onChange]);

  const set = (id: string, w: number, sliderMax: number) => {
    const snapped = Math.round(clamp(w, 0, sliderMax) / step) * step;
    setAlloc((prev) => ({ ...prev, [id]: snapped }));
  };

  const okCount = task.subsystems.filter((s) => rowStatus(s, alloc[s.id] ?? 0) === "ok").length;

  return (
    <div className="task-power">
      <div className="task-panel task-power-gauge-panel">
        <h4 className="task-panel-title">Power Budget</h4>
        <Gauge used={used} available={task.availableWatts} />
        <p className="task-muted task-power-summary">
          {okCount}/{task.subsystems.length} subsystems nominal
        </p>
        <button
          type="button"
          className="task-chip"
          onClick={() => setAlloc(Object.fromEntries(task.subsystems.map((s) => [s.id, 0])))}
        >
          Reset all
        </button>
      </div>

      <div className="task-power-rows">
        {task.subsystems.map((s) => {
          const w = alloc[s.id] ?? 0;
          const sliderMax = Math.ceil((s.maxWatts * 1.25) / step) * step;
          const st = rowStatus(s, w);
          const pct = (v: number) => `${clamp((v / sliderMax) * 100, 0, 100)}%`;
          return (
            <div key={s.id} className={`task-power-row task-power-row--${st}`}>
              <div className="task-power-row-head">
                <span className="task-power-name">
                  {s.name}
                  {s.critical && <span className="task-badge task-badge--critical">Critical</span>}
                </span>
                <span className="task-power-watts task-mono">{w} W</span>
              </div>
              <div className="task-power-control">
                <button
                  type="button"
                  className="task-nudge"
                  onClick={() => set(s.id, w - step, sliderMax)}
                  aria-label={`Decrease ${s.name} power`}
                >
                  −
                </button>
                <div className="task-power-slider">
                  <div className="task-power-band" style={{ left: pct(s.minWatts), width: `calc(${pct(s.maxWatts)} - ${pct(s.minWatts)})` }} />
                  <div className="task-power-marker" style={{ left: pct(s.minWatts) }} title={`Minimum ${s.minWatts} W`}>
                    <span>min {s.minWatts}</span>
                  </div>
                  <div className="task-power-marker task-power-marker--max" style={{ left: pct(s.maxWatts) }} title={`Maximum ${s.maxWatts} W`}>
                    <span>max {s.maxWatts}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={sliderMax}
                    step={step}
                    value={w}
                    onChange={(e) => set(s.id, Number(e.target.value), sliderMax)}
                    aria-label={`${s.name} power in watts, minimum ${s.minWatts}, maximum ${s.maxWatts}`}
                  />
                </div>
                <button
                  type="button"
                  className="task-nudge"
                  onClick={() => set(s.id, w + step, sliderMax)}
                  aria-label={`Increase ${s.name} power`}
                >
                  +
                </button>
              </div>
              <span className="task-power-status">{STATUS_TEXT[st]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
