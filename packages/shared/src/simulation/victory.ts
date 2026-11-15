// Match outcome rules per mode.
import type { MatchOutcome, MatchState } from "../types";
import { pushEvent } from "./state";

function finish(state: MatchState, outcome: MatchOutcome, winnerId?: string): void {
  state.status = "finished";
  state.outcome = outcome;
  if (winnerId !== undefined) state.winnerId = winnerId;
  pushEvent(state, { kind: "match-end" });
}

function latestCompletion(state: MatchState, playerIds: string[]): number | undefined {
  const tasks = state.tasks.filter((t) => playerIds.includes(t.playerId));
  if (tasks.length === 0 || tasks.some((t) => t.completedAtMs === undefined)) return undefined;
  return Math.max(...tasks.map((t) => t.completedAtMs ?? 0));
}

/** Evaluate end conditions; mutates state when the match ends. */
export function checkVictory(state: MatchState): void {
  if (state.status !== "active") return;

  if (state.mode === "solo" || state.mode === "coop") {
    const ship = state.spacecraft[0];
    if (!ship) return;
    const solo = state.mode === "solo";
    if (ship.phase === "destroyed") {
      const atMs = ship.destroyedAtMs ?? state.elapsedMs;
      finish(state, solo ? { kind: "solo-destroyed", atMs } : { kind: "coop-destroyed", atMs });
      return;
    }
    if (ship.phase === "task-complete") {
      const totalMs = latestCompletion(state, ship.ownerIds) ?? state.elapsedMs;
      finish(state, solo ? { kind: "solo-complete", totalMs } : { kind: "coop-complete", totalMs });
    }
    return;
  }

  // 1v1: first valid task completion wins.
  const completed = state.tasks
    .filter((t) => t.completedAtMs !== undefined)
    .sort((a, b) => (a.completedAtMs ?? 0) - (b.completedAtMs ?? 0));
  const first = completed[0];
  if (first && first.completedAtMs !== undefined) {
    finish(state, { kind: "1v1-task", winnerId: first.playerId, totalMs: first.completedAtMs }, first.playerId);
    return;
  }
  const destroyed = state.spacecraft.find((s) => s.phase === "destroyed");
  if (destroyed) {
    const loserId = destroyed.ownerIds[0] ?? "";
    const winnerShip = state.spacecraft.find((s) => s.id !== destroyed.id);
    const winnerId = winnerShip?.ownerIds[0] ?? "";
    finish(state, {
      kind: "1v1-destroyed", winnerId, loserId, atMs: destroyed.destroyedAtMs ?? state.elapsedMs,
    }, winnerId);
  }
}
