// Small shared helpers for the simulation modules.
import { TIMING } from "../config/timing";
import type {
  ActiveEffect, EffectType, FlightPhase, GameEvent, MatchState, PlayerState, SpacecraftState,
} from "../types";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A GameEvent without seq/atMs (filled by pushEvent). */
export type EventInput = DistributiveOmit<GameEvent, "seq" | "atMs">;

export function pushEvent(state: MatchState, event: EventInput): void {
  const full = { ...event, seq: state.nextEventSeq, atMs: state.elapsedMs } as GameEvent;
  state.nextEventSeq += 1;
  state.events.push(full);
  if (state.events.length > TIMING.maxEventsKept) {
    state.events.splice(0, state.events.length - TIMING.maxEventsKept);
  }
}

export function findShip(state: MatchState, shipId: string | undefined): SpacecraftState | undefined {
  if (shipId === undefined) return undefined;
  return state.spacecraft.find((s) => s.id === shipId);
}

export function findPlayer(state: MatchState, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.id === playerId);
}

export function shipOfPlayer(state: MatchState, playerId: string): SpacecraftState | undefined {
  const p = findPlayer(state, playerId);
  return p ? findShip(state, p.shipId) : undefined;
}

export const FLYING_PHASES: readonly FlightPhase[] = ["main-flight", "overtime", "simulation"];

/** Ship is still travelling (abilities, movement, hazards may apply). */
export function isFlying(ship: SpacecraftState): boolean {
  return FLYING_PHASES.includes(ship.phase);
}

export function isOvertime(ship: SpacecraftState): boolean {
  return ship.phase === "overtime";
}

/** Multiplier for ability magnitudes (overtime halving). */
export function effectScale(ship: SpacecraftState): number {
  return isOvertime(ship) ? TIMING.overtimeEffectMultiplier : 1;
}

export function hasEffect(ship: SpacecraftState, type: EffectType): boolean {
  return ship.effects.some((e) => e.type === type && e.remainingMs > 0);
}

export function addEffect(
  ship: SpacecraftState,
  effect: Omit<ActiveEffect, "id" | "remainingMs">,
  elapsedMs: number,
): ActiveEffect {
  const src = effect.sourceAbility ?? effect.sourceHazard ?? "fx";
  const full: ActiveEffect = {
    ...effect,
    id: `${ship.id}-${src}-${elapsedMs}-${ship.effects.length}`,
    remainingMs: effect.durationMs,
  };
  ship.effects.push(full);
  return full;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
