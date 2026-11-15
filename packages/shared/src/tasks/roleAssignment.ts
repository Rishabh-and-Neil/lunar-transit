// Lunar task assignment per mode/role.
import { createRng, hashSeed } from "../rng";
import type { AssignedTask, GameMode, LunarTaskId, PlayerRole } from "../types";
import { LUNAR_TASKS, LUNAR_TASK_IDS } from "./definitions";
import { generateTask } from "./generator";

export function eligibleTasks(role: PlayerRole): LunarTaskId[] {
  return LUNAR_TASK_IDS.filter((id) => (LUNAR_TASKS[id].eligibleRoles as PlayerRole[]).includes(role));
}

export interface TaskAssignmentInput {
  mode: GameMode;
  seed: number;
  players: { id: string; role: PlayerRole }[];
  /** Whether a player's ship carries a spectrometer. */
  hasHint: (playerId: string) => boolean;
}

export function assignedTaskId(playerId: string): string {
  return `task-${playerId}`;
}

function makeTask(playerId: string, taskId: LunarTaskId, seed: number, withHint: boolean): AssignedTask {
  return {
    id: assignedTaskId(playerId), taskId, playerId, seed,
    instance: generateTask(taskId, seed, withHint), attempts: 0,
  };
}

/**
 * solo: one random task. 1v1: one task id + one seed shared by both players.
 * coop: pilot and engineer get two different role-eligible tasks.
 */
export function assignTasks(input: TaskAssignmentInput): AssignedTask[] {
  const rng = createRng(hashSeed(input.seed, "task-assignment", input.mode));
  const taskSeed = (salt: string): number => hashSeed(input.seed, "task-seed", salt, rng.int(0, 1_000_000));

  if (input.mode === "coop") {
    const out: AssignedTask[] = [];
    const taken = new Set<LunarTaskId>();
    // Assign the most constrained role first (pilot then engineer, others after).
    const order = [...input.players].sort((a, b) => rank(a.role) - rank(b.role));
    for (const p of order) {
      const pool = eligibleTasks(p.role).filter((t) => !taken.has(t));
      const choice = rng.pick(pool.length > 0 ? pool : LUNAR_TASK_IDS.filter((t) => !taken.has(t)));
      taken.add(choice);
      out.push(makeTask(p.id, choice, taskSeed(p.id), input.hasHint(p.id)));
    }
    return out;
  }

  const role: PlayerRole = input.mode === "1v1" ? "competitor" : "solo";
  const taskId = rng.pick(eligibleTasks(role));
  const seed = taskSeed("shared");
  return input.players.map((p) => makeTask(p.id, taskId, seed, input.hasHint(p.id)));
}

function rank(role: PlayerRole): number {
  return role === "pilot" ? 0 : role === "engineer" ? 1 : 2;
}
