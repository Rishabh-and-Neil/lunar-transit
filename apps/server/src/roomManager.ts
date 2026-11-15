// Rooms (private codes + matchmade) and the matchmaking queues.
import { randomInt } from "node:crypto";
import type { Difficulty, PlayerRole, RoomPlayer, RoomState } from "@sm/shared";

export type MpMode = "1v1" | "coop";

export interface Room {
  code: string;
  mode: MpMode;
  difficulty: Difficulty;
  hostId: string;
  players: RoomPlayer[];
  isPrivate: boolean;
  matchId?: string;
  /** Co-op: when true the first player is engineer and the second pilot. */
  rolesSwapped: boolean;
  /** Set once the match leaves preparation; only returning players may join afterwards. */
  locked: boolean;
  /** When the room last had zero connected players (for cleanup). */
  emptySince?: number;
}

export const MAX_ROOM_PLAYERS = 2;
/** No I, L, O, 0, 1. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export type JoinResult = { ok: true; room: Room; rejoined: boolean } | { ok: false; reason: string };

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly playerRoom = new Map<string, string>();

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  getByPlayer(playerId: string): Room | undefined {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  create(host: { id: string; name: string }, mode: MpMode, difficulty: Difficulty, isPrivate: boolean): Room {
    let code: string;
    do code = isPrivate ? randomCode(5) : `MM-${randomCode(4)}`;
    while (this.rooms.has(code));
    const room: Room = {
      code, mode, difficulty, isPrivate, hostId: host.id, players: [], rolesSwapped: false, locked: false,
    };
    this.rooms.set(code, room);
    this.addPlayer(room, host);
    return room;
  }

  /**
   * Join by code. `isReturning` says whether the player belongs to the room's (started) match,
   * which lets them back into a locked room.
   */
  join(code: string, player: { id: string; name: string }, isReturning: (room: Room) => boolean): JoinResult {
    const room = this.get(code);
    if (!room) return { ok: false, reason: "Room not found" };
    const existing = room.players.find((p) => p.id === player.id);
    if (existing) return { ok: true, room, rejoined: true };
    const returning = isReturning(room);
    if (room.locked && !returning) return { ok: false, reason: "Match already started" };
    if (room.players.length >= MAX_ROOM_PLAYERS) return { ok: false, reason: "Room is full" };
    this.addPlayer(room, player);
    return { ok: true, room, rejoined: returning };
  }

  /** Removes the player from their room. Returns the room (deleted=true when it became empty). */
  removePlayer(playerId: string): { room: Room; deleted: boolean } | undefined {
    const room = this.getByPlayer(playerId);
    this.playerRoom.delete(playerId);
    if (!room) return undefined;
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return { room, deleted: true };
    }
    if (room.hostId === playerId) room.hostId = room.players[0].id;
    this.assignRoles(room);
    return { room, deleted: false };
  }

  delete(room: Room): void {
    for (const p of room.players) if (this.playerRoom.get(p.id) === room.code) this.playerRoom.delete(p.id);
    this.rooms.delete(room.code);
  }

  setConnected(playerId: string, connected: boolean): Room | undefined {
    const room = this.getByPlayer(playerId);
    const p = room?.players.find((x) => x.id === playerId);
    if (!room || !p) return undefined;
    p.connected = connected;
    if (connected) room.emptySince = undefined;
    return room;
  }

  assignRoles(room: Room): void {
    room.players.forEach((p, i) => {
      p.role = roleFor(room, i);
    });
  }

  toState(room: Room): RoomState {
    return {
      code: room.code,
      mode: room.mode,
      difficulty: room.difficulty,
      hostId: room.hostId,
      players: room.players.map((p) => ({ ...p })),
      isPrivate: room.isPrivate,
      ...(room.matchId ? { matchId: room.matchId } : {}),
    };
  }

  private addPlayer(room: Room, player: { id: string; name: string }): void {
    room.players.push({ id: player.id, name: player.name, role: "competitor", connected: true });
    room.emptySince = undefined;
    this.playerRoom.set(player.id, room.code);
    this.assignRoles(room);
  }
}

function roleFor(room: Room, index: number): PlayerRole {
  if (room.mode === "1v1") return "competitor";
  const first: PlayerRole = room.rolesSwapped ? "engineer" : "pilot";
  const second: PlayerRole = room.rolesSwapped ? "pilot" : "engineer";
  return index === 0 ? first : second;
}

// ---------------------------------------------------------------------------
// Matchmaking: one FIFO queue per mode.

export interface QueuedPlayer {
  id: string;
  name: string;
}

export class MatchmakingQueues {
  private readonly queues: Record<MpMode, QueuedPlayer[]> = { "1v1": [], coop: [] };

  /** Adds (or moves) the player to the end of the mode's queue. Returns 1-based position. */
  enqueue(mode: MpMode, player: QueuedPlayer): number {
    this.remove(player.id);
    this.queues[mode].push(player);
    return this.queues[mode].length;
  }

  /** Removes the player from any queue; returns the mode they were queued for. */
  remove(playerId: string): MpMode | undefined {
    for (const mode of ["1v1", "coop"] as const) {
      const q = this.queues[mode];
      const i = q.findIndex((p) => p.id === playerId);
      if (i >= 0) {
        q.splice(i, 1);
        return mode;
      }
    }
    return undefined;
  }

  popPair(mode: MpMode): [QueuedPlayer, QueuedPlayer] | null {
    const q = this.queues[mode];
    if (q.length < 2) return null;
    const a = q.shift();
    const b = q.shift();
    return a && b ? [a, b] : null;
  }

  list(mode: MpMode): readonly QueuedPlayer[] {
    return this.queues[mode];
  }
}
