import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LEADERBOARD_LAUNCH_AT, TIMING, advance, allPlayersReady, applyCommand, createMatch, startCountdown, submissionFromSolution,
  type LeaderboardBoard, type MatchState, type PlayerCommand, type RecordedCommand, type SoloRunRecord, type SubmitResult,
} from "@sm/shared";
import { startServer, type RunningServer } from "../src/app";
import { LeaderboardService } from "../src/leaderboard";

/** Plays a solo run like the browser does and returns its replay record. */
function playRun(seed: number, name = "Ace", clientId?: string): SoloRunRecord {
  const pid = "p";
  let state: MatchState = createMatch({ id: "l", mode: "solo", difficulty: "normal", seed, players: [{ id: pid, name, role: "solo" }] });
  const log: RecordedCommand[] = [];
  let ticks = 0;
  let n = 0;
  const send = (cmd: RecordedCommand["cmd"]) => {
    log.push({ tick: ticks, cmd });
    state = applyCommand(state, { ...cmd, commandId: `c${n++}`, playerId: pid } as PlayerCommand).state;
    if (state.status === "preparation" && allPlayersReady(state)) state = startCountdown(state);
  };
  send({ type: "PURCHASE_EQUIPMENT", equipmentId: "ion-thruster" });
  send({ type: "SET_READY", ready: true });
  while (state.status !== "finished" && ticks < 20_000) {
    if (state.status === "active" && ticks % 40 === 0) send({ type: "ACTIVATE_ABILITY", abilityId: "gravity-assist" });
    const task = state.tasks.find((t) => t.playerId === pid);
    if (state.spacecraft[0].phase === "lunar-task" && task) send({ type: "SUBMIT_TASK", submission: submissionFromSolution(task.instance.solution) });
    if ((state.status as MatchState["status"]) === "finished") break;
    state = advance(state, TIMING.tickMs);
    ticks++;
  }
  return { v: 1, seed, difficulty: "normal", name, ...(clientId ? { clientId } : {}), commands: log };
}

