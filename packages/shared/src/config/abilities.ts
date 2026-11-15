import type { AbilityId, AbilityKind, EffectType } from "../types";

export interface AbilityDefinition {
  id: AbilityId;
  name: string;
  kind: AbilityKind;
  cost: number;
  cooldownMs: number;
  /** Abilities sharing a cooldownGroup put each other on cooldown (e.g. "stun"). */
  cooldownGroup?: string;
  /** Timed effect applied to self (booster) or target (deterrent). */
  effect?: { type: EffectType; magnitude: number; durationMs: number };
  /** Instant effects. */
  instantProgress?: number; // route units
  instantHeal?: number;
  instantDamage?: number;
  /** Removes negative effects on self when activated. */
  cleanse?: boolean;
  short: string;
  icon: string;
  hotkey: string;
}

export const ABILITIES: Record<AbilityId, AbilityDefinition> = {
  // ---- Boosters / protectors
  "thruster-burn": {
    id: "thruster-burn", name: "Thruster Burn", kind: "booster", cost: 70, cooldownMs: 18000,
    effect: { type: "speed-multiplier", magnitude: 0.45, durationMs: 8000 },
    short: "+45% speed for 8s", icon: "🚀", hotkey: "1",
  },
  "gravity-assist": {
    id: "gravity-assist", name: "Gravity Assist", kind: "booster", cost: 130, cooldownMs: 40000,
    instantProgress: 7,
    short: "Instantly advance 7 route units", icon: "🌀", hotkey: "2",
  },
  "deflector-surge": {
    id: "deflector-surge", name: "Deflector Surge", kind: "booster", cost: 50, cooldownMs: 22000,
    effect: { type: "damage-reduction", magnitude: 0.6, durationMs: 10000 },
    short: "-60% incoming damage for 10s", icon: "🔰", hotkey: "3",
  },
  "hull-patch": {
    id: "hull-patch", name: "Hull Patch", kind: "booster", cost: 70, cooldownMs: 28000,
    instantHeal: 15,
    short: "Instantly restore 15 HP", icon: "🩹", hotkey: "4",
  },
  "navigation-lock": {
    id: "navigation-lock", name: "Navigation Lock", kind: "booster", cost: 45, cooldownMs: 24000,
    effect: { type: "slow-immunity", magnitude: 1, durationMs: 10000 }, cleanse: true,
    short: "Cleanse & ignore slows/stuns for 10s", icon: "🧭", hotkey: "5",
  },
  // ---- Deterrents (1v1 only)
  "ion-jammer": {
    id: "ion-jammer", name: "Ion Jammer", kind: "deterrent", cost: 70, cooldownMs: 22000,
    effect: { type: "speed-multiplier", magnitude: -0.35, durationMs: 6000 },
    short: "Opponent -35% speed for 6s", icon: "📶", hotkey: "Q",
  },
  "debris-scatter": {
    id: "debris-scatter", name: "Debris Scatter", kind: "deterrent", cost: 80, cooldownMs: 26000,
    instantDamage: 12,
    short: "Deal 12 impact damage to opponent", icon: "☄️", hotkey: "W",
  },
  "emp-pulse": {
    id: "emp-pulse", name: "EMP Pulse", kind: "deterrent", cost: 100, cooldownMs: 35000, cooldownGroup: "stun",
    effect: { type: "stunned", magnitude: 1, durationMs: 3000 },
    short: "Stun opponent 3s (no thrust, no abilities)", icon: "⚡", hotkey: "E",
  },
  "tractor-lock": {
    id: "tractor-lock", name: "Tractor Lock", kind: "deterrent", cost: 90, cooldownMs: 35000, cooldownGroup: "stun",
    effect: { type: "stunned", magnitude: 1, durationMs: 4000 },
    short: "Hold opponent in place 4s (shares stun cooldown)", icon: "🧲", hotkey: "R",
  },
  "comms-spoof": {
    id: "comms-spoof", name: "Comms Spoof", kind: "deterrent", cost: 60, cooldownMs: 28000,
    effect: { type: "abilities-blocked", magnitude: 1, durationMs: 5000 },
    short: "Block opponent abilities for 5s", icon: "📵", hotkey: "T",
  },
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];
export const BOOSTER_IDS = ABILITY_IDS.filter((a) => ABILITIES[a].kind === "booster");
export const DETERRENT_IDS = ABILITY_IDS.filter((a) => ABILITIES[a].kind === "deterrent");

/** Order the auto-simulation prefers when buying boosts. */
export const AUTO_SIM_PRIORITY: AbilityId[] = ["gravity-assist", "thruster-burn"];

/** In co-op: which role may activate what. Pilot flies; Engineer protects & repairs. */
export const COOP_ROLE_PERMISSIONS = {
  pilot: ["thruster-burn", "gravity-assist", "navigation-lock"] as AbilityId[],
  engineer: ["deflector-surge", "hull-patch"] as AbilityId[],
  repairRole: "engineer" as const,
  purchaseRoles: ["pilot", "engineer"] as const,
};
