// Accelerated simulation: auto-buy boosters by priority when affordable & off cooldown.
import { AUTO_SIM_PRIORITY } from "../config/abilities";
import type { MatchState, SpacecraftState } from "../types";
import { activateAbility } from "./abilities";

export function runAutoSim(state: MatchState, ship: SpacecraftState): void {
  if (ship.phase !== "simulation") return;
  const playerId = ship.ownerIds[0];
  if (playerId === undefined) return;
  for (const abilityId of AUTO_SIM_PRIORITY) {
    const res = activateAbility(state, playerId, abilityId, undefined, true);
    if (res.ok) ship.stats.autoSimPurchases += 1;
  }
}
