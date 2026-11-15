// Thin wrapper: task generation/validation lives in the shared engine.
// The server only forwards the viewer's own *public* task instance.
import type { PublicMatchSnapshot, PublicTaskInstance } from "@sm/shared";

export interface AssignedTaskPayload {
  assignedId: string;
  instance: PublicTaskInstance;
}

/** The viewer's own public task instance from their snapshot (never the solution). */
export function ownTaskFromSnapshot(snapshot: PublicMatchSnapshot): AssignedTaskPayload | null {
  const own = snapshot.tasks.find((t) => t.playerId === snapshot.viewerId && t.instance !== undefined);
  if (!own || !own.instance) return null;
  return { assignedId: own.assignedId, instance: own.instance };
}
