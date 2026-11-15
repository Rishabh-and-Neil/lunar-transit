import { useEffect, useRef, useState } from "react";
import { useGameStore } from "../state/gameStore";
import { isMuted, onMuteChange, setMuted } from "../audio/sfx";

/** Re-renders at ~`fps` with performance.now(). */
export function useNow(fps = 30, active = true): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const step = 1000 / fps;
    const loop = (t: number) => {
      if (t - last >= step) {
        last = t;
        setNow(t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, active]);
  return now;
}

/** Mission clock smoothed between 10 Hz snapshots (display only). */
export function useSmoothElapsed(): number {
  const elapsed = useGameStore((s) => s.snapshot?.elapsedMs ?? 0);
  const at = useGameStore((s) => s.snapshotAt);
  const running = useGameStore((s) => s.snapshot?.status === "active");
  const now = useNow(20, running);
  if (!running) return elapsed;
  return elapsed + Math.min(250, Math.max(0, now - at));
}

/** Smoothly animates a number toward its target. */
export function useAnimatedNumber(target: number, durationMs = 450): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const valueRef = useRef(target);
  valueRef.current = value;
  useEffect(() => {
    fromRef.current = valueRef.current;
    if (fromRef.current === target) return;
    const start = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs);
      const e = 1 - Math.pow(1 - k, 3);
      setValue(fromRef.current + (target - fromRef.current) * e);
      if (k < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

export function useMuted(): [boolean, (m: boolean) => void] {
  const [m, setM] = useState(isMuted());
  useEffect(() => onMuteChange(setM), []);
  return [m, setMuted];
}

/** Returns a counter that increments whenever `value` decreases (for flash effects). */
export function useDecreaseFlash(value: number): number {
  const prev = useRef(value);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (value < prev.current - 0.01) setN((x) => x + 1);
    prev.current = value;
  }, [value]);
  return n;
}
