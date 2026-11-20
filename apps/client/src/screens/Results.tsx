import { useMemo, useState } from "react";
import {
  ABILITIES,
  ABILITY_IDS,
  ATTACHMENTS,
  DIFFICULTY,
  LUNAR_TASKS,
  NASA_FACTS,
  type Difficulty,
  type LunarTaskId,
  type NasaFact,
  type PublicMatchSnapshot,
  type PublicShip,
} from "@sm/shared";
import { openLeaderboard, useGameStore } from "../state/gameStore";
import { formatClock, totalCreditsSpent, viewerShip } from "../state/selectors";
import { playAgain, returnToMenu } from "../network/session";
import { playSfx } from "../audio/sfx";
import { FactCard } from "./Loading";
import { ROLE_INFO } from "./Lobby";

const TASK_TOPIC: Record<LunarTaskId, NasaFact["topic"][]> = {
  "surface-analysis": ["lunar-science"],
  "terrain-mapping": ["lunar-science", "navigation"],
  communications: ["navigation", "mission-design"],
  "power-calibration": ["power"],
  "orbit-calibration": ["mission-design", "navigation"],
};

function header(snap: PublicMatchSnapshot): { title: string; sub: string; tone: "good" | "bad" | "warn" } {
  const o = snap.outcome;
  const name = (id: string) => snap.players.find((p) => p.id === id)?.name ?? "Opponent";
  if (!o) return { title: "Mission Ended", sub: "", tone: "warn" };
  switch (o.kind) {
    case "solo-complete":
      return { title: "Mission Complete", sub: `Total mission time ${formatClock(o.totalMs, true)}`, tone: "good" };
    case "solo-destroyed":
      return { title: "Mission Failed", sub: `Spacecraft destroyed at T+${formatClock(o.atMs)}`, tone: "bad" };
    case "coop-complete":
      return { title: "Crew Mission Complete", sub: `Team time ${formatClock(o.totalMs, true)}`, tone: "good" };
    case "coop-destroyed":
      return { title: "Mission Failed", sub: `The shared spacecraft was destroyed at T+${formatClock(o.atMs)}`, tone: "bad" };
    case "1v1-task": {
      const won = o.winnerId === snap.viewerId;
      return {
        title: won ? "Victory" : "Defeat",
        sub: won ? `You completed the lunar task first · ${formatClock(o.totalMs, true)}` : `${name(o.winnerId)} completed the lunar task first · ${formatClock(o.totalMs, true)}`,
        tone: won ? "good" : "bad",
      };
    }
    case "1v1-destroyed": {
      const won = o.winnerId === snap.viewerId;
      return {
        title: won ? "Victory" : "Defeat",
        sub: won ? `${name(o.loserId)}'s spacecraft was destroyed at T+${formatClock(o.atMs)}` : `Your spacecraft was destroyed at T+${formatClock(o.atMs)}`,
        tone: won ? "good" : "bad",
      };
    }
    case "abandoned":
      return { title: "Mission Aborted", sub: o.reason, tone: "warn" };
  }
}

function StatCard(props: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`result-stat ${props.tone ? `tone-${props.tone}` : ""}`}>
      <span className="stat-label">{props.label}</span>
      <span className="stat-value">{props.value}</span>
      {props.sub && <span className="stat-sub">{props.sub}</span>}
    </div>
  );
}

