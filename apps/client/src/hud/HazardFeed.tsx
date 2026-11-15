import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { ABILITIES, HAZARDS, LUNAR_TASKS, type GameEvent, type PublicMatchSnapshot } from "@sm/shared";
import { useGameStore } from "../state/gameStore";
import { formatClock } from "../state/selectors";
import { playSfx } from "../audio/sfx";
import { useNow } from "./hooks";

export function HazardBanner() {
  const hazards = useGameStore(
    useShallow((s) => (s.snapshot ? s.snapshot.hazards.filter((h) => h.shipId === s.snapshot?.viewerShipId && !h.resolved && h.strikesInMs > 0) : [])),
  );
  const at = useGameStore((s) => s.snapshotAt);
  const deflectorReady = useGameStore((s) => {
    const ship = s.snapshot?.spacecraft.find((x) => x.id === s.snapshot?.viewerShipId);
    return !!ship && (ship.cooldowns["deflector-surge"] ?? 0) <= 0;
  });
  const shielded = useGameStore((s) => {
    const ship = s.snapshot?.spacecraft.find((x) => x.id === s.snapshot?.viewerShipId);
    return !!ship?.effects.some((e) => e.type === "damage-reduction" && e.remainingMs > 0);
  });
  const now = useNow(20, hazards.length > 0);
  if (hazards.length === 0) return null;
  const h = [...hazards].sort((a, b) => a.strikesInMs - b.strikesInMs)[0];
  const def = HAZARDS[h.type];
  const secs = Math.max(0, (h.strikesInMs - (now - at)) / 1000);
  return (
    <div className="hazard-banner" role="alert" data-tour="hazard">
      <span className="hazard-icon">{def.icon}</span>
      <div className="hazard-text">
        <span className="hazard-kicker">⚠ HAZARD INBOUND{hazards.length > 1 ? ` (+${hazards.length - 1})` : ""}</span>
        <strong>{def.name}</strong>
        <span className="hazard-sub">
          {def.short}
          {def.damageType !== "none" ? ` · ${def.damageType} damage` : " · slows ship"}
          {shielded ? " · deflector active" : deflectorReady && def.damageType !== "none" ? " · press 3 for Deflector Surge" : ""}
        </span>
      </div>
      <span className="hazard-count">{secs.toFixed(1)}s</span>
    </div>
  );
}

function describe(e: GameEvent, snap: PublicMatchSnapshot): { text: string; tone: "bad" | "good" | "info" | "warn"; icon: string } | null {
  const mine = snap.viewerShipId;
  const name = (pid: string) => (pid === snap.viewerId ? "You" : snap.players.find((p) => p.id === pid)?.name ?? "Opponent");
  switch (e.kind) {
    case "hazard-hit": {
      if (e.shipId !== mine) return null;
      const h = HAZARDS[e.hazard];
      if (h.damageType === "none") return { icon: h.icon, tone: "warn", text: `${h.name}: guidance drift slowed the ship` };
      return {
        icon: h.icon,
        tone: "bad",
        text: `${h.name} hit: −${Math.round(e.damage)} HP${e.prevented > 0.5 ? ` (${Math.round(e.prevented)} blocked)` : ""}`,
      };
    }
    case "hazard-warning":
      return null;
    case "ability": {
      const a = ABILITIES[e.ability];
      if (e.targetShipId === mine && e.shipId !== mine) return { icon: a.icon, tone: "bad", text: `${name(e.playerId)} used ${a.name} on you` };
      if (e.shipId === mine) {
        const target = e.targetShipId && e.targetShipId !== mine ? " on rival" : "";
        return { icon: a.icon, tone: "good", text: `${e.auto ? "Auto-sim" : name(e.playerId)}: ${a.name}${target}${e.overtime ? " (½)" : ""}` };
      }
      return null;
    }
    case "repair-start":
      return e.shipId === mine ? { icon: "🤖", tone: "info", text: `Repair drone deployed (◈${e.cost})` } : null;
    case "repair-done":
      return e.shipId === mine ? { icon: "🤖", tone: "good", text: `Repair complete: +${Math.round(e.healed)} HP` } : null;
    case "phase": {
      const own = e.shipId === mine;
      const who = own ? "Your ship" : "Rival";
      if (e.phase === "overtime") return own ? { icon: "⏱", tone: "warn", text: "Overtime: abilities ½ cost, ½ effect" } : null;
      if (e.phase === "simulation") return own ? { icon: "⏩", tone: "warn", text: "Accelerated simulation engaged" } : null;
      if (e.phase === "lunar-task") return { icon: "🌕", tone: own ? "good" : "info", text: `${who} arrived at the Moon` };
      if (e.phase === "destroyed") return { icon: "💥", tone: own ? "bad" : "good", text: `${who} was destroyed` };
      return null;
    }
    case "task-failed-attempt":
      return { icon: "✖", tone: "warn", text: `${name(e.playerId)}: task attempt failed` };
    case "task-complete": {
      const t = snap.tasks.find((x) => x.playerId === e.playerId);
      return { icon: "✔", tone: "good", text: `${name(e.playerId)} completed ${t ? LUNAR_TASKS[t.taskId].title : "the task"}` };
    }
    case "match-end":
      return null;
  }
}

/** Plays SFX for new events relevant to the viewer. */
export function useEventSounds(): void {
  const lastSeq = useRef<number>(-1);
  const events = useGameStore((s) => s.snapshot?.events);
  const snap = useGameStore.getState().snapshot;
  useEffect(() => {
    if (!events || !snap) return;
    const maxSeq = events.reduce((m, e) => Math.max(m, e.seq), -1);
    if (lastSeq.current < 0) {
      lastSeq.current = maxSeq;
      return;
    }
    for (const e of events) {
      if (e.seq <= lastSeq.current) continue;
      if (e.kind === "hazard-warning" && e.shipId === snap.viewerShipId) playSfx("warning");
      if (e.kind === "hazard-hit" && e.shipId === snap.viewerShipId && e.damage > 0) playSfx("hit");
      if (e.kind === "ability" && e.targetShipId === snap.viewerShipId && e.shipId !== snap.viewerShipId) playSfx("hit");
      if (e.kind === "repair-done" && e.shipId === snap.viewerShipId) playSfx("purchase");
      if (e.kind === "task-complete") playSfx("success");
      if (e.kind === "task-failed-attempt" && e.playerId === snap.viewerId) playSfx("fail");
    }
    lastSeq.current = Math.max(lastSeq.current, maxSeq);
  }, [events, snap]);
}

export function EventFeed() {
  const events = useGameStore((s) => s.snapshot?.events);
  const snap = useGameStore.getState().snapshot;
  if (!events || !snap) return null;
  const lines = [...events]
    .sort((a, b) => b.seq - a.seq)
    .map((e) => ({ e, d: describe(e, snap) }))
    .filter((x): x is { e: GameEvent; d: NonNullable<ReturnType<typeof describe>> } => x.d !== null)
    .slice(0, 6);
  if (lines.length === 0) return null;
  return (
    <div className="event-feed" aria-live="polite" data-tour="log">
      {lines.map(({ e, d }, i) => (
        <div key={e.seq} className={`feed-line tone-${d.tone}`} style={{ opacity: 1 - i * 0.13 }}>
          <span className="feed-time">{formatClock(e.atMs)}</span>
          <span className="feed-icon">{d.icon}</span>
          <span className="feed-text">{d.text}</span>
        </div>
      ))}
    </div>
  );
}
