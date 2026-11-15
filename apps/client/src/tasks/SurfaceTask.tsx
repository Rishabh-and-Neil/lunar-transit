import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { SurfaceAnalysisPublic, SurfaceRegion } from "@sm/shared";
import { clamp, cssVars, fmt, seededRandom } from "./taskTypes";
import type { TaskComponentProps } from "./taskTypes";

const TERRAIN_LABEL: Record<SurfaceRegion["terrain"], string> = {
  mare: "Mare plain",
  highland: "Highland",
  "crater-rim": "Crater rim",
  ejecta: "Ejecta blanket",
};

/** Procedural lunar-surface art for one region, deterministic per region id. */
function RegionArt({ region }: { region: SurfaceRegion }) {
  const rnd = seededRandom(region.id);
  const g = Math.round(clamp(region.albedo, 0, 1) * 150 + 45);
  const base = `rgb(${g}, ${g + 2}, ${g + 8})`;
  const dark = `rgb(${Math.round(g * 0.55)}, ${Math.round(g * 0.56)}, ${Math.round(g * 0.62)})`;
  const light = `rgb(${Math.min(255, g + 45)}, ${Math.min(255, g + 46)}, ${Math.min(255, g + 50)})`;
  // Titanium-rich basalts look slightly bluer in false-colour imagery; tint subtly for flavour.
  const tint = clamp(region.tiO2 / 12, 0, 1) * 0.28;
  const gid = `sg-${region.id}`;

  const features: ReactElement[] = [];
  const smallCraters = region.terrain === "mare" ? 3 : 6;
  for (let i = 0; i < smallCraters; i++) {
    const cx = 10 + rnd() * 80;
    const cy = 10 + rnd() * 80;
    const r = 2 + rnd() * (region.terrain === "highland" ? 7 : 4);
    features.push(
      <g key={`c${i}`}>
        <circle cx={cx} cy={cy} r={r} fill={dark} opacity={0.55} />
        <circle cx={cx - r * 0.25} cy={cy - r * 0.25} r={r * 0.75} fill="none" stroke={light} strokeWidth={0.8} opacity={0.5} />
      </g>,
    );
  }
  if (region.terrain === "crater-rim") {
    const cx = 30 + rnd() * 40;
    const cy = 30 + rnd() * 40;
    features.push(
      <g key="big">
        <circle cx={cx} cy={cy} r={30} fill={dark} opacity={0.6} />
        <circle cx={cx - 4} cy={cy - 4} r={27} fill="none" stroke={light} strokeWidth={3} opacity={0.75} />
        <circle cx={cx + 3} cy={cy + 3} r={12} fill={dark} opacity={0.5} />
      </g>,
    );
  } else if (region.terrain === "ejecta") {
    const ox = rnd() * 100;
    const oy = rnd() * 100;
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      features.push(
        <line
          key={`ray${i}`}
          x1={ox}
          y1={oy}
          x2={ox + Math.cos(a) * 90}
          y2={oy + Math.sin(a) * 90}
          stroke={light}
          strokeWidth={2 + rnd() * 3}
          strokeLinecap="round"
          opacity={0.35}
        />,
      );
    }
  } else if (region.terrain === "highland") {
    for (let i = 0; i < 4; i++) {
      const x = rnd() * 100;
      const y = rnd() * 100;
      features.push(
        <path key={`h${i}`} d={`M${x - 12} ${y + 6} L${x} ${y - 8} L${x + 12} ${y + 6}`} fill="none" stroke={light} strokeWidth={1.4} opacity={0.45} />,
      );
    }
  }

  return (
    <svg viewBox="0 0 100 100" className="task-surface-art" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <radialGradient id={gid} cx="35%" cy="30%" r="90%">
          <stop offset="0%" stopColor={light} />
          <stop offset="60%" stopColor={base} />
          <stop offset="100%" stopColor={dark} />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gid})`} />
      {features}
      <rect width="100" height="100" fill="#3a6dff" opacity={tint} style={{ mixBlendMode: "color" }} />
    </svg>
  );
}

function Meter(props: { label: string; value: number; max: number; threshold: number; unit: string }) {
  const { label, value, max, threshold, unit } = props;
  const pass = value >= threshold;
  return (
    <div className="task-meter">
      <div className="task-meter-head">
        <span className="task-meter-label">{label}</span>
        <span className={`task-meter-value ${pass ? "task-good" : ""}`}>
          {fmt(value)}
          {unit}
        </span>
      </div>
      <div className="task-meter-track">
        <div
          className={`task-meter-fill ${pass ? "task-meter-fill--pass" : ""}`}
          style={{ width: `${clamp((value / max) * 100, 0, 100)}%` }}
        />
        {threshold > 0 && (
          <div className="task-meter-threshold" style={{ left: `${clamp((threshold / max) * 100, 0, 100)}%` }}>
            <span>
              ≥{fmt(threshold, 0)}
              {unit}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function SurfaceTask({ task, onChange }: TaskComponentProps<SurfaceAnalysisPublic>) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  const ordered = useMemo(
    () => [...task.regions].sort((a, b) => a.row - b.row || a.col - b.col),
    [task.regions],
  );
  const byId = useMemo(() => new Map(task.regions.map((r) => [r.id, r])), [task.regions]);
  const feMax = Math.max(25, ...task.regions.map((r) => r.feO));
  const tiMax = Math.max(12, ...task.regions.map((r) => r.tiO2));

  useEffect(() => {
    onChange(selected.size > 0 ? { taskId: "surface-analysis", regionIds: [...selected].sort() } : null);
  }, [selected, onChange]);

  const toggle = (id: string) => {
    setLastClicked(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const shownId = focusId ?? lastClicked;
  const shown = shownId ? byId.get(shownId) : undefined;

  return (
    <div className="task-surface">
      <div className="task-surface-map-wrap">
        <div className="task-surface-map" style={cssVars({ "--cols": task.cols })} role="group" aria-label="Lunar surface regions">
          {ordered.map((r) => {
            const isSel = selected.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                className={`task-surface-cell${isSel ? " task-surface-cell--selected" : ""}${shownId === r.id ? " task-surface-cell--focus" : ""}`}
                style={{ gridRow: r.row + 1, gridColumn: r.col + 1 }}
                aria-pressed={isSel}
                aria-label={`Region ${String.fromCharCode(65 + r.row)}${r.col + 1}, ${TERRAIN_LABEL[r.terrain]}, FeO ${fmt(r.feO)}%, TiO2 ${fmt(r.tiO2)}%`}
                onClick={() => toggle(r.id)}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") setFocusId(r.id);
                }}
                onPointerLeave={() => setFocusId(null)}
                onFocus={() => setFocusId(r.id)}
                onBlur={() => setFocusId(null)}
              >
                <RegionArt region={r} />
                <span className="task-surface-coord">
                  {String.fromCharCode(65 + r.row)}
                  {r.col + 1}
                </span>
                {isSel && <span className="task-surface-check" aria-hidden="true">✔</span>}
                <span className="task-surface-scan" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <p className="task-caption">
          {selected.size} region{selected.size === 1 ? "" : "s"} selected · tap a region to toggle
        </p>
      </div>

      <aside className="task-panel task-spectro" aria-live="polite">
        <h4 className="task-panel-title">Spectrometer</h4>
        <p className="task-criterion">{task.criterion}</p>
        {shown ? (
          <div className="task-spectro-readout">
            <div className="task-spectro-id">
              <span className="task-spectro-coord">
                {String.fromCharCode(65 + shown.row)}
                {shown.col + 1}
              </span>
              <span className="task-muted">{TERRAIN_LABEL[shown.terrain]}</span>
            </div>
            <Meter label="FeO (iron oxide)" value={shown.feO} max={feMax} threshold={task.minFeO} unit="%" />
            <Meter label="TiO₂ (titanium dioxide)" value={shown.tiO2} max={tiMax} threshold={task.minTiO2} unit="%" />
            <div className="task-meter-head">
              <span className="task-meter-label">Albedo</span>
              <span className="task-meter-value">{fmt(shown.albedo, 2)}</span>
            </div>
          </div>
        ) : (
          <p className="task-muted task-spectro-empty">Hover or tap a region to read its spectrum.</p>
        )}
      </aside>
    </div>
  );
}
