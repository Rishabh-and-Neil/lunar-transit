import { describe, expect, it } from "vitest";
import { ABILITIES, REPAIR, TIMING, repairCost } from "../index";
import { advance, canActivateAbility, canRepair } from "../simulation/engine";
import { cmd, launch, must, newMatch, noHazards, ship, withShip } from "./helpers";

const flying1v1 = () => noHazards(launch(newMatch("1v1")));

describe("abilities", () => {
  it("are only usable during flight", () => {
    const prep = newMatch("solo");
    expect(cmd(prep, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "thruster-burn" }).ok).toBe(false);
    let s = launch(newMatch("solo"));
    s = withShip(s, "ship-1", (sh) => { sh.phase = "lunar-task"; });
    expect(cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "thruster-burn" }).ok).toBe(false);
  });

  it("apply cooldowns", () => {
    let s = launch(newMatch("solo"));
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "thruster-burn" });
    const again = cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "thruster-burn" });
    expect(again.ok).toBe(false);
    s = advance(s, ABILITIES["thruster-burn"].cooldownMs);
    expect(cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "thruster-burn" }).ok).toBe(true);
  });

  it("halve effect magnitude in overtime but keep durations/cooldowns", () => {
    let s = noHazards(launch(newMatch("solo")));
    s = withShip(s, "ship-1", (sh) => { sh.phase = "overtime"; sh.health = 50; });
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "thruster-burn" });
    const eff = ship(s).effects.find((e) => e.sourceAbility === "thruster-burn");
    expect(eff?.magnitude).toBeCloseTo((ABILITIES["thruster-burn"].effect?.magnitude ?? 0) * TIMING.overtimeEffectMultiplier);
    expect(eff?.durationMs).toBe(ABILITIES["thruster-burn"].effect?.durationMs);
    expect(ship(s).cooldowns["thruster-burn"]).toBe(ABILITIES["thruster-burn"].cooldownMs);
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "hull-patch" });
    expect(ship(s).health).toBeCloseTo(50 + (ABILITIES["hull-patch"].instantHeal ?? 0) * TIMING.overtimeEffectMultiplier);
    const p0 = ship(s).progress;
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "gravity-assist" });
    expect(ship(s).progress - p0).toBeCloseTo((ABILITIES["gravity-assist"].instantProgress ?? 0) * 0.5);
  });

  it("deterrents are disallowed in solo and co-op", () => {
    const solo = launch(newMatch("solo"));
    const r = cmd(solo, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "ion-jammer" });
    expect(r.ok).toBe(false);
    const coop = launch(newMatch("coop"));
    expect(canActivateAbility(coop, "p1", "emp-pulse").ok).toBe(false);
    expect(canActivateAbility(coop, "p2", "debris-scatter").ok).toBe(false);
  });

  it("deterrents hit the opponent in 1v1 and not a ship that stopped flying", () => {
    let s = flying1v1();
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "debris-scatter", targetShipId: "ship-2" });
    expect(ship(s, "ship-2").health).toBeCloseTo(100 - (ABILITIES["debris-scatter"].instantDamage ?? 0));
    expect(ship(s, "ship-2").stats.deterrentsReceived).toBe(1);
    expect(cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "ion-jammer", targetShipId: "ship-1" }).ok).toBe(false);
    const landed = withShip(s, "ship-2", (sh) => { sh.phase = "lunar-task"; });
    const r = cmd(landed, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "ion-jammer", targetShipId: "ship-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no longer flying/);
  });

  it("EMP Pulse and Tractor Lock share the stun cooldown", () => {
    let s = flying1v1();
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "emp-pulse", targetShipId: "ship-2" });
    expect(ship(s, "ship-2").effects.some((e) => e.type === "stunned")).toBe(true);
    // Let the stun expire, then tractor lock is still on the shared cooldown.
    s = advance(s, 5000);
    const r = cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "tractor-lock", targetShipId: "ship-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cooldown/);
    s = advance(s, ABILITIES["emp-pulse"].cooldownMs);
    expect(cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "tractor-lock", targetShipId: "ship-2" }).ok).toBe(true);
  });

  it("stuns do not stack and stunned ships cannot act", () => {
    let s = flying1v1();
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "emp-pulse", targetShipId: "ship-2" });
    // Clear p1's cooldowns to test the 'already stunned' rule specifically.
    s = withShip(s, "ship-1", (sh) => { sh.cooldowns = {}; });
    const r = cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "tractor-lock", targetShipId: "ship-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already stunned/);
    const own = cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p2", abilityId: "navigation-lock" });
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.reason).toMatch(/stunned/);
  });

  it("navigation lock cleanses slows and blocks stuns", () => {
    let s = flying1v1();
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "ion-jammer", targetShipId: "ship-2" });
    expect(ship(s, "ship-2").effects.some((e) => e.type === "speed-multiplier" && e.magnitude < 0)).toBe(true);
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p2", abilityId: "navigation-lock" });
    expect(ship(s, "ship-2").effects.some((e) => e.type === "speed-multiplier" && e.magnitude < 0)).toBe(false);
    const r = cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "emp-pulse", targetShipId: "ship-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/immune/);
  });

  it("comms spoof blocks the opponent's abilities", () => {
    let s = flying1v1();
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "comms-spoof", targetShipId: "ship-2" });
    expect(cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p2", abilityId: "thruster-burn" }).ok).toBe(false);
    s = advance(s, 6000);
    expect(cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p2", abilityId: "thruster-burn" }).ok).toBe(true);
  });

  it("co-op role permissions", () => {
    const s = launch(newMatch("coop"));
    // p1 pilot, p2 engineer
    expect(canActivateAbility(s, "p1", "thruster-burn").ok).toBe(true);
    expect(canActivateAbility(s, "p1", "gravity-assist").ok).toBe(true);
    expect(canActivateAbility(s, "p1", "navigation-lock").ok).toBe(true);
    expect(canActivateAbility(s, "p1", "deflector-surge").ok).toBe(false);
    expect(canActivateAbility(s, "p1", "hull-patch").ok).toBe(false);
    expect(canActivateAbility(s, "p2", "deflector-surge").ok).toBe(true);
    expect(canActivateAbility(s, "p2", "hull-patch").ok).toBe(true);
    expect(canActivateAbility(s, "p2", "thruster-burn").ok).toBe(false);
    expect(canRepair(s, "p1").ok).toBe(false);
  });

  it("co-op repair: engineer only, needs drone, escalating cost, heals over time", () => {
    let s = newMatch("coop");
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "repair-drone" });
    s = noHazards(launch(s));
    s = withShip(s, "ship-1", (sh) => { sh.health = 40; });
    expect(cmd(s, { type: "ACTIVATE_REPAIR", playerId: "p1" }).ok).toBe(false);
    const credits = ship(s).credits;
    s = must(s, { type: "ACTIVATE_REPAIR", playerId: "p2" });
    expect(credits - ship(s).credits).toBe(repairCost(0));
    expect(cmd(s, { type: "ACTIVATE_REPAIR", playerId: "p2" }).ok).toBe(false); // already repairing
    s = advance(s, REPAIR.base.durationMs / 2);
    expect(ship(s).health).toBeGreaterThan(40);
    expect(ship(s).health).toBeLessThan(40 + REPAIR.base.heal);
    s = advance(s, REPAIR.base.durationMs);
    expect(ship(s).health).toBeCloseTo(40 + REPAIR.base.heal);
    expect(cmd(s, { type: "ACTIVATE_REPAIR", playerId: "p2" }).ok).toBe(false); // cooldown
    s = advance(s, REPAIR.base.cooldownMs);
    const c2 = ship(s).credits;
    s = must(s, { type: "ACTIVATE_REPAIR", playerId: "p2" });
    expect(c2 - ship(s).credits).toBe(repairCost(1));
  });

  it("deflector surge reduces hazard damage", () => {
    const base = launch(newMatch("solo"));
    const firstHz = base.hazards.filter((h) => h.type !== "nav-anomaly").sort((a, b) => a.atMs - b.atMs)[0];
    expect(firstHz).toBeDefined();
    let a = { ...base, hazards: [{ ...firstHz, atMs: 2000 }] };
    let b = must(a, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "deflector-surge" });
    a = advance(a, 3000);
    b = advance(b, 3000);
    const dmgA = 100 - ship(a).health;
    const dmgB = 100 - ship(b).health;
    expect(dmgA).toBeGreaterThan(0);
    expect(dmgB).toBeCloseTo(dmgA * (1 - (ABILITIES["deflector-surge"].effect?.magnitude ?? 0)));
    expect(ship(b).stats.damagePrevented).toBeGreaterThan(0);
  });
});
