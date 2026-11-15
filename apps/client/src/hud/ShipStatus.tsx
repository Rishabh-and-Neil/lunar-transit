import { ABILITIES, HAZARDS, type ActiveEffect } from "@sm/shared";
import { useGameStore } from "../state/gameStore";
import { viewerShip } from "../state/selectors";
import { useAnimatedNumber, useDecreaseFlash } from "./hooks";
import { Credits } from "./ui";

export function HealthBar() {
  const health = useGameStore((s) => viewerShip(s.snapshot)?.health ?? 0);
  const max = useGameStore((s) => viewerShip(s.snapshot)?.maxHealth ?? 100);
  const repairing = useGameStore((s) => !!viewerShip(s.snapshot)?.repair);
  const flash = useDecreaseFlash(health);
  const shown = useAnimatedNumber(health, 300);
  const pct = Math.max(0, Math.min(1, health / Math.max(1, max)));
  const tone = pct > 0.6 ? "good" : pct > 0.3 ? "warn" : "bad";
  return (
    <div className={`hud-health tone-${tone} ${repairing ? "repairing" : ""}`} data-tour="health">
      <div className="hud-row-head">
        <span className="hud-label">HULL INTEGRITY</span>
        <span className="hud-num">
          {Math.ceil(shown)}
          <small>/{max}</small>
        </span>
      </div>
      <div className="health-track">
        <div className="health-ghost" style={{ width: `${pct * 100}%` }} />
        <div className="health-fill" style={{ width: `${(shown / Math.max(1, max)) * 100}%` }} />
        {[0.25, 0.5, 0.75].map((t) => (
          <span key={t} className="health-tick" style={{ left: `${t * 100}%` }} />
        ))}
      </div>
      {flash > 0 && <div key={flash} className="health-flash" />}
    </div>
  );
}

export function BudgetDisplay() {
  const credits = useGameStore((s) => viewerShip(s.snapshot)?.credits ?? 0);
  const income = useGameStore((s) => viewerShip(s.snapshot)?.derived.creditIncomePerSec ?? 0);
  const shared = useGameStore((s) => s.snapshot?.mode === "coop");
  const shown = useAnimatedNumber(credits, 500);
  const spend = useDecreaseFlash(Math.round(credits));
  return (
    <div className="hud-budget" data-tour="credits">
      <span className="hud-label">{shared ? "SHARED CREDITS" : "CREDITS"}</span>
      <span key={spend} className={`hud-credits ${spend > 0 ? "spent" : ""}`}>
        <Credits value={shown} />
      </span>
      {income > 0 && <span className="hud-income">+{income}/s telemetry</span>}
    </div>
  );
}

function effectMeta(e: ActiveEffect): { icon: string; label: string; bad: boolean } {
  const src = e.sourceAbility ? ABILITIES[e.sourceAbility] : undefined;
  const hz = e.sourceHazard ? HAZARDS[e.sourceHazard] : undefined;
  switch (e.type) {
    case "speed-multiplier":
      return {
        icon: src?.icon ?? hz?.icon ?? (e.magnitude >= 0 ? "⏩" : "🐢"),
        label: `${e.magnitude >= 0 ? "+" : "−"}${Math.round(Math.abs(e.magnitude) * 100)}% speed`,
        bad: e.magnitude < 0,
      };
    case "damage-reduction":
      return { icon: src?.icon ?? "🔰", label: `−${Math.round(e.magnitude * 100)}% damage`, bad: false };
    case "slow-immunity":
      return { icon: src?.icon ?? "🧭", label: "Slow immune", bad: false };
    case "stunned":
      return { icon: src?.icon ?? "⚡", label: "STUNNED", bad: true };
    case "abilities-blocked":
      return { icon: src?.icon ?? "📵", label: "Abilities blocked", bad: true };
  }
}

export function EffectChips() {
  const effects = useGameStore((s) => viewerShip(s.snapshot)?.effects);
  if (!effects || effects.length === 0) return null;
  return (
    <div className="effect-chips">
      {effects
        .filter((e) => e.remainingMs > 0)
        .map((e) => {
          const m = effectMeta(e);
          const frac = e.remainingMs / Math.max(1, e.durationMs);
          return (
            <span key={e.id} className={`effect-chip ${m.bad ? "bad" : "good"}`} title={e.sourceAbility ? ABILITIES[e.sourceAbility].name : e.sourceHazard ? HAZARDS[e.sourceHazard].name : e.type}>
              <span>{m.icon}</span>
              <span>{m.label}</span>
              <span className="chip-time">{(e.remainingMs / 1000).toFixed(1)}s</span>
              <span className="chip-bar" style={{ transform: `scaleX(${frac})` }} />
            </span>
          );
        })}
    </div>
  );
}
