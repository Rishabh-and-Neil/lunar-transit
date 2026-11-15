// Base spacecraft and movement constants. GAME-DESIGN VALUES, not NASA data.
export const SPACECRAFT = {
  startingCredits: 1000,
  baseMass: 100, // mass units
  basePowerCapacity: 60, // watts-ish power units
  maxHealth: 100,
  /** Reference cruise speed in route units / second at base mass with no thrust bonus. */
  referenceSpeed: 0.75,
  /** speed = referenceSpeed * thrustMultiplier * (baseMass / mass) ^ massExponent */
  massExponent: 0.45,
  /** Absolute floor/ceiling for speed after all modifiers (units/s). */
  minSpeed: 0.15,
  maxSpeed: 3.0,
} as const;

export const ROUTE_DISTANCE = 150;
