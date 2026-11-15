export const REPAIR = {
  drone: { cost: 150, mass: 10, powerDraw: 8 },
  upgrade: { cost: 120 }, // requires drone; purchasable in preparation or in flight
  base: { heal: 25, durationMs: 4000, cooldownMs: 20000 },
  upgraded: { heal: 40, durationMs: 3000, cooldownMs: 14000 },
  /** Cost of the n-th repair (0-based) = baseCost + n * costStep */
  baseCost: 40,
  costStep: 20,
} as const;

export function repairCost(repairsUsed: number): number {
  return REPAIR.baseCost + repairsUsed * REPAIR.costStep;
}
