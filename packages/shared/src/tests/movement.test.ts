import { describe, expect, it } from "vitest";
import { ROUTE_DISTANCE, SPACECRAFT, TIMING } from "../index";
import { advance, calculateStats } from "../simulation/engine";
import { computeVelocity } from "../simulation/movement";
import { launch, must, newMatch, noHazards, runUntil, ship, withShip } from "./helpers";

describe("movement", () => {
  it("base ship moves at reference speed", () => {
    let s = noHazards(launch(newMatch("solo")));
    expect(calculateStats(ship(s)).baseSpeed).toBeCloseTo(SPACECRAFT.referenceSpeed);
    s = advance(s, 10_000);
    expect(ship(s).progress).toBeCloseTo(SPACECRAFT.referenceSpeed * 10, 5);
  });

  it("propulsion speeds up and mass slows down", () => {
    let s = newMatch("solo");
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "solar-sail" });
    const fast = calculateStats(ship(s)).baseSpeed;
    expect(fast).toBeGreaterThan(SPACECRAFT.referenceSpeed);
    let h = newMatch("solo");
    h = must(h, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "radiation-vault" });
    expect(calculateStats(ship(h)).baseSpeed).toBeLessThan(SPACECRAFT.referenceSpeed);
  });

  it("thruster burn adds speed; stun stops; slow-immunity ignores slows", () => {
    let s = noHazards(launch(newMatch("solo")));
    const base = computeVelocity(ship(s));
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "thruster-burn" });
    expect(computeVelocity(ship(s))).toBeCloseTo(base * 1.45);
    const stunned = withShip(s, "ship-1", (sh) => {
      sh.effects.push({ id: "x", type: "stunned", magnitude: 1, remainingMs: 1000, durationMs: 1000 });
    });
    expect(computeVelocity(ship(stunned))).toBe(0);
    const slowed = withShip(s, "ship-1", (sh) => {
      sh.effects = [
        { id: "a", type: "speed-multiplier", magnitude: -0.4, remainingMs: 1000, durationMs: 1000 },
        { id: "b", type: "slow-immunity", magnitude: 1, remainingMs: 1000, durationMs: 1000 },
      ];
    });
    expect(computeVelocity(ship(slowed))).toBeCloseTo(base);
  });

  it("an unequipped ship arrives in about route/referenceSpeed seconds", () => {
    let s = noHazards(launch(newMatch("solo")));
    s = runUntil(s, (x) => ship(x).phase === "lunar-task", 400_000, 500);
    expect(ship(s).phase).toBe("lunar-task");
    const expected = (ROUTE_DISTANCE / SPACECRAFT.referenceSpeed) * 1000;
    expect(Math.abs((ship(s).arrivedAtMs ?? 0) - expected)).toBeLessThanOrEqual(TIMING.tickMs * 2);
  });

  it("reaches the Moon via accelerated simulation after 240s even with 0 credits", () => {
    let s = launch(newMatch("solo"));
    s = noHazards(s);
    // Put the ship far behind just before simulation starts, with no credits.
    s = withShip(s, "ship-1", (sh) => { sh.credits = 0; sh.progress = 0; });
    s = { ...s, elapsedMs: TIMING.simulationStartMs - 1000 };
    s = runUntil(s, (x) => ship(x).phase === "lunar-task", 200_000, 1000);
    const sh = ship(s);
    expect(sh.phase).toBe("lunar-task");
    expect(sh.stats.timeInSimulationMs).toBeGreaterThan(0);
    expect(sh.stats.autoSimPurchases).toBe(0);
    // ×6 speed: 150 units at 4.5u/s ≈ 34s.
    expect((sh.arrivedAtMs ?? 0) - TIMING.simulationStartMs).toBeLessThan(40_000);
  });

  it("auto-sim buys boosters when affordable", () => {
    let s = noHazards(launch(newMatch("solo")));
    s = withShip(s, "ship-1", (sh) => { sh.progress = 0; });
    s = { ...s, elapsedMs: TIMING.simulationStartMs - 100 };
    s = advance(s, 1000);
    const sh = ship(s);
    expect(sh.phase).toBe("simulation");
    expect(sh.stats.autoSimPurchases).toBeGreaterThanOrEqual(2);
    expect(sh.stats.abilitiesUsed["gravity-assist"]).toBe(1);
    expect(sh.stats.abilitiesUsed["thruster-burn"]).toBe(1);
  });

  it("phases advance main-flight → overtime → simulation for a slow ship", () => {
    let s = noHazards(launch(newMatch("solo")));
    s = withShip(s, "ship-1", (sh) => { sh.progress = -1000; sh.credits = 0; });
    s = advance(s, TIMING.mainFlightMs + 100);
    expect(ship(s).phase).toBe("overtime");
    s = advance(s, TIMING.overtimeMs);
    expect(ship(s).phase).toBe("simulation");
    expect(s.events.some((e) => e.kind === "phase" && e.phase === "overtime")).toBe(true);
  });
});
