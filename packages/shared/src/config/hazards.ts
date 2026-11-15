import type { DamageType, Difficulty, HazardType } from "../types";

export interface HazardDefinition {
  type: HazardType;
  name: string;
  damageType: DamageType;
  baseDamage: number;
  /** Optional timed slow applied on hit (nav anomaly). */
  slow?: { magnitude: number; durationMs: number };
  /** Progress window (fraction of route) where it can occur. */
  progressWindow: [number, number];
  weight: number; // relative frequency
  warnMs: number;
  short: string;
  icon: string;
}

export const HAZARDS: Record<HazardType, HazardDefinition> = {
  micrometeoroid: {
    type: "micrometeoroid", name: "Micrometeoroid Swarm", damageType: "impact", baseDamage: 9,
    progressWindow: [0, 1], weight: 3, warnMs: 3000, short: "Tiny high-velocity particles", icon: "🌠",
  },
  "solar-flare": {
    type: "solar-flare", name: "Solar Flare", damageType: "radiation", baseDamage: 14,
    progressWindow: [0.1, 1], weight: 2, warnMs: 4000, short: "Burst of solar energetic particles", icon: "☀️",
  },
  "radiation-belt": {
    type: "radiation-belt", name: "Van Allen Belt Pass", damageType: "radiation", baseDamage: 10,
    progressWindow: [0, 0.25], weight: 3, warnMs: 3000, short: "Trapped radiation near Earth", icon: "🟣",
  },
  "space-debris": {
    type: "space-debris", name: "Orbital Debris", damageType: "impact", baseDamage: 12,
    progressWindow: [0, 0.2], weight: 2, warnMs: 3000, short: "Fragments in Earth orbit", icon: "🛰️",
  },
  "thermal-spike": {
    type: "thermal-spike", name: "Thermal Spike", damageType: "thermal", baseDamage: 10,
    progressWindow: [0.2, 1], weight: 2, warnMs: 3000, short: "Sudden sun exposure overheats systems", icon: "🌡️",
  },
  "nav-anomaly": {
    type: "nav-anomaly", name: "Navigation Anomaly", damageType: "none", baseDamage: 0,
    slow: { magnitude: -0.4, durationMs: 5000 },
    progressWindow: [0.3, 1], weight: 2, warnMs: 3000, short: "Guidance drift slows the ship", icon: "🧭",
  },
};

export const HAZARD_TYPES = Object.keys(HAZARDS) as HazardType[];

export const DIFFICULTY: Record<Difficulty, { label: string; damageMultiplier: number; intervalMs: [number, number] }> = {
  easy: { label: "Easy", damageMultiplier: 0.6, intervalMs: [18000, 26000] },
  normal: { label: "Normal", damageMultiplier: 1.0, intervalMs: [13000, 19000] },
  hard: { label: "Hard", damageMultiplier: 1.1, intervalMs: [11500, 16500] },
};

/** Co-op hazard pressure: two players share a ship so hazards come more often and hit harder. */
export const COOP_PRESSURE = { intervalMultiplier: 0.9, damageMultiplier: 1.1 };

/** Hazards are not scheduled during accelerated simulation (guarantees arrival). */
export const HAZARDS_DURING_SIMULATION = false;
/** First hazard cannot strike before this. */
export const FIRST_HAZARD_MIN_MS = 8000;
