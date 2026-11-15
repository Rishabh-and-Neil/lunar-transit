// Authoritative match lifecycle: creation, command queue, tick loop, snapshots, results.
import { randomInt, randomUUID } from "node:crypto";
import {
  TIMING, abandonMatch, advance, allPlayersReady, applyCommand, createMatch, getSnapshot,
  setPlayerConnected, startCountdown,
} from "@sm/shared";
import type { MatchConfig, MatchResultPayload, MatchState, PlayerCommand, PublicMatchSnapshot, ValidationResult } from "@sm/shared";
import { GameRunner } from "./gameRunner";
import { buildResult, describeOutcome } from "./resultService";
import { ownTaskFromSnapshot, type AssignedTaskPayload } from "./taskService";
import type { Room } from "./roomManager";

/** Per-player outbound channel (implemented by the socket gateway). */
export interface PlayerChannel {
  snapshot(playerId: string, snapshot: PublicMatchSnapshot): void;
  countdown(playerId: string, payload: { matchId: string; countdownMs: number }): void;
  rejected(playerId: string, payload: { commandId: string; reason: string }): void;
  taskAssigned(playerId: string, payload: AssignedTaskPayload): void;
  result(playerId: string, payload: MatchResultPayload): void;
}

export interface MatchManagerOptions {
  tickMs?: number;
  finishedRetentionMs?: number;
  maxQueuedCommands?: number;
  log?: (line: string) => void;
  /** Called when a match enters its countdown. */
  onCountdown?: (entry: MatchEntry) => void;
  /** Called when a match reaches "finished" (after results are sent). */
  onFinished?: (entry: MatchEntry) => void;
}

export interface MatchEntry {
  id: string;
  roomCode: string;
  state: MatchState;
  queue: PlayerCommand[];
  runner: GameRunner;
  ticks: number;
  /** Players who already received "task:assigned". */
  taskSent: Set<string>;
  finished: boolean;
  deleteTimer?: ReturnType<typeof setTimeout>;
}

export class MatchManager {
  private readonly matches = new Map<string, MatchEntry>();
  private readonly tickMs: number;
  private readonly finishedRetentionMs: number;
  private readonly maxQueued: number;
  private readonly log: (line: string) => void;

  constructor(private readonly channel: PlayerChannel, private readonly opts: MatchManagerOptions = {}) {
    this.tickMs = opts.tickMs ?? TIMING.tickMs;
    this.finishedRetentionMs = opts.finishedRetentionMs ?? 120_000;
    this.maxQueued = opts.maxQueuedCommands ?? 64;
    this.log = opts.log ?? (() => undefined);
  }

  get(matchId: string | undefined): MatchEntry | undefined {
    return matchId ? this.matches.get(matchId) : undefined;
  }

  /** Creates a match in "preparation" for a full room and starts its runner. Returns null on engine failure. */
  createForRoom(room: Room): MatchEntry | null {
    const config: MatchConfig = {
      id: `m-${randomUUID()}`,
      mode: room.mode,
      difficulty: room.difficulty,
      seed: randomInt(0, 0x1_0000_0000),
      players: room.players.map((p) => ({ id: p.id, name: p.name, role: p.role })),
    };
    let state: MatchState;
    try {
      state = createMatch(config);
      for (const p of room.players) if (!p.connected) state = setPlayerConnected(state, p.id, false);
    } catch (err) {
      this.log(`[match] create failed for room ${room.code}: ${errMsg(err)}`);
      return null;
    }
    const entry: MatchEntry = {
      id: state.id, roomCode: room.code, state, queue: [], ticks: 0, taskSent: new Set(), finished: false,
      runner: new GameRunner(this.tickMs, () => this.step(entry)),
    };
    this.matches.set(entry.id, entry);
    entry.runner.start();
    this.log(`[match] ${entry.id} created (${room.mode}/${room.difficulty}) room ${room.code}: ${config.players.map((p) => `${p.name}:${p.role}`).join(", ")}`);
    this.broadcastSnapshots(entry);
    return entry;
  }

  /**
   * Difficulty / role changes are only allowed while nothing has been committed:
   * status "preparation", no equipment bought (credits untouched) and nobody ready.
   * The match is then recreated from the room. Otherwise the change is rejected.
   */
  canReconfigure(matchId: string): ValidationResult {
    const e = this.matches.get(matchId);
    if (!e) return { ok: true };
    if (e.state.status !== "preparation") return { ok: false, reason: "Match already started" };
    if (e.state.players.some((p) => p.ready)) return { ok: false, reason: "Cannot change settings after a player is ready" };
    const touched = e.state.spacecraft.some(
      (s) => s.attachments.length > 0 || s.hasRepairDrone || s.repairUpgraded || s.stats.creditsSpentEquipment > 0,
    );
    if (touched) return { ok: false, reason: "Cannot change settings after equipment was purchased" };
    return { ok: true };
  }

  /** Queue a validated command for the next tick. */
  enqueue(matchId: string, command: PlayerCommand): ValidationResult {
    const e = this.matches.get(matchId);
    if (!e || e.finished) return { ok: false, reason: "Match is not running" };
    if (e.queue.length >= this.maxQueued) return { ok: false, reason: "Too many pending commands" };
    e.queue.push(command);
    return { ok: true };
  }

  setConnected(matchId: string | undefined, playerId: string, connected: boolean): void {
    const e = this.get(matchId);
    if (!e || !e.state.players.some((p) => p.id === playerId)) return;
    try {
      e.state = setPlayerConnected(e.state, playerId, connected);
    } catch (err) {
      this.log(`[match] ${e.id} setPlayerConnected failed: ${errMsg(err)}`);
      return;
    }
    if (!e.finished) this.broadcastSnapshots(e);
  }

