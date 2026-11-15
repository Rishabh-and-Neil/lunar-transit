// Tiny synthesized sound effects via WebAudio. No audio files.
const MUTE_KEY = "lt.muted";

export type SfxName = "click" | "purchase" | "sell" | "ability" | "hit" | "warning" | "liftoff" | "success" | "fail" | "error";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();
const listeners = new Set<(m: boolean) => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return master ? { ctx, out: master } : null;
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime + (opts.delay ?? 0);
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
  const peak = opts.gain ?? 0.4;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; filter?: number; delay?: number; sweepTo?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime + (opts.delay ?? 0);
  const len = Math.max(1, Math.floor(a.ctx.sampleRate * dur));
  const buf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const f = a.ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(opts.filter ?? 800, t0);
  if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + dur);
  const g = a.ctx.createGain();
  const peak = opts.gain ?? 0.4;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.3, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.out);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export function playSfx(name: SfxName): void {
  if (muted) return;
  switch (name) {
    case "click":
      tone(1200, 0.05, { type: "triangle", gain: 0.15 });
      break;
    case "purchase":
      tone(660, 0.08, { type: "triangle", gain: 0.25 });
      tone(990, 0.12, { type: "triangle", gain: 0.25, delay: 0.07 });
      break;
    case "sell":
      tone(700, 0.08, { type: "triangle", gain: 0.2 });
      tone(470, 0.12, { type: "triangle", gain: 0.2, delay: 0.07 });
      break;
    case "ability":
      tone(300, 0.25, { type: "sawtooth", gain: 0.12, slideTo: 1200 });
      tone(900, 0.18, { type: "sine", gain: 0.2, delay: 0.08 });
      break;
    case "hit":
      noise(0.35, { gain: 0.5, filter: 1600, sweepTo: 200 });
      tone(90, 0.3, { type: "square", gain: 0.15, slideTo: 40 });
      break;
    case "warning":
      tone(880, 0.1, { type: "square", gain: 0.1 });
      tone(880, 0.1, { type: "square", gain: 0.1, delay: 0.18 });
      break;
    case "liftoff":
      noise(2.6, { gain: 0.6, filter: 180, sweepTo: 900 });
      tone(55, 2.4, { type: "sawtooth", gain: 0.12, slideTo: 110 });
      break;
    case "success":
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: "triangle", gain: 0.22, delay: i * 0.11 }));
      break;
    case "fail":
      [392, 330, 262].forEach((f, i) => tone(f, 0.4, { type: "sawtooth", gain: 0.1, delay: i * 0.16 }));
      break;
    case "error":
      tone(220, 0.14, { type: "square", gain: 0.09 });
      break;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(m));
}

export function onMuteChange(cb: (m: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
