// Ship statistics bookkeeping.
import type { AbilityId, ShipStatistics, SpacecraftState } from "../types";

export function emptyStats(): ShipStatistics {
  return {
    creditsSpentEquipment: 0,
    creditsSpentAbilities: 0,
    creditsSpentRepairs: 0,
    creditsEarned: 0,
    damageTaken: 0,
    damagePrevented: 0,
    healthRepaired: 0,
    hazardsEncountered: 0,
    abilitiesUsed: {},
    deterrentsReceived: 0,
    peakVelocity: 0,
    timeInOvertimeMs: 0,
    timeInSimulationMs: 0,
    autoSimPurchases: 0,
  };
}

export function recordAbilityUse(ship: SpacecraftState, abilityId: AbilityId, cost: number): void {
  ship.stats.abilitiesUsed[abilityId] = (ship.stats.abilitiesUsed[abilityId] ?? 0) + 1;
  ship.stats.creditsSpentAbilities += cost;
}

export function recordDamage(ship: SpacecraftState, dealt: number, prevented: number): void {
  ship.stats.damageTaken += dealt;
  ship.stats.damagePrevented += prevented;
}

export function recordHeal(ship: SpacecraftState, healed: number): void {
  ship.stats.healthRepaired += healed;
}

export function recordVelocity(ship: SpacecraftState, velocity: number): void {
  if (velocity > ship.stats.peakVelocity) ship.stats.peakVelocity = velocity;
}

export function totalCreditsSpent(stats: ShipStatistics): number {
  return stats.creditsSpentEquipment + stats.creditsSpentAbilities + stats.creditsSpentRepairs;
}

export function totalAbilitiesUsed(stats: ShipStatistics): number {
  return Object.values(stats.abilitiesUsed).reduce<number>((s, n) => s + (n ?? 0), 0);
}
