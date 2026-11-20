// Socket.IO event handlers: sessions, rooms, matchmaking and command intake.
import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type { z } from "zod";
import {
  ABILITY_IDS, ATTACHMENT_IDS, zAbility, zMatchmakingJoin, zName, zPurchase, zReady, zRepair, zRoomConfigure,
  zRoomCreate, zRoomJoin, zTaskSubmit,
} from "@sm/shared";
import type {
  AbilityId, ClientToServerEvents, EquipmentId, PlayerCommand, RoomState, ServerToClientEvents,
} from "@sm/shared";
import { MatchManager, type PlayerChannel } from "./matchManager";
import { MatchmakingQueues, RoomManager, type MpMode, type Room } from "./roomManager";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type AckFn = Parameters<ClientToServerEvents["room:create"]>[1];

export interface GatewayOptions {
  /** Rooms with no connected players are removed after this long. */
  emptyRoomTtlMs?: number;
  finishedRetentionMs?: number;
  /** Called with the final state whenever a match finishes (used for the co-op leaderboard). */
  /** clientIdOf maps a player to their browser's lasting id (for one-entry-per-player leaderboards). */
  onMatchFinished?: (state: import("@sm/shared").MatchState, clientIdOf: (playerId: string) => string | undefined) => void;
  /** A player who drops mid-match has this long to reconnect before the match is cancelled. */
  disconnectGraceMs?: number;
  log?: (line: string) => void;
}

const EQUIPMENT_IDS: readonly string[] = [...ATTACHMENT_IDS, "repair-drone", "repair-upgrade"];
const isEquipmentId = (s: string): s is EquipmentId => EQUIPMENT_IDS.includes(s);
const isAbilityId = (s: string): s is AbilityId => (ABILITY_IDS as readonly string[]).includes(s);

const playerChannel = (id: string): string => `player:${id}`;
const roomChannel = (code: string): string => `room:${code}`;

interface Session {
  playerId: string;
  name: string;
  socket: GameSocket;
  clientId?: string;
}

export class SocketGateway {
  readonly rooms = new RoomManager();
  readonly queues = new MatchmakingQueues();
  readonly matches: MatchManager;
  private readonly sessions = new Map<string, Session>();
  private readonly emptyRoomTtlMs: number;
  private readonly disconnectGraceMs: number;
  /** Pending "cancel the match unless they come back" timers, by player id. */
  private readonly dropTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly log: (line: string) => void;

  constructor(private readonly io: IO, opts: GatewayOptions = {}) {
    this.emptyRoomTtlMs = opts.emptyRoomTtlMs ?? 60_000;
    this.disconnectGraceMs = opts.disconnectGraceMs ?? 20_000;
    this.log = opts.log ?? ((line) => console.log(line));
    const channel: PlayerChannel = {
      snapshot: (id, s) => void this.io.to(playerChannel(id)).emit("match:snapshot", s),
      countdown: (id, p) => void this.io.to(playerChannel(id)).emit("match:countdown", p),
      rejected: (id, p) => void this.io.to(playerChannel(id)).emit("command:rejected", p),
      taskAssigned: (id, p) => void this.io.to(playerChannel(id)).emit("task:assigned", p),
      result: (id, p) => void this.io.to(playerChannel(id)).emit("match:result", p),
    };
    this.matches = new MatchManager(channel, {
      finishedRetentionMs: opts.finishedRetentionMs,
      log: this.log,
      // Once the countdown starts, only returning players may (re)join the room.
      onFinished: (entry) => opts.onMatchFinished?.(entry.state, (pid) => this.sessions.get(pid)?.clientId),
      onCountdown: (entry) => {
        const room = this.rooms.get(entry.roomCode);
        if (room && room.matchId === entry.id) room.locked = true;
      },
    });
    io.on("connection", (socket) => this.onConnection(socket));
  }

