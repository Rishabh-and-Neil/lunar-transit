// Core shared game types. This file is the contract between engine, server and client.

export type GameMode = "solo" | "1v1" | "coop";
export type Difficulty = "easy" | "normal" | "hard";
export type PlayerRole = "solo" | "pilot" | "engineer" | "competitor";

export type AttachmentCategory = "shielding" | "propulsion" | "instruments";

export type AttachmentId =
  // shielding
  | "whipple-shield"
  | "radiation-vault"
  | "thermal-blanket"
  | "magnetic-deflector"
  // propulsion
  | "ion-thruster"
  | "chemical-booster"
  | "solar-sail"
  | "cold-gas-rcs"
  // instruments
  | "star-tracker"
  | "solar-array"
  | "deep-space-transponder"
  | "spectrometer";

/** Purchasable equipment that is not one of the 12 attachments. */
export type ExtraEquipmentId = "repair-drone" | "repair-upgrade";
export type EquipmentId = AttachmentId | ExtraEquipmentId;

export type AbilityId =
  // boosters / protectors (all modes)
  | "thruster-burn"
  | "gravity-assist"
  | "deflector-surge"
  | "hull-patch"
  | "navigation-lock"
  // deterrents (1v1 only, target the opponent)
  | "ion-jammer"
  | "debris-scatter"
  | "emp-pulse"
  | "tractor-lock"
  | "comms-spoof";

export type AbilityKind = "booster" | "deterrent";

export type HazardType =
  | "micrometeoroid"
  | "solar-flare"
  | "radiation-belt"
  | "space-debris"
  | "thermal-spike"
  | "nav-anomaly";

export type DamageType = "impact" | "radiation" | "thermal" | "none";

export type LunarTaskId =
  | "surface-analysis"
  | "communications"
  | "power-calibration"
  | "orbit-calibration"
  | "terrain-mapping";

/** Per-spacecraft phase. Each ship progresses independently. */
export type FlightPhase =
  | "main-flight"
  | "overtime"
  | "simulation"
  | "lunar-task"
  | "task-complete"
  | "destroyed";

/** Overall match status. */
export type MatchStatus = "preparation" | "countdown" | "active" | "finished";

// ---------------------------------------------------------------------------
// Effects, repairs, hazards

export type EffectType =
  | "speed-multiplier" // magnitude: e.g. 0.4 => +40% speed ; -0.3 => -30% speed
  | "damage-reduction" // magnitude: 0..1 fraction of incoming damage removed
  | "slow-immunity" // ignore negative speed multipliers / stuns / nav anomalies
  | "stunned" // speed forced to 0 AND abilities disabled
  | "abilities-blocked"; // abilities disabled, movement unaffected

export interface ActiveEffect {
  id: string; // unique instance id
  type: EffectType;
  sourceAbility?: AbilityId;
  sourceHazard?: HazardType;
  magnitude: number;
  remainingMs: number;
  durationMs: number;
  appliedByPlayerId?: string;
}

export interface RepairState {
  remainingMs: number;
  durationMs: number;
  healTotal: number;
  healedSoFar: number;
}

export interface ScheduledHazard {
  id: string;
  type: HazardType;
  shipId: string;
  atMs: number; // match elapsed time when it strikes
  warnMs: number; // how long before strike the warning is public
  resolved: boolean;
  /** Set when resolved: damage actually dealt (after reductions). */
  damageDealt?: number;
}

/** Hazard info that is safe to expose: only those within their warning window or recently resolved. */
export interface PublicHazard {
  id: string;
  type: HazardType;
  shipId: string;
  strikesInMs: number; // <=0 means it has struck
  resolved: boolean;
  damageDealt?: number;
}

// ---------------------------------------------------------------------------
// Spacecraft

export interface SpacecraftState {
  id: string;
  /** Player ids that control this ship. 1 in solo/1v1, 2 in co-op. */
  ownerIds: string[];
  mass: number;
  powerCapacity: number;
  powerUsed: number;
  health: number;
  maxHealth: number;
  credits: number;
  progress: number; // 0..route distance (150)
  velocity: number; // units per second (last computed)
  attachments: AttachmentId[];
  hasRepairDrone: boolean;
  repairUpgraded: boolean;
  repairsUsed: number;
  repair: RepairState | null;
  effects: ActiveEffect[];
  /** Remaining cooldown ms keyed by AbilityId, "stun" (shared group) or "repair". */
  cooldowns: Record<string, number>;
  phase: FlightPhase;
  arrivedAtMs?: number;
  destroyedAtMs?: number;
  stats: ShipStatistics;
}

