// Equipment purchase/sell rules and derived ship stats.
import { ATTACHMENTS } from "../config/attachments";
import { COOP_ROLE_PERMISSIONS } from "../config/abilities";
import { REPAIR } from "../config/repair";
import { SPACECRAFT } from "../config/spacecraft";
import type {
  AttachmentId, DamageType, DerivedShipStats, EquipmentId, MatchState, SpacecraftState, ValidationResult,
} from "../types";
import { findPlayer, findShip, isFlying } from "./state";

const MAX_DAMAGE_REDUCTION = 0.9;

export function isAttachmentId(id: string): id is AttachmentId {
  return Object.prototype.hasOwnProperty.call(ATTACHMENTS, id);
}

export function isEquipmentId(id: string): id is EquipmentId {
  return isAttachmentId(id) || id === "repair-drone" || id === "repair-upgrade";
}

/** Derived stats from the ship's equipment (pure). */
export function calculateStats(ship: SpacecraftState): DerivedShipStats {
  let mass: number = SPACECRAFT.baseMass;
  let powerCapacity: number = SPACECRAFT.basePowerCapacity;
  let powerUsed = 0;
  let thrustMultiplier = 1;
  const damageReduction: Record<DamageType, number> = { impact: 0, radiation: 0, thermal: 0, none: 0 };
  let slowResistance = 0;
  let creditIncomePerSec = 0;
  let hazardWarningBonusMs = 0;
  let taskHint = false;

  for (const id of ship.attachments) {
    const def = ATTACHMENTS[id];
    if (!def) continue;
    mass += def.mass;
    powerUsed += def.powerDraw;
    if (def.thrustBonus) thrustMultiplier *= 1 + def.thrustBonus;
    if (def.damageReduction) {
      for (const [type, value] of Object.entries(def.damageReduction) as [DamageType, number][]) {
        damageReduction[type] += value;
      }
    }
    slowResistance += def.slowResistance ?? 0;
    powerCapacity += def.powerCapacityBonus ?? 0;
    creditIncomePerSec += def.creditIncomePerSec ?? 0;
    hazardWarningBonusMs += def.hazardWarningBonusMs ?? 0;
    if (def.taskHint) taskHint = true;
  }
  if (ship.hasRepairDrone) {
    mass += REPAIR.drone.mass;
    powerUsed += REPAIR.drone.powerDraw;
  }
  for (const key of Object.keys(damageReduction) as DamageType[]) {
    damageReduction[key] = Math.min(MAX_DAMAGE_REDUCTION, damageReduction[key]);
  }
  damageReduction.none = 0;
  slowResistance = Math.min(1, slowResistance);

  const rawSpeed = SPACECRAFT.referenceSpeed * thrustMultiplier * Math.pow(SPACECRAFT.baseMass / mass, SPACECRAFT.massExponent);
  const baseSpeed = Math.min(SPACECRAFT.maxSpeed, Math.max(SPACECRAFT.minSpeed, rawSpeed));

  return {
    mass, powerCapacity, powerUsed, thrustMultiplier, baseSpeed, damageReduction,
    slowResistance, creditIncomePerSec, hazardWarningBonusMs, taskHint,
  };
}

/** Sync the denormalised mass/power fields on the ship. */
export function refreshShipFields(ship: SpacecraftState): void {
  const d = calculateStats(ship);
  ship.mass = d.mass;
  ship.powerCapacity = d.powerCapacity;
  ship.powerUsed = d.powerUsed;
}

export function equipmentCost(id: EquipmentId): number {
  if (id === "repair-drone") return REPAIR.drone.cost;
  if (id === "repair-upgrade") return REPAIR.upgrade.cost;
  return ATTACHMENTS[id].cost;
}

function ownsEquipment(ship: SpacecraftState, id: EquipmentId): boolean {
  if (id === "repair-drone") return ship.hasRepairDrone;
  if (id === "repair-upgrade") return ship.repairUpgraded;
  return ship.attachments.includes(id);
}

