// Deterministic match engine: public API. All functions return new state objects.
import { SPACECRAFT } from "../config/spacecraft";
import { TIMING } from "../config/timing";
import { assignTasks } from "../tasks/roleAssignment";
import { validateSubmission } from "../tasks/validators";
import type {
  AbilityId, CommandResult, DerivedShipStats, EquipmentId, MatchConfig, MatchState, PlayerCommand, PlayerRole,
  PlayerState, PublicHazard, PublicMatchSnapshot, PublicPlayerTask, SpacecraftState, TaskSubmission, ValidationResult,
} from "../types";
import { activateAbility, canActivateAbility as canActivateAbilityImpl, tickEffectsAndCooldowns } from "./abilities";
import { runAutoSim } from "./autoSim";
import { abilityCost as abilityCostImpl, applyIncome } from "./economy";
import {
  applyPurchase, applySell, calculateStats as calculateStatsImpl, canPurchase as canPurchaseImpl, canSell, refreshShipFields,
} from "./equipment";
import { generateHazardTimeline, hazardsActiveFor, hazardsForShip, processHazards } from "./hazards";
import { moveShip } from "./movement";
import { checkShipOutcome, checkTaskPhase, trackPhaseTime, updateTimePhase } from "./phases";
import { canRepair as canRepairImpl, startRepair, tickRepair } from "./repair";
import { clone, findPlayer, findShip, isFlying, pushEvent, shipOfPlayer } from "./state";
import { emptyStats } from "./statistics";
import { checkVictory } from "./victory";

/** How long resolved hazards stay visible in snapshots. */
export const RESOLVED_HAZARD_VISIBLE_MS = 6000;

function newShip(id: string, ownerIds: string[]): SpacecraftState {
  const ship: SpacecraftState = {
    id, ownerIds,
    mass: SPACECRAFT.baseMass,
    powerCapacity: SPACECRAFT.basePowerCapacity,
    powerUsed: 0,
    health: SPACECRAFT.maxHealth,
    maxHealth: SPACECRAFT.maxHealth,
    credits: SPACECRAFT.startingCredits,
    progress: 0,
    velocity: 0,
    attachments: [],
    hasRepairDrone: false,
    repairUpgraded: false,
    repairsUsed: 0,
    repair: null,
    effects: [],
    cooldowns: {},
    phase: "main-flight",
    stats: emptyStats(),
  };
  refreshShipFields(ship);
  return ship;
}

/** New match in status "preparation"; each ship has 1000 credits and no equipment. */
export function createMatch(config: MatchConfig): MatchState {
  const spacecraft: SpacecraftState[] = [];
  const players: PlayerState[] = [];
  const mk = (p: { id: string; name: string }, role: PlayerRole, shipId: string): PlayerState => ({
    id: p.id, name: p.name, role, shipId, ready: false, connected: true,
  });

  if (config.mode === "coop") {
    const shipId = "ship-1";
    spacecraft.push(newShip(shipId, config.players.map((p) => p.id)));
    config.players.forEach((p, i) => {
      const role: PlayerRole = p.role === "pilot" || p.role === "engineer" ? p.role : i === 0 ? "pilot" : "engineer";
      players.push(mk(p, role, shipId));
    });
  } else if (config.mode === "1v1") {
    config.players.forEach((p, i) => {
      const shipId = `ship-${i + 1}`;
      spacecraft.push(newShip(shipId, [p.id]));
      players.push(mk(p, "competitor", shipId));
    });
  } else {
    const p = config.players[0];
    if (p) {
      spacecraft.push(newShip("ship-1", [p.id]));
      players.push(mk(p, "solo", "ship-1"));
    }
  }

  return {
    id: config.id,
    mode: config.mode,
    difficulty: config.difficulty,
    seed: config.seed >>> 0,
    status: "preparation",
    elapsedMs: 0,
    countdownMs: 0,
    spacecraft,
    players,
    tasks: [],
    hazards: [],
    events: [],
    processedCommandIds: [],
    tutorial: config.tutorial ?? false,
    nextEventSeq: 1,
  };
}

// ---------------------------------------------------------------------------
// Commands

function handleSubmitTask(state: MatchState, playerId: string, submission: TaskSubmission): ValidationResult {
  if (state.status !== "active") return { ok: false, reason: "match not active" };
  const task = state.tasks.find((t) => t.playerId === playerId);
  if (!task) return { ok: false, reason: "no task assigned" };
  const ship = shipOfPlayer(state, playerId);
  if (!ship || ship.phase !== "lunar-task") return { ok: false, reason: "not at the Moon yet" };
  if (task.completedAtMs !== undefined) return { ok: false, reason: "task already complete" };
  if (typeof submission !== "object" || submission === null) return { ok: false, reason: "malformed submission" };
  if (submission.taskId !== task.taskId) return { ok: false, reason: "submission is for a different task" };
  task.attempts += 1;
  const result = validateSubmission(task.instance, submission);
  if (result.ok) {
    task.completedAtMs = state.elapsedMs;
    pushEvent(state, { kind: "task-complete", playerId });
  } else {
    pushEvent(state, { kind: "task-failed-attempt", playerId });
  }
  // A wrong (but well-formed) answer is an accepted command: the attempt is counted.
  return { ok: true };
}

