import { useEffect, useMemo, useState } from "react";
import type { OrbitCalibrationPublic } from "@sm/shared";
import { clamp, fmt } from "./taskTypes";
import type { TaskComponentProps } from "./taskTypes";

/** Visual radius of the Moon in SVG units. Altitudes are exaggerated so low lunar orbits stay readable. */
const MOON_VIS = 24;
const MAX_ALT_VIS = 68;

/** Choose a "nice" slider step that can actually hit the tolerance window. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10];
  let best = candidates[0];
  for (const c of candidates) if (c <= raw) best = c;
  return best;
}

interface Orbit {
  periKm: number;
  apoKm: number;
}

/** SVG ellipse for an orbit with the Moon's centre (focus) at (0,0); periapsis on +x. */
function OrbitPath(props: { orbit: Orbit; toPx: (km: number) => number; className: string }) {
  const rp = props.toPx(props.orbit.periKm);
  const ra = props.toPx(props.orbit.apoKm);
  const lo = Math.min(rp, ra);
  const hi = Math.max(rp, ra);
  const a = (lo + hi) / 2;
  const b = Math.sqrt(lo * hi);
  const c = a - lo;
  return <ellipse cx={-c} cy={0} rx={a} ry={b} className={props.className} />;
}

function Readout(props: { label: string; predicted: number; current: number; target: number; tol: number }) {
  const { label, predicted, current, target, tol } = props;
  const err = predicted - target;
  const ok = Math.abs(err) <= tol;
  const closeness = clamp(1 - Math.abs(err) / Math.max(tol * 8, 1), 0, 1);
  return (
    <div className={`task-orbit-readout${ok ? " task-orbit-readout--ok" : ""}`}>
      <div className="task-orbit-readout-head">
        <span>{label}</span>
        <span className={ok ? "task-good" : "task-muted"}>{ok ? "✔ within tolerance" : `${err > 0 ? "+" : ""}${fmt(err, 0)} km`}</span>
      </div>
      <div className="task-orbit-nums">
        <div>
          <span className="task-orbit-num-label">Now</span>
          <span className="task-mono">{fmt(current, 0)} km</span>
        </div>
        <div>
          <span className="task-orbit-num-label">Predicted</span>
          <span className="task-mono task-orbit-pred">{fmt(predicted, 0)} km</span>
        </div>
        <div>
          <span className="task-orbit-num-label">Target</span>
          <span className="task-mono">
            {fmt(target, 0)} ±{fmt(tol, 0)}
          </span>
        </div>
      </div>
      <div className="task-orbit-closeness" aria-hidden="true">
        <div style={{ width: `${closeness * 100}%` }} />
      </div>
    </div>
  );
}

function BurnSlider(props: {
  label: string;
  sub: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const { label, sub, value, min, max, step, onChange } = props;
  const zeroPct = clamp(((0 - min) / (max - min)) * 100, 0, 100);
  const set = (v: number) => onChange(clamp(Math.round(v / step) * step, min, max));
  return (
    <div className="task-burn">
      <div className="task-slider-head">
        <span>
          {label} <span className="task-muted">· {sub}</span>
        </span>
        <span className={`task-mono ${value < 0 ? "task-warn" : value > 0 ? "task-accent" : ""}`}>
          {value > 0 ? "+" : ""}
          {fmt(value, step < 1 ? 1 : 0)} m/s
        </span>
      </div>
      <div className="task-burn-control">
        <button type="button" className="task-nudge" onClick={() => set(value - step)} aria-label={`${label}: decrease`}>
          −
        </button>
        <div className="task-burn-track">
          <div className="task-burn-zero" style={{ left: `${zeroPct}%` }} />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => set(Number(e.target.value))}
            aria-label={`${label} delta-v in metres per second`}
          />
        </div>
        <button type="button" className="task-nudge" onClick={() => set(value + step)} aria-label={`${label}: increase`}>
          +
        </button>
        <input
          type="number"
          className="task-number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) set(v);
          }}
          aria-label={`${label} delta-v exact value`}
        />
      </div>
      <div className="task-burn-scale task-muted">
        <span>{min} retrograde</span>
        <span>prograde {max}</span>
      </div>
    </div>
  );
}