function playerAndShip(state: MatchState, playerId: string): { ok: true; ship: SpacecraftState } | { ok: false; reason: string } {
  const player = findPlayer(state, playerId);
  if (!player) return { ok: false, reason: "unknown player" };
  const ship = findShip(state, player.shipId);
  if (!ship) return { ok: false, reason: "no ship" };
  if (state.mode === "coop" && !(COOP_ROLE_PERMISSIONS.purchaseRoles as readonly string[]).includes(player.role)) {
    return { ok: false, reason: "role cannot purchase" };
  }
  return { ok: true, ship };
}

/** Window in which buying/selling this equipment is allowed. */
function inPurchaseWindow(state: MatchState, ship: SpacecraftState, id: EquipmentId): boolean {
  if (state.status === "preparation") return true;
  return id === "repair-upgrade" && state.status === "active" && isFlying(ship);
}

export function canPurchase(state: MatchState, playerId: string, equipmentId: EquipmentId): ValidationResult {
  if (!isEquipmentId(equipmentId)) return { ok: false, reason: "unknown equipment" };
  const ps = playerAndShip(state, playerId);
  if (!ps.ok) return ps;
  const ship = ps.ship;
  if (!inPurchaseWindow(state, ship, equipmentId)) return { ok: false, reason: "not purchasable now" };
  if (ownsEquipment(ship, equipmentId)) return { ok: false, reason: "already owned" };
  if (equipmentId === "repair-upgrade" && !ship.hasRepairDrone) return { ok: false, reason: "requires repair drone" };
  const cost = equipmentCost(equipmentId);
  if (ship.credits < cost) return { ok: false, reason: "insufficient credits" };

  // Power check on the hypothetical loadout.
  const next: SpacecraftState = {
    ...ship,
    attachments: isAttachmentId(equipmentId) ? [...ship.attachments, equipmentId] : ship.attachments,
    hasRepairDrone: ship.hasRepairDrone || equipmentId === "repair-drone",
  };
  const d = calculateStats(next);
  if (d.powerUsed > d.powerCapacity) return { ok: false, reason: "exceeds power capacity" };
  return { ok: true };
}

export function canSell(state: MatchState, playerId: string, equipmentId: EquipmentId): ValidationResult {
  if (!isEquipmentId(equipmentId)) return { ok: false, reason: "unknown equipment" };
  const ps = playerAndShip(state, playerId);
  if (!ps.ok) return ps;
  const ship = ps.ship;
  if (state.status !== "preparation") return { ok: false, reason: "can only sell during preparation" };
  if (!ownsEquipment(ship, equipmentId)) return { ok: false, reason: "not owned" };
  if (equipmentId === "repair-drone" && ship.repairUpgraded) return { ok: false, reason: "sell repair upgrade first" };
  const next: SpacecraftState = {
    ...ship,
    attachments: ship.attachments.filter((a) => a !== equipmentId),
    hasRepairDrone: equipmentId === "repair-drone" ? false : ship.hasRepairDrone,
  };
  const d = calculateStats(next);
  if (d.powerUsed > d.powerCapacity) return { ok: false, reason: "remaining equipment would exceed power capacity" };
  return { ok: true };
}

/** Mutates ship; caller has validated with canPurchase. */
export function applyPurchase(ship: SpacecraftState, equipmentId: EquipmentId): void {
  const cost = equipmentCost(equipmentId);
  ship.credits -= cost;
  ship.stats.creditsSpentEquipment += cost;
  if (equipmentId === "repair-drone") ship.hasRepairDrone = true;
  else if (equipmentId === "repair-upgrade") ship.repairUpgraded = true;
  else ship.attachments.push(equipmentId);
  refreshShipFields(ship);
}

/** Mutates ship; full refund. Caller has validated with canSell. */
export function applySell(ship: SpacecraftState, equipmentId: EquipmentId): void {
  const cost = equipmentCost(equipmentId);
  ship.credits += cost;
  ship.stats.creditsSpentEquipment -= cost;
  if (equipmentId === "repair-drone") ship.hasRepairDrone = false;
  else if (equipmentId === "repair-upgrade") ship.repairUpgraded = false;
  else ship.attachments = ship.attachments.filter((a) => a !== equipmentId);
  refreshShipFields(ship);
}
