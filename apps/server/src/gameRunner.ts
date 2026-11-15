// Fixed-step simulation clock. One instance per live match.
// setInterval only wakes us up; the number of steps is derived from real elapsed
// time, so the match clock keeps pace with wall time regardless of timer jitter or clients.

export class GameRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private accumulator = 0;
  private last = 0;

  constructor(
    private readonly stepMs: number,
    private readonly onStep: () => void,
    /** Upper bound on catch-up steps per wake-up (avoids a spiral after a long stall). */
    private readonly maxStepsPerWake = 40,
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.accumulator = 0;
    this.last = performance.now();
    this.timer = setInterval(() => this.wake(), this.stepMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private wake(): void {
    const now = performance.now();
    this.accumulator += now - this.last;
    this.last = now;
    let steps = 0;
    while (this.timer && this.accumulator >= this.stepMs) {
      this.accumulator -= this.stepMs;
      this.onStep();
      if (++steps >= this.maxStepsPerWake) {
        this.accumulator = 0; // drop the rest of a long stall
        break;
      }
    }
  }
}
