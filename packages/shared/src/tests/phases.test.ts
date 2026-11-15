import { describe, expect, it } from "vitest";
import { FIRST_HAZARD_MIN_MS, ROUTE_DISTANCE, TIMING } from "../index";
import { advance, allPlayersReady, getSnapshot, startCountdown } from "../simulation/engine";
import { launch, must, newMatch, noHazards, runUntil, ship, withShip } from "./helpers";

describe("phases & lifecycle", () => {
  it("countdown → active", () => {
    let s = newMatch("solo");
    s = must(s, { type: "SET_READY", playerId: "p1", ready: true });
    expect(allPlayersReady(s)).toBe(true);
    s = startCountdown(s);
    expect(s.status).toBe("countdown");
    expect(s.countdownMs).toBe(TIMING.countdownMs);
    s = advance(s, TIMING.countdownMs - 50);
    expect(s.status).toBe("countdown");
    s = advance(s, 50);
    expect(s.status).toBe("active");
    expect(s.elapsedMs).toBe(0);
  });

  it("schedules hazards from the seed, after the first-hazard minimum, before simulation", () => {
    const a = startCountdown(newMatch("solo", 42));
    const b = startCountdown(newMatch("solo", 42));
    expect(a.hazards).toEqual(b.hazards);
    expect(a.hazards.length).toBeGreaterThan(5);
    for (const h of a.hazards) {
      expect(h.atMs).toBeGreaterThanOrEqual(FIRST_HAZARD_MIN_MS);
      expect(h.atMs).toBeLessThan(TIMING.simulationStartMs);
    }
  });

  it("1v1 ships receive identical hazard schedules", () => {
    const s = startCountdown(newMatch("1v1", 7));
    const h1 = s.hazards.filter((h) => h.shipId === "ship-1").map((h) => [h.type, h.atMs]);
    const h2 = s.hazards.filter((h) => h.shipId === "ship-2").map((h) => [h.type, h.atMs]);
    expect(h1).toEqual(h2);
  });

  it("star tracker extends the warning window", () => {
    let s = newMatch("1v1", 7);
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "star-tracker" });
    s = startCountdown(s);
    const w1 = s.hazards.find((h) => h.shipId === "ship-1")?.warnMs ?? 0;
    const w2 = s.hazards.find((h) => h.shipId === "ship-2")?.warnMs ?? 0;
    expect(w1 - w2).toBe(3000);
  });

  it("emits hazard warnings once and resolves hazards", () => {
    let s = launch(newMatch("solo", 99));
    const first = [...s.hazards].sort((a, b) => a.atMs - b.atMs)[0];
    s = advance(s, first.atMs + 100);
    const warnings = s.events.filter((e) => e.kind === "hazard-warning");
    expect(warnings.length).toBe(1);
    expect(s.hazards.find((h) => h.id === first.id)?.resolved).toBe(true);
    expect(ship(s).stats.hazardsEncountered).toBe(1);
  });

  it("phases are independent per ship (one on the Moon, one flying)", () => {
    let s = noHazards(launch(newMatch("1v1")));
    s = withShip(s, "ship-1", (sh) => { sh.progress = ROUTE_DISTANCE - 1; });
    s = advance(s, 2000);
    expect(ship(s, "ship-1").phase).toBe("lunar-task");
    expect(ship(s, "ship-2").phase).toBe("main-flight");
    const p2 = ship(s, "ship-2").progress;
    s = advance(s, 2000);
    expect(ship(s, "ship-2").progress).toBeGreaterThan(p2);
    expect(ship(s, "ship-1").progress).toBe(ROUTE_DISTANCE);
    expect(s.status).toBe("active");
  });

  it("keeps events bounded with increasing seq", () => {
    let s = launch(newMatch("solo", 5, "hard"));
    s = withShip(s, "ship-1", (sh) => { sh.health = 1e9; sh.maxHealth = 1e9; sh.progress = -1e6; });
    s = runUntil(s, (x) => x.elapsedMs > 230_000, 300_000, 5000);
    expect(s.events.length).toBeLessThanOrEqual(TIMING.maxEventsKept);
    for (let i = 1; i < s.events.length; i++) expect(s.events[i].seq).toBeGreaterThan(s.events[i - 1].seq);
  });

  it("snapshot hides future hazards and solutions", () => {
    let s = newMatch("1v1", 11);
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "spectrometer" });
    s = launch(s);
    s = advance(s, 30_000);
    for (const viewer of ["p1", "p2"]) {
      const snap = getSnapshot(s, viewer);
      const json = JSON.stringify(snap);
      expect(json).not.toContain("solution");
      for (const h of snap.hazards) {
        const full = s.hazards.find((x) => x.id === h.id);
        expect(full).toBeDefined();
        if (!h.resolved && full) expect(h.strikesInMs).toBeLessThanOrEqual(full.warnMs);
      }
      const visibleUnresolved = snap.hazards.filter((h) => !h.resolved).length;
      const futureTotal = s.hazards.filter((h) => !h.resolved).length;
      expect(visibleUnresolved).toBeLessThan(futureTotal);
      const own = snap.tasks.find((t) => t.playerId === viewer);
      const other = snap.tasks.find((t) => t.playerId !== viewer);
      expect(own?.instance).toBeDefined();
      expect(other?.instance).toBeUndefined();
      expect(snap.spacecraft[0].derived.baseSpeed).toBeGreaterThan(0);
    }
  });
});
