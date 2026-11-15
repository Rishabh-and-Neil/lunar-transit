// Credits: ability pricing (overtime discount), flight income.
import { ABILITIES } from "../config/abilities";
import { TIMING } from "../config/timing";
import type { AbilityId, MatchState, SpacecraftState } from "../types";
import { calculateStats } from "./equipment";
import { findShip, isOvertime } from "./state";

/** Ability price for a ship right now (overtime halves it, rounded up to whole credits). */
export function abilityCostForShip(ship: SpacecraftState, abilityId: AbilityId): number {
  const base = ABILITIES[abilityId].cost;
  return isOvertime(ship) ? Math.ceil(base * TIMING.overtimeCostMultiplier) : base;
}

export function abilityCost(state: MatchState, shipId: string, abilityId: AbilityId): number {
  const def = ABILITIES[abilityId];
  if (!def) return Number.POSITIVE_INFINITY;
  const ship = findShip(state, shipId);
  if (!ship) return def.cost;
  return abilityCostForShip(ship, abilityId);
}

export function canAfford(ship: SpacecraftState, cost: number): boolean {
  return ship.credits + 1e-9 >= cost;
}

/** Passive credit income during flight (e.g. Deep Space Transponder). */
export function applyIncome(ship: SpacecraftState, deltaMs: number): void {
  const rate = calculateStats(ship).creditIncomePerSec;
  if (rate <= 0) return;
  const earned = (rate * deltaMs) / 1000;
  ship.credits += earned;
  ship.stats.creditsEarned += earned;
}
