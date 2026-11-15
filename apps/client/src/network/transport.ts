// Transport abstraction: the UI sends commands and receives snapshots the same way
// whether the match runs locally (solo/tutorial) or on the server (1v1/co-op).
import type { MatchResultPayload, PlayerCommand, PublicMatchSnapshot, PublicTaskInstance } from "@sm/shared";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A player command without transport-assigned fields. */
export type CommandInput = DistributiveOmit<PlayerCommand, "commandId" | "playerId">;

export interface TransportHandlers {
  onSnapshot(snapshot: PublicMatchSnapshot): void;
  onRejected(commandId: string, reason: string): void;
  onTaskAssigned?(assignedId: string, instance: PublicTaskInstance): void;
  onResult?(payload: MatchResultPayload): void;
}

export interface GameTransport {
  readonly kind: "local" | "socket";
  /** Player id of this client (local: generated; socket: sessionId acknowledged by server). */
  readonly playerId: string | null;
  /** Sends a command with the given unique commandId. */
  send(command: CommandInput, commandId: string): void;
  /** Stops timers / closes the socket. */
  dispose(): void;
}

let active: GameTransport | null = null;

export function setActiveTransport(t: GameTransport | null): void {
  if (active && active !== t) active.dispose();
  active = t;
}

export function getActiveTransport(): GameTransport | null {
  return active;
}
