export const TIMING = {
  tickMs: 50, // 20 Hz fixed simulation
  snapshotEveryTicks: 2, // 10 Hz network snapshots
  countdownMs: 3000,
  mainFlightMs: 180_000,
  overtimeMs: 60_000, // overtime is 180s..240s
  simulationStartMs: 240_000,
  /** In accelerated simulation the ship's movement is multiplied by this. */
  simulationTimeScale: 6,
  /** Overtime: ability cost and effect magnitude multiplied by these. Cooldowns unchanged. */
  overtimeCostMultiplier: 0.5,
  overtimeEffectMultiplier: 0.5,
  maxEventsKept: 40,
  maxProcessedCommandIds: 500,
} as const;
