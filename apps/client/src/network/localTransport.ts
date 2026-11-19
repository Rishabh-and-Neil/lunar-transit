// Runs the shared deterministic engine in the browser (solo + tutorial).
// Fixed-step simulation at TIMING.tickMs with an accumulator; snapshots at 10 Hz.
import {
  TIMING,
  advance,
  allPlayersReady,
  applyCommand,
  createMatch,
  getSnapshot,
  startCountdown,
  type Difficulty,
  type EquipmentId,
  type MatchState,
  type PlayerCommand,
  type RecordedCommand,
  type SoloRunRecord,
} from "@sm/shared";
import type { CommandInput, GameTransport, TransportHandlers } from "./transport";
import { newCommandId } from "./commands";

export interface LocalMatchOptions {
  playerId: string;
  name: string;
  difficulty: Difficulty;
  tutorial: boolean;
}

/** Max simulated time per timer callback (prevents spiral of death after a stall). */
const MAX_CATCHUP_MS = 1000;

export class LocalTransport implements GameTransport {
  readonly kind = "local" as const;
  readonly playerId: string;
  private state: MatchState;
  private timer: number | null = null;
  private lastAt = 0;
  private acc = 0;
  private ticks = 0;
  private lastEmitTick = 0;
  private lastEmitAt = 0;
  private timeScale = 1;
  private paused = false;
  /** Every command with the engine tick it was applied at, for leaderboard replay verification. */
  private log: RecordedCommand[] = [];
  private disposed = false;

  constructor(
    private opts: LocalMatchOptions,
    private handlers: TransportHandlers,
  ) {
    this.playerId = opts.playerId;
    this.state = LocalTransport.create(opts);
  }

  private static create(opts: LocalMatchOptions): MatchState {
    return createMatch({
      id: `local-${Date.now().toString(36)}`,
      mode: "solo",
      difficulty: opts.difficulty,
      seed: Math.floor(Math.random() * 2 ** 31),
      players: [{ id: opts.playerId, name: opts.name, role: "solo" }],
      tutorial: opts.tutorial,
    });
  }

  /** Emits the initial (preparation) snapshot. */
  start(): void {
    this.emit();
  }

  /**
   * Tutorial only: run the same engine faster than real time (more fixed ticks per real ms).
   * Gameplay rules are unchanged; tutorial results are never recorded.
   */
  setTimeScale(scale: number): void {
    if (!this.opts.tutorial) return;
    this.timeScale = Math.max(1, Math.min(16, scale));
  }

  /** Tutorial only: freeze the simulation while the player reads (commands still apply instantly). */
  setPaused(paused: boolean): void {
    if (!this.opts.tutorial) return;
    this.paused = paused;
    this.lastAt = performance.now();
  }

  get difficulty(): Difficulty {
    return this.opts.difficulty;
  }

  /** Solo only, during preparation: rebuild the match at a new difficulty, keeping the loadout. */
  setDifficulty(difficulty: Difficulty): void {
    if (this.state.status !== "preparation" || difficulty === this.opts.difficulty) return;
    const old = this.state.spacecraft[0];
    const loadout: EquipmentId[] = old ? [...old.attachments] : [];
    if (old?.hasRepairDrone) loadout.push("repair-drone");
    if (old?.repairUpgraded) loadout.push("repair-upgrade");
    this.opts = { ...this.opts, difficulty };
    let next = LocalTransport.create(this.opts);
    for (const equipmentId of loadout) {
      const r = applyCommand(next, { type: "PURCHASE_EQUIPMENT", equipmentId, commandId: newCommandId(), playerId: this.playerId });
      next = r.state;
    }
    this.state = next;
    this.log = loadout.map((equipmentId) => ({ tick: 0, cmd: { type: "PURCHASE_EQUIPMENT", equipmentId } }));
    this.emit();
  }

  /** The replayable record of this run (seed + commands), sent to the server for leaderboard verification. */
  getRunRecord(): SoloRunRecord {
    return { v: 1, seed: this.state.seed, difficulty: this.opts.difficulty, name: this.opts.name, commands: [...this.log] };
  }

  send(command: CommandInput, commandId: string): void {
    if (this.disposed) return;
    const full = { ...command, commandId, playerId: this.playerId } as PlayerCommand;
    this.log.push({ tick: this.ticks, cmd: { ...command } as RecordedCommand["cmd"] });
    let result;
    try {
      result = applyCommand(this.state, full);
    } catch (e) {
      this.handlers.onRejected(commandId, e instanceof Error ? e.message : "Command failed");
      return;
    }
    this.state = result.state;
    if (!result.ok) this.handlers.onRejected(commandId, result.reason);
    if (this.state.status === "preparation" && allPlayersReady(this.state)) {
      this.state = startCountdown(this.state);
      this.startLoop();
    }
    this.emit();
  }

  private startLoop(): void {
    if (this.timer !== null || this.disposed) return;
    this.lastAt = performance.now();
    this.acc = 0;
    this.timer = window.setInterval(() => this.pump(), 16);
  }

  private pump(): void {
    const now = performance.now();
    if (this.paused) {
      this.lastAt = now;
      return;
    }
    this.acc += Math.min(MAX_CATCHUP_MS, now - this.lastAt) * this.timeScale;
    this.lastAt = now;
    let emitted = false;
    let budget = 400; // hard cap on ticks per callback
    while (this.acc >= TIMING.tickMs && budget-- > 0) {
      this.acc -= TIMING.tickMs;
      try {
        this.state = advance(this.state, TIMING.tickMs);
      } catch (e) {
        console.error("[LocalTransport] engine advance failed", e);
        this.stopLoop();
        return;
      }
      this.ticks++;
      // 10 Hz in real time (also when time-warped in the tutorial).
      if (this.ticks - this.lastEmitTick >= TIMING.snapshotEveryTicks && now - this.lastEmitAt >= 90) emitted = true;
      if (this.state.status === "finished") {
        this.stopLoop();
        emitted = true;
        break;
      }
    }
    if (budget <= 0) this.acc = 0;
    if (emitted) this.emit();
  }

  private stopLoop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private emit(): void {
    if (this.disposed) return;
    this.lastEmitTick = this.ticks;
    this.lastEmitAt = performance.now();
    try {
      this.handlers.onSnapshot(getSnapshot(this.state, this.playerId));
    } catch (e) {
      console.error("[LocalTransport] snapshot failed", e);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
  }
}
