// Repair drone: heal over time with escalating cost.
import { COOP_ROLE_PERMISSIONS } from "../config/abilities";
import { REPAIR, repairCost } from "../config/repair";
import type { MatchState, SpacecraftState, ValidationResult } from "../types";
import { canAfford } from "./economy";
import { findPlayer, findShip, hasEffect, isFlying, pushEvent } from "./state";
import { recordHeal } from "./statistics";

export function repairParams(ship: SpacecraftState): { heal: number; durationMs: number; cooldownMs: number } {
  return ship.repairUpgraded ? REPAIR.upgraded : REPAIR.base;
}

function resolveRepair(state: MatchState, playerId: string): { ok: true; ship: SpacecraftState } | { ok: false; reason: string } {
  if (state.status !== "active") return { ok: false, reason: "match not active" };
  const player = findPlayer(state, playerId);
  if (!player) return { ok: false, reason: "unknown player" };
  const ship = findShip(state, player.shipId);
  if (!ship) return { ok: false, reason: "no ship" };
  if (state.mode === "coop" && player.role !== COOP_ROLE_PERMISSIONS.repairRole) {
    return { ok: false, reason: "only the engineer can repair" };
  }
  if (!isFlying(ship)) return { ok: false, reason: "repairs only during flight" };
  if (!ship.hasRepairDrone) return { ok: false, reason: "no repair drone" };
  if (ship.repair) return { ok: false, reason: "already repairing" };
  if ((ship.cooldowns.repair ?? 0) > 0) return { ok: false, reason: "on cooldown" };
  if (hasEffect(ship, "stunned")) return { ok: false, reason: "ship is stunned" };
  if (!canAfford(ship, repairCost(ship.repairsUsed))) return { ok: false, reason: "insufficient credits" };
  return { ok: true, ship };
}

export function canRepair(state: MatchState, playerId: string): ValidationResult {
  const r = resolveRepair(state, playerId);
  return r.ok ? { ok: true } : r;
}

export function startRepair(state: MatchState, playerId: string): ValidationResult {
  const r = resolveRepair(state, playerId);
  if (!r.ok) return r;
  const ship = r.ship;
  const cost = repairCost(ship.repairsUsed);
  const p = repairParams(ship);
  ship.credits -= cost;
  ship.stats.creditsSpentRepairs += cost;
  ship.repairsUsed += 1;
  ship.cooldowns.repair = p.cooldownMs;
  ship.repair = { remainingMs: p.durationMs, durationMs: p.durationMs, healTotal: p.heal, healedSoFar: 0 };
  pushEvent(state, { kind: "repair-start", shipId: ship.id, cost });
  return { ok: true };
}

/** Progressive healing. */
export function tickRepair(state: MatchState, ship: SpacecraftState, deltaMs: number): void {
  const rep = ship.repair;
  if (!rep) return;
  const step = Math.min(deltaMs, rep.remainingMs);
  const healPortion = (rep.healTotal * step) / rep.durationMs;
  const before = ship.health;
  ship.health = Math.min(ship.maxHealth, ship.health + healPortion);
  const healed = ship.health - before;
  rep.healedSoFar += healed;
  recordHeal(ship, healed);
  rep.remainingMs -= step;
  if (rep.remainingMs <= 0) {
    pushEvent(state, { kind: "repair-done", shipId: ship.id, healed: rep.healedSoFar });
    ship.repair = null;
  }
}
