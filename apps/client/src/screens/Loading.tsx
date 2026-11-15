import { useEffect, useMemo, useRef, useState } from "react";
import { NASA_FACTS, NASA_SOURCES, type NasaFact } from "@sm/shared";
import { useGameStore } from "../state/gameStore";
import { playSfx } from "../audio/sfx";
import { useNow } from "../hud/hooks";

const FALLBACK_FACTS: NasaFact[] = [
  {
    id: "fallback-1",
    title: "Translunar injection",
    text: "To reach the Moon, a spacecraft performs a translunar injection burn that stretches its orbit until it intersects the Moon's path a few days later.",
    topic: "mission-design",
    sourceIds: [],
    sourceLocations: [],
  },
  {
    id: "fallback-2",
    title: "Every gram counts",
    text: "Mission designers track mass and power budgets closely: each extra kilogram needs more propellant, and every instrument must fit within the power the spacecraft can generate.",
    topic: "power",
    sourceIds: [],
    sourceLocations: [],
  },
];

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function FactCard({ fact, compact }: { fact: NasaFact; compact?: boolean }) {
  const source = fact.sourceIds.map((id) => NASA_SOURCES.find((s) => s.id === id)?.title).filter(Boolean)[0];
  return (
    <div className={`fact-card ${compact ? "compact" : ""}`}>
      <div className="fact-kicker">NASA FACT · {fact.topic.replace("-", " ").toUpperCase()}</div>
      <h3>{fact.title}</h3>
      <p>{fact.text}</p>
      {source && <div className="fact-source">Source: {source}</div>}
    </div>
  );
}

export function Loading() {
  const countdownMs = useGameStore((s) => s.snapshot?.countdownMs ?? 0);
  const at = useGameStore((s) => s.snapshotAt);
  const now = useNow(30);
  const remaining = Math.max(0, countdownMs - (now - at));
  const facts = useMemo(() => shuffled(NASA_FACTS.length ? NASA_FACTS : FALLBACK_FACTS), []);
  const [factIdx, setFactIdx] = useState(0);
  const digit = Math.ceil(remaining / 1000);
  const lastDigit = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setFactIdx((i) => (i + 1) % facts.length), 2600);
    return () => window.clearInterval(id);
  }, [facts.length]);

  useEffect(() => {
    if (lastDigit.current === digit) return;
    lastDigit.current = digit;
    if (digit > 0) playSfx("warning");
    else playSfx("liftoff");
  }, [digit]);

  const fact = facts[factIdx % facts.length];
  return (
    <div className="loading">
      <div className="loading-top">
        <div className="kicker">LAUNCH SEQUENCE</div>
        <div className="checklist">
          {["Guidance", "Propulsion", "Life support", "Comms"].map((c, i) => (
            <span key={c} className="check-item" style={{ animationDelay: `${i * 0.25}s` }}>
              ✓ {c}
            </span>
          ))}
        </div>
      </div>
      <div className="countdown" aria-live="assertive">
        <span key={digit} className={`count-digit ${digit === 0 ? "liftoff" : ""}`}>
          {digit > 0 ? digit : "LIFTOFF"}
        </span>
        <span className="count-label">{digit > 0 ? `T-minus ${digit}` : "Clear of the tower"}</span>
      </div>
      <div className="loading-fact" key={fact.id}>
        <FactCard fact={fact} />
      </div>
    </div>
  );
}
