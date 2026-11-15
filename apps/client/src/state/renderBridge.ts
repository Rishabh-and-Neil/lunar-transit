// Non-React bridge between network/local snapshots and the Three.js scene.
// The scene reads this inside useFrame (no React re-render per frame).
import type { PublicMatchSnapshot } from "@sm/shared";

export const renderBridge = {
  prev: null as PublicMatchSnapshot | null,
  prevAt: 0, // performance.now() when prev arrived
  curr: null as PublicMatchSnapshot | null,
  currAt: 0,
  push(s: PublicMatchSnapshot) {
    this.prev = this.curr;
    this.prevAt = this.currAt;
    this.curr = s;
    this.currAt = performance.now();
  },
  reset() {
    this.prev = null;
    this.curr = null;
    this.prevAt = 0;
    this.currAt = 0;
  },
  /** Interpolated progress (route units) for a ship at render time `now`. */
  progressOf(shipId: string, now: number): number | null {
    const c = this.curr?.spacecraft.find((s) => s.id === shipId);
    if (!c) return null;
    const p = this.prev?.spacecraft.find((s) => s.id === shipId);
    if (!p) return c.progress;
    const span = Math.max(1, this.currAt - this.prevAt);
    const t = Math.min(1.5, (now - this.currAt) / span + 1) - 1; // 0..0.5 extrapolate a little
    return c.progress + (c.progress - p.progress) * Math.max(0, t);
  },
};