let server: RunningServer;
let url = "";
let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lb-"));
  const leaderboard = new LeaderboardService(() => undefined, { file: join(dir, "lb.json"), submissionsPerMinute: 100 });
  server = await startServer(0, { log: () => undefined, leaderboard, staticDir: null });
  url = `http://localhost:${server.port}`;
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: unknown) => fetch(`${url}/api/leaderboard/solo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("leaderboard API", () => {
  it("serves empty boards for every mode and difficulty", async () => {
    for (const mode of ["solo", "coop"]) for (const difficulty of ["easy", "normal", "hard"]) {
      const b = (await (await fetch(`${url}/api/leaderboard?mode=${mode}&difficulty=${difficulty}`)).json()) as LeaderboardBoard;
      expect(b.entries).toEqual([]);
      expect(b.total).toBe(0);
    }
    expect((await fetch(`${url}/api/leaderboard?mode=1v1&difficulty=normal`)).status).toBe(400);
  });

  it("verifies a real solo run by replay and ranks it", async () => {
    const res = await post(playRun(5, "Ace"));
    const body = (await res.json()) as SubmitResult;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rank).toBe(1);
    expect(body.entry?.names).toEqual(["Ace"]);
    expect(body.entry?.loadout).toContain("Ion Thruster");
    const board = (await (await fetch(`${url}/api/leaderboard?mode=solo&difficulty=normal`)).json()) as LeaderboardBoard;
    expect(board.entries[0].timeMs).toBe(body.entry?.timeMs);
  });

  it("rejects submitting the same run twice", async () => {
    const res = await post(playRun(5, "Ace"));
    expect(res.status).toBe(422);
    expect(((await res.json()) as SubmitResult).reason).toMatch(/already/);
  });

  it("rejects a tampered run (task never solved)", async () => {
    const rec = playRun(6, "Cheater");
    rec.commands = rec.commands.filter((c) => c.cmd.type !== "SUBMIT_TASK");
    const res = await post(rec);
    expect(res.status).toBe(422);
    expect(((await res.json()) as SubmitResult).ok).toBe(false);
  });

  it("rejects malformed bodies", async () => {
    expect((await post({ hello: "world" })).status).toBe(422);
  });

  it("imports a personal best saved before leaderboards launched, once, marked as an earlier run", async () => {
    const best = { mode: "solo", difficulty: "hard", name: "Old Timer", totalMs: 140_000, setAt: LEADERBOARD_LAUNCH_AT - 86_400_000, attachments: ["ion-thruster", "made-up"] };
    const imp = (b: unknown) => fetch(`${url}/api/leaderboard/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const res = await imp(best);
    const body = (await res.json()) as SubmitResult;
    expect(res.status).toBe(200);
    expect(body.rank).toBe(1);
    expect(body.entry?.imported).toBe(true);
    expect(body.entry?.loadout).toEqual(["Ion Thruster"]);
    expect(body.entry?.at).toBe(best.setAt);
    // uploading it again is refused; a slower one under the same name keeps the existing row
    expect((await imp(best)).status).toBe(422);
    expect(((await (await imp({ ...best, totalMs: 150_000 })).json()) as SubmitResult).kept).toBe(true);
    // set after launch, impossibly fast, or malformed: refused
    expect((await imp({ ...best, name: "Late", setAt: LEADERBOARD_LAUNCH_AT + 1 })).status).toBe(422);
    expect((await imp({ ...best, name: "Speedy", totalMs: 5_000 })).status).toBe(422);
    expect((await imp({ nope: 1 })).status).toBe(422);
    const board = (await (await fetch(`${url}/api/leaderboard?mode=solo&difficulty=hard`)).json()) as LeaderboardBoard;
    expect(board.entries.map((e) => [e.names[0], e.imported])).toEqual([["Old Timer", true]]);
  });

  it("keeps one row per player per board: only their best", async () => {
    const board = async () => ((await (await fetch(`${url}/api/leaderboard?mode=solo&difficulty=normal`)).json()) as LeaderboardBoard).entries;
    const runs = [7, 8, 9].map((seed) => playRun(seed, "Rishabh", "client-rishabh-1"));
    const results: SubmitResult[] = [];
    for (const r of runs) results.push((await (await post(r)).json()) as SubmitResult);
    const times = results.map((r) => r.entry!.timeMs);
    const rows = (await board()).filter((e) => e.names[0] === "Rishabh");
    expect(rows).toHaveLength(1);
    expect(rows[0].timeMs).toBe(Math.min(...times));
    // a slower run reports the kept best
    const slowest = results.findIndex((r) => r.entry!.timeMs === Math.max(...times));
    if (slowest > 0) expect(results[slowest].kept).toBe(true);
    // the same name from a different browser is a different player
    await post(playRun(10, "Rishabh", "client-rishabh-2"));
    expect((await board()).filter((e) => e.names[0] === "Rishabh")).toHaveLength(2);
  });

  it("a player's browser takes over the row recorded under their name before ids existed", async () => {
    const res = (await (await post(playRun(5, "Ace", "client-ace"))).json()) as SubmitResult;
    // same commands + seed as the earlier "Ace" run: duplicate run, refused
    expect(res.ok).toBe(false);
    const r2 = (await (await post(playRun(11, "Ace", "client-ace"))).json()) as SubmitResult;
    expect(r2.ok).toBe(true);
    const aces = ((await (await fetch(`${url}/api/leaderboard?mode=solo&difficulty=normal`)).json()) as LeaderboardBoard).entries.filter((e) => e.names[0] === "Ace");
    expect(aces).toHaveLength(1);
  });

  it("records finished co-op missions from server state", async () => {
    let s = createMatch({ id: "coop-1", mode: "coop", difficulty: "easy", seed: 3, players: [{ id: "a", name: "Pilot P", role: "pilot" }, { id: "b", name: "Eng E", role: "engineer" }] });
    s = { ...s, status: "finished", outcome: { kind: "coop-complete", totalMs: 150_000 } };
    const r = await server.leaderboard.recordCoop(s);
    expect(r?.rank).toBe(1);
    const board = (await (await fetch(`${url}/api/leaderboard?mode=coop&difficulty=easy`)).json()) as LeaderboardBoard;
    expect(board.entries[0].names).toEqual(["Pilot P", "Eng E"]);
  });
});

describe("leaderboard storage migration", () => {
  it("collapses old duplicate rows to each name's best", async () => {
    const d = mkdtempSync(join(tmpdir(), "lbm-"));
    const file = join(d, "lb.json");
    const row = (id: string, name: string, timeMs: number) => ({ id, mode: "solo", difficulty: "normal", names: [name], timeMs, at: 1, loadout: [], fingerprint: id });
    writeFileSync(file, JSON.stringify([row("a", "Rishabh", 113_300), row("b", "Rishabh", 111_800), row("c", "rishabh ", 117_000), row("d", "Neil", 120_000)]));
    const svc = new LeaderboardService(() => undefined, { file });
    await svc.init();
    const b = await svc.board("solo", "normal");
    expect(b.entries.map((e) => [e.names[0], e.timeMs])).toEqual([["Rishabh", 111_800], ["Neil", 120_000]]);
    rmSync(d, { recursive: true, force: true });
  });
});
