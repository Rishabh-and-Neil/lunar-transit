import { describe, expect, it } from "vitest";
import { TIMING } from "../config/timing";
import { advance, allPlayersReady, applyCommand, createMatch, startCountdown } from "../simulation/engine";
import { replaySoloRun, type RecordedCommand, type SoloRunRecord } from "../simulation/replay";
import { submissionFromSolution } from "../tasks/validators";
import type { MatchState, PlayerCommand } from "../types";

/** Plays a solo run exactly the way the browser's LocalTransport does, recording commands with ticks. */
function playLikeBrowser(seed: number, difficulty: "easy" | "normal" | "hard", taskDelayTicks = 40): { rec: SoloRunRecord; state: MatchState } {
  const pid = "browser-player";
  let state = createMatch({ id: "local", mode: "solo", difficulty, seed, players: [{ id: pid, name: "Tester", role: "solo" }] });
  const log: RecordedCommand[] = [];
  let ticks = 0;
  let n = 0;
  const send = (cmd: RecordedCommand["cmd"]) => {
    log.push({ tick: ticks, cmd: { ...cmd } });
    state = applyCommand(state, { ...cmd, commandId: `b${n++}`, playerId: pid } as PlayerCommand).state;
    if (state.status === "preparation" && allPlayersReady(state)) state = startCountdown(state);
  };
  for (const equipmentId of ["ion-thruster", "chemical-booster", "repair-drone"]) send({ type: "PURCHASE_EQUIPMENT", equipmentId });
  send({ type: "SELL_EQUIPMENT", equipmentId: "repair-drone" });
  send({ type: "SET_READY", ready: true });
  let landedAt = -1;
  while (state.status !== "finished" && ticks < 20_000) {
    const ship = state.spacecraft[0];
    if (state.status === "active" && ticks % 37 === 0) send({ type: "ACTIVATE_ABILITY", abilityId: ticks % 2 ? "thruster-burn" : "gravity-assist" });
    if (ship.phase === "lunar-task") {
      if (landedAt < 0) landedAt = ticks;
      if (ticks - landedAt === taskDelayTicks) {
        const task = state.tasks.find((t) => t.playerId === pid);
        if (task) send({ type: "SUBMIT_TASK", submission: submissionFromSolution(task.instance.solution) });
      }
    }
    if ((state.status as MatchState["status"]) === "finished") break;
    state = advance(state, TIMING.tickMs);
    ticks++;
  }
  return { rec: { v: 1, seed, difficulty, name: "Tester", commands: log }, state };
}

describe("solo run replay (leaderboard verification)", () => {
  for (const [seed, diff] of [[11, "easy"], [22, "normal"], [33, "hard"], [44, "normal"]] as const) {
    it(`reproduces the exact finish time (seed ${seed}, ${diff})`, () => {
      const { rec, state } = playLikeBrowser(seed, diff);
      const o = state.outcome;
      expect(o?.kind).toBe("solo-complete");
      if (!o || o.kind !== "solo-complete") return;
      const r = replaySoloRun(rec);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.totalMs).toBe(o.totalMs);
    });
  }

  it("rejects a run that never solves the task", () => {
    const { rec } = playLikeBrowser(22, "normal");
    const tampered = { ...rec, commands: rec.commands.filter((c) => c.cmd.type !== "SUBMIT_TASK") };
    expect(replaySoloRun(tampered).ok).toBe(false);
  });

  it("a different seed cannot reuse someone else's commands", () => {
    const { rec } = playLikeBrowser(22, "normal");
    const r = replaySoloRun({ ...rec, seed: 999 });
    // the recorded task answer belongs to seed 22's task, so seed 999's task is not solved
    expect(r.ok).toBe(false);
  });

  it("time comes from the replay, not from anything the client claims", () => {
    const { rec, state } = playLikeBrowser(11, "easy", 200);
    const r = replaySoloRun(rec);
    expect(r.ok).toBe(true);
    if (r.ok && state.outcome?.kind === "solo-complete") expect(r.totalMs).toBe(state.outcome.totalMs);
  });

  it("rejects a run that never launched", () => {
    expect(replaySoloRun({ v: 1, seed: 1, difficulty: "normal", name: "x", commands: [] }).ok).toBe(false);
  });
});