export function OrbitTask({ task, onChange }: TaskComponentProps<OrbitCalibrationPublic>) {
  const step = useMemo(() => niceStep(task.toleranceKm / Math.max(task.kmPerMps, 1e-6) / 2), [task.toleranceKm, task.kmPerMps]);
  const [dvP, setDvP] = useState(0);
  const [dvA, setDvA] = useState(0);

  useEffect(() => {
    onChange(dvP === 0 && dvA === 0 ? null : { taskId: "orbit-calibration", dvAtPeriapsis: dvP, dvAtApoapsis: dvA });
  }, [dvP, dvA, onChange]);

  const current: Orbit = { periKm: task.currentPeriapsisKm, apoKm: task.currentApoapsisKm };
  const target: Orbit = { periKm: task.targetPeriapsisKm, apoKm: task.targetApoapsisKm };
  // Game model: periapsis burn shifts apoapsis; apoapsis burn shifts periapsis (linear, simplified).
  const predicted: Orbit = {
    periKm: task.currentPeriapsisKm + dvA * task.kmPerMps,
    apoKm: task.currentApoapsisKm + dvP * task.kmPerMps,
  };
  const impact = Math.min(predicted.periKm, predicted.apoKm) <= 0;

  // Fit everything into the viewBox (altitude axis exaggerated, not to scale).
  const VB = 200;
  const maxAlt = Math.max(current.apoKm, target.apoKm, current.periKm, target.periKm, 1) * 1.3;
  const altScale = MAX_ALT_VIS / maxAlt;
  const moonR = MOON_VIS;
  const toPx = (km: number) => MOON_VIS + clamp(km, 0, maxAlt) * altScale;
  // The focus (Moon) sits at (0,0); shift the drawing so the widest orbit is centred.
  const offsetX = (toPx(Math.max(current.apoKm, target.apoKm)) - toPx(Math.min(current.periKm, target.periKm))) / 2;

  const periArrow = Math.sign(dvP) * Math.min(Math.abs(dvP) / Math.max(Math.abs(task.dvMax), Math.abs(task.dvMin), 1), 1) * 22;
  const apoArrow = Math.sign(dvA) * Math.min(Math.abs(dvA) / Math.max(Math.abs(task.dvMax), Math.abs(task.dvMin), 1), 1) * 22;
  const pPx = toPx(current.periKm);
  const aPx = toPx(current.apoKm);

  return (
    <div className="task-orbit">
      <div className="task-orbit-view">
        <svg viewBox={`${-VB / 2} ${-VB / 2} ${VB} ${VB}`} aria-label="Orbit diagram: current, target and predicted orbits around the Moon" role="img">
          <defs>
            <radialGradient id="task-moon" cx="38%" cy="35%" r="70%">
              <stop offset="0%" stopColor="#e9e6df" />
              <stop offset="70%" stopColor="#9d9a93" />
              <stop offset="100%" stopColor="#5b5953" />
            </radialGradient>
            <marker id="task-arrow-pro" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10z" fill="#4fc3ff" />
            </marker>
            <marker id="task-arrow-retro" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10z" fill="#ffc24b" />
            </marker>
          </defs>
          <g transform={`translate(${offsetX} 0)`}>
            <OrbitPath orbit={target} toPx={toPx} className="task-orbit-target" />
            <OrbitPath orbit={current} toPx={toPx} className="task-orbit-current" />
            {!impact && <OrbitPath orbit={predicted} toPx={toPx} className="task-orbit-predicted" />}
            <circle r={moonR} fill="url(#task-moon)" />
            <circle cx={-moonR * 0.3} cy={moonR * 0.2} r={moonR * 0.18} fill="#7b7871" opacity={0.6} />
            <circle cx={moonR * 0.35} cy={-moonR * 0.3} r={moonR * 0.12} fill="#7b7871" opacity={0.6} />

            {/* Burn markers: periapsis on +x, apoapsis on -x; velocity is tangential (vertical here). */}
            <circle cx={pPx} cy={0} r={2.6} className="task-orbit-node" />
            <text x={pPx + 4} y={-4} className="task-orbit-label">Pe</text>
            {periArrow !== 0 && (
              <line
                x1={pPx}
                y1={0}
                x2={pPx}
                y2={-periArrow}
                stroke={periArrow > 0 ? "#4fc3ff" : "#ffc24b"}
                strokeWidth={1.6}
                markerEnd={`url(#${periArrow > 0 ? "task-arrow-pro" : "task-arrow-retro"})`}
              />
            )}
            <circle cx={-aPx} cy={0} r={2.6} className="task-orbit-node" />
            <text x={-aPx - 4} y={-4} className="task-orbit-label" textAnchor="end">Ap</text>
            {apoArrow !== 0 && (
              <line
                x1={-aPx}
                y1={0}
                x2={-aPx}
                y2={apoArrow}
                stroke={apoArrow > 0 ? "#4fc3ff" : "#ffc24b"}
                strokeWidth={1.6}
                markerEnd={`url(#${apoArrow > 0 ? "task-arrow-pro" : "task-arrow-retro"})`}
              />
            )}
          </g>
        </svg>
        <div className="task-orbit-legend">
          <span><i className="task-legend-swatch task-legend-current" /> Current</span>
          <span><i className="task-legend-swatch task-legend-target" /> Target</span>
          <span><i className="task-legend-swatch task-legend-pred" /> Predicted</span>
        </div>
        <p className="task-caption">Altitudes exaggerated for readability</p>
        {impact && <p className="task-orbit-impact">⚠ Predicted orbit intersects the lunar surface!</p>}
      </div>

      <div className="task-panel task-orbit-panel">
        <BurnSlider
          label="Burn at periapsis"
          sub="changes apoapsis"
          value={dvP}
          min={task.dvMin}
          max={task.dvMax}
          step={step}
          onChange={setDvP}
        />
        <BurnSlider
          label="Burn at apoapsis"
          sub="changes periapsis"
          value={dvA}
          min={task.dvMin}
          max={task.dvMax}
          step={step}
          onChange={setDvA}
        />
        <Readout label="Periapsis altitude" predicted={predicted.periKm} current={current.periKm} target={target.periKm} tol={task.toleranceKm} />
        <Readout label="Apoapsis altitude" predicted={predicted.apoKm} current={current.apoKm} target={target.apoKm} tol={task.toleranceKm} />
        <p className="task-muted task-orbit-note">
          Model: each m/s shifts the opposite side of the orbit by {fmt(task.kmPerMps, 2)} km (game simplification).
        </p>
      </div>
    </div>
  );
}
