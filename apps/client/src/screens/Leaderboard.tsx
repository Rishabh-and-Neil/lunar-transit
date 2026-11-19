// Global leaderboards: Solo / Co-op x Easy / Normal / Hard.
import { useCallback, useEffect, useState } from "react";
import { DIFFICULTY, type Difficulty, type LeaderboardBoard, type LeaderboardMode } from "@sm/shared";
import { Modal } from "../hud/ui";
import { setLeaderboardView, useGameStore } from "../state/gameStore";
import { formatClock } from "../state/selectors";
import { getPersonalBest } from "../state/personalBests";
import { fetchBoard } from "../network/leaderboard";
import { playSfx } from "../audio/sfx";

const MODES: { id: LeaderboardMode; label: string; icon: string }[] = [
  { id: "solo", label: "Solo", icon: "🚀" },
  { id: "coop", label: "Co-op", icon: "🤝" },
];
const DIFFS: Difficulty[] = ["easy", "normal", "hard"];
const MEDAL = ["🥇", "🥈", "🥉"];

function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const view = useGameStore((s) => s.leaderboardView);
  const myName = useGameStore((s) => s.playerName).trim().toLowerCase();
  const lbSubmit = useGameStore((s) => s.lbSubmit);
  const myEntryId = lbSubmit.status === "ok" ? lbSubmit.entryId : undefined;
  const [board, setBoard] = useState<LeaderboardBoard | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const b = await fetchBoard(view.mode, view.difficulty);
      setBoard(b);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [view.mode, view.difficulty]);

  useEffect(() => {
    void load();
  }, [load]);

  const pb = getPersonalBest(view.mode, view.difficulty);
  const pick = (v: Partial<typeof view>) => {
    playSfx("click");
    setLeaderboardView(v);
  };

  return (
    <Modal title="🏆 Leaderboards" onClose={onClose} wide>
      <div className="lb">
        <div className="lb-controls">
          <div className="segmented lb-modes" role="tablist" aria-label="Game mode">
            {MODES.map((m) => (
              <button key={m.id} role="tab" aria-selected={view.mode === m.id} className={`seg ${view.mode === m.id ? "seg-on" : ""}`} onClick={() => pick({ mode: m.id })}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label="Difficulty">
            {DIFFS.map((d) => (
              <button key={d} role="radio" aria-checked={view.difficulty === d} className={`seg seg-${d} ${view.difficulty === d ? "seg-on" : ""}`} onClick={() => pick({ difficulty: d })}>
                {DIFFICULTY[d].label}
              </button>
            ))}
          </div>
        </div>

        <p className="lb-caption muted small">
          Fastest {view.mode === "coop" ? "crews" : "pilots"} on {DIFFICULTY[view.difficulty].label} — time from launch to completed lunar science.
          {board && board.total > 0 && ` ${board.total} mission${board.total === 1 ? "" : "s"} logged.`}
        </p>

        {state === "loading" && (
          <div className="lb-state">
            <span className="spinner small" /> Loading leaderboard… <span className="muted small">(the server may take a moment to wake up)</span>
          </div>
        )}
        {state === "error" && (
          <div className="lb-state">
            Couldn't reach the leaderboard server.
            <button className="btn btn-small btn-ghost" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}
        {state === "ready" && board && board.entries.length === 0 && (
          <div className="lb-state lb-empty">
            <div className="lb-empty-icon">🌕</div>
            No {view.mode === "coop" ? "crew has" : "one has"} landed on {DIFFICULTY[view.difficulty].label} yet — be the first on the board!
          </div>
        )}
        {state === "ready" && board && board.entries.length > 0 && (
          <ol className="lb-list">
            {board.entries.map((e, i) => {
              const mine = e.id === myEntryId || (myName.length > 0 && e.names.some((n) => n.trim().toLowerCase() === myName));
              return (
                <li key={e.id} className={`lb-row ${i < 3 ? `lb-top lb-top-${i + 1}` : ""} ${mine ? "lb-mine" : ""}`}>
                  <span className="lb-rank">{i < 3 ? MEDAL[i] : i + 1}</span>
                  <span className="lb-names">
                    <span className="lb-name">
                      {e.names.join(" & ")}
                      {mine && <span className="tag">YOU</span>}
                    </span>
                    <span className="lb-loadout">{e.loadout.join(" · ") || "No attachments"}</span>
                  </span>
                  <span className="lb-time">{formatClock(e.timeMs, true)}</span>
                  <span className="lb-when muted small">{ago(e.at)}</span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="lb-foot">
          <span>
            Your best here: <b>{pb ? formatClock(pb.totalMs, true) : "—"}</b>
          </span>
          <span className="muted small">
            {view.mode === "solo"
              ? "Solo times are verified by replaying your run on the server."
              : "Co-op times are recorded by the server when both crewmates finish."}
          </span>
        </div>
      </div>
    </Modal>
  );
}
