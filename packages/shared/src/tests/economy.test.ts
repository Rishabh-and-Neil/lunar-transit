import { describe, expect, it } from "vitest";
import { ABILITIES, ATTACHMENTS, REPAIR, SPACECRAFT, TIMING } from "../index";
import { abilityCost, applyCommand, calculateStats, canPurchase } from "../simulation/engine";
import { cmd, launch, must, newMatch, ship, withShip } from "./helpers";

describe("economy & equipment", () => {
  it("starts with configured credits and stats", () => {
    const s = newMatch("solo");
    expect(s.status).toBe("preparation");
    expect(ship(s).credits).toBe(SPACECRAFT.startingCredits);
    expect(ship(s).health).toBe(SPACECRAFT.maxHealth);
    expect(ship(s).phase).toBe("main-flight");
  });

  it("buys, rejects duplicates, and sells with full refund", () => {
    let s = newMatch("solo");
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "whipple-shield" });
    expect(ship(s).credits).toBe(SPACECRAFT.startingCredits - ATTACHMENTS["whipple-shield"].cost);
    expect(ship(s).mass).toBe(SPACECRAFT.baseMass + ATTACHMENTS["whipple-shield"].mass);
    const dup = cmd(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "whipple-shield" });
    expect(dup.ok).toBe(false);
    s = must(s, { type: "SELL_EQUIPMENT", playerId: "p1", equipmentId: "whipple-shield" });
    expect(ship(s).credits).toBe(SPACECRAFT.startingCredits);
    expect(ship(s).attachments).toEqual([]);
    expect(ship(s).stats.creditsSpentEquipment).toBe(0);
  });

  it("cannot overspend", () => {
    let s = newMatch("solo");
    s = withShip(s, "ship-1", (sh) => { sh.credits = 100; });
    const r = cmd(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "whipple-shield" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/credits/);
    expect(ship(r.state).credits).toBe(100);
  });

  it("enforces power capacity, including the solar-array bonus", () => {
    let s = newMatch("solo");
    // ion 28 + magnetic 24 = 52 of 60; spectrometer (10) would exceed.
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "ion-thruster" });
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "magnetic-deflector" });
    expect(canPurchase(s, "p1", "spectrometer").ok).toBe(false);
    const r = cmd(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "spectrometer" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/power/);
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "solar-array" });
    expect(calculateStats(ship(s)).powerCapacity).toBe(SPACECRAFT.basePowerCapacity + 45);
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "spectrometer" });
    // Selling the solar array would now overload power.
    expect(cmd(s, { type: "SELL_EQUIPMENT", playerId: "p1", equipmentId: "solar-array" }).ok).toBe(false);
  });

  it("repair upgrade requires the drone; drone cannot be sold while upgraded", () => {
    let s = newMatch("solo");
    expect(cmd(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "repair-upgrade" }).ok).toBe(false);
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "repair-drone" });
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "repair-upgrade" });
    expect(cmd(s, { type: "SELL_EQUIPMENT", playerId: "p1", equipmentId: "repair-drone" }).ok).toBe(false);
    expect(ship(s).credits).toBe(SPACECRAFT.startingCredits - REPAIR.drone.cost - REPAIR.upgrade.cost);
  });

  it("only repair-upgrade can be bought during flight; nothing can be sold", () => {
    let s = newMatch("solo");
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "repair-drone" });
    s = launch(s);
    expect(cmd(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "solar-sail" }).ok).toBe(false);
    expect(cmd(s, { type: "SELL_EQUIPMENT", playerId: "p1", equipmentId: "repair-drone" }).ok).toBe(false);
    s = must(s, { type: "PURCHASE_EQUIPMENT", playerId: "p1", equipmentId: "repair-upgrade" });
    expect(ship(s).repairUpgraded).toBe(true);
  });

  it("halves ability cost in overtime", () => {
    let s = launch(newMatch("solo"));
    expect(abilityCost(s, "ship-1", "thruster-burn")).toBe(ABILITIES["thruster-burn"].cost);
    s = withShip(s, "ship-1", (sh) => { sh.phase = "overtime"; });
    expect(abilityCost(s, "ship-1", "thruster-burn")).toBe(ABILITIES["thruster-burn"].cost * TIMING.overtimeCostMultiplier);
    const before = ship(s).credits;
    s = must(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "thruster-burn" });
    expect(before - ship(s).credits).toBe(ABILITIES["thruster-burn"].cost * TIMING.overtimeCostMultiplier);
  });

  it("cannot overspend on abilities", () => {
    let s = launch(newMatch("solo"));
    s = withShip(s, "ship-1", (sh) => { sh.credits = 10; });
    const r = cmd(s, { type: "ACTIVATE_ABILITY", playerId: "p1", abilityId: "thruster-burn" });
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate command ids without changes", () => {
    const s = newMatch("solo");
    const c = { type: "PURCHASE_EQUIPMENT" as const, playerId: "p1", equipmentId: "solar-sail" as const, commandId: "same-id" };
    const r1 = applyCommand(s, c);
    expect(r1.ok).toBe(true);
    const r2 = applyCommand(r1.state, c);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("duplicate");
    expect(r2.state).toBe(r1.state);
    expect(ship(r2.state).credits).toBe(ship(r1.state).credits);
  });

  it("bounds the processed command id set", () => {
    let s = newMatch("solo");
    for (let i = 0; i < TIMING.maxProcessedCommandIds + 20; i++) {
      s = must(s, { type: "SET_READY", playerId: "p1", ready: i % 2 === 0 });
    }
    expect(s.processedCommandIds.length).toBe(TIMING.maxProcessedCommandIds);
  });

  it("never throws on garbage input", () => {
    const s = newMatch("solo");
    const garbage = [
      null,
      { commandId: "x1", playerId: "nobody", type: "SET_READY", ready: true },
      { commandId: "x2", playerId: "p1", type: "NOPE" },
      { commandId: "x3", playerId: "p1", type: "PURCHASE_EQUIPMENT", equipmentId: "warp-drive" },
      { commandId: "x4", playerId: "p1", type: "SUBMIT_TASK", submission: null },
    ];
    for (const g of garbage) {
      const r = applyCommand(s, g as never);
      expect(r.ok).toBe(false);
    }
  });
});
