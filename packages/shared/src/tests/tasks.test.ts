import { describe, expect, it } from "vitest";
import { LUNAR_TASKS, LUNAR_TASK_IDS } from "../index";
import { generateTask } from "../tasks/generator";
import { eligibleTasks } from "../tasks/roleAssignment";
import { submissionFromSolution, validateSubmission } from "../tasks/validators";
import type { TaskInstance, TaskSubmission } from "../types";
import { startCountdown } from "../simulation/engine";
import { must, newMatch } from "./helpers";

function wrongSubmission(inst: TaskInstance): TaskSubmission {
  const pub = inst.public;
  const sol = inst.solution;
  switch (pub.taskId) {
    case "surface-analysis":
      if (sol.taskId !== "surface-analysis") throw new Error("mismatch");
      return { taskId: "surface-analysis", regionIds: sol.regionIds.slice(1) };
    case "communications":
      return { taskId: "communications", azimuth: pub.earthAzimuth + 30, elevation: pub.earthElevation };
    case "power-calibration": {
      if (sol.taskId !== "power-calibration") throw new Error("mismatch");
      const crit = pub.subsystems.find((s) => s.critical);
      if (!crit) throw new Error("no critical subsystem");
      return { taskId: "power-calibration", allocation: { ...sol.example, [crit.id]: crit.minWatts } };
    }
    case "orbit-calibration":
      if (sol.taskId !== "orbit-calibration") throw new Error("mismatch");
      return { taskId: "orbit-calibration", dvAtPeriapsis: sol.dvAtPeriapsis + 10, dvAtApoapsis: sol.dvAtApoapsis };
    case "terrain-mapping": {
      if (sol.taskId !== "terrain-mapping") throw new Error("mismatch");
      const mapping = { ...sol.mapping };
      const a = 0;
      const b = pub.cellElevations.findIndex((e) => e !== pub.cellElevations[0]);
      const tmp = mapping[a];
      mapping[a] = mapping[b];
      mapping[b] = tmp;
      return { taskId: "terrain-mapping", mapping };
    }
  }
}

describe("lunar tasks", () => {
  it("every generated task is solved by its own solution and rejects a wrong answer", () => {
    for (const id of LUNAR_TASK_IDS) {
      for (let seed = 0; seed < 300; seed++) {
        const inst = generateTask(id, seed * 7919 + 13, seed % 2 === 0);
        expect(inst.public.taskId).toBe(id);
        const good = validateSubmission(inst, submissionFromSolution(inst.solution));
        if (!good.ok) throw new Error(`${id} seed ${seed}: ${good.reason}`);
        expect(validateSubmission(inst, wrongSubmission(inst)).ok).toBe(false);
      }
    }
  });

  it("is deterministic and hint only toggles the hint field", () => {
    for (const id of LUNAR_TASK_IDS) {
      const a = generateTask(id, 555, true);
      const b = generateTask(id, 555, false);
      expect(a.public.hint).toBeTruthy();
      expect(b.public.hint).toBeUndefined();
      const { hint: _h, ...rest } = a.public;
      void _h;
      expect(rest).toEqual(b.public);
      expect(generateTask(id, 555, true)).toEqual(a);
      expect(JSON.stringify(a.public)).not.toContain("solution");
    }
  });

  it("surface analysis has 3-4 correct regions in a 3x4 grid", () => {
    for (let seed = 0; seed < 100; seed++) {
      const inst = generateTask("surface-analysis", seed, true);
      if (inst.public.taskId !== "surface-analysis" || inst.solution.taskId !== "surface-analysis") throw new Error();
      expect(inst.public.regions.length).toBe(12);
      expect(inst.solution.regionIds.length).toBeGreaterThanOrEqual(3);
      expect(inst.solution.regionIds.length).toBeLessThanOrEqual(4);
      const hinted = inst.solution.regionIds.some((r) => inst.public.hint?.includes(`region ${r} `));
      expect(hinted).toBe(true);
    }
  });

  it("power calibration cannot be solved by maxing everything", () => {
    for (let seed = 0; seed < 100; seed++) {
      const inst = generateTask("power-calibration", seed, false);
      if (inst.public.taskId !== "power-calibration") throw new Error();
      const total = inst.public.subsystems.reduce((s, x) => s + x.maxWatts, 0);
      expect(total).toBeGreaterThan(inst.public.availableWatts);
    }
  });

  it("communications start far from Earth", () => {
    for (let seed = 0; seed < 100; seed++) {
      const inst = generateTask("communications", seed, false);
      if (inst.public.taskId !== "communications") throw new Error();
      const p = inst.public;
      const sub: TaskSubmission = { taskId: "communications", azimuth: p.startAzimuth, elevation: p.startElevation };
      expect(validateSubmission(inst, sub).ok).toBe(false);
      if (/Shackleton|Malapert|Nobile/.test(p.siteName)) expect(p.earthElevation).toBeLessThanOrEqual(12);
    }
  });

  it("validators reject malformed submissions without throwing", () => {
    const inst = generateTask("terrain-mapping", 3, false);
    const bad: unknown[] = [
      null, {}, { taskId: "communications", azimuth: 1, elevation: 2 },
      { taskId: "terrain-mapping", mapping: null },
      { taskId: "terrain-mapping", mapping: { 0: "T1" } },
      { taskId: "terrain-mapping", mapping: { 99: "T1" } },
    ];
    for (const b of bad) expect(validateSubmission(inst, b as TaskSubmission).ok).toBe(false);
    const orbit = generateTask("orbit-calibration", 3, false);
    expect(validateSubmission(orbit, { taskId: "orbit-calibration", dvAtPeriapsis: Number.NaN, dvAtApoapsis: 0 }).ok).toBe(false);
    const power = generateTask("power-calibration", 3, false);
    expect(validateSubmission(power, { taskId: "power-calibration", allocation: { hacker: 5 } }).ok).toBe(false);
  });

  it("1v1 players get the same task instance", () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = startCountdown(newMatch("1v1", seed));
      const [a, b] = s.tasks;
      expect(a.taskId).toBe(b.taskId);
      expect(a.seed).toBe(b.seed);
      expect(a.instance).toEqual(b.instance);
      expect(a.playerId).not.toBe(b.playerId);
      expect(s.players.every((p) => p.taskId !== undefined)).toBe(true);
    }
  });

  it("1v1 hint differs only by spectrometer", () => {
    let s = newMatch("1v1", 3);
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "spectrometer" });
    s = startCountdown(s);
    const a = s.tasks.find((t) => t.playerId === "p1");
    const b = s.tasks.find((t) => t.playerId === "p2");
    expect(a?.instance.public.hint).toBeTruthy();
    expect(b?.instance.public.hint).toBeUndefined();
    expect(a?.instance.solution).toEqual(b?.instance.solution);
  });

  it("co-op players get different role-eligible tasks", () => {
    for (let seed = 1; seed < 60; seed++) {
      const s = startCountdown(newMatch("coop", seed));
      const pilot = s.tasks.find((t) => t.playerId === "p1");
      const eng = s.tasks.find((t) => t.playerId === "p2");
      expect(pilot && eng).toBeTruthy();
      if (!pilot || !eng) return;
      expect(pilot.taskId).not.toBe(eng.taskId);
      expect(LUNAR_TASKS[pilot.taskId].eligibleRoles).toContain("pilot");
      expect(LUNAR_TASKS[eng.taskId].eligibleRoles).toContain("engineer");
    }
    expect(eligibleTasks("pilot").sort()).toEqual(["communications", "orbit-calibration", "terrain-mapping"]);
  });
});