  /** Periodic housekeeping: removes rooms that have had no connected players for emptyRoomTtlMs. */
  sweep(now = Date.now()): void {
    for (const room of this.rooms.all()) {
      if (room.players.some((p) => p.connected)) {
        room.emptySince = undefined;
        continue;
      }
      room.emptySince ??= now;
      if (now - room.emptySince >= this.emptyRoomTtlMs) {
        this.matches.abandonAndDispose(room.matchId, "all players disconnected");
        this.rooms.delete(room);
        this.log(`[room] ${room.code} cleaned up (empty)`);
      }
    }
  }

  close(): void {
    for (const t of this.dropTimers.values()) clearTimeout(t);
    this.dropTimers.clear();
    this.matches.closeAll();
  }

  // -------------------------------------------------------------------------

  private onConnection(socket: GameSocket): void {
    const auth: unknown = socket.handshake.auth;
    const rawId = field(auth, "sessionId");
    const playerId = typeof rawId === "string" && rawId.length >= 8 && rawId.length <= 64 ? rawId : randomUUID();
    const parsedName = zName.safeParse(field(auth, "name"));
    const prev = this.sessions.get(playerId);
    const name = parsedName.success ? parsedName.data : prev?.name ?? `Player-${playerId.slice(0, 4)}`;

    const rawClient = field(auth, "clientId");
    const clientId = typeof rawClient === "string" && /^[A-Za-z0-9-]{8,64}$/.test(rawClient) ? rawClient : prev?.clientId;
    const session: Session = { playerId, name, socket, clientId };
    this.sessions.set(playerId, session);
    if (prev && prev.socket.id !== socket.id && prev.socket.connected) prev.socket.disconnect(true);

    void socket.join(playerChannel(playerId));
    socket.emit("session:welcome", { playerId });

    // Restore room / match on reconnect.
    this.clearDropTimer(playerId);
    const room = this.rooms.getByPlayer(playerId);
    if (room) {
      void socket.join(roomChannel(room.code));
      this.rooms.setConnected(playerId, true);
      this.matches.setConnected(room.matchId, playerId, true);
      this.broadcastRoom(room);
      this.matches.sendFullState(room.matchId, playerId);
    } else {
      socket.emit("room:state", null);
    }

    socket.on("room:create", (p, ack) => this.onRoomCreate(session, p, ack));
    socket.on("room:join", (p, ack) => this.onRoomJoin(session, p, ack));
    socket.on("room:leave", () => this.leaveRoom(session));
    socket.on("room:configure", (p, ack) => this.onRoomConfigure(session, p, ack));
    socket.on("matchmaking:join", (p, ack) => this.onMatchmakingJoin(session, p, ack));
    socket.on("matchmaking:leave", () => {
      this.queues.remove(session.playerId);
      socket.emit("matchmaking:status", { queued: false });
      this.emitQueuePositions();
    });

    socket.on("player:ready", (p) =>
      this.command(session, p, zReady, (d) => ({ type: "SET_READY", commandId: d.commandId, playerId, ready: d.ready })),
    );
    socket.on("equipment:purchase", (p) =>
      this.command(session, p, zPurchase, (d) => {
        if (!isEquipmentId(d.equipmentId)) return "Unknown equipment";
        return d.sell
          ? { type: "SELL_EQUIPMENT", commandId: d.commandId, playerId, equipmentId: d.equipmentId }
          : { type: "PURCHASE_EQUIPMENT", commandId: d.commandId, playerId, equipmentId: d.equipmentId };
      }),
    );
    socket.on("ability:activate", (p) =>
      this.command(session, p, zAbility, (d) => {
        if (!isAbilityId(d.abilityId)) return "Unknown ability";
        return {
          type: "ACTIVATE_ABILITY", commandId: d.commandId, playerId, abilityId: d.abilityId,
          ...(d.targetShipId !== undefined ? { targetShipId: d.targetShipId } : {}),
        };
      }),
    );
    socket.on("repair:activate", (p) =>
      this.command(session, p, zRepair, (d) => ({ type: "ACTIVATE_REPAIR", commandId: d.commandId, playerId })),
    );
    socket.on("task:submit", (p) =>
      this.command(session, p, zTaskSubmit, (d) => ({ type: "SUBMIT_TASK", commandId: d.commandId, playerId, submission: d.submission })),
    );

    socket.on("disconnect", () => this.onDisconnect(session));
  }

