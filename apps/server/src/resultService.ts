// Builds end-of-match payloads and log lines.
import { getSnapshot } from "@sm/shared";
import type { MatchOutcome, MatchResultPayload, MatchState } from "@sm/shared";

export function outcomeOf(state: MatchState): MatchOutcome {
  return state.outcome ?? { kind: "abandoned", reason: "unknown" };
}

/** Viewer-specific result (own snapshot). */
export function buildResult(state: MatchState, playerId: string): MatchResultPayload {
  return { matchId: state.id, outcome: outcomeOf(state), snapshot: getSnapshot(state, playerId) };
}

export function describeOutcome(state: MatchState): string {
  const o = outcomeOf(state);
  const name = (id: string): string => state.players.find((p) => p.id === id)?.name ?? id;
  const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
  switch (o.kind) {
    case "solo-complete":
    case "coop-complete":
      return `${o.kind} in ${secs(o.totalMs)}`;
    case "solo-destroyed":
    case "coop-destroyed":
      return `${o.kind} at ${secs(o.atMs)}`;
    case "1v1-task":
      return `1v1 won by ${name(o.winnerId)} (task) in ${secs(o.totalMs)}`;
    case "1v1-destroyed":
      return `1v1 won by ${name(o.winnerId)} (${name(o.loserId)} destroyed at ${secs(o.atMs)})`;
    case "abandoned":
      return `abandoned (${o.reason})`;
  }
}
