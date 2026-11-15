import { ROUTE_DISTANCE, LUNAR_TASKS } from "@sm/shared";
import { useGameStore } from "../state/gameStore";
import { renderBridge } from "../state/renderBridge";
import { isFlying, opponentShip, otherPlayer, viewerShip } from "../state/selectors";
import { useNow } from "./hooks";
import { ROLE_INFO } from "../screens/Lobby";

function useSmoothProgress(shipId: string | undefined, fallback: number): number {
  const now = useNow(30, !!shipId);
  if (!shipId) return fallback;
  const p = renderBridge.progressOf(shipId, now);
  return Math.min(ROUTE_DISTANCE, p ?? fallback);
}

export function RouteProgress() {
  const shipId = useGameStore((s) => s.snapshot?.viewerShipId);
  const progress = useGameStore((s) => viewerShip(s.snapshot)?.progress ?? 0);
  const velocity = useGameStore((s) => viewerShip(s.snapshot)?.velocity ?? 0);
  const phase = useGameStore((s) => viewerShip(s.snapshot)?.phase);
  const oppId = useGameStore((s) => opponentShip(s.snapshot)?.id);
  const oppProgress = useGameStore((s) => opponentShip(s.snapshot)?.progress ?? 0);
  const smooth = useSmoothProgress(shipId, progress);
  const oppSmooth = useSmoothProgress(oppId, oppProgress);
  const frac = smooth / ROUTE_DISTANCE;
  const remaining = Math.max(0, ROUTE_DISTANCE - smooth);
  const eta = velocity > 0.01 ? remaining / velocity : Infinity;
  return (
    <div className="route" data-tour="progress">
      <div className="route-ends">
        <span className="route-body earth">🌍 Earth</span>
        <span className="route-stats">
          <b>{remaining.toFixed(1)}</b> u to go · <b>{velocity.toFixed(2)}</b> u/s
          {phase && isFlying(phase) && Number.isFinite(eta) ? ` · ETA ${Math.ceil(eta)}s` : ""}
        </span>
        <span className="route-body moon">Moon 🌕</span>
      </div>
      <div className="route-track">
        <div className="route-fill" style={{ width: `${frac * 100}%` }} />
        {oppId && <span className="route-marker opp" style={{ left: `${(oppSmooth / ROUTE_DISTANCE) * 100}%` }} title="Opponent" />}
        <span className="route-marker me" style={{ left: `${frac * 100}%` }} title="You" />
      </div>
    </div>
  );
}

/** 1v1: both ships on a mini route. Co-op: partner role + task status. */
export function OpponentMap() {
  const mode = useGameStore((s) => s.snapshot?.mode);
  if (mode === "1v1") return <RivalPanel />;
  if (mode === "coop") return <PartnerPanel />;
  return null;
}

function RivalPanel() {
  const opp = useGameStore((s) => opponentShip(s.snapshot));
  const oppPlayer = useGameStore((s) => otherPlayer(s.snapshot));
  const me = useGameStore((s) => viewerShip(s.snapshot));
  const oppSmooth = useSmoothProgress(opp?.id, opp?.progress ?? 0);
  const meSmooth = useSmoothProgress(me?.id, me?.progress ?? 0);
  if (!opp || !me) return null;
  const lead = meSmooth - oppSmooth;
  const status =
    opp.phase === "destroyed"
      ? "Destroyed"
      : opp.phase === "lunar-task"
        ? "On the Moon — working task"
        : opp.phase === "task-complete"
          ? "Task complete"
          : opp.phase === "simulation"
            ? "Auto-simulation"
            : opp.phase === "overtime"
              ? "Overtime"
              : "In flight";
  return (
    <div className="side-card rival" data-tour="opponent">
      <div className="side-head">
        <span className="hud-label">RIVAL</span>
        <strong>{oppPlayer?.name ?? "Opponent"}</strong>
        {oppPlayer && !oppPlayer.connected && <span className="tag tag-bad">offline</span>}
      </div>
      <div className="mini-route">
        <span className="mini-earth" />
        <span className="mini-moon" />
        <span className="mini-ship me" style={{ left: `${(meSmooth / ROUTE_DISTANCE) * 100}%` }} />
        <span className="mini-ship opp" style={{ left: `${(oppSmooth / ROUTE_DISTANCE) * 100}%` }} />
      </div>
      <div className="side-rows">
        <span>
          HP <b className={opp.health < 30 ? "bad" : ""}>{Math.ceil(opp.health)}</b>
        </span>
        <span>
          ◈ <b>{Math.round(opp.credits)}</b>
        </span>
        <span className={lead >= 0 ? "good" : "bad"}>
          {lead >= 0 ? "▲" : "▼"} {Math.abs(lead).toFixed(1)} u
        </span>
      </div>
      <div className="side-status">{status}</div>
    </div>
  );
}

function PartnerPanel() {
  const partner = useGameStore((s) => otherPlayer(s.snapshot));
  const partnerTask = useGameStore((s) => s.snapshot?.tasks.find((t) => t.playerId === partner?.id));
  const myTask = useGameStore((s) => s.snapshot?.tasks.find((t) => t.playerId === s.snapshot?.viewerId));
  if (!partner) return null;
  const info = ROLE_INFO[partner.role];
  return (
    <div className="side-card partner" data-tour="opponent">
      <div className="side-head">
        <span className="hud-label">CREWMATE</span>
        <strong>
          {info.icon} {partner.name}
        </strong>
        <span className={`conn-dot ${partner.connected ? "on" : "off"}`} />
      </div>
      <div className="side-rows">
        <span className="muted">{info.label}</span>
      </div>
      {[
        { who: "You", t: myTask },
        { who: partner.name, t: partnerTask },
      ].map(({ who, t }) =>
        t ? (
          <div key={who} className="task-line">
            <span>{LUNAR_TASKS[t.taskId].icon}</span>
            <span className="task-line-name">
              {who}: {LUNAR_TASKS[t.taskId].title}
            </span>
            <span className={t.completedAtMs !== undefined ? "good" : "muted"}>{t.completedAtMs !== undefined ? "✓" : t.attempts > 0 ? `${t.attempts} tries` : "—"}</span>
          </div>
        ) : null,
      )}
    </div>
  );
}