function dispatch(state: MatchState, command: PlayerCommand): ValidationResult {
  switch (command.type) {
    case "PURCHASE_EQUIPMENT": {
      const v = canPurchaseImpl(state, command.playerId, command.equipmentId);
      if (!v.ok) return v;
      const ship = shipOfPlayer(state, command.playerId);
      if (!ship) return { ok: false, reason: "no ship" };
      applyPurchase(ship, command.equipmentId);
      return { ok: true };
    }
    case "SELL_EQUIPMENT": {
      const v = canSell(state, command.playerId, command.equipmentId);
      if (!v.ok) return v;
      const ship = shipOfPlayer(state, command.playerId);
      if (!ship) return { ok: false, reason: "no ship" };
      applySell(ship, command.equipmentId);
      return { ok: true };
    }
    case "SET_READY": {
      if (state.status !== "preparation") return { ok: false, reason: "not in preparation" };
      const p = findPlayer(state, command.playerId);
      if (!p) return { ok: false, reason: "unknown player" };
      p.ready = Boolean(command.ready);
      return { ok: true };
    }
    case "ACTIVATE_ABILITY":
      return activateAbility(state, command.playerId, command.abilityId, command.targetShipId, false);
    case "ACTIVATE_REPAIR":
      return startRepair(state, command.playerId);
    case "SUBMIT_TASK":
      return handleSubmitTask(state, command.playerId, command.submission);
    default:
      return { ok: false, reason: "unknown command" };
  }
}

/** Arrival / destruction / task-phase / victory checks after any mutation. */
function settle(state: MatchState): void {
  for (const ship of state.spacecraft) {
    checkShipOutcome(state, ship);
    checkTaskPhase(state, ship);
  }
  checkVictory(state);
}

/** Validates and applies a command. Idempotent on commandId. Never throws for bad input. */
export function applyCommand(state: MatchState, command: PlayerCommand): CommandResult {
  try {
    if (typeof command !== "object" || command === null || typeof command.commandId !== "string") {
      return { ok: false, state, reason: "malformed command" };
    }
    if (state.processedCommandIds.includes(command.commandId)) return { ok: false, state, reason: "duplicate" };
    if (state.status === "finished") return { ok: false, state, reason: "match finished" };
    if (!findPlayer(state, command.playerId)) return { ok: false, state, reason: "unknown player" };

    const next = clone(state);
    const res = dispatch(next, command);
    if (!res.ok) return { ok: false, state, reason: res.reason };
    next.processedCommandIds.push(command.commandId);
    if (next.processedCommandIds.length > TIMING.maxProcessedCommandIds) {
      next.processedCommandIds.splice(0, next.processedCommandIds.length - TIMING.maxProcessedCommandIds);
    }
    settle(next);
    return { ok: true, state: next };
  } catch (err) {
    return { ok: false, state, reason: err instanceof Error ? `error: ${err.message}` : "error" };
  }
}

// ---------------------------------------------------------------------------
// Lifecycle

/** preparation -> countdown. Schedules hazards and assigns lunar tasks. */
export function startCountdown(state: MatchState): MatchState {
  if (state.status !== "preparation") return state;
  const next = clone(state);
  next.status = "countdown";
  next.countdownMs = TIMING.countdownMs;
  next.elapsedMs = 0;
  for (const ship of next.spacecraft) refreshShipFields(ship);

  // One timeline for the match: in 1v1 both ships get the identical schedule.
  const timeline = generateHazardTimeline(next.seed, next.difficulty, next.mode);
  next.hazards = next.spacecraft.flatMap((ship) => hazardsForShip(timeline, ship));

  next.tasks = assignTasks({
    mode: next.mode,
    seed: next.seed,
    players: next.players.map((p) => ({ id: p.id, role: p.role })),
    hasHint: (pid) => {
      const ship = shipOfPlayer(next, pid);
      return ship ? calculateStatsImpl(ship).taskHint : false;
    },
  });
  for (const p of next.players) {
    p.taskId = next.tasks.find((t) => t.playerId === p.id)?.id;
  }
  return next;
}

function stepActive(state: MatchState, deltaMs: number): void {
  const prev = state.elapsedMs;
  state.elapsedMs += deltaMs;
  for (const ship of state.spacecraft) {
    if (!isFlying(ship)) {
      ship.velocity = 0;
      continue;
    }
    updateTimePhase(state, ship);
    trackPhaseTime(ship, deltaMs);
    tickEffectsAndCooldowns(ship, deltaMs);
    tickRepair(state, ship, deltaMs);
    applyIncome(ship, deltaMs);
    runAutoSim(state, ship);
    moveShip(ship, deltaMs);
    processHazards(state, ship, prev);
    checkShipOutcome(state, ship);
  }
  for (const ship of state.spacecraft) checkTaskPhase(state, ship);
  checkVictory(state);
}

