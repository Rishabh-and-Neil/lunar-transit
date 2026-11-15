import { describe, expect, it } from "vitest";
import { ROUTE_DISTANCE } from "../index";
import { abandonMatch, advance, getSnapshot } from "../simulation/engine";
import { submissionFromSolution } from "../tasks/validators";
import type { MatchState, TaskSubmission } from "../types";
import { cmd, launch, must, newMatch, noHazards, ship, withShip } from "./helpers";

function arrive(state: MatchState, shipId: string): MatchState {
  const s = withShip(state, shipId, (sh) => { sh.progress = ROUTE_DISTANCE - 0.01; });
  return advance(s, 100);
}

function solutionFor(state: MatchState, playerId: string): TaskSubmission {
  const t = state.tasks.find((x) => x.playerId === playerId);
  if (!t) throw new Error("no task");
  return submissionFromSolution(t.instance.solution);
}

function wrongFor(state: MatchState, playerId: string): TaskSubmission {
  const sub = solutionFor(state, playerId);
  switch (sub.taskId) {
    case "surface-analysis": return { ...sub, regionIds: [] };
    case "communications": return { ...sub, azimuth: sub.azimuth + 90 };
    case "power-calibration": return { ...sub, allocation: {} };
    case "orbit-calibration": return { ...sub, dvAtPeriapsis: sub.dvAtPeriapsis + 20 };
    case "terrain-mapping": return { ...sub, mapping: {} };
  }
}

describe("victory", () => {
  it("solo: task completion finishes the match", () => {
    let s = noHazards(launch(newMatch("solo")));
    // Can't submit before arrival.
    expect(cmd(s, { type: "SUBMIT_TASK", playerId: "p1", submission: solutionFor(s, "p1") }).ok).toBe(false);
    s = advance(s, 5000);
    s = arrive(s, "ship-1");
    expect(ship(s).phase).toBe("lunar-task");
    s = must(s, { type: "SUBMIT_TASK", playerId: "p1", submission: wrongFor(s, "p1") });
    expect(s.tasks[0].attempts).toBe(1);
    expect(s.status).toBe("active");
    expect(s.events.some((e) => e.kind === "task-failed-attempt")).toBe(true);
    s = advance(s, 1000);
    s = must(s, { type: "SUBMIT_TASK", playerId: "p1", submission: solutionFor(s, "p1") });
    expect(s.tasks[0].attempts).toBe(2);
    expect(s.status).toBe("finished");
    expect(ship(s).phase).toBe("task-complete");
    expect(s.outcome).toEqual({ kind: "solo-complete", totalMs: s.tasks[0].completedAtMs });
    expect(s.events.some((e) => e.kind === "match-end")).toBe(true);
    // Finished: advance is a no-op, commands rejected.
    expect(advance(s, 1000)).toBe(s);
    expect(cmd(s, { type: "SET_READY", playerId: "p1", ready: true }).ok).toBe(false);
  });

  it("solo: destruction", () => {
    let s = launch(newMatch("solo"));
    s = withShip(s, "ship-1", (sh) => { sh.health = 0.01; });
    s = advance(s, 60_000);
    expect(ship(s).phase).toBe("destroyed");
    expect(s.status).toBe("finished");
    expect(s.outcome?.kind).toBe("solo-destroyed");
  });

  it("1v1: first completion wins regardless of arrival order", () => {
    let s = noHazards(launch(newMatch("1v1")));
    s = arrive(s, "ship-1");
    s = advance(s, 3000);
    s = arrive(s, "ship-2");
    // Only the assigned player may submit their task.
    expect(cmd(s, { type: "SUBMIT_TASK", playerId: "p1", submission: wrongFor(s, "p1") }).ok).toBe(true);
    s = must(s, { type: "SUBMIT_TASK", playerId: "p2", submission: solutionFor(s, "p2") });
    expect(s.status).toBe("finished");
    expect(s.winnerId).toBe("p2");
    expect(s.outcome?.kind).toBe("1v1-task");
  });

  it("1v1: player cannot submit while still flying", () => {
    let s = noHazards(launch(newMatch("1v1")));
    s = arrive(s, "ship-1");
    const r = cmd(s, { type: "SUBMIT_TASK", playerId: "p2", submission: solutionFor(s, "p2") });
    expect(r.ok).toBe(false);
  });

  it("1v1: destruction gives the opponent the win immediately", () => {
    let s = launch(newMatch("1v1"));
    s = withShip(s, "ship-1", (sh) => { sh.health = 5; });
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p2", abilityId: "debris-scatter", targetShipId: "ship-1" });
    expect(ship(s, "ship-1").phase).toBe("destroyed");
    expect(s.status).toBe("finished");
    expect(s.winnerId).toBe("p2");
    expect(s.outcome).toMatchObject({ kind: "1v1-destroyed", winnerId: "p2", loserId: "p1" });
  });

  it("co-op: both tasks required", () => {
    let s = noHazards(launch(newMatch("coop")));
    s = arrive(s, "ship-1");
    expect(ship(s).phase).toBe("lunar-task");
    s = must(s, { type: "SUBMIT_TASK", playerId: "p1", submission: solutionFor(s, "p1") });
    expect(s.status).toBe("active");
    expect(ship(s).phase).toBe("lunar-task");
    s = advance(s, 2000);
    s = must(s, { type: "SUBMIT_TASK", playerId: "p2", submission: solutionFor(s, "p2") });
    expect(ship(s).phase).toBe("task-complete");
    expect(s.status).toBe("finished");
    expect(s.outcome?.kind).toBe("coop-complete");
    if (s.outcome?.kind === "coop-complete") expect(s.outcome.totalMs).toBe(s.elapsedMs);
  });

  it("co-op: destruction fails the mission", () => {
    let s = launch(newMatch("coop"));
    s = withShip(s, "ship-1", (sh) => { sh.health = 0.01; });
    s = advance(s, 60_000);
    expect(s.outcome?.kind).toBe("coop-destroyed");
  });

  it("abandon", () => {
    const s = abandonMatch(launch(newMatch("1v1")), "all players left");
    expect(s.status).toBe("finished");
    expect(s.outcome).toEqual({ kind: "abandoned", reason: "all players left" });
    expect(getSnapshot(s, "p1").outcome?.kind).toBe("abandoned");
  });
});
