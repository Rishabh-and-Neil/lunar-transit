// Display-only derivations from the public snapshot + shared config.
// These are HINTS for the UI; the engine/server remains the authority.
import {
  ABILITIES,
  ATTACHMENTS,
  COOP_ROLE_PERMISSIONS,
  REPAIR,
  ROUTE_DISTANCE,
  SPACECRAFT,
  TIMING,
  repairCost,
  type AbilityId,
  type EquipmentId,
  type FlightPhase,
  type PlayerState,
  type PublicMatchSnapshot,
  type PublicShip,
} from "@sm/shared";

export const FLYING_PHASES: FlightPhase[] = ["main-flight", "overtime", "simulation"];

export function isFlying(phase: FlightPhase): boolean {
  return phase === "main-flight" || phase === "overtime" || phase === "simulation";
}

export function viewerShip(s: PublicMatchSnapshot | null): PublicShip | undefined {
  if (!s) return undefined;
  return s.spacecraft.find((x) => x.id === s.viewerShipId);
}

export function viewerPlayer(s: PublicMatchSnapshot | null): PlayerState | undefined {
  if (!s) return undefined;
  return s.players.find((p) => p.id === s.viewerId);
}

export function opponentShip(s: PublicMatchSnapshot | null): PublicShip | undefined {
  if (!s || s.mode !== "1v1") return undefined;
  return s.spacecraft.find((x) => x.id !== s.viewerShipId);
}

export function otherPlayer(s: PublicMatchSnapshot | null): PlayerState | undefined {
  if (!s) return undefined;
  return s.players.find((p) => p.id !== s.viewerId);
}

export function formatClock(ms: number, withTenths = false): string {
  const neg = ms < 0;
  const t = Math.abs(ms);
  const m = Math.floor(t / 60000);
  const sec = Math.floor((t % 60000) / 1000);
  const tenths = Math.floor((t % 1000) / 100);
  return `${neg ? "-" : ""}${m}:${sec.toString().padStart(2, "0")}${withTenths ? `.${tenths}` : ""}`;
}

export function overtimeAt(elapsedMs: number): boolean {
  return elapsedMs >= TIMING.mainFlightMs && elapsedMs < TIMING.simulationStartMs;
}

/** Ability cost as shown in the HUD (overtime halves cost). */
export function displayAbilityCost(abilityId: AbilityId, phase: FlightPhase): number {
  const base = ABILITIES[abilityId].cost;
  return phase === "overtime" ? Math.ceil(base * TIMING.overtimeCostMultiplier) : base;
}

export function cooldownKey(abilityId: AbilityId): string {
  return ABILITIES[abilityId].cooldownGroup ?? abilityId;
}

export function cooldownRemaining(ship: PublicShip, abilityId: AbilityId): number {
  const own = ship.cooldowns[abilityId] ?? 0;
  const group = ABILITIES[abilityId].cooldownGroup;
  const grp = group ? ship.cooldowns[group] ?? 0 : 0;
  return Math.max(own, grp);
}

export function hasEffect(ship: PublicShip, type: PublicShip["effects"][number]["type"]): boolean {
  return ship.effects.some((e) => e.type === type && e.remainingMs > 0);
}

export interface AbilityHint {
  enabled: boolean;
  reason?: string;
  cost: number;
  cooldownMs: number;
  cooldownTotalMs: number;
}

export function abilityHint(snap: PublicMatchSnapshot, abilityId: AbilityId): AbilityHint {
  const def = ABILITIES[abilityId];
  const ship = viewerShip(snap);
  const me = viewerPlayer(snap);
  const phase: FlightPhase = ship?.phase ?? "main-flight";
  const cost = displayAbilityCost(abilityId, phase);
  const cd = ship ? cooldownRemaining(ship, abilityId) : 0;
  const base: AbilityHint = { enabled: false, cost, cooldownMs: cd, cooldownTotalMs: def.cooldownMs };
  if (!ship || !me) return { ...base, reason: "No ship" };
  if (snap.status !== "active") return { ...base, reason: "Mission not in flight" };
  if (!isFlying(ship.phase)) return { ...base, reason: "Only available during flight" };
  if (def.kind === "deterrent") {
    if (snap.mode !== "1v1") return { ...base, reason: "Deterrents are 1v1 only" };
    const opp = opponentShip(snap);
    if (!opp || !isFlying(opp.phase)) return { ...base, reason: "Opponent is no longer flying" };
    const eff = def.effect;
    if (eff?.type === "stunned" && hasEffect(opp, "stunned")) return { ...base, reason: "Opponent already stunned" };
    if (((eff?.type === "speed-multiplier" && eff.magnitude < 0) || eff?.type === "stunned") && hasEffect(opp, "slow-immunity"))
      return { ...base, reason: "Opponent immune (Navigation Lock)" };
  }
  if (snap.mode === "coop") {
    const allowed =
      me.role === "pilot"
        ? COOP_ROLE_PERMISSIONS.pilot.includes(abilityId)
        : me.role === "engineer"
          ? COOP_ROLE_PERMISSIONS.engineer.includes(abilityId)
          : false;
    if (!allowed) return { ...base, reason: `${me.role === "pilot" ? "Engineer" : "Pilot"} controls this` };
  }
  if (hasEffect(ship, "stunned")) return { ...base, reason: "Stunned" };
  if (hasEffect(ship, "abilities-blocked")) return { ...base, reason: "Comms blocked" };
  if (cd > 0) return { ...base, reason: `Cooldown ${(cd / 1000).toFixed(1)}s` };
  if (ship.credits < cost) return { ...base, reason: `Need ${cost} credits` };
  return { ...base, enabled: true };
}