/** Advance by deltaMs (call with TIMING.tickMs). Handles countdown -> active and all per-ship updates. */
export function advance(state: MatchState, deltaMs: number): MatchState {
  if (!(deltaMs > 0) || !Number.isFinite(deltaMs)) return state;
  if (state.status !== "countdown" && state.status !== "active") return state;
  const next = clone(state);
  let remaining = deltaMs;
  while (remaining > 0 && (next.status === "countdown" || next.status === "active")) {
    const step = Math.min(TIMING.tickMs, remaining);
    remaining -= step;
    if (next.status === "countdown") {
      next.countdownMs -= step;
      if (next.countdownMs <= 0) {
        next.countdownMs = 0;
        next.status = "active";
        next.elapsedMs = 0;
      }
    } else {
      stepActive(next, step);
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Snapshots & misc

/** Viewer-specific, serializable, stripped of solutions and future hazards. */
export function getSnapshot(state: MatchState, viewerId: string): PublicMatchSnapshot {
  const viewer = findPlayer(state, viewerId);
  const now = state.elapsedMs;
  const hazards: PublicHazard[] = [];
  if (state.status === "active" || state.status === "finished") {
    for (const hz of state.hazards) {
      const ship = findShip(state, hz.shipId);
      if (!ship) continue;
      const strikesInMs = hz.atMs - now;
      const visibleWarning = !hz.resolved && strikesInMs > 0 && strikesInMs <= hz.warnMs && hazardsActiveFor(ship);
      const recent = hz.resolved && now - hz.atMs <= RESOLVED_HAZARD_VISIBLE_MS;
      if (!visibleWarning && !recent) continue;
      const pub: PublicHazard = { id: hz.id, type: hz.type, shipId: hz.shipId, strikesInMs, resolved: hz.resolved };
      if (hz.resolved) pub.damageDealt = hz.damageDealt ?? 0;
      hazards.push(pub);
    }
  }
  const tasks: PublicPlayerTask[] = state.tasks.map((t) => {
    const entry: PublicPlayerTask = {
      assignedId: t.id, playerId: t.playerId, taskId: t.taskId, attempts: t.attempts,
    };
    if (t.completedAtMs !== undefined) entry.completedAtMs = t.completedAtMs;
    if (t.playerId === viewerId) entry.instance = clone(t.instance.public);
    return entry;
  });
  return {
    id: state.id,
    mode: state.mode,
    difficulty: state.difficulty,
    status: state.status,
    elapsedMs: state.elapsedMs,
    countdownMs: state.countdownMs,
    serverTime: Date.now(),
    viewerId,
    viewerShipId: viewer?.shipId ?? "",
    spacecraft: state.spacecraft.map((s) => ({ ...clone(s), derived: calculateStatsImpl(s) })),
    players: clone(state.players),
    tasks,
    hazards,
    events: clone(state.events),
    winnerId: state.winnerId,
    outcome: state.outcome ? clone(state.outcome) : undefined,
    tutorial: state.tutorial,
  };
}

export function allPlayersReady(state: MatchState): boolean {
  return state.players.length > 0 && state.players.every((p) => p.ready);
}

export function setPlayerConnected(state: MatchState, playerId: string, connected: boolean): MatchState {
  const p = findPlayer(state, playerId);
  if (!p || p.connected === connected) return state;
  const next = clone(state);
  const np = findPlayer(next, playerId);
  if (np) np.connected = connected;
  return next;
}

export function abandonMatch(state: MatchState, reason: string): MatchState {
  if (state.status === "finished") return state;
  const next = clone(state);
  next.status = "finished";
  next.outcome = { kind: "abandoned", reason };
  pushEvent(next, { kind: "match-end" });
  return next;
}

// Read-only helpers the client may use for display (never authoritative):
export function calculateStats(ship: SpacecraftState): DerivedShipStats {
  return calculateStatsImpl(ship);
}
export function canPurchase(state: MatchState, playerId: string, equipmentId: EquipmentId): ValidationResult {
  return canPurchaseImpl(state, playerId, equipmentId);
}
export function abilityCost(state: MatchState, shipId: string, abilityId: AbilityId): number {
  return abilityCostImpl(state, shipId, abilityId);
}
export function canActivateAbility(state: MatchState, playerId: string, abilityId: AbilityId, targetShipId?: string): ValidationResult {
  return canActivateAbilityImpl(state, playerId, abilityId, targetShipId);
}
export function canRepair(state: MatchState, playerId: string): ValidationResult {
  return canRepairImpl(state, playerId);
}
