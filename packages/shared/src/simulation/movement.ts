// Ship movement along the Earth→Moon route.
import { ROUTE_DISTANCE, SPACECRAFT } from "../config/spacecraft";
import { TIMING } from "../config/timing";
import type { SpacecraftState } from "../types";
import { calculateStats } from "./equipment";
import { hasEffect } from "./state";
import { recordVelocity } from "./statistics";

/** Bounds for the summed temporary speed factor (1 + Σ multipliers). */
export const SPEED_FACTOR_BOUNDS = { min: 0.1, max: 3 } as const;

/** 1 + Σ speed multipliers, with negatives reduced by slow resistance / ignored when slow-immune. */
export function speedFactor(ship: SpacecraftState): number {
  const immune = hasEffect(ship, "slow-immunity");
  const resistance = calculateStats(ship).slowResistance;
  let sum = 0;
  for (const e of ship.effects) {
    if (e.type !== "speed-multiplier" || e.remainingMs <= 0) continue;
    if (e.magnitude >= 0) sum += e.magnitude;
    else if (!immune) sum += e.magnitude * (1 - resistance);
  }
  return Math.min(SPEED_FACTOR_BOUNDS.max, Math.max(SPEED_FACTOR_BOUNDS.min, 1 + sum));
}

/** Current velocity in route units per (real) second, including the simulation time scale. */
export function computeVelocity(ship: SpacecraftState): number {
  if (hasEffect(ship, "stunned") && !hasEffect(ship, "slow-immunity")) return 0;
  const base = calculateStats(ship).baseSpeed;
  const speed = Math.min(SPACECRAFT.maxSpeed, Math.max(SPACECRAFT.minSpeed, base * speedFactor(ship)));
  return ship.phase === "simulation" ? speed * TIMING.simulationTimeScale : speed;
}

/** Advance the ship along the route; returns true if it reached the Moon. */
export function moveShip(ship: SpacecraftState, deltaMs: number): boolean {
  const v = computeVelocity(ship);
  ship.velocity = v;
  recordVelocity(ship, v);
  ship.progress = Math.min(ROUTE_DISTANCE, ship.progress + (v * deltaMs) / 1000);
  return ship.progress >= ROUTE_DISTANCE;
}

/** Seconds a ship with given base speed needs for the full route with no modifiers. */
export function estimateTravelSeconds(baseSpeed: number): number {
  return ROUTE_DISTANCE / Math.max(SPACECRAFT.minSpeed, baseSpeed);
}