export interface DerivedShipStats {
  mass: number;
  powerCapacity: number;
  powerUsed: number;
  thrustMultiplier: number; // product of propulsion bonuses
  baseSpeed: number; // units/s before temporary effects
  damageReduction: Record<DamageType, number>; // 0..0.9 fractions
  slowResistance: number; // 0..1 reduces negative speed effects & nav anomaly
  creditIncomePerSec: number;
  hazardWarningBonusMs: number;
  taskHint: boolean;
}

export interface ShipStatistics {
  creditsSpentEquipment: number;
  creditsSpentAbilities: number;
  creditsSpentRepairs: number;
  creditsEarned: number;
  damageTaken: number;
  damagePrevented: number;
  healthRepaired: number;
  hazardsEncountered: number;
  abilitiesUsed: Partial<Record<AbilityId, number>>;
  deterrentsReceived: number;
  peakVelocity: number;
  timeInOvertimeMs: number;
  timeInSimulationMs: number;
  autoSimPurchases: number;
}

// ---------------------------------------------------------------------------
// Players, tasks, match

export interface PlayerState {
  id: string;
  name: string;
  role: PlayerRole;
  shipId: string;
  ready: boolean;
  connected: boolean;
  taskId?: string; // AssignedTask.id
}

export interface AssignedTask {
  id: string;
  taskId: LunarTaskId;
  playerId: string;
  seed: number;
  /** Full generated instance including solution. SERVER-PRIVATE. */
  instance: TaskInstance;
  startedAtMs?: number;
  completedAtMs?: number;
  attempts: number;
}

export interface MatchConfig {
  id: string;
  mode: GameMode;
  difficulty: Difficulty;
  seed: number;
  players: { id: string; name: string; role: PlayerRole }[];
  tutorial?: boolean;
}

export interface MatchState {
  id: string;
  mode: GameMode;
  difficulty: Difficulty;
  seed: number;
  status: MatchStatus;
  elapsedMs: number; // flight clock, starts at 0 when status becomes active
  countdownMs: number;
  spacecraft: SpacecraftState[];
  players: PlayerState[];
  tasks: AssignedTask[];
  hazards: ScheduledHazard[];
  /** Recent events for HUD feed / effects. Engine trims to last ~30. */
  events: GameEvent[];
  winnerId?: string; // 1v1: player id ; solo/coop: unused
  outcome?: MatchOutcome;
  processedCommandIds: string[]; // bounded idempotency set
  tutorial: boolean;
  nextEventSeq: number;
}

export type MatchOutcome =
  | { kind: "solo-complete"; totalMs: number }
  | { kind: "solo-destroyed"; atMs: number }
  | { kind: "coop-complete"; totalMs: number }
  | { kind: "coop-destroyed"; atMs: number }
  | { kind: "1v1-task"; winnerId: string; totalMs: number }
  | { kind: "1v1-destroyed"; winnerId: string; loserId: string; atMs: number }
  | { kind: "abandoned"; reason: string };

export type GameEvent =
  | { seq: number; atMs: number; kind: "hazard-warning"; shipId: string; hazard: HazardType }
  | { seq: number; atMs: number; kind: "hazard-hit"; shipId: string; hazard: HazardType; damage: number; prevented: number }
  | { seq: number; atMs: number; kind: "ability"; shipId: string; playerId: string; ability: AbilityId; targetShipId?: string; overtime: boolean; auto: boolean }
  | { seq: number; atMs: number; kind: "repair-start"; shipId: string; cost: number }
  | { seq: number; atMs: number; kind: "repair-done"; shipId: string; healed: number }
  | { seq: number; atMs: number; kind: "phase"; shipId: string; phase: FlightPhase }
  | { seq: number; atMs: number; kind: "task-failed-attempt"; playerId: string }
  | { seq: number; atMs: number; kind: "task-complete"; playerId: string }
  | { seq: number; atMs: number; kind: "match-end" };

// ---------------------------------------------------------------------------
// Commands (client -> engine). Discriminated union.

interface CommandBase {
  commandId: string;
  playerId: string;
}

export type PlayerCommand =
  | (CommandBase & { type: "PURCHASE_EQUIPMENT"; equipmentId: EquipmentId })
  | (CommandBase & { type: "SELL_EQUIPMENT"; equipmentId: EquipmentId }) // preparation only, full refund
  | (CommandBase & { type: "SET_READY"; ready: boolean })
  | (CommandBase & { type: "ACTIVATE_ABILITY"; abilityId: AbilityId; targetShipId?: string })
  | (CommandBase & { type: "ACTIVATE_REPAIR" })
  | (CommandBase & { type: "SUBMIT_TASK"; submission: TaskSubmission });

export type CommandResult =
  | { ok: true; state: MatchState }
  | { ok: false; state: MatchState; reason: string };

export type ValidationResult = { ok: true } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Lunar task instances. Each has a public part and a private solution.

