import { TIMING } from "@sm/shared";
import { useGameStore } from "../state/gameStore";
import { formatClock, viewerShip } from "../state/selectors";
import { useSmoothElapsed } from "./hooks";

type ClockPhase = "main" | "overtime" | "simulation" | "arrived" | "destroyed";

export function MissionClock() {
  const elapsed = useSmoothElapsed();
  const shipPhase = useGameStore((s) => viewerShip(s.snapshot)?.phase);
  let phase: ClockPhase;
  if (shipPhase === "destroyed") phase = "destroyed";
  else if (shipPhase === "lunar-task" || shipPhase === "task-complete") phase = "arrived";
  else if (shipPhase === "simulation" || elapsed >= TIMING.simulationStartMs) phase = "simulation";
  else if (shipPhase === "overtime" || elapsed >= TIMING.mainFlightMs) phase = "overtime";
  else phase = "main";

  let sub: string;
  let frac: number;
  if (phase === "main") {
    sub = `Main flight · overtime in ${formatClock(TIMING.mainFlightMs - elapsed)}`;
    frac = elapsed / TIMING.mainFlightMs;
  } else if (phase === "overtime") {
    sub = `½ cost · ½ effect · auto-sim in ${formatClock(Math.max(0, TIMING.simulationStartMs - elapsed))}`;
    frac = (elapsed - TIMING.mainFlightMs) / TIMING.overtimeMs;
  } else if (phase === "simulation") {
    sub = `Movement ×${TIMING.simulationTimeScale} · auto-boosters · no hazards`;
    frac = 1;
  } else if (phase === "arrived") {
    sub = "Lunar operations";
    frac = 1;
  } else {
    sub = "Signal lost";
    frac = 1;
  }

  const label = phase === "main" ? "MISSION CLOCK" : phase === "overtime" ? "OVERTIME" : phase === "simulation" ? "AUTO-SIMULATION" : phase === "arrived" ? "ON THE MOON" : "DESTROYED";

  return (
    <div className={`mission-clock clock-${phase}`} data-tour="clock">
      <div className="clock-label">{label}</div>
      <div className="clock-time">T+{formatClock(elapsed, true)}</div>
      <div className="clock-sub">{sub}</div>
      <div className="clock-bar">
        <div className="clock-bar-fill" style={{ width: `${Math.min(1, Math.max(0, frac)) * 100}%` }} />
      </div>
    </div>
  );
}
