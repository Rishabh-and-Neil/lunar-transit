// Looping in-flight soundtrack with its own mute setting (independent of SFX mute).
// Track: "Black Orbit" by MokkaMusic (see README credits).

const MUSIC_URL = "/audio/black-orbit.mp3";
const MUSIC_MUTE_KEY = "lt.musicMuted";
const VOLUME = 0.35;
const FADE_MS = 1200;

let audio: HTMLAudioElement | null = null;
let active = false;
let fadeTimer: number | null = null;
let muted = readMuted();
const listeners = new Set<(m: boolean) => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUSIC_MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(MUSIC_URL);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
  }
  return audio;
}

function fadeTo(target: number, then?: () => void): void {
  const a = getAudio();
  if (fadeTimer !== null) window.clearInterval(fadeTimer);
  const start = a.volume;
  const t0 = performance.now();
  fadeTimer = window.setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    a.volume = Math.max(0, Math.min(1, start + (target - start) * k));
    if (k >= 1) {
      if (fadeTimer !== null) window.clearInterval(fadeTimer);
      fadeTimer = null;
      then?.();
    }
  }, 50);
}

function apply(): void {
  const shouldPlay = active && !muted;
  const a = getAudio();
  if (shouldPlay) {
    if (a.paused) {
      a.volume = 0;
      // Browsers may block playback before a user gesture; by flight time the player has clicked.
      void a.play().catch(() => undefined);
    }
    fadeTo(VOLUME);
  } else if (!a.paused) {
    fadeTo(0, () => {
      if (!(active && !muted)) a.pause();
    });
  }
}

/** Turn the soundtrack on while the player's ship is in transit; off otherwise. */
export function setMusicActive(on: boolean): void {
  if (on === active) return;
  active = on;
  if (!on && audio) {
    // Restart from the top on the next flight.
    fadeTo(0, () => {
      if (!active && audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    return;
  }
  apply();
}

export function isMusicMuted(): boolean {
  return muted;
}

export function setMusicMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUSIC_MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
  apply();
  for (const cb of listeners) cb(m);
}

export function onMusicMuteChange(cb: (m: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
