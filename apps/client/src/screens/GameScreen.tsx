import { useEffect, useRef, useState } from "react";
import { LUNAR_TASKS, ROUTE_DISTANCE, type TaskSubmission } from "@sm/shared";
import { TaskHost } from "../tasks/TaskHost";
import { useGameStore } from "../state/gameStore";
import { isFlying, opponentShip, otherPlayer, viewerShip } from "../state/selectors";
import { commands } from "../network/commands";
import { returnToMenu } from "../network/session";
import { playSfx } from "../audio/sfx";
import { FlightHUD } from "../hud/FlightHUD";
import { MissionClock } from "../hud/MissionClock";
import { useDecreaseFlash, useNow } from "../hud/hooks";
import { useEventSounds } from "../hud/HazardFeed";

function LiftoffFlash() {
  const elapsed = useGameStore((s) => s.snapshot?.elapsedMs ?? 99999);
  const [show, setShow] = useState(elapsed < 2000);
  useEffect(() => {
    if (!show) return;
    const id = window.setTimeout(() => setShow(false), 2200);
    return () => window.clearTimeout(id);
  }, [show]);
  if (!show) return null;
  return (
    <div className="liftoff-flash">
      <span>LIFTOFF</span>
      <small>Trans-lunar injection confirmed</small>
    </div>
  );
}

function DamageVignette() {
  const health = useGameStore((s) => viewerShip(s.snapshot)?.health ?? 100);
  const max = useGameStore((s) => viewerShip(s.snapshot)?.maxHealth ?? 100);
  const flash = useDecreaseFlash(health);
  const low = health / Math.max(1, max) < 0.3;
  return (
    <>
      {low && <div className="low-health-vignette" />}
      {flash > 0 && <div key={flash} className="damage-vignette" />}
    </>
  );
}