  isPlayerInMatch(matchId: string | undefined, playerId: string): boolean {
    const e = this.get(matchId);
    return !!e && e.state.players.some((p) => p.id === playerId);
  }

  /** Full resync for a (re)connecting player: snapshot, own task, and result if finished. */
  sendFullState(matchId: string | undefined, playerId: string): void {
    const e = this.get(matchId);
    if (!e || !e.state.players.some((p) => p.id === playerId)) return;
    try {
      const snap = getSnapshot(e.state, playerId);
      const task = ownTaskFromSnapshot(snap);
      if (task) {
        this.channel.taskAssigned(playerId, task);
        e.taskSent.add(playerId);
      }
      this.channel.snapshot(playerId, snap);
      if (e.finished) this.channel.result(playerId, buildResult(e.state, playerId));
    } catch (err) {
      this.log(`[match] ${e.id} snapshot failed: ${errMsg(err)}`);
    }
  }

  /**
   * Cancel a running match: mark it abandoned with `reason`, send every player a final snapshot and
   * result (so the remaining player sees why it ended), then dispose of it. No-op if already finished.
   */
  cancel(matchId: string | undefined, reason: string): boolean {
    const e = this.get(matchId);
    if (!e || e.finished) return false;
    try {
      e.state = abandonMatch(e.state, reason);
    } catch (err) {
      this.log(`[match] ${e.id} cancel failed: ${errMsg(err)}`);
      this.dispose(e.id);
      return false;
    }
    this.log(`[match] ${e.id} cancelled (${reason})`);
    this.broadcastSnapshots(e);
    this.finish(e);
    return true;
  }

  /** Abandon (if still running) and delete. */
  abandonAndDispose(matchId: string | undefined, reason: string): void {
    const e = this.get(matchId);
    if (!e) return;
    if (!e.finished) {
      try {
        e.state = abandonMatch(e.state, reason);
      } catch (err) {
        this.log(`[match] ${e.id} abandon failed: ${errMsg(err)}`);
      }
      this.log(`[match] ${e.id} abandoned (${reason})`);
    }
    this.dispose(e.id);
  }

  dispose(matchId: string | undefined): void {
    const e = this.get(matchId);
    if (!e) return;
    e.runner.stop();
    if (e.deleteTimer) clearTimeout(e.deleteTimer);
    this.matches.delete(e.id);
  }

  closeAll(): void {
    for (const id of [...this.matches.keys()]) this.dispose(id);
  }

  // -------------------------------------------------------------------------

  private step(e: MatchEntry): void {
    let changed = false;
    try {
      // 1) Commands, in arrival order.
      const batch = e.queue.splice(0);
      for (const cmd of batch) {
        const res = applyCommand(e.state, cmd);
        e.state = res.state;
        if (res.ok) changed = true;
        else this.channel.rejected(cmd.playerId, { commandId: cmd.commandId, reason: res.reason });
      }

      // 2) Everyone ready -> countdown.
      if (e.state.status === "preparation" && allPlayersReady(e.state)) {
        e.state = startCountdown(e.state);
        changed = true;
        this.log(`[match] ${e.id} start (countdown ${e.state.countdownMs}ms)`);
        for (const p of e.state.players) this.channel.countdown(p.id, { matchId: e.id, countdownMs: e.state.countdownMs });
        this.opts.onCountdown?.(e);
      }

      // 3) Simulation.
      let periodic = false;
      if (e.state.status === "countdown" || e.state.status === "active") {
        e.state = advance(e.state, this.tickMs);
        e.ticks++;
        periodic = e.ticks % TIMING.snapshotEveryTicks === 0;
      }

      // 4) Snapshots.
      if (changed || periodic || e.state.status === "finished") this.broadcastSnapshots(e);
    } catch (err) {
      this.log(`[match] ${e.id} tick error: ${errMsg(err)}`);
      try {
        e.state = abandonMatch(e.state, "server-error");
      } catch {
        e.runner.stop();
        return;
      }
    }

    // 5) End of match.
    if (e.state.status === "finished") this.finish(e);
  }

  private broadcastSnapshots(e: MatchEntry): void {
    for (const p of e.state.players) {
      try {
        const snap = getSnapshot(e.state, p.id);
        if (!e.taskSent.has(p.id) && e.state.status !== "preparation") {
          const task = ownTaskFromSnapshot(snap);
          if (task) {
            this.channel.taskAssigned(p.id, task);
            e.taskSent.add(p.id);
          }
        }
        this.channel.snapshot(p.id, snap);
      } catch (err) {
        this.log(`[match] ${e.id} snapshot failed for ${p.id}: ${errMsg(err)}`);
      }
    }
  }

  private finish(e: MatchEntry): void {
    if (e.finished) return;
    e.finished = true;
    e.runner.stop();
    e.queue.length = 0;
    for (const p of e.state.players) {
      try {
        this.channel.result(p.id, buildResult(e.state, p.id));
      } catch (err) {
        this.log(`[match] ${e.id} result failed for ${p.id}: ${errMsg(err)}`);
      }
    }
    this.log(`[match] ${e.id} end: ${describeOutcome(e.state)}`);
    e.deleteTimer = setTimeout(() => this.dispose(e.id), this.finishedRetentionMs);
    e.deleteTimer.unref?.();
    this.opts.onFinished?.(e);
  }
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
