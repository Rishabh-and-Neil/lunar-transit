// Ability validation/activation and effect/cooldown ticking.
import { ABILITIES, COOP_ROLE_PERMISSIONS } from "../config/abilities";
import { ROUTE_DISTANCE } from "../config/spacecraft";
import type { AbilityId, MatchState, PlayerRole, SpacecraftState, ValidationResult } from "../types";
import { abilityCostForShip, canAfford } from "./economy";
import { applyDamage } from "./hazards";
import {
  addEffect, effectScale, findPlayer, findShip, hasEffect, isFlying, isOvertime, pushEvent,
} from "./state";
import { recordAbilityUse, recordHeal } from "./statistics";

export function isAbilityId(id: string): id is AbilityId {
  return Object.prototype.hasOwnProperty.call(ABILITIES, id);
}

export function roleMayUseAbility(role: PlayerRole, abilityId: AbilityId): boolean {
  if (role === "pilot") return COOP_ROLE_PERMISSIONS.pilot.includes(abilityId);
  if (role === "engineer") return COOP_ROLE_PERMISSIONS.engineer.includes(abilityId);
  return true;
}

function cooldownKeys(abilityId: AbilityId): string[] {
  const def = ABILITIES[abilityId];
  return def.cooldownGroup ? [abilityId, def.cooldownGroup] : [abilityId];
}

export function isOnCooldown(ship: SpacecraftState, key: string): boolean {
  return (ship.cooldowns[key] ?? 0) > 0;
}

/** The ship a deterrent from `ship` would hit by default (1v1 opponent). */
export function opponentShip(state: MatchState, ship: SpacecraftState): SpacecraftState | undefined {
  return state.spacecraft.find((s) => s.id !== ship.id);
}

interface Resolved { ship: SpacecraftState; target: SpacecraftState; cost: number }

function resolveActivation(
  state: MatchState, playerId: string, abilityId: AbilityId, targetShipId: string | undefined, auto: boolean,
): { ok: true; value: Resolved } | { ok: false; reason: string } {
  if (state.status !== "active") return { ok: false, reason: "match not active" };
  if (!isAbilityId(abilityId)) return { ok: false, reason: "unknown ability" };
  const def = ABILITIES[abilityId];
  const player = findPlayer(state, playerId);
  if (!player) return { ok: false, reason: "unknown player" };
  const ship = findShip(state, player.shipId);
  if (!ship) return { ok: false, reason: "no ship" };
  if (!isFlying(ship)) return { ok: false, reason: "abilities only during flight" };
  if (!auto && state.mode === "coop" && !roleMayUseAbility(player.role, abilityId)) {
    return { ok: false, reason: `${player.role} cannot use ${def.name}` };
  }

  let target: SpacecraftState = ship;
  if (def.kind === "deterrent") {
    if (state.mode !== "1v1") return { ok: false, reason: "deterrents only in 1v1" };
    const t = targetShipId !== undefined ? findShip(state, targetShipId) : opponentShip(state, ship);
    if (!t) return { ok: false, reason: "invalid target" };
    if (t.id === ship.id) return { ok: false, reason: "cannot target own ship" };
    if (!isFlying(t)) return { ok: false, reason: "target is no longer flying" };
    const eff = def.effect;
    if (eff?.type === "stunned") {
      if (hasEffect(t, "stunned")) return { ok: false, reason: "target already stunned" };
      if (hasEffect(t, "slow-immunity")) return { ok: false, reason: "target is immune (navigation lock)" };
    }
    if (eff?.type === "speed-multiplier" && eff.magnitude < 0 && hasEffect(t, "slow-immunity")) {
      return { ok: false, reason: "target is immune (navigation lock)" };
    }
    target = t;
  } else if (targetShipId !== undefined && targetShipId !== ship.id) {
    return { ok: false, reason: "boosters target own ship" };
  }

  if (hasEffect(ship, "stunned")) return { ok: false, reason: "ship is stunned" };
  if (hasEffect(ship, "abilities-blocked")) return { ok: false, reason: "abilities blocked" };
  for (const key of cooldownKeys(abilityId)) {
    if (isOnCooldown(ship, key)) return { ok: false, reason: "on cooldown" };
  }
  const cost = abilityCostForShip(ship, abilityId);
  if (!canAfford(ship, cost)) return { ok: false, reason: "insufficient credits" };
  return { ok: true, value: { ship, target, cost } };
}

export function canActivateAbility(
  state: MatchState, playerId: string, abilityId: AbilityId, targetShipId?: string,
): ValidationResult {
  const r = resolveActivation(state, playerId, abilityId, targetShipId, false);
  return r.ok ? { ok: true } : r;
}

/** Validates and applies an ability on the (already cloned) state. */
export function activateAbility(
  state: MatchState, playerId: string, abilityId: AbilityId, targetShipId: string | undefined, auto: boolean,
): ValidationResult {
  const r = resolveActivation(state, playerId, abilityId, targetShipId, auto);
  if (!r.ok) return r;
  const { ship, target, cost } = r.value;
  const def = ABILITIES[abilityId];
  const overtime = isOvertime(ship);
  const scale = effectScale(ship);

  ship.credits -= cost;
  recordAbilityUse(ship, abilityId, cost);
  for (const key of cooldownKeys(abilityId)) ship.cooldowns[key] = def.cooldownMs;

  if (def.cleanse) {
    target.effects = target.effects.filter(
      (e) => !(e.type === "stunned" || (e.type === "speed-multiplier" && e.magnitude < 0)),
    );
  }
  if (def.effect) {
    const scalesMagnitude = def.effect.type === "speed-multiplier" || def.effect.type === "damage-reduction";
    addEffect(target, {
      type: def.effect.type,
      sourceAbility: abilityId,
      magnitude: scalesMagnitude ? def.effect.magnitude * scale : def.effect.magnitude,
      durationMs: def.effect.durationMs,
      appliedByPlayerId: playerId,
    }, state.elapsedMs);
  }
  if (def.instantProgress) {
    target.progress = Math.min(ROUTE_DISTANCE, target.progress + def.instantProgress * scale);
  }
  if (def.instantHeal) {
    const before = target.health;
    target.health = Math.min(target.maxHealth, target.health + def.instantHeal * scale);
    recordHeal(target, target.health - before);
  }
  if (def.instantDamage) {
    applyDamage(state, target, def.instantDamage * scale, "impact");
  }
  if (def.kind === "deterrent") target.stats.deterrentsReceived += 1;

  pushEvent(state, {
    kind: "ability", shipId: ship.id, playerId, ability: abilityId,
    targetShipId: target.id !== ship.id ? target.id : undefined, overtime, auto,
  });
  return { ok: true };
}

/** Tick effect durations and cooldowns. */
export function tickEffectsAndCooldowns(ship: SpacecraftState, deltaMs: number): void {
  for (const e of ship.effects) e.remainingMs -= deltaMs;
  ship.effects = ship.effects.filter((e) => e.remainingMs > 0);
  for (const key of Object.keys(ship.cooldowns)) {
    const left = ship.cooldowns[key] - deltaMs;
    if (left > 0) ship.cooldowns[key] = left;
    else delete ship.cooldowns[key];
  }
}
