import type { AttachmentCategory, AttachmentId, DamageType } from "../types";

export interface AttachmentDefinition {
  id: AttachmentId;
  name: string;
  category: AttachmentCategory;
  cost: number;
  mass: number;
  powerDraw: number; // consumes power capacity
  /** Effects (all optional, combine multiplicatively for thrust, additively otherwise). */
  thrustBonus?: number; // +0.12 => x1.12
  damageReduction?: Partial<Record<DamageType, number>>; // fraction
  slowResistance?: number; // fraction
  powerCapacityBonus?: number;
  creditIncomePerSec?: number;
  hazardWarningBonusMs?: number;
  taskHint?: boolean;
  short: string; // one-line gameplay summary shown in shop
  icon: string; // emoji/glyph for UI
}

export const ATTACHMENTS: Record<AttachmentId, AttachmentDefinition> = {
  // ---- Shielding
  "whipple-shield": {
    id: "whipple-shield", name: "Whipple Shield", category: "shielding",
    cost: 150, mass: 14, powerDraw: 0, damageReduction: { impact: 0.35 },
    short: "-35% impact damage (micrometeoroids, debris)", icon: "🛡️",
  },
  "radiation-vault": {
    id: "radiation-vault", name: "Radiation Vault", category: "shielding",
    cost: 170, mass: 20, powerDraw: 4, damageReduction: { radiation: 0.4 },
    short: "-40% radiation damage (flares, Van Allen belts)", icon: "☢️",
  },
  "thermal-blanket": {
    id: "thermal-blanket", name: "Multi-Layer Insulation", category: "shielding",
    cost: 90, mass: 6, powerDraw: 0, damageReduction: { thermal: 0.4 },
    short: "-40% thermal damage", icon: "🧥",
  },
  "magnetic-deflector": {
    id: "magnetic-deflector", name: "Active Magnetic Deflector", category: "shielding",
    cost: 210, mass: 14, powerDraw: 24, damageReduction: { impact: 0.15, radiation: 0.2, thermal: 0.15 },
    short: "-15–20% all damage, power-hungry", icon: "🧲",
  },
  // ---- Propulsion
  "ion-thruster": {
    id: "ion-thruster", name: "Ion Thruster", category: "propulsion",
    cost: 200, mass: 10, powerDraw: 28, thrustBonus: 0.22,
    short: "+22% thrust, high power draw", icon: "🔵",
  },
  "chemical-booster": {
    id: "chemical-booster", name: "Bipropellant Booster", category: "propulsion",
    cost: 170, mass: 24, powerDraw: 3, thrustBonus: 0.28,
    short: "+28% thrust, heavy", icon: "🔥",
  },
  "solar-sail": {
    id: "solar-sail", name: "Solar Sail", category: "propulsion",
    cost: 130, mass: 5, powerDraw: 0, thrustBonus: 0.12,
    short: "+12% thrust, almost weightless", icon: "⛵",
  },
  "cold-gas-rcs": {
    id: "cold-gas-rcs", name: "Cold-Gas RCS", category: "propulsion",
    cost: 100, mass: 8, powerDraw: 4, slowResistance: 0.5,
    short: "-50% slowdown from jammers & nav anomalies", icon: "💨",
  },
  // ---- Instruments
  "star-tracker": {
    id: "star-tracker", name: "Star Tracker", category: "instruments",
    cost: 110, mass: 3, powerDraw: 6, hazardWarningBonusMs: 3000, slowResistance: 0.2,
    short: "+3s hazard warning, -20% slowdowns", icon: "✨",
  },
  "solar-array": {
    id: "solar-array", name: "Deployable Solar Array", category: "instruments",
    cost: 120, mass: 9, powerDraw: 0, powerCapacityBonus: 45,
    short: "+45 power capacity", icon: "🔆",
  },
  "deep-space-transponder": {
    id: "deep-space-transponder", name: "Deep Space Transponder", category: "instruments",
    cost: 120, mass: 5, powerDraw: 10, creditIncomePerSec: 2,
    short: "Earn +2 credits/s during flight (science telemetry)", icon: "📡",
  },
  spectrometer: {
    id: "spectrometer", name: "Lunar Spectrometer", category: "instruments",
    cost: 140, mass: 7, powerDraw: 10, taskHint: true,
    short: "Unlocks a hint for your lunar task", icon: "🔬",
  },
};

export const ATTACHMENT_IDS = Object.keys(ATTACHMENTS) as AttachmentId[];

export const ATTACHMENT_CATEGORIES: { id: AttachmentCategory; label: string }[] = [
  { id: "shielding", label: "Shielding" },
  { id: "propulsion", label: "Propulsion" },
  { id: "instruments", label: "Instruments" },
];
