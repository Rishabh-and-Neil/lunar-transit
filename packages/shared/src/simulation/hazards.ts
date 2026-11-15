// Hazard scheduling (seeded) and resolution, plus the shared damage formula.
import {
  COOP_PRESSURE, DIFFICULTY, FIRST_HAZARD_MIN_MS, HAZARDS, HAZARD_TYPES, HAZARDS_DURING_SIMULATION,
} from "../config/hazards";
import { ROUTE_DISTANCE, SPACECRAFT } from "../config/spacecraft";
import { TIMING } from "../config/timing";
import { createRng, hashSeed } from "../rng";
import type {
  DamageType, Difficulty, GameMode, HazardType, MatchState, ScheduledHazard, SpacecraftState,
} from "../types";
import { calculateStats } from "./equipment";
import { addEffect, hasEffect, pushEvent } from "./state";
import { recordDamage } from "./statistics";

export interface HazardSlot { type: HazardType; atMs: number }

/** Hazard interval range for a mode/difficulty. */
export function hazardIntervalMs(difficulty: Difficulty, mode: GameMode): [number, number] {
  const [a, b] = DIFFICULTY[difficulty].intervalMs;
  const m = mode === "coop" ? COOP_PRESSURE.intervalMultiplier : 1;
  return [a * m, b * m];
}

/** Deterministic hazard timeline (types + strike times), independent of any ship. */
export function generateHazardTimeline(seed: number, difficulty: Difficulty, mode: GameMode): HazardSlot[] {
  const rng = createRng(hashSeed(seed, "hazards", difficulty, mode));
  const [minI, maxI] = hazardIntervalMs(difficulty, mode);
  const slots: HazardSlot[] = [];
  let t = FIRST_HAZARD_MIN_MS + rng.range(0, minI / 2);
  const endMs = HAZARDS_DURING_SIMULATION ? Number.POSITIVE_INFINITY : TIMING.simulationStartMs;
  while (t < endMs) {
    const fraction = Math.min(1, (SPACECRAFT.referenceSpeed * t) / 1000 / ROUTE_DISTANCE);
    const candidates = HAZARD_TYPES.filter((h) => {
      const [lo, hi] = HAZARDS[h].progressWindow;
      return fraction >= lo && fraction <= hi;
    });
    const pool = candidates.length > 0 ? candidates : HAZARD_TYPES;
    const type = rng.weighted(pool, (h) => HAZARDS[h].weight);
    slots.push({ type, atMs: Math.round(t) });
    t += rng.range(minI, maxI);
  }
  return slots;
}

/** Concrete per-ship hazards from a timeline (warning window includes star-tracker bonus). */
export function hazardsForShip(timeline: HazardSlot[], ship: SpacecraftState): ScheduledHazard[] {
  const bonus = calculateStats(ship).hazardWarningBonusMs;
  return timeline.map((slot, i) => ({
    id: `hz-${ship.id}-${i}`,
    type: slot.type,
    shipId: ship.id,
    atMs: slot.atMs,
    warnMs: HAZARDS[slot.type].warnMs + bonus,
    resolved: false,
  }));
}

/** Damage scaling from difficulty & co-op pressure. */
export function hazardDamageMultiplier(difficulty: Difficulty, mode: GameMode): number {
  return DIFFICULTY[difficulty].damageMultiplier * (mode === "coop" ? COOP_PRESSURE.damageMultiplier : 1);
}

/** Strongest active Deflector Surge-style reduction. */
export function activeDamageReduction(ship: SpacecraftState): number {
  let best = 0;
  for (const e of ship.effects) {
    if (e.type === "damage-reduction" && e.remainingMs > 0) best = Math.max(best, e.magnitude);
  }
  return Math.min(0.9, best);
}

/** Apply raw damage of a type through shielding + active reduction. Mutates the ship. */
export function applyDamage(
  state: MatchState, ship: SpacecraftState, raw: number, damageType: DamageType,
): { dealt: number; prevented: number } {
  void state;
  if (raw <= 0 || damageType === "none") return { dealt: 0, prevented: 0 };
  const shield = calculateStats(ship).damageReduction[damageType];
  const dealt = raw * (1 - shield) * (1 - activeDamageReduction(ship));
  const prevented = raw - dealt;
  ship.health = Math.max(0, ship.health - dealt);
  recordDamage(ship, dealt, prevented);
  return { dealt, prevented };
}

/** Whether hazards affect a ship in this phase. */
export function hazardsActiveFor(ship: SpacecraftState): boolean {
  if (ship.phase === "main-flight" || ship.phase === "overtime") return true;
  return ship.phase === "simulation" && HAZARDS_DURING_SIMULATION;
}

/** Emit warnings for hazards entering their window and resolve those whose time has come. */
export function processHazards(state: MatchState, ship: SpacecraftState, prevElapsedMs: number): void {
  if (!hazardsActiveFor(ship)) return;
  const now = state.elapsedMs;
  for (const hz of state.hazards) {
    if (hz.shipId !== ship.id || hz.resolved) continue;
    const warnAt = hz.atMs - hz.warnMs;
    if (prevElapsedMs < warnAt && warnAt <= now) {
      pushEvent(state, { kind: "hazard-warning", shipId: ship.id, hazard: hz.type });
    }
    if (hz.atMs <= now) resolveHazard(state, ship, hz);
  }
}

function resolveHazard(state: MatchState, ship: SpacecraftState, hz: ScheduledHazard): void {
  const def = HAZARDS[hz.type];
  hz.resolved = true;
  ship.stats.hazardsEncountered += 1;
  const raw = def.baseDamage * hazardDamageMultiplier(state.difficulty, state.mode);
  const { dealt, prevented } = applyDamage(state, ship, raw, def.damageType);
  hz.damageDealt = dealt;
  if (def.slow && !hasEffect(ship, "slow-immunity")) {
    addEffect(ship, {
      type: "speed-multiplier", sourceHazard: hz.type, magnitude: def.slow.magnitude, durationMs: def.slow.durationMs,
    }, state.elapsedMs);
  }
  pushEvent(state, { kind: "hazard-hit", shipId: ship.id, hazard: hz.type, damage: dealt, prevented });
}
