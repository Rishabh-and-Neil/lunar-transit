// Small shared presentational components.
import { useEffect, useState, type ReactNode } from "react";
import { playSfx } from "../audio/sfx";
import { isMusicMuted, onMusicMuteChange, setMusicMuted } from "../audio/music";
import { useMuted } from "./hooks";

export function Meter(props: {
  label: string;
  value: number;
  max: number;
  display?: ReactNode;
  tone?: "accent" | "good" | "warn" | "bad" | "orange";
  overflow?: boolean;
  hint?: string;
}) {
  const pct = props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0;
  return (
    <div className={`meter tone-${props.overflow ? "bad" : props.tone ?? "accent"}`} title={props.hint}>
      <div className="meter-head">
        <span className="meter-label">{props.label}</span>
        <span className="meter-value">{props.display ?? `${Math.round(props.value)} / ${Math.round(props.max)}`}</span>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div className={`modal panel ${props.wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={props.title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  );
}

export function MuteToggle() {
  const [muted, setMuted] = useMuted();
  return (
    <button
      className="icon-btn mute-toggle"
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      title={muted ? "Sound off" : "Sound on"}
      onClick={() => {
        setMuted(!muted);
        if (muted) playSfx("click");
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

export function MusicToggle() {
  const [musicMuted, setMusicMutedState] = useState(isMusicMuted());
  useEffect(() => onMusicMuteChange(setMusicMutedState), []);
  return (
    <button
      className={`icon-btn mute-toggle music-toggle ${musicMuted ? "off" : ""}`}
      aria-label={musicMuted ? "Turn music on" : "Turn music off"}
      aria-pressed={!musicMuted}
      title={musicMuted ? "Music off" : "Music on"}
      onClick={() => {
        setMusicMuted(!musicMuted);
        playSfx("click");
      }}
    >
      🎵
    </button>
  );
}

/** Circular progress ring (0..1). */
export function Ring(props: { progress: number; size?: number; stroke?: number; className?: string }) {
  const size = props.size ?? 44;
  const stroke = props.stroke ?? 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, props.progress));
  return (
    <svg className={`ring ${props.className ?? ""}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="ring-fill"
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export function Credits(props: { value: number; className?: string }) {
  return (
    <span className={`credits ${props.className ?? ""}`}>
      <span className="credits-glyph">◈</span>
      {Math.round(props.value).toLocaleString()}
    </span>
  );
}