  private onDisconnect(session: Session): void {
    // A newer socket for the same session replaced this one: nothing to do.
    if (this.sessions.get(session.playerId) !== session) return;
    const { playerId } = session;
    if (this.queues.remove(playerId)) this.emitQueuePositions();
    const room = this.rooms.setConnected(playerId, false);
    if (room) {
      this.matches.setConnected(room.matchId, playerId, false);
      this.broadcastRoom(room);
      if (this.hasLiveMatch(room)) {
        // Give an accidental refresh / network blip a moment; otherwise cancel for the other player.
        this.clearDropTimer(playerId);
        const timer = setTimeout(() => {
          this.dropTimers.delete(playerId);
          const r = this.rooms.getByPlayer(playerId);
          const still = r?.players.find((p) => p.id === playerId);
          if (r && still && !still.connected && this.hasLiveMatch(r)) {
            this.cancelRoomMatch(r, session.name, "lost connection");
          }
        }, this.disconnectGraceMs);
        timer.unref?.();
        this.dropTimers.set(playerId, timer);
      }
    }
  }

  private clearDropTimer(playerId: string): void {
    const t = this.dropTimers.get(playerId);
    if (t) clearTimeout(t);
    this.dropTimers.delete(playerId);
  }

  /** A match that has launched (countdown or flight/tasks) and not finished. */
  private hasLiveMatch(room: Room): boolean {
    const m = this.matches.get(room.matchId);
    return !!m && !m.finished && m.state.status !== "preparation";
  }

  /**
   * A player left a launched match: cancel it for everyone (the remaining player gets a
   * "mission aborted" result explaining why) and close the room so nobody can rejoin it.
   */
  private cancelRoomMatch(room: Room, leaverName: string, how: "left" | "lost connection"): void {
    const what = room.mode === "coop" ? "mission" : "match";
    const reason =
      how === "left"
        ? `${leaverName} left the ${what}, so it was cancelled.`
        : `${leaverName} lost connection, so the ${what} was cancelled.`;
    this.matches.cancel(room.matchId, reason);
    for (const p of room.players) {
      this.clearDropTimer(p.id);
      const s = this.sessions.get(p.id);
      if (s) void s.socket.leave(roomChannel(room.code));
    }
    this.rooms.delete(room);
    this.log(`[room] ${room.code} closed: ${reason}`);
  }

  // ---- rooms ---------------------------------------------------------------

