// Deterministic replay of a solo run, used by the server to verify leaderboard submissions.
// The browser records every command with the engine tick it was applied at; replaying the same
// seed + commands through the same engine must reproduce the same outcome.
import { z } from "zod";
import { TIMING } from "../config/timing";
import { zClientId, zName, zDifficulty } from "../protocol";
import type { Difficulty, MatchState, PlayerCommand } from "../types";
import { advance, allPlayersReady, applyCommand, createMatch, startCountdown } from "./engine";

/** A command as recorded by the browser (no commandId / playerId: those are filled in on replay). */
export type RecordedCommand = { tick: number; cmd: Record<string, unknown> & { type: PlayerCommand["type"] } };

export interface SoloRunRecord {
  v: 1;
  seed: number;
  difficulty: Difficulty;
  name: string;
  /** The browser's lasting player id: one leaderboard entry per player per board. */
  clientId?: string;
  commands: RecordedCommand[];
}

export const REPLAY_LIMITS = {
  maxCommands: 600,
  /** Hard cap on simulated ticks (countdown + 4 min flight + generous task time). */
  maxTicks: Math.ceil((TIMING.countdownMs + 15 * 60_000) / TIMING.tickMs),
} as const;

export const zSoloRunRecord = z.object({
  v: z.literal(1),
  seed: z.number().int().min(0).max(2 ** 32),
  difficulty: zDifficulty,
  name: zName,
  clientId: zClientId.optional(),
  commands: z
    .array(
      z.object({
        tick: z.number().int().min(0).max(REPLAY_LIMITS.maxTicks),
        cmd: z.object({ type: z.enum(["PURCHASE_EQUIPMENT", "SELL_EQUIPMENT", "SET_READY", "ACTIVATE_ABILITY", "ACTIVATE_REPAIR", "SUBMIT_TASK"]) }).passthrough(),
      }),
    )
    .max(REPLAY_LIMITS.maxCommands),
});

export type ReplayResult =
  | { ok: true; totalMs: number; state: MatchState }
  | { ok: false; reason: string };

const PLAYER = "replay-player";

/** Re-simulates a recorded solo run. Mirrors LocalTransport exactly. */
export function replaySoloRun(rec: SoloRunRecord): ReplayResult {
  let state = createMatch({
    id: "replay",
    mode: "solo",
    difficulty: rec.difficulty,
    seed: rec.seed,
    players: [{ id: PLAYER, name: rec.name, role: "solo" }],
  });
  const cmds = [...rec.commands].sort((a, b) => a.tick - b.tick);
  for (let i = 1; i < cmds.length; i++) if (cmds[i].tick < cmds[i - 1].tick) return { ok: false, reason: "commands out of order" };
  let tick = 0;
  let next = 0;
  let n = 0;
  const apply = (c: RecordedCommand) => {
    const full = { ...c.cmd, commandId: `r${n++}`, playerId: PLAYER } as PlayerCommand;
    state = applyCommand(state, full).state;
    if (state.status === "preparation" && allPlayersReady(state)) state = startCountdown(state);
  };
  // preparation commands all carry tick 0 (the loop has not started)
  while (next < cmds.length && cmds[next].tick === 0 && state.status === "preparation") apply(cmds[next++]);
  if (state.status === "preparation") return { ok: false, reason: "run never launched" };
  while (tick < REPLAY_LIMITS.maxTicks && (state.status === "countdown" || state.status === "active")) {
    while (next < cmds.length && cmds[next].tick === tick) apply(cmds[next++]);
    if ((state.status as MatchState["status"]) === "finished") break;
    state = advance(state, TIMING.tickMs);
    tick++;
  }
  // commands recorded after the final tick (e.g. the winning task submission) apply to the last state
  while (next < cmds.length && state.status !== "finished") apply(cmds[next++]);
  const o = state.outcome;
  if (!o) return { ok: false, reason: "run did not finish" };
  if (o.kind !== "solo-complete") return { ok: false, reason: `run ended as ${o.kind}` };
  return { ok: true, totalMs: o.totalMs, state };
}