export interface SurfaceRegion {
  id: string;
  row: number;
  col: number;
  feO: number; // wt% iron oxide reading
  tiO2: number; // wt% titanium dioxide reading
  albedo: number; // 0..1 brightness (visual)
  terrain: "mare" | "highland" | "crater-rim" | "ejecta";
}
export interface SurfaceAnalysisPublic {
  taskId: "surface-analysis";
  rows: number;
  cols: number;
  regions: SurfaceRegion[];
  /** Plain-language criterion, e.g. "Select every region with TiO2 >= 6% (high-titanium mare basalt)" */
  criterion: string;
  minTiO2: number;
  minFeO: number;
  hint?: string;
}
export interface CommunicationsPublic {
  taskId: "communications";
  /** Where Earth sits in the lunar sky for this landing site (degrees). */
  earthAzimuth: number; // 0..360
  earthElevation: number; // 0..90
  toleranceDeg: number;
  startAzimuth: number;
  startElevation: number;
  siteName: string;
  hint?: string;
}
export interface PowerSubsystem {
  id: string;
  name: string;
  minWatts: number; // required to function
  maxWatts: number; // more than this is wasted (invalid)
  critical: boolean; // must be at maxWatts
}
export interface PowerCalibrationPublic {
  taskId: "power-calibration";
  availableWatts: number;
  subsystems: PowerSubsystem[];
  step: number; // slider step in watts
  hint?: string;
}
export interface OrbitCalibrationPublic {
  taskId: "orbit-calibration";
  /** Current orbit (km altitude above lunar surface). */
  currentPeriapsisKm: number;
  currentApoapsisKm: number;
  targetPeriapsisKm: number;
  targetApoapsisKm: number;
  toleranceKm: number;
  /** Burn delta-v ranges in m/s (signed: negative = retrograde). */
  dvMin: number;
  dvMax: number;
  /** km of apoapsis change per m/s when burning at periapsis, and periapsis change per m/s at apoapsis. */
  kmPerMps: number;
  hint?: string;
}
export type TerrainKind = "crater" | "mare" | "highland" | "rille" | "ridge" | "landing-site";
export interface TerrainTile {
  id: string;
  kind: TerrainKind;
  elevation: number; // 0..4 relative height band
}
export interface TerrainMappingPublic {
  taskId: "terrain-mapping";
  rows: number;
  cols: number;
  /** Elevation band per cell (from orbital altimetry), row-major. */
  cellElevations: number[];
  /** Some cells are pre-labeled as anchors: cellIndex -> tile id. */
  anchors: Record<number, string>;
  tiles: TerrainTile[]; // one per cell, shuffled
  /** Optional textual clues ("The landing site is east of the rille"). */
  clues: string[];
  hint?: string;
}

export type PublicTaskInstance =
  | SurfaceAnalysisPublic
  | CommunicationsPublic
  | PowerCalibrationPublic
  | OrbitCalibrationPublic
  | TerrainMappingPublic;

export type TaskSolution =
  | { taskId: "surface-analysis"; regionIds: string[] }
  | { taskId: "communications"; azimuth: number; elevation: number }
  | { taskId: "power-calibration"; example: Record<string, number> }
  | { taskId: "orbit-calibration"; dvAtPeriapsis: number; dvAtApoapsis: number }
  | { taskId: "terrain-mapping"; mapping: Record<number, string> };

export interface TaskInstance {
  public: PublicTaskInstance;
  solution: TaskSolution;
}

export type TaskSubmission =
  | { taskId: "surface-analysis"; regionIds: string[] }
  | { taskId: "communications"; azimuth: number; elevation: number }
  | { taskId: "power-calibration"; allocation: Record<string, number> }
  | { taskId: "orbit-calibration"; dvAtPeriapsis: number; dvAtApoapsis: number }
  | { taskId: "terrain-mapping"; mapping: Record<number, string> };

// ---------------------------------------------------------------------------
// Snapshots (engine -> client). Never contains solutions or future hazards.

export interface PublicShip extends Omit<SpacecraftState, never> {
  derived: DerivedShipStats;
}

export interface PublicPlayerTask {
  assignedId: string;
  playerId: string;
  taskId: LunarTaskId;
  completedAtMs?: number;
  attempts: number;
  /** Only present for the viewer's own task (or both in 1v1 since identical). */
  instance?: PublicTaskInstance;
}

export interface PublicMatchSnapshot {
  id: string;
  mode: GameMode;
  difficulty: Difficulty;
  status: MatchStatus;
  elapsedMs: number;
  countdownMs: number;
  serverTime: number; // Date.now() at snapshot creation
  viewerId: string;
  viewerShipId: string;
  spacecraft: PublicShip[];
  players: PlayerState[];
  tasks: PublicPlayerTask[];
  hazards: PublicHazard[];
  events: GameEvent[];
  winnerId?: string;
  outcome?: MatchOutcome;
  tutorial: boolean;
}