function ShipBreakdown({ ship, snap }: { ship: PublicShip; snap: PublicMatchSnapshot }) {
  const owners = snap.players.filter((p) => ship.ownerIds.includes(p.id));
  const st = ship.stats;
  const tasks = snap.tasks.filter((t) => ship.ownerIds.includes(t.playerId));
  const usedAbilities = ABILITY_IDS.filter((a) => (st.abilitiesUsed[a] ?? 0) > 0);
  const rows: [string, string][] = [
    ["Arrival", ship.arrivedAtMs !== undefined ? `T+${formatClock(ship.arrivedAtMs, true)}` : ship.destroyedAtMs !== undefined ? `Destroyed T+${formatClock(ship.destroyedAtMs)}` : "—"],
    ["Credits on equipment", `◈${st.creditsSpentEquipment}`],
    ["Credits on abilities", `◈${st.creditsSpentAbilities}`],
    ["Credits on repairs", `◈${st.creditsSpentRepairs}`],
    ["Credits earned in flight", `◈${Math.round(st.creditsEarned)}`],
    ["Credits remaining", `◈${Math.round(ship.credits)}`],
    ["Damage taken", `${Math.round(st.damageTaken)} HP`],
    ["Damage prevented", `${Math.round(st.damagePrevented)} HP`],
    ["Hull repaired", `${Math.round(st.healthRepaired)} HP (${ship.repairsUsed} repairs)`],
    ["Hazards encountered", `${st.hazardsEncountered}`],
    ["Deterrents received", `${st.deterrentsReceived}`],
    ["Peak velocity", `${st.peakVelocity.toFixed(2)} u/s`],
    ["Time in overtime", formatClock(st.timeInOvertimeMs)],
    ["Time in auto-simulation", formatClock(st.timeInSimulationMs)],
    ["Auto-sim purchases", `${st.autoSimPurchases}`],
    ...tasks.map((t): [string, string] => [
      `${LUNAR_TASKS[t.taskId].title} (${snap.players.find((p) => p.id === t.playerId)?.name ?? "?"})`,
      `${t.attempts} attempt${t.attempts === 1 ? "" : "s"}${t.completedAtMs !== undefined ? ` · done T+${formatClock(t.completedAtMs)}` : ""}`,
    ]),
  ];
  return (
    <div className="breakdown panel-glass">
      <h4>
        {ship.id === snap.viewerShipId ? "Your spacecraft" : "Rival spacecraft"} ·{" "}
        {owners.map((o) => `${o.name}${snap.mode === "coop" ? ` (${ROLE_INFO[o.role].label})` : ""}`).join(" + ")}
      </h4>
      <div className="breakdown-grid">
        {rows.map(([k, v]) => (
          <div key={k} className="bd-row">
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <div className="bd-section">
        <span className="stat-label">Abilities used</span>
        <div className="bd-chips">
          {usedAbilities.length === 0 && <span className="muted">None</span>}
          {usedAbilities.map((a) => (
            <span key={a} className="eq-chip">
              {ABILITIES[a].icon} {ABILITIES[a].name} ×{st.abilitiesUsed[a]}
            </span>
          ))}
        </div>
      </div>
      <div className="bd-section">
        <span className="stat-label">Loadout</span>
        <div className="bd-chips">
          {ship.attachments.length === 0 && !ship.hasRepairDrone && <span className="muted">Bare hull</span>}
          {ship.attachments.map((a) => (
            <span key={a} className="eq-chip">
              {ATTACHMENTS[a].icon} {ATTACHMENTS[a].name}
            </span>
          ))}
          {ship.hasRepairDrone && <span className="eq-chip">🤖 Repair Drone{ship.repairUpgraded ? " +" : ""}</span>}
        </div>
      </div>
    </div>
  );
}

function LeaderboardRank({ mode, difficulty }: { mode: string; difficulty: Difficulty }) {
  const lb = useGameStore((s) => s.lbSubmit);
  if (mode === "1v1" || lb.status === "idle") return null;
  const board = mode === "coop" ? "coop" : "solo";
  const view = () => openLeaderboard({ mode: board, difficulty });
  if (lb.status === "pending") return <div className="lb-result"><span className="spinner small" /> Verifying your run for the global leaderboard…</div>;
  if (lb.status === "error")
    return (
      <div className="lb-result err">
        Not on the leaderboard: {lb.reason}
        <button className="btn btn-small btn-ghost" onClick={view}>View leaderboard</button>
      </div>
    );
  if (lb.kept !== undefined)
    return (
      <div className="lb-result">
        🏆 Your best of <b>{formatClock(lb.kept, true)}</b> stays on the board{lb.rank ? <> at <b>#{lb.rank}</b></> : null}
        <button className="btn btn-small btn-ghost" onClick={view}>View leaderboard</button>
      </div>
    );
  return (
    <div className="lb-result">
      🏆 {lb.rank ? <>Global rank <b>#{lb.rank}</b> on {DIFFICULTY[difficulty].label}</> : <>Logged on the {DIFFICULTY[difficulty].label} leaderboard</>}
      <button className="btn btn-small btn-ghost" onClick={view}>View leaderboard</button>
    </div>
  );
}

export function Results() {
  const snap = useGameStore((s) => s.snapshot);
  const result = useGameStore((s) => s.result);
  const transportKind = useGameStore((s) => s.transportKind);
  const [expanded, setExpanded] = useState(false);
  const myTask = snap?.tasks.find((t) => t.playerId === snap.viewerId);

  const fact = useMemo(() => {
    if (!myTask) return NASA_FACTS[Math.floor(Math.random() * Math.max(1, NASA_FACTS.length))];
    const topics = TASK_TOPIC[myTask.taskId];
    const pool = NASA_FACTS.filter((f) => topics.includes(f.topic));
    const list = pool.length ? pool : NASA_FACTS;
    return list[Math.floor(Math.random() * Math.max(1, list.length))];
  }, [myTask]);

  if (!snap) {
    return (
      <div className="screen-center">
        <button className="btn" onClick={returnToMenu}>
          Main menu
        </button>
      </div>
    );
  }

  const h = header(snap);
  const ship = viewerShip(snap);
  const pb = result?.pb;
  const totalMs = snap.outcome && "totalMs" in snap.outcome ? snap.outcome.totalMs : undefined;
  const taskDef = myTask ? LUNAR_TASKS[myTask.taskId] : undefined;

  return (
    <div className="results">
      <div className={`results-hero tone-${h.tone}`}>
        <div className="kicker">
          MISSION REPORT · {snap.mode === "1v1" ? "ONLINE 1v1" : snap.mode === "coop" ? "CO-OP" : "SOLO"} · {DIFFICULTY[snap.difficulty].label.toUpperCase()}
        </div>
        <h1>{h.title}</h1>
        <p>{h.sub}</p>
        {pb?.isNewBest && (
          <div className="pb-badge">
            ★ NEW PERSONAL BEST
            {pb.previous && <small>previous {formatClock(pb.previous.totalMs, true)}</small>}
          </div>
        )}
        {pb?.eligible && !pb.isNewBest && pb.previous && <div className="pb-note">Personal best: {formatClock(pb.previous.totalMs, true)}</div>}
        <LeaderboardRank mode={snap.mode} difficulty={snap.difficulty} />
      </div>

      {ship && (
        <div className="result-stats">
          <StatCard label="Total time" value={totalMs !== undefined ? formatClock(totalMs, true) : "—"} tone={h.tone === "good" ? "good" : undefined} />
          <StatCard label="Arrival" value={ship.arrivedAtMs !== undefined ? formatClock(ship.arrivedAtMs, true) : "—"} sub="launch → lunar orbit" />
          <StatCard label="Hull remaining" value={`${Math.ceil(ship.health)} / ${ship.maxHealth}`} sub={`${Math.round(ship.stats.damageTaken)} damage taken`} />
          <StatCard label="Credits spent" value={`◈${totalCreditsSpent(ship)}`} sub={`◈${Math.round(ship.credits)} left`} />
          <StatCard
            label="Task attempts"
            value={myTask ? `${myTask.attempts}` : "—"}
            sub={taskDef ? `${taskDef.icon} ${taskDef.title}` : undefined}
          />
          <StatCard label="Hazards" value={`${ship.stats.hazardsEncountered}`} sub={`${Math.round(ship.stats.damagePrevented)} dmg prevented`} />
        </div>
      )}

      <div className="results-actions">
        <button
          className="btn btn-primary btn-xl"
          onClick={() => {
            playSfx("click");
            playAgain();
          }}
        >
          {transportKind === "socket" ? "New online match" : "Play again"}
        </button>
        <button
          className="btn btn-xl btn-ghost"
          onClick={() => {
            playSfx("click");
            returnToMenu();
          }}
        >
          Main menu
        </button>
        <button className="btn btn-xl btn-ghost" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Hide" : "Expanded"} statistics
        </button>
      </div>

      {expanded && (
        <div className="breakdowns">
          {[...snap.spacecraft]
            .sort((a, b) => (a.id === snap.viewerShipId ? -1 : b.id === snap.viewerShipId ? 1 : 0))
            .map((s) => (
              <ShipBreakdown key={s.id} ship={s} snap={snap} />
            ))}
        </div>
      )}

      <div className="results-fact">
        {fact ? (
          <FactCard fact={fact} compact />
        ) : taskDef ? (
          <div className="fact-card compact">
            <div className="fact-kicker">THE SCIENCE BEHIND YOUR TASK</div>
            <h3>
              {taskDef.icon} {taskDef.title}
            </h3>
            <p>{taskDef.scienceExplanation}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