export interface RepairHint {
  available: boolean; // has drone
  enabled: boolean;
  reason?: string;
  cost: number;
  cooldownMs: number;
  cooldownTotalMs: number;
  repairing: boolean;
  progress: number; // 0..1 when repairing
}

export function repairHint(snap: PublicMatchSnapshot): RepairHint {
  const ship = viewerShip(snap);
  const me = viewerPlayer(snap);
  const cfg = ship?.repairUpgraded ? REPAIR.upgraded : REPAIR.base;
  const cost = repairCost(ship?.repairsUsed ?? 0);
  const cd = ship?.cooldowns.repair ?? 0;
  const repairing = !!ship?.repair && ship.repair.remainingMs > 0;
  const progress = ship?.repair ? 1 - ship.repair.remainingMs / Math.max(1, ship.repair.durationMs) : 0;
  const base: RepairHint = {
    available: !!ship?.hasRepairDrone,
    enabled: false,
    cost,
    cooldownMs: cd,
    cooldownTotalMs: cfg.cooldownMs,
    repairing,
    progress,
  };
  if (!ship || !me) return { ...base, reason: "No ship" };
  if (!ship.hasRepairDrone) return { ...base, reason: "No Repair Drone installed" };
  if (snap.status !== "active" || !isFlying(ship.phase)) return { ...base, reason: "Only available during flight" };
  if (snap.mode === "coop" && me.role !== COOP_ROLE_PERMISSIONS.repairRole) return { ...base, reason: "Engineer controls repairs" };
  if (repairing) return { ...base, reason: "Repair in progress" };
  if (hasEffect(ship, "stunned")) return { ...base, reason: "Stunned" };
  if (cd > 0) return { ...base, reason: `Cooldown ${(cd / 1000).toFixed(1)}s` };
  if (ship.health >= ship.maxHealth) return { ...base, reason: "Hull at full integrity" };
  if (ship.credits < cost) return { ...base, reason: `Need ${cost} credits` };
  return { ...base, enabled: true };
}

// ---------------------------------------------------------------------------
// Preparation hints

export function equipmentCost(id: EquipmentId): number {
  if (id === "repair-drone") return REPAIR.drone.cost;
  if (id === "repair-upgrade") return REPAIR.upgrade.cost;
  return ATTACHMENTS[id].cost;
}

export function equipmentMass(id: EquipmentId): number {
  if (id === "repair-drone") return REPAIR.drone.mass;
  if (id === "repair-upgrade") return 0;
  return ATTACHMENTS[id].mass;
}

export function equipmentPower(id: EquipmentId): number {
  if (id === "repair-drone") return REPAIR.drone.powerDraw;
  if (id === "repair-upgrade") return 0;
  return ATTACHMENTS[id].powerDraw;
}

export function ownsEquipment(ship: PublicShip, id: EquipmentId): boolean {
  if (id === "repair-drone") return ship.hasRepairDrone;
  if (id === "repair-upgrade") return ship.repairUpgraded;
  return ship.attachments.includes(id);
}

export interface PurchaseHint {
  owned: boolean;
  canBuy: boolean;
  reason?: string;
}

export function purchaseHint(snap: PublicMatchSnapshot, id: EquipmentId): PurchaseHint {
  const ship = viewerShip(snap);
  if (!ship) return { owned: false, canBuy: false, reason: "No ship" };
  const owned = ownsEquipment(ship, id);
  if (owned) return { owned, canBuy: false };
  const me = viewerPlayer(snap);
  if (me?.ready) return { owned, canBuy: false, reason: "Un-ready to change equipment" };
  const inFlight = snap.status !== "preparation";
  if (inFlight && id !== "repair-upgrade") return { owned, canBuy: false, reason: "Preparation only" };
  if (id === "repair-upgrade" && !ship.hasRepairDrone) return { owned, canBuy: false, reason: "Requires Repair Drone" };
  const cost = equipmentCost(id);
  if (ship.credits < cost) return { owned, canBuy: false, reason: `Need ${cost - ship.credits} more credits` };
  const extraCap = id !== "repair-drone" && id !== "repair-upgrade" ? ATTACHMENTS[id].powerCapacityBonus ?? 0 : 0;
  if (ship.derived.powerUsed + equipmentPower(id) > ship.derived.powerCapacity + extraCap)
    return { owned, canBuy: false, reason: "Insufficient power capacity" };
  return { owned, canBuy: true };
}

/** Cosmetic estimate of cruise speed for a given loadout (mirrors the config formula). */
export function estimateSpeed(thrustMultiplier: number, mass: number): number {
  const v = SPACECRAFT.referenceSpeed * thrustMultiplier * Math.pow(SPACECRAFT.baseMass / Math.max(1, mass), SPACECRAFT.massExponent);
  return Math.min(SPACECRAFT.maxSpeed, Math.max(SPACECRAFT.minSpeed, v));
}

export function estimateArrivalMs(speed: number): number {
  return (ROUTE_DISTANCE / Math.max(0.01, speed)) * 1000;
}

export function totalCreditsSpent(ship: PublicShip): number {
  return ship.stats.creditsSpentEquipment + ship.stats.creditsSpentAbilities + ship.stats.creditsSpentRepairs;
}
