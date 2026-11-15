import { advance, applyCommand, createMatch, startCountdown } from "../simulation/engine";
import { TIMING } from "../config/timing";
import type { CommandResult, Difficulty, GameMode, MatchState, PlayerCommand, SpacecraftState } from "../types";

let counter = 0;
export function nextId(): string {
  counter += 1;
  return `cmd-${counter}`;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandInput = DistributiveOmit<PlayerCommand, "commandId">;

export function cmd(state: MatchState, command: CommandInput): CommandResult {
  return applyCommand(state, { ...command, commandId: nextId() } as PlayerCommand);
}

/** Apply and expect success; returns new state. */
export function must(state: MatchState, command: CommandInput): MatchState {
  const r = cmd(state, command);
  if (!r.ok) throw new Error(`command ${command.type} rejected: ${r.reason}`);
  return r.state;
}

export function newMatch(mode: GameMode, seed = 1234, difficulty: Difficulty = "normal"): MatchState {
  const players =
    mode === "solo" ? [{ id: "p1", name: "Ada", role: "solo" as const }]
      : mode === "1v1" ? [{ id: "p1", name: "Ada", role: "competitor" as const }, { id: "p2", name: "Bo", role: "competitor" as const }]
        : [{ id: "p1", name: "Ada", role: "pilot" as const }, { id: "p2", name: "Bo", role: "engineer" as const }];
  return createMatch({ id: `m-${mode}`, mode, difficulty, seed, players });
}

/** preparation → active (elapsed 0). */
export function launch(state: MatchState): MatchState {
  return advance(startCountdown(state), TIMING.countdownMs);
}

export function ship(state: MatchState, id = "ship-1"): SpacecraftState {
  const s = state.spacecraft.find((x) => x.id === id);
  if (!s) throw new Error(`no ship ${id}`);
  return s;
}

/** Mutating helper for tests: edit a ship in a cloned state. */
export function withShip(state: MatchState, id: string, fn: (s: SpacecraftState) => void): MatchState {
  const next = structuredClone(state);
  fn(ship(next, id));
  return next;
}

/** Advance until predicate holds or limit reached. */
export function runUntil(state: MatchState, pred: (s: MatchState) => boolean, limitMs = 400_000, stepMs = 1000): MatchState {
  let s = state;
  let t = 0;
  while (!pred(s) && t < limitMs) {
    s = advance(s, stepMs);
    t += stepMs;
  }
  return s;
}

/** Remove all hazards (for deterministic movement tests). */
export function noHazards(state: MatchState): MatchState {
  return { ...state, hazards: [] };
}