  private onRoomCreate(session: Session, raw: unknown, ack: AckFn): void {
    const reply = safeAck(ack);
    const parsed = zRoomCreate.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, reason: "Invalid room settings" });
    const { mode, name, difficulty } = parsed.data;
    session.name = name;
    this.detach(session);
    const room = this.rooms.create({ id: session.playerId, name }, mode, difficulty, true);
    void session.socket.join(roomChannel(room.code));
    this.log(`[room] ${room.code} created (${mode}/${difficulty}) by ${name}`);
    reply({ ok: true, data: this.rooms.toState(room) });
    this.broadcastRoom(room);
  }

  private onRoomJoin(session: Session, raw: unknown, ack: AckFn): void {
    const reply = safeAck(ack);
    const parsed = zRoomJoin.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, reason: "Invalid room code or name" });
    const { code, name } = parsed.data;
    const target = this.rooms.get(code);
    if (!target) return reply({ ok: false, reason: "Room not found" });

    const current = this.rooms.getByPlayer(session.playerId);
    if (current && current !== target) this.detach(session);
    else this.queues.remove(session.playerId);
    session.name = name;

    const res = this.rooms.join(code, { id: session.playerId, name }, (room) =>
      this.matches.isPlayerInMatch(room.matchId, session.playerId),
    );
    if (!res.ok) return reply({ ok: false, reason: res.reason });
    const room = res.room;
    this.rooms.setConnected(session.playerId, true);
    void session.socket.join(roomChannel(room.code));
    reply({ ok: true, data: this.rooms.toState(room) });
    this.log(`[room] ${room.code} ${res.rejoined ? "rejoined" : "joined"} by ${name}`);

    if (res.rejoined && this.matches.get(room.matchId)) {
      this.matches.setConnected(room.matchId, session.playerId, true);
      this.broadcastRoom(room);
      this.matches.sendFullState(room.matchId, session.playerId);
    } else {
      this.ensureMatch(room);
    }
  }

  /** Host-only. See MatchManager.canReconfigure for when changes are allowed. */
  private onRoomConfigure(session: Session, raw: unknown, ack: AckFn): void {
    const reply = safeAck(ack);
    const parsed = zRoomConfigure.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, reason: "Invalid settings" });
    const room = this.rooms.getByPlayer(session.playerId);
    if (!room) return reply({ ok: false, reason: "Not in a room" });
    if (room.hostId !== session.playerId) return reply({ ok: false, reason: "Only the host can change settings" });
    if (!room.isPrivate) return reply({ ok: false, reason: "Matchmade rooms cannot be configured" });
    if (room.locked) return reply({ ok: false, reason: "Match already started" });
    const { difficulty, swapRoles } = parsed.data;
    if (swapRoles && room.mode !== "coop") return reply({ ok: false, reason: "Roles can only be swapped in co-op" });

    const existing = this.matches.get(room.matchId);
    if (existing) {
      const check = this.matches.canReconfigure(existing.id);
      if (!check.ok) return reply({ ok: false, reason: check.reason });
    }
    if (difficulty) room.difficulty = difficulty;
    if (swapRoles) {
      room.rolesSwapped = !room.rolesSwapped;
      this.rooms.assignRoles(room);
    }
    if (existing && (difficulty || swapRoles)) {
      this.matches.dispose(existing.id);
      room.matchId = undefined;
      this.ensureMatch(room, false);
    }
    reply({ ok: true, data: this.rooms.toState(room) });
    this.broadcastRoom(room);
  }

  /**
   * Leave the current room (if any). Leaving a launched match cancels it for the other player and
   * closes the room, so the leaver cannot come back. Leaving in preparation returns the other player
   * to the lobby to wait for someone new.
   */
  private leaveRoom(session: Session): void {
    const { playerId, socket } = session;
    this.queues.remove(playerId);
    const room = this.rooms.getByPlayer(playerId);
    if (!room) {
      socket.emit("room:state", null);
      return;
    }
    if (this.hasLiveMatch(room)) {
      this.cancelRoomMatch(room, session.name, "left");
      socket.emit("room:state", null);
      return;
    }
    const match = this.matches.get(room.matchId);
    const res = this.rooms.removePlayer(playerId);
    void socket.leave(roomChannel(room.code));
    socket.emit("room:state", null);
    if (!res) return;
    this.log(`[room] ${room.code} left by ${session.name}`);

    if (res.deleted) {
      this.matches.abandonAndDispose(room.matchId, "all players left");
      this.log(`[room] ${room.code} closed`);
      return;
    }
    if (match && match.state.status === "preparation" && !match.finished) {
      // Back to the lobby: the remaining player waits for a new opponent/partner.
      this.matches.dispose(match.id);
      room.matchId = undefined;
    } else if (match) {
      this.matches.setConnected(match.id, playerId, false);
    }
    this.broadcastRoom(room);
  }

  /** Leave any room / queue before entering a new one. */
  private detach(session: Session): void {
    if (this.queues.remove(session.playerId)) {
      session.socket.emit("matchmaking:status", { queued: false });
      this.emitQueuePositions();
    }
    if (this.rooms.getByPlayer(session.playerId)) this.leaveRoom(session);
  }

  /** Full room without a match -> create one in preparation. */
  private ensureMatch(room: Room, broadcast = true): void {
    if (room.players.length === 2 && !room.locked && !this.matches.get(room.matchId)) {
      const entry = this.matches.createForRoom(room);
      room.matchId = entry?.id;
    }
    if (broadcast) this.broadcastRoom(room);
  }

  // ---- matchmaking -----------------------------------------------------------

  private onMatchmakingJoin(session: Session, raw: unknown, ack: Parameters<ClientToServerEvents["matchmaking:join"]>[1]): void {
    const reply = safeAck(ack);
    const parsed = zMatchmakingJoin.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, reason: "Invalid matchmaking request" });
    const { mode, name } = parsed.data;
    session.name = name;
    if (this.rooms.getByPlayer(session.playerId)) this.leaveRoom(session);
    const position = this.queues.enqueue(mode, { id: session.playerId, name });
    reply({ ok: true });
    session.socket.emit("matchmaking:status", { queued: true, mode, position });
    this.log(`[mm] ${name} queued for ${mode} (#${position})`);
    this.tryPair(mode);
  }

  private tryPair(mode: MpMode): void {
    for (;;) {
      const pair = this.queues.popPair(mode);
      if (!pair) break;
      const [a, b] = pair;
      const sa = this.sessions.get(a.id);
      const sb = this.sessions.get(b.id);
      const room = this.rooms.create(a, mode, "normal", false);
      this.rooms.join(room.code, b, () => false);
      for (const s of [sa, sb]) {
        if (!s) continue;
        void s.socket.join(roomChannel(room.code));
        s.socket.emit("matchmaking:status", { queued: false });
        if (!s.socket.connected) this.rooms.setConnected(s.playerId, false);
      }
      this.log(`[mm] paired ${a.name} + ${b.name} (${mode}) -> room ${room.code}`);
      this.ensureMatch(room);
    }
    this.emitQueuePositions();
  }

  private emitQueuePositions(): void {
    for (const mode of ["1v1", "coop"] as const) {
      this.queues.list(mode).forEach((p, i) => {
        this.io.to(playerChannel(p.id)).emit("matchmaking:status", { queued: true, mode, position: i + 1 });
      });
    }
  }

  // ---- commands ---------------------------------------------------------------

  private command<S extends z.ZodTypeAny>(
    session: Session,
    raw: unknown,
    schema: S,
    build: (data: z.infer<S>) => PlayerCommand | string,
  ): void {
    const commandId = extractCommandId(raw);
    const reject = (reason: string): void => {
      session.socket.emit("command:rejected", { commandId, reason });
    };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return reject("Invalid command");
    const room = this.rooms.getByPlayer(session.playerId);
    const match = this.matches.get(room?.matchId);
    if (!room || !match) return reject("Not in a match");
    if (!match.state.players.some((p) => p.id === session.playerId)) return reject("Not a player in this match");
    const cmd = build(parsed.data);
    if (typeof cmd === "string") return reject(cmd);
    const queued = this.matches.enqueue(match.id, cmd);
    if (!queued.ok) return reject(queued.reason);
  }

  // ---- broadcast ----------------------------------------------------------------

  private broadcastRoom(room: Room): void {
    const state: RoomState = this.rooms.toState(room);
    this.io.to(roomChannel(room.code)).emit("room:state", state);
  }
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

function extractCommandId(raw: unknown): string {
  const id = field(raw, "commandId");
  return typeof id === "string" && id.length <= 64 ? id : "";
}

/** Clients may omit the ack callback; never call a non-function. */
function safeAck<R>(ack: (res: R) => void): (res: R) => void {
  return typeof ack === "function" ? ack : () => undefined;
}
