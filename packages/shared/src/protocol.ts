// Typed Socket.IO protocol + Zod validation for client commands.
import { z } from "zod";
import type { Difficulty, GameMode, MatchOutcome, PlayerRole, PublicMatchSnapshot, PublicTaskInstance } from "./types";
import { ABILITY_IDS } from "./config/abilities";
import { ATTACHMENT_IDS } from "./config/attachments";

export interface RoomPlayer {
  id: string;
  name: string;
  role: PlayerRole;
  connected: boolean;
}

export interface RoomState {
  code: string; // 5-char private code, or "MM-xxxx" for matchmade rooms
  mode: Exclude<GameMode, "solo">;
  difficulty: Difficulty;
  hostId: string;
  players: RoomPlayer[];
  isPrivate: boolean;
  matchId?: string;
}

export interface MatchResultPayload {
  matchId: string;
  outcome: MatchOutcome;
  snapshot: PublicMatchSnapshot;
}

type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; reason: string }) => void;

export interface ClientToServerEvents {
  "room:create": (p: { mode: "1v1" | "coop"; name: string; difficulty: Difficulty }, ack: Ack<RoomState>) => void;
  "room:join": (p: { code: string; name: string }, ack: Ack<RoomState>) => void;
  "room:leave": () => void;
  /** Host only: change difficulty or swap co-op roles. */
  "room:configure": (p: { difficulty?: Difficulty; swapRoles?: boolean }, ack: Ack<RoomState>) => void;
  "matchmaking:join": (p: { mode: "1v1" | "coop"; name: string }, ack: Ack) => void;
  "matchmaking:leave": () => void;
  "player:ready": (p: { commandId: string; ready: boolean }) => void;
  "equipment:purchase": (p: { commandId: string; equipmentId: string; sell?: boolean }) => void;
  "ability:activate": (p: { commandId: string; abilityId: string; targetShipId?: string }) => void;
  "repair:activate": (p: { commandId: string }) => void;
  "task:submit": (p: { commandId: string; submission: unknown }) => void;
}

export interface ServerToClientEvents {
  "session:welcome": (p: { playerId: string }) => void;
  "room:state": (room: RoomState | null) => void;
  "matchmaking:status": (p: { queued: boolean; mode?: "1v1" | "coop"; position?: number }) => void;
  "match:countdown": (p: { matchId: string; countdownMs: number }) => void;
  "match:snapshot": (snapshot: PublicMatchSnapshot) => void;
  "command:rejected": (p: { commandId: string; reason: string }) => void;
  "task:assigned": (p: { assignedId: string; instance: PublicTaskInstance }) => void;
  "match:result": (p: MatchResultPayload) => void;
}

/** Socket handshake auth: client keeps a persistent sessionId in localStorage; it is the playerId. */
export interface HandshakeAuth {
  sessionId: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Zod schemas

const commandId = z.string().min(1).max(64);
export const zDifficulty = z.enum(["easy", "normal", "hard"]);
export const zMpMode = z.enum(["1v1", "coop"]);
export const zName = z.string().trim().min(1).max(20);

export const zRoomCreate = z.object({ mode: zMpMode, name: zName, difficulty: zDifficulty });
export const zRoomJoin = z.object({ code: z.string().trim().min(3).max(12), name: zName });
export const zRoomConfigure = z.object({ difficulty: zDifficulty.optional(), swapRoles: z.boolean().optional() });
export const zMatchmakingJoin = z.object({ mode: zMpMode, name: zName });
export const zReady = z.object({ commandId, ready: z.boolean() });
export const zPurchase = z.object({
  commandId,
  equipmentId: z.enum([...(ATTACHMENT_IDS as [string, ...string[]]), "repair-drone", "repair-upgrade"]),
  sell: z.boolean().optional(),
});
export const zAbility = z.object({
  commandId,
  abilityId: z.enum(ABILITY_IDS as [string, ...string[]]),
  targetShipId: z.string().max(64).optional(),
});
export const zRepair = z.object({ commandId });

const zNum = z.number().finite();
export const zTaskSubmission = z.discriminatedUnion("taskId", [
  z.object({ taskId: z.literal("surface-analysis"), regionIds: z.array(z.string().max(32)).max(64) }),
  z.object({ taskId: z.literal("communications"), azimuth: zNum, elevation: zNum }),
  z.object({ taskId: z.literal("power-calibration"), allocation: z.record(z.string().max(32), zNum) }),
  z.object({ taskId: z.literal("orbit-calibration"), dvAtPeriapsis: zNum, dvAtApoapsis: zNum }),
  z.object({ taskId: z.literal("terrain-mapping"), mapping: z.record(z.string().max(4), z.string().max(32)) }),
]);
export const zTaskSubmit = z.object({ commandId, submission: zTaskSubmission });
