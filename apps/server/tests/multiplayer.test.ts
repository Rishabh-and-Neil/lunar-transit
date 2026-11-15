import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket } from "socket.io-client";
import type { ClientToServerEvents, PublicMatchSnapshot, RoomState, ServerToClientEvents } from "@sm/shared";
import { startServer, type RunningServer } from "../src/app";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckRes<T> = { ok: true; data?: T } | { ok: false; reason: string };

let server: RunningServer;
let url = "";
const clients: Client[] = [];
let seq = 0;

beforeAll(async () => {
  server = await startServer(0, { log: () => undefined });
  url = `http://localhost:${server.port}`;
});
afterAll(async () => {
  await server.close();
});
afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});

function sid(): string {
  return `test-session-${Date.now()}-${seq++}`;
}

/** Records every event so assertions never miss one that arrived early. */
interface Probe {
  socket: Client;
  sessionId: string;
  events: { name: string; payload: unknown }[];
  next: <T>(name: keyof ServerToClientEvents, pred?: (p: T) => boolean, timeoutMs?: number) => Promise<T>;
}

async function connect(sessionId = sid(), name = "Tester"): Promise<Probe> {
  const socket: Client = ioClient(url, { auth: { sessionId, name }, transports: ["websocket"], forceNew: true, reconnection: false });
  clients.push(socket);
  const events: Probe["events"] = [];
  const waiters: { name: string; pred: (p: unknown) => boolean; resolve: (p: unknown) => void }[] = [];
  socket.onAny((evName: string, payload: unknown) => {
    events.push({ name: evName, payload });
    for (const w of [...waiters]) {
      if (w.name === evName && w.pred(payload)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(payload);
      }
    }
  });
  const next = <T,>(evName: keyof ServerToClientEvents, pred: (p: T) => boolean = () => true, timeoutMs = 3000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const seen = events.find((e) => e.name === evName && pred(e.payload as T));
      if (seen) return resolve(seen.payload as T);
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${evName}`)), timeoutMs);
      waiters.push({
        name: evName,
        pred: (p) => pred(p as T),
        resolve: (p) => {
          clearTimeout(timer);
          resolve(p as T);
        },
      });
    });
  const probe: Probe = { socket, sessionId, events, next };
  await next<{ playerId: string }>("session:welcome");
  return probe;
}

function createRoom(c: Probe, mode: "1v1" | "coop", name = "Host"): Promise<AckRes<RoomState>> {
  return new Promise((resolve) => c.socket.emit("room:create", { mode, name, difficulty: "normal" }, resolve));
}
function joinRoom(c: Probe, code: string, name = "Guest"): Promise<AckRes<RoomState>> {
  return new Promise((resolve) => c.socket.emit("room:join", { code, name }, resolve));
}
async function launchMatch(mode: "1v1" | "coop"): Promise<{ a: Probe; b: Probe; code: string }> {
  const a = await connect(undefined, "Alpha");
  const b = await connect(undefined, "Bravo");
  const room = roomOf(await createRoom(a, mode, "Alpha"));
  roomOf(await joinRoom(b, room.code, "Bravo"));
  await a.next("match:snapshot");
  a.socket.emit("player:ready", { commandId: `ra-${room.code}`, ready: true });
  b.socket.emit("player:ready", { commandId: `rb-${room.code}`, ready: true });
  await a.next("match:countdown");
  await b.next("match:countdown");
  return { a, b, code: room.code };
}

function roomOf(res: AckRes<RoomState>): RoomState {
  if (!res.ok || !res.data) throw new Error(`expected ok ack, got ${JSON.stringify(res)}`);
  return res.data;
}

describe("multiplayer server", () => {
  it("serves /health", async () => {
    const res = await fetch(`${url}/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("uses sessionId as playerId and replaces invalid ids", async () => {
    const id = sid();
    const a = await connect(id);
    const welcomeA = a.events.find((e) => e.name === "session:welcome")?.payload as { playerId: string };
    expect(welcomeA.playerId).toBe(id);
    const b = await connect("short");
    const welcomeB = b.events.find((e) => e.name === "session:welcome")?.payload as { playerId: string };
    expect(welcomeB.playerId).not.toBe("short");
    expect(welcomeB.playerId.length).toBeGreaterThanOrEqual(8);
  });

  it("creates and joins a private 1v1 room (case-insensitive code)", async () => {
    const host = await connect();
    const guest = await connect();
    const room = roomOf(await createRoom(host, "1v1"));
    expect(room.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}$/);
    expect(room.hostId).toBe(host.sessionId);
    expect(room.isPrivate).toBe(true);

    const joined = roomOf(await joinRoom(guest, room.code.toLowerCase()));
    expect(joined.players.map((p) => p.id)).toEqual([host.sessionId, guest.sessionId]);
    expect(joined.players.every((p) => p.role === "competitor")).toBe(true);

    const hostView = await host.next<RoomState | null>("room:state", (r) => !!r && r.players.length === 2);
    expect(hostView?.code).toBe(room.code);
  });

  it("assigns pilot/engineer in co-op and lets the host swap roles", async () => {
    const host = await connect();
    const guest = await connect();
    const room = roomOf(await createRoom(host, "coop"));
    expect(room.players[0].role).toBe("pilot");
    const joined = roomOf(await joinRoom(guest, room.code));
    const roles = Object.fromEntries(joined.players.map((p) => [p.id, p.role]));
    expect(roles[host.sessionId]).toBe("pilot");
    expect(roles[guest.sessionId]).toBe("engineer");

    const notHost = await new Promise<AckRes<RoomState>>((r) => guest.socket.emit("room:configure", { swapRoles: true }, r));
    expect(notHost.ok).toBe(false);

    const swapped = await new Promise<AckRes<RoomState>>((r) => host.socket.emit("room:configure", { swapRoles: true }, r));
    const swappedRoles = Object.fromEntries(roomOf(swapped).players.map((p) => [p.id, p.role]));
    expect(swappedRoles[host.sessionId]).toBe("engineer");
    expect(swappedRoles[guest.sessionId]).toBe("pilot");
  });

  it("rejects joining a full room", async () => {
    const a = await connect();
    const b = await connect();
    const c = await connect();
    const room = roomOf(await createRoom(a, "1v1"));
    roomOf(await joinRoom(b, room.code));
    const res = await joinRoom(c, room.code);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/full|started/i);
    expect((await joinRoom(c, "ZZZZZ")).ok).toBe(false);
  });

  it("pairs two matchmaking clients into a non-private room in preparation", async () => {
    const a = await connect();
    const b = await connect();
    await new Promise((r) => a.socket.emit("matchmaking:join", { mode: "coop", name: "A" }, r));
    const queued = await a.next<{ queued: boolean; position?: number }>("matchmaking:status", (s) => s.queued);
    expect(queued.position).toBe(1);
    await new Promise((r) => b.socket.emit("matchmaking:join", { mode: "coop", name: "B" }, r));

    const room = await b.next<RoomState | null>("room:state", (r) => !!r && r.players.length === 2);
    expect(room?.isPrivate).toBe(false);
    expect(room?.difficulty).toBe("normal");
    expect(room?.code.startsWith("MM-")).toBe(true);
    expect(room?.players.map((p) => p.role).sort()).toEqual(["engineer", "pilot"]);
    await a.next("matchmaking:status", (s: { queued: boolean }) => !s.queued);

    const snap = await a.next<PublicMatchSnapshot>("match:snapshot");
    expect(snap.status).toBe("preparation");
    expect(snap.viewerId).toBe(a.sessionId);
  });

  it("ready -> countdown -> task assignment -> streaming snapshots", async () => {
    const a = await connect();
    const b = await connect();
    const room = roomOf(await createRoom(a, "1v1"));
    roomOf(await joinRoom(b, room.code));
    const prep = await a.next<PublicMatchSnapshot>("match:snapshot");
    expect(prep.status).toBe("preparation");

    a.socket.emit("player:ready", { commandId: "ready-a", ready: true });
    b.socket.emit("player:ready", { commandId: "ready-b", ready: true });

    const cd = await a.next<{ matchId: string; countdownMs: number }>("match:countdown");
    expect(cd.matchId).toBe(prep.id);
    expect(cd.countdownMs).toBeGreaterThan(0);
    await b.next("match:countdown");

    const task = await a.next<{ assignedId: string; instance: { taskId: string } }>("task:assigned");
    expect(task.instance.taskId).toBeTruthy();
    expect(JSON.stringify(task)).not.toContain("solution");

    const count = (): number => a.events.filter((e) => e.name === "match:snapshot").length;
    const before = count();
    const first = await a.next<PublicMatchSnapshot>("match:snapshot", (s) => s.status !== "preparation");
    await new Promise((r) => setTimeout(r, 600));
    expect(count() - before).toBeGreaterThanOrEqual(4); // ~10 Hz
    const latest = a.events.filter((e) => e.name === "match:snapshot").at(-1)?.payload as PublicMatchSnapshot;
    expect(["countdown", "active"]).toContain(latest.status);
    expect(latest.countdownMs <= first.countdownMs || latest.elapsedMs >= first.elapsedMs).toBe(true);
  });

  it("rejects invalid commands with command:rejected", async () => {
    const a = await connect();
    const b = await connect();
    // Not in a match yet.
    a.socket.emit("repair:activate", { commandId: "no-match" });
    const r1 = await a.next<{ commandId: string; reason: string }>("command:rejected", (r) => r.commandId === "no-match");
    expect(r1.reason).toBeTruthy();

    const room = roomOf(await createRoom(a, "1v1"));
    roomOf(await joinRoom(b, room.code));
    await a.next("match:snapshot");

    // Schema violation: unknown equipment id.
    (a.socket as unknown as { emit: (ev: string, p: unknown) => void }).emit("equipment:purchase", {
      commandId: "bad-equip", equipmentId: "death-ray",
    });
    const r2 = await a.next<{ commandId: string; reason: string }>("command:rejected", (r) => r.commandId === "bad-equip");
    expect(r2.reason).toMatch(/invalid/i);

    // Valid shape but rejected by the engine (no abilities in preparation).
    a.socket.emit("ability:activate", { commandId: "early-ability", abilityId: "thruster-burn" });
    const r3 = await a.next<{ commandId: string; reason: string }>("command:rejected", (r) => r.commandId === "early-ability");
    expect(r3.reason).toBeTruthy();
  });

  it("restores room and match state on reconnect with the same sessionId", async () => {
    const a = await connect();
    const b = await connect();
    const room = roomOf(await createRoom(a, "1v1"));
    roomOf(await joinRoom(b, room.code));
    await b.next("match:snapshot");

    b.socket.disconnect();
    const offline = await a.next<RoomState | null>("room:state", (r) => !!r && r.players.some((p) => !p.connected));
    expect(offline?.players.find((p) => p.id === b.sessionId)?.connected).toBe(false);

    const b2 = await connect(b.sessionId);
    const restored = await b2.next<RoomState | null>("room:state", (r) => !!r);
    expect(restored?.code).toBe(room.code);
    expect(restored?.players.find((p) => p.id === b.sessionId)?.connected).toBe(true);
    const snap = await b2.next<PublicMatchSnapshot>("match:snapshot");
    expect(snap.viewerId).toBe(b.sessionId);
  });

  it("leaving a launched match cancels it for the other player and closes the room", async () => {
    const { a, b, code } = await launchMatch("1v1");
    a.socket.emit("room:leave");

    const result = await b.next<{ outcome: { kind: string; reason?: string } }>("match:result");
    expect(result.outcome.kind).toBe("abandoned");
    expect(result.outcome.reason).toMatch(/Alpha left the match/);

    // The leaver cannot get back in, by code or by reconnecting.
    const rejoin = await joinRoom(a, code, "Alpha");
    expect(rejoin.ok).toBe(false);
    const a2 = await connect(a.sessionId, "Alpha");
    expect(await a2.next<RoomState | null>("room:state")).toBeNull();
  });

  it("co-op: a crewmate leaving mid-mission cancels the shared mission", async () => {
    const { a, b } = await launchMatch("coop");
    b.socket.emit("room:leave");
    const result = await a.next<{ outcome: { kind: string; reason?: string } }>("match:result");
    expect(result.outcome.kind).toBe("abandoned");
    expect(result.outcome.reason).toMatch(/Bravo left the mission/);
  });

  it("leaving during preparation keeps the other player in the room", async () => {
    const a = await connect(undefined, "Alpha");
    const b = await connect(undefined, "Bravo");
    const room = roomOf(await createRoom(a, "1v1", "Alpha"));
    roomOf(await joinRoom(b, room.code, "Bravo"));
    await a.next("match:snapshot");
    b.socket.emit("room:leave");
    const state = await a.next<RoomState | null>("room:state", (r) => !!r && r.players.length === 1);
    expect(state?.code).toBe(room.code);
    expect(a.events.some((e) => e.name === "match:result")).toBe(false);
  });

  it("a player who drops mid-match and does not return in time cancels it", async () => {
    const short = await startServer(0, { log: () => undefined, disconnectGraceMs: 300 });
    const saved = url;
    url = `http://localhost:${short.port}`;
    try {
      const { a, b } = await launchMatch("1v1");
      b.socket.disconnect();
      const result = await a.next<{ outcome: { kind: string; reason?: string } }>("match:result", () => true, 3000);
      expect(result.outcome.kind).toBe("abandoned");
      expect(result.outcome.reason).toMatch(/Bravo lost connection/);
    } finally {
      url = saved;
      await short.close();
    }
  });

  it("a player who reconnects within the grace period keeps the match going", async () => {
    const short = await startServer(0, { log: () => undefined, disconnectGraceMs: 1500 });
    const saved = url;
    url = `http://localhost:${short.port}`;
    try {
      const { a, b } = await launchMatch("1v1");
      b.socket.disconnect();
      await new Promise((r) => setTimeout(r, 200));
      const b2 = await connect(b.sessionId, "Bravo");
      expect((await b2.next<RoomState | null>("room:state"))?.players.length).toBe(2);
      await new Promise((r) => setTimeout(r, 1800)); // past the original grace window
      expect(a.events.some((e) => e.name === "match:result")).toBe(false);
      const snap = await b2.next<PublicMatchSnapshot>("match:snapshot");
      expect(snap.status === "countdown" || snap.status === "active").toBe(true);
    } finally {
      url = saved;
      await short.close();
    }
  });
});
