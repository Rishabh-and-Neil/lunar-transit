// Socket.IO transport for online 1v1 / co-op. The server is authoritative.
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  Difficulty,
  HandshakeAuth,
  RoomState,
  ServerToClientEvents,
} from "@sm/shared";
import type { CommandInput, GameTransport, TransportHandlers } from "./transport";

/**
 * Multiplayer server. VITE_SERVER_URL wins; otherwise production builds use the page's own origin
 * (the server serves the client in the single-service deploy) and dev uses localhost:3001.
 */
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ||
  (import.meta.env.PROD && typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");

import { getClientId } from "./clientId";

const SESSION_KEY = "lt.sessionId";

/**
 * Per-tab session id (sessionStorage): survives reloads so reconnects restore the player,
 * while two tabs in the same browser are distinct players (handy for local 1v1/co-op demos).
 */
export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && existing.length >= 8) return existing;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `s-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export type SocketConnectionState = "connecting" | "connected" | "reconnecting" | "error";

export interface SocketHandlers extends TransportHandlers {
  onConnection(state: SocketConnectionState, error?: string): void;
  onWelcome(playerId: string): void;
  onRoom(room: RoomState | null): void;
  onMatchmaking(p: { queued: boolean; mode?: "1v1" | "coop"; position?: number }): void;
  onCountdown?(p: { matchId: string; countdownMs: number }): void;
}

type AckResult<T> = { ok: true; data?: T } | { ok: false; reason: string };
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 8000;

export class SocketTransport implements GameTransport {
  readonly kind = "socket" as const;
  private socket: GameSocket;
  private _playerId: string;
  private disposed = false;

  constructor(
    name: string,
    private handlers: SocketHandlers,
  ) {
    this._playerId = getSessionId();
    const auth: HandshakeAuth = { sessionId: this._playerId, name, clientId: getClientId() };
    this.socket = io(SERVER_URL, {
      auth,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000,
      timeout: 8000,
    });
    this.bind();
    handlers.onConnection("connecting");
  }

  get playerId(): string {
    return this._playerId;
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  /** Updates the name sent on (re)connect handshakes. */
  setName(name: string): void {
    const auth: HandshakeAuth = { sessionId: this._playerId, name, clientId: getClientId() };
    this.socket.auth = auth;
  }

  private bind(): void {
    const s = this.socket;
    const h = this.handlers;
    s.on("connect", () => h.onConnection("connected"));
    s.on("disconnect", (reason) => {
      if (this.disposed) return;
      h.onConnection(reason === "io client disconnect" ? "error" : "reconnecting", reason);
    });
    s.on("connect_error", (err) => {
      if (this.disposed) return;
      h.onConnection(s.active ? "reconnecting" : "error", err.message);
    });
    s.io.on("reconnect_attempt", () => !this.disposed && h.onConnection("reconnecting"));
    s.on("session:welcome", ({ playerId }) => {
      this._playerId = playerId;
      h.onWelcome(playerId);
    });
    s.on("room:state", (room) => h.onRoom(room));
    s.on("matchmaking:status", (p) => h.onMatchmaking(p));
    s.on("match:countdown", (p) => h.onCountdown?.(p));
    s.on("match:snapshot", (snap) => h.onSnapshot(snap));
    s.on("command:rejected", ({ commandId, reason }) => h.onRejected(commandId, reason));
    s.on("task:assigned", ({ assignedId, instance }) => h.onTaskAssigned?.(assignedId, instance));
    s.on("match:result", (p) => h.onResult?.(p));
  }

  private withAck<T>(emit: (ack: (res: AckResult<T>) => void) => void): Promise<AckResult<T>> {
    return new Promise((resolve) => {
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, reason: this.socket.connected ? "Server did not respond" : "Not connected to server" });
      }, ACK_TIMEOUT_MS);
      emit((res) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(res);
      });
    });
  }

  createRoom(mode: "1v1" | "coop", name: string, difficulty: Difficulty): Promise<AckResult<RoomState>> {
    return this.withAck<RoomState>((ack) => this.socket.emit("room:create", { mode, name, difficulty }, ack));
  }

  joinRoom(code: string, name: string): Promise<AckResult<RoomState>> {
    return this.withAck<RoomState>((ack) => this.socket.emit("room:join", { code, name }, ack));
  }

  configureRoom(p: { difficulty?: Difficulty; swapRoles?: boolean }): Promise<AckResult<RoomState>> {
    return this.withAck<RoomState>((ack) => this.socket.emit("room:configure", p, ack));
  }

  leaveRoom(): void {
    this.socket.emit("room:leave");
  }

  joinMatchmaking(mode: "1v1" | "coop", name: string): Promise<AckResult<unknown>> {
    return this.withAck<unknown>((ack) => this.socket.emit("matchmaking:join", { mode, name }, ack));
  }

  leaveMatchmaking(): void {
    this.socket.emit("matchmaking:leave");
  }

  send(command: CommandInput, commandId: string): void {
    const s = this.socket;
    switch (command.type) {
      case "PURCHASE_EQUIPMENT":
        s.emit("equipment:purchase", { commandId, equipmentId: command.equipmentId });
        break;
      case "SELL_EQUIPMENT":
        s.emit("equipment:purchase", { commandId, equipmentId: command.equipmentId, sell: true });
        break;
      case "SET_READY":
        s.emit("player:ready", { commandId, ready: command.ready });
        break;
      case "ACTIVATE_ABILITY":
        s.emit("ability:activate", { commandId, abilityId: command.abilityId, targetShipId: command.targetShipId });
        break;
      case "ACTIVATE_REPAIR":
        s.emit("repair:activate", { commandId });
        break;
      case "SUBMIT_TASK":
        s.emit("task:submit", { commandId, submission: command.submission });
        break;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.socket.removeAllListeners();
    this.socket.io.removeAllListeners();
    this.socket.disconnect();
  }
}
