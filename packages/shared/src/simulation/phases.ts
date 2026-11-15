// Per-ship flight phase transitions.
import { ROUTE_DISTANCE } from "../config/spacecraft";
import { TIMING } from "../config/timing";
import type { FlightPhase, MatchState, SpacecraftState } from "../types";
import { isFlying, pushEvent } from "./state";

/** Phase a still-flying ship should be in at a given match time. */
export function flightPhaseForTime(elapsedMs: number): Extract<FlightPhase, "main-flight" | "overtime" | "simulation"> {
  if (elapsedMs >= TIMING.simulationStartMs) return "simulation";
  if (elapsedMs >= TIMING.mainFlightMs) return "overtime";
  return "main-flight";
}

function setPhase(state: MatchState, ship: SpacecraftState, phase: FlightPhase): void {
  if (ship.phase === phase) return;
  ship.phase = phase;
  pushEvent(state, { kind: "phase", shipId: ship.id, phase });
}

/** Time-based transitions (main-flight → overtime → simulation) for flying ships. */
export function updateTimePhase(state: MatchState, ship: SpacecraftState): void {
  if (!isFlying(ship)) return;
  setPhase(state, ship, flightPhaseForTime(state.elapsedMs));
}

/** Accumulate time-in-phase statistics. */
export function trackPhaseTime(ship: SpacecraftState, deltaMs: number): void {
  if (ship.phase === "overtime") ship.stats.timeInOvertimeMs += deltaMs;
  else if (ship.phase === "simulation") ship.stats.timeInSimulationMs += deltaMs;
}

/** Destruction (health ≤ 0) and arrival (progress ≥ route) checks. */
export function checkShipOutcome(state: MatchState, ship: SpacecraftState): void {
  if (!isFlying(ship)) return;
  if (ship.health <= 0) {
    ship.health = 0;
    ship.velocity = 0;
    ship.destroyedAtMs = state.elapsedMs;
    ship.repair = null;
    ship.effects = [];
    setPhase(state, ship, "destroyed");
    return;
  }
  if (ship.progress >= ROUTE_DISTANCE) {
    ship.progress = ROUTE_DISTANCE;
    ship.velocity = 0;
    ship.arrivedAtMs = state.elapsedMs;
    ship.effects = [];
    ship.repair = null;
    for (const t of state.tasks) {
      if (ship.ownerIds.includes(t.playerId) && t.startedAtMs === undefined) t.startedAtMs = state.elapsedMs;
    }
    setPhase(state, ship, "lunar-task");
  }
}

/** lunar-task → task-complete once every owner's task is done. */
export function checkTaskPhase(state: MatchState, ship: SpacecraftState): void {
  if (ship.phase !== "lunar-task") return;
  const tasks = state.tasks.filter((t) => ship.ownerIds.includes(t.playerId));
  if (tasks.length > 0 && tasks.every((t) => t.completedAtMs !== undefined)) {
    setPhase(state, ship, "task-complete");
  }
}
