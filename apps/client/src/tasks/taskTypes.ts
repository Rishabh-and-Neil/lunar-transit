import type { CSSProperties } from "react";
import type { PublicTaskInstance, TaskSubmission } from "@sm/shared";

/** Props every task minigame receives. `onChange(null)` means "not ready to submit yet". */
export interface TaskComponentProps<T extends PublicTaskInstance> {
  task: T;
  onChange: (submission: TaskSubmission | null) => void;
}

/** Typed helper for CSS custom properties in inline styles. */
export function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Small deterministic PRNG (mulberry32) seeded from a string, for stable procedural art. */
export function seededRandom(key: string): () => number {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round to a sensible number of decimals for display. */
export function fmt(v: number, digits = 1): string {
  return v.toFixed(digits);
}