function RivalStatusCard() {
  const opp = useGameStore((s) => opponentShip(s.snapshot));
  const oppPlayer = useGameStore((s) => otherPlayer(s.snapshot));
  const oppTask = useGameStore((s) => s.snapshot?.tasks.find((t) => t.playerId === oppPlayer?.id));
  if (!opp) return null;
  const pct = Math.round((opp.progress / ROUTE_DISTANCE) * 100);
  const text =
    opp.phase === "lunar-task"
      ? `On the Moon — ${oppTask?.attempts ?? 0} attempt${oppTask?.attempts === 1 ? "" : "s"} so far`
      : opp.phase === "destroyed"
        ? "Destroyed"
        : isFlying(opp.phase)
          ? `Still flying · ${pct}% of the route`
          : "Task complete";
  return (
    <div className={`rival-status ${opp.phase === "lunar-task" ? "hot" : ""}`}>
      <span className="hud-label">RIVAL · {oppPlayer?.name ?? "Opponent"}</span>
      <span>{text}</span>
      {isFlying(opp.phase) && (
        <div className="mini-bar">
          <div style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function LunarTaskView() {
  const snap = useGameStore((s) => s.snapshot);
  const assigned = useGameStore((s) => s.assignedTasks);
  const taskPending = useGameStore((s) => Object.values(s.pending).some((p) => p.key === "task"));
  if (!snap) return null;
  const mine = snap.tasks.find((t) => t.playerId === snap.viewerId);
  const instance = mine ? mine.instance ?? assigned[mine.assignedId] : undefined;
  const partner = otherPlayer(snap);
  const partnerTask = partner ? snap.tasks.find((t) => t.playerId === partner.id) : undefined;
  const completed = mine?.completedAtMs !== undefined;
  const waitingFor = snap.mode === "coop" && completed && partnerTask && partnerTask.completedAtMs === undefined ? partner?.name : undefined;
  const onSubmit = (s: TaskSubmission) => {
    if (taskPending) return;
    playSfx("click");
    commands.submitTask(s);
  };
  return (
    <div className="lunar-view">
      <div className="lunar-head">
        <MissionClock />
        {snap.mode === "1v1" && <RivalStatusCard />}
        {snap.mode === "coop" && partner && partnerTask && (
          <div className="rival-status">
            <span className="hud-label">CREWMATE · {partner.name}</span>
            <span>
              {LUNAR_TASKS[partnerTask.taskId].icon} {LUNAR_TASKS[partnerTask.taskId].title} —{" "}
              {partnerTask.completedAtMs !== undefined ? "complete ✓" : `in progress (${partnerTask.attempts} attempts)`}
            </span>
          </div>
        )}
      </div>
      <div className="lunar-task-area">
        {mine && instance ? (
          <TaskHost task={instance} attempts={mine.attempts} completed={completed} waitingFor={waitingFor} onSubmit={onSubmit} />
        ) : (
          <div className="panel waiting-card">
            <div className="spinner" />
            <p>Receiving task uplink…</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DestroyedOverlay() {
  const mode = useGameStore((s) => s.snapshot?.mode);
  const finished = useGameStore((s) => s.snapshot?.status === "finished");
  return (
    <div className="destroyed-overlay">
      <div className="destroyed-glitch" data-text="SIGNAL LOST">
        SIGNAL LOST
      </div>
      <p>Hull integrity reached zero. The spacecraft has been destroyed.</p>
      {mode === "1v1" && <p className="muted">Your rival wins this race.</p>}
      {mode === "coop" && <p className="muted">Mission failed — the crew could not reach the Moon.</p>}
      {!finished && <p className="muted small">Waiting for mission control…</p>}
    </div>
  );
}

function FinishBanner() {
  const snap = useGameStore((s) => s.snapshot);
  if (!snap || snap.status !== "finished" || snap.tutorial) return null;
  const o = snap.outcome;
  let title = "MISSION COMPLETE";
  let tone = "good";
  if (!o) title = "MISSION ENDED";
  else if (o.kind === "solo-destroyed" || o.kind === "coop-destroyed") {
    title = "MISSION FAILED";
    tone = "bad";
  } else if (o.kind === "1v1-task" || o.kind === "1v1-destroyed") {
    const won = o.winnerId === snap.viewerId;
    title = won ? "VICTORY" : "DEFEAT";
    tone = won ? "good" : "bad";
  } else if (o.kind === "abandoned") {
    title = "MISSION ABORTED";
    tone = "warn";
  }
  return (
    <div className={`finish-banner tone-${tone}`}>
      <span>{title}</span>
      <small>Compiling mission report…</small>
    </div>
  );
}

function useFinishSound(): void {
  const status = useGameStore((s) => s.snapshot?.status);
  const outcome = useGameStore((s) => s.snapshot?.outcome);
  const viewerId = useGameStore((s) => s.snapshot?.viewerId);
  const played = useRef(false);
  useEffect(() => {
    if (status !== "finished" || played.current || !outcome) return;
    played.current = true;
    const good =
      outcome.kind === "solo-complete" ||
      outcome.kind === "coop-complete" ||
      ((outcome.kind === "1v1-task" || outcome.kind === "1v1-destroyed") && outcome.winnerId === viewerId);
    playSfx(good ? "success" : "fail");
  }, [status, outcome, viewerId]);
}

function QuitButton() {
  const [confirm, setConfirm] = useState(false);
  const now = useNow(2, confirm);
  const [armedAt, setArmedAt] = useState(0);
  useEffect(() => {
    if (confirm && now - armedAt > 3500) setConfirm(false);
  }, [now, confirm, armedAt]);
  return (
    <button
      className={`btn btn-small quit-btn ${confirm ? "btn-danger" : "btn-ghost"}`}
      onClick={() => {
        if (confirm) returnToMenu();
        else {
          setConfirm(true);
          setArmedAt(performance.now());
        }
      }}
    >
      {confirm ? "Confirm abort?" : "Abort"}
    </button>
  );
}

export function GameScreen() {
  const phase = useGameStore((s) => viewerShip(s.snapshot)?.phase);
  const tutorial = useGameStore((s) => s.tutorial);
  useEventSounds();
  useFinishSound();
  if (!phase) return null;
  return (
    <div className="game">
      <DamageVignette />
      {isFlying(phase) && <FlightHUD />}
      {(phase === "lunar-task" || phase === "task-complete") && <LunarTaskView />}
      {phase === "destroyed" && <DestroyedOverlay />}
      <LiftoffFlash />
      <FinishBanner />
      {!tutorial && <QuitButton />}
    </div>
  );
}
