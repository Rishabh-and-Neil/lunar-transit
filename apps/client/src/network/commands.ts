// Command helpers: unique ids, pending-state keys, and a single send entry point.
import type { AbilityId, EquipmentId, TaskSubmission } from "@sm/shared";
import { addPending, pushToast } from "../state/gameStore";
import { playSfx } from "../audio/sfx";
import { getActiveTransport, type CommandInput } from "./transport";

export function newCommandId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* insecure context */
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function pendingKey(cmd: CommandInput): string {
  switch (cmd.type) {
    case "PURCHASE_EQUIPMENT":
      return `buy:${cmd.equipmentId}`;
    case "SELL_EQUIPMENT":
      return `sell:${cmd.equipmentId}`;
    case "SET_READY":
      return "ready";
    case "ACTIVATE_ABILITY":
      return `ability:${cmd.abilityId}`;
    case "ACTIVATE_REPAIR":
      return "repair";
    case "SUBMIT_TASK":
      return "task";
  }
}

/** Sends a command through the active transport. Returns the commandId, or null if offline. */
export function sendCommand(cmd: CommandInput): string | null {
  const t = getActiveTransport();
  if (!t) {
    pushToast("Not connected to a mission.", "error");
    playSfx("error");
    return null;
  }
  const commandId = newCommandId();
  addPending({ commandId, key: pendingKey(cmd), sentAt: performance.now() });
  t.send(cmd, commandId);
  return commandId;
}

export const commands = {
  buy: (equipmentId: EquipmentId) => sendCommand({ type: "PURCHASE_EQUIPMENT", equipmentId }),
  sell: (equipmentId: EquipmentId) => sendCommand({ type: "SELL_EQUIPMENT", equipmentId }),
  ready: (ready: boolean) => sendCommand({ type: "SET_READY", ready }),
  ability: (abilityId: AbilityId, targetShipId?: string) => sendCommand({ type: "ACTIVATE_ABILITY", abilityId, targetShipId }),
  repair: () => sendCommand({ type: "ACTIVATE_REPAIR" }),
  submitTask: (submission: TaskSubmission) => sendCommand({ type: "SUBMIT_TASK", submission }),
};
