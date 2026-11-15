import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CommunicationsPublic } from "@sm/shared";
import { clamp, fmt } from "./taskTypes";
import type { TaskComponentProps } from "./taskTypes";

const DEG = Math.PI / 180;
const DOME_R = 140; // px in SVG units
const CX = 160;
const CY = 160;

function normAz(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** Great-circle angle between two sky directions, degrees. */
function angularDistance(az1: number, el1: number, az2: number, el2: number): number {
  const c =
    Math.sin(el1 * DEG) * Math.sin(el2 * DEG) +
    Math.cos(el1 * DEG) * Math.cos(el2 * DEG) * Math.cos((az1 - az2) * DEG);
  return Math.acos(clamp(c, -1, 1)) / DEG;
}

/** Sky-dome projection: zenith at centre, horizon at the rim, north up, east right (map view). */
function project(az: number, el: number): { x: number; y: number } {
  const r = ((90 - el) / 90) * DOME_R;
  return { x: CX + Math.sin(az * DEG) * r, y: CY - Math.cos(az * DEG) * r };
}

function unproject(x: number, y: number): { az: number; el: number } {
  const dx = x - CX;
  const dy = CY - y;
  const r = Math.min(DOME_R, Math.hypot(dx, dy));
  const az = normAz(Math.atan2(dx, dy) / DEG);
  return { az, el: 90 - (r / DOME_R) * 90 };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function compass(az: number): string {
  return COMPASS[Math.round(normAz(az) / 45) % 8];
}

export function CommsTask({ task, onChange }: TaskComponentProps<CommunicationsPublic>) {
  const [az, setAz] = useState(() => normAz(task.startAzimuth));
  const [el, setEl] = useState(() => clamp(task.startElevation, 0, 90));
  const [dragging, setDragging] = useState(false);
  const [jitter, setJitter] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    onChange({ taskId: "communications", azimuth: Math.round(az * 10) / 10, elevation: Math.round(el * 10) / 10 });
  }, [az, el, onChange]);

  // Subtle live noise on the meter so the link feels "alive" (cosmetic only).
  useEffect(() => {
    const t = window.setInterval(() => setJitter(Math.random() * 2 - 1), 160);
    return () => window.clearInterval(t);
  }, []);

  const dist = angularDistance(az, el, task.earthAzimuth, task.earthElevation);
  const sigma = Math.max(task.toleranceDeg * 3.5, 10);
  const strength = Math.exp(-((dist / sigma) ** 2));
  const shownStrength = clamp(strength * 100 + jitter * (2 + (1 - strength) * 4), 0, 100);
  const locked = dist <= task.toleranceDeg;

  const pointerToSky = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 320;
    const y = ((e.clientY - rect.top) / rect.height) * 320;
    const s = unproject(x, y);
    setAz(s.az);
    setEl(s.el);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 5 : 1;
    let handled = true;
    if (e.key === "ArrowLeft") setAz((a) => normAz(a - step));
    else if (e.key === "ArrowRight") setAz((a) => normAz(a + step));
    else if (e.key === "ArrowUp") setEl((v) => clamp(v + step, 0, 90));
    else if (e.key === "ArrowDown") setEl((v) => clamp(v - step, 0, 90));
    else handled = false;
    if (handled) e.preventDefault();
  };

  const beam = project(az, el);
  const earth = project(task.earthAzimuth, task.earthElevation);
  const tolR = (task.toleranceDeg / 90) * DOME_R;
  const bars = 10;
  const litBars = Math.round((shownStrength / 100) * bars);

  return (
    <div className="task-comms">
      <div className="task-comms-dome-wrap">
        <svg
          ref={svgRef}
          viewBox="0 0 320 320"
          className={`task-comms-dome${dragging ? " task-comms-dome--drag" : ""}`}
          role="application"
          aria-label={`Sky dome. Antenna azimuth ${fmt(az)} degrees, elevation ${fmt(el)} degrees. Use arrow keys to steer; hold Shift for larger steps.`}
          tabIndex={0}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            pointerToSky(e);
          }}
          onPointerMove={(e) => {
            if (dragging) pointerToSky(e);
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setDragging(false);
          }}
          onPointerCancel={() => setDragging(false)}
        >
          <defs>
            <radialGradient id="task-sky" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0b1430" />
              <stop offset="85%" stopColor="#070b1c" />
              <stop offset="100%" stopColor="#1b2440" />
            </radialGradient>
            <radialGradient id="task-beam" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={locked ? "#3ddc97" : "#4fc3ff"} stopOpacity="0.55" />
              <stop offset="100%" stopColor={locked ? "#3ddc97" : "#4fc3ff"} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={CX} cy={CY} r={DOME_R + 6} fill="#2a2f3d" />
          <circle cx={CX} cy={CY} r={DOME_R} fill="url(#task-sky)" />
          {[30, 60].map((e) => (
            <circle key={e} cx={CX} cy={CY} r={((90 - e) / 90) * DOME_R} className="task-comms-grid" />
          ))}
          {[0, 45, 90, 135].map((a) => {
            const p1 = project(a, 0);
            const p2 = project(a + 180, 0);
            return <line key={a} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="task-comms-grid" />;
          })}
          {["N", "E", "S", "W"].map((l, i) => {
            const p = project(i * 90, -9);
            return (
              <text key={l} x={p.x} y={p.y + 4} className="task-comms-compass">
                {l}
              </text>
            );
          })}
          <text x={CX + 4} y={CY - ((90 - 30) / 90) * DOME_R - 3} className="task-comms-elev">30°</text>
          <text x={CX + 4} y={CY - ((90 - 60) / 90) * DOME_R - 3} className="task-comms-elev">60°</text>

          {/* Beam footprint and line from the antenna at the zenith-centred mount */}
          <line x1={CX} y1={CY} x2={beam.x} y2={beam.y} className="task-comms-beamline" />
          <circle cx={beam.x} cy={beam.y} r={Math.max(tolR * 2.4, 16)} fill="url(#task-beam)" className="task-comms-pulse" />
          <circle cx={beam.x} cy={beam.y} r={Math.max(tolR, 4)} className={`task-comms-reticle${locked ? " task-comms-reticle--lock" : ""}`} />
          <line x1={beam.x - 8} y1={beam.y} x2={beam.x + 8} y2={beam.y} className="task-comms-cross" />
          <line x1={beam.x} y1={beam.y - 8} x2={beam.x} y2={beam.y + 8} className="task-comms-cross" />

          {/* Earth */}
          <g transform={`translate(${earth.x} ${earth.y})`} className="task-comms-earth">
            <circle r={11} fill="#1d5fd1" />
            <path d="M-6 -5 q4 -3 7 0 q2 3 -2 5 q-3 1 -5 -2z M2 3 q4 -1 5 3 q-3 3 -6 1z" fill="#3ddc97" opacity={0.9} />
            <circle r={11} fill="none" stroke="#9fd4ff" strokeWidth={1.5} opacity={0.7} />
            <circle r={15} fill="none" stroke="#9fd4ff" strokeWidth={1} opacity={0.25} />
          </g>
          <circle cx={CX} cy={CY} r={5} fill="#c9d4ea" />
        </svg>
        <p className="task-caption">Drag on the sky dome · arrow keys nudge (Shift = 5°)</p>
      </div>

      <div className="task-panel task-comms-panel">
        <h4 className="task-panel-title">{task.siteName}</h4>
        <p className="task-muted task-comms-sub">High-gain antenna · tolerance ±{fmt(task.toleranceDeg)}°</p>

        <div className={`task-signal${locked ? " task-signal--lock" : ""}`} aria-live="polite">
          <div className="task-signal-bars" aria-hidden="true">
            {Array.from({ length: bars }, (_, i) => (
              <span key={i} className={i < litBars ? "task-signal-bar task-signal-bar--on" : "task-signal-bar"} style={{ height: `${30 + i * 7}%` }} />
            ))}
          </div>
          <div className="task-signal-text">
            <span className="task-signal-value">{Math.round(shownStrength)}%</span>
            <span className="task-signal-label">{locked ? "Carrier lock" : strength > 0.3 ? "Acquiring…" : "No signal"}</span>
          </div>
        </div>

        <label className="task-slider">
          <span className="task-slider-head">
            <span>Azimuth</span>
            <span className="task-mono">
              {fmt(az)}° {compass(az)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={359.5}
            step={0.5}
            value={az}
            onChange={(e) => setAz(Number(e.target.value))}
            aria-label="Antenna azimuth in degrees"
          />
        </label>
        <label className="task-slider">
          <span className="task-slider-head">
            <span>Elevation</span>
            <span className="task-mono">{fmt(el)}°</span>
          </span>
          <input
            type="range"
            min={0}
            max={90}
            step={0.5}
            value={el}
            onChange={(e) => setEl(Number(e.target.value))}
            aria-label="Antenna elevation in degrees"
          />
        </label>
        <div className="task-nudge-row">
          <button type="button" className="task-nudge" onClick={() => setAz((a) => normAz(a - 1))} aria-label="Rotate left 1 degree">◀</button>
          <button type="button" className="task-nudge" onClick={() => setEl((v) => clamp(v + 1, 0, 90))} aria-label="Tilt up 1 degree">▲</button>
          <button type="button" className="task-nudge" onClick={() => setEl((v) => clamp(v - 1, 0, 90))} aria-label="Tilt down 1 degree">▼</button>
          <button type="button" className="task-nudge" onClick={() => setAz((a) => normAz(a + 1))} aria-label="Rotate right 1 degree">▶</button>
        </div>
        <p className="task-muted task-comms-off">
          Pointing error: <span className="task-mono">{fmt(dist)}°</span>
        </p>
      </div>
    </div>
  );
}
