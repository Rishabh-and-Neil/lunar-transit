import { useEffect, useState } from "react";
import { setModal, setPlayerName, useGameStore } from "../state/gameStore";
import { openOnline, startSolo, startTutorial } from "../network/session";
import { SERVER_URL } from "../network/socket";
import { playSfx } from "../audio/sfx";

type ServerProbe = "checking" | "online" | "offline";

/** Lightweight reachability probe of the Socket.IO server (polling handshake endpoint). */
function useServerProbe(): ServerProbe {
  const [state, setState] = useState<ServerProbe>("checking");
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 3000);
        // no-cors: an opaque response still proves the server is reachable.
        await fetch(`${SERVER_URL.replace(/\/$/, "")}/health?t=${Date.now()}`, {
          signal: ctrl.signal,
          cache: "no-store",
          mode: "no-cors",
        });
        window.clearTimeout(timer);
        if (alive) setState("online");
      } catch {
        if (alive) setState("offline");
      }
    };
    void probe();
    const id = window.setInterval(probe, 10000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return state;
}

export function MainMenu() {
  const name = useGameStore((s) => s.playerName);
  const probe = useServerProbe();
  const click = (fn: () => void) => () => {
    playSfx("click");
    fn();
  };

  return (
    <div className="menu">
      <header className="menu-hero">
        <div className="menu-kicker">
          <span className="dot-live" /> MISSION CONTROL · EARTH → MOON
        </div>
        <h1 className="title">
          LUNAR<span className="title-gap" />
          TRANSIT
        </h1>
        <p className="subtitle">A NASA-inspired Earth-to-Moon mission race</p>
      </header>

      <div className="menu-grid">
        <section className="panel menu-panel">
          <label className="field">
            <span className="field-label">Flight callsign</span>
            <input
              className="input"
              value={name}
              maxLength={20}
              placeholder="Your name"
              onChange={(e) => setPlayerName(e.target.value)}
              aria-label="Player name"
            />
          </label>

          <div className="menu-buttons">
            <button className="btn btn-primary btn-xl" onClick={click(() => startSolo())}>
              <span className="btn-icon">🚀</span>
              <span className="btn-text">
                <strong>Solo Mission</strong>
                <small>Race the clock to the Moon</small>
              </span>
            </button>
            <button className="btn btn-xl" onClick={click(() => openOnline("1v1"))}>
              <span className="btn-icon">⚔️</span>
              <span className="btn-text">
                <strong>Online 1v1</strong>
                <small>Same ship, same task — first to finish wins</small>
              </span>
            </button>
            <button className="btn btn-xl" onClick={click(() => openOnline("coop"))}>
              <span className="btn-icon">🤝</span>
              <span className="btn-text">
                <strong>Co-op Mission</strong>
                <small>Pilot + Engineer share one spacecraft</small>
              </span>
            </button>
            <button className="btn btn-xl btn-ghost" onClick={click(startTutorial)}>
              <span className="btn-icon">🎓</span>
              <span className="btn-text">
                <strong>Tutorial</strong>
                <small>Guided 60-second flight</small>
              </span>
            </button>
          </div>

          <div className="menu-footer">
            <button className="btn btn-small btn-ghost" onClick={click(() => setModal("bests"))}>
              🏆 Personal Bests
            </button>
            <button className="btn btn-small btn-ghost" onClick={click(() => setModal("about"))}>
              📚 About &amp; Sources
            </button>
            <span className={`server-pill server-${probe}`} title={SERVER_URL}>
              <span className="server-dot" />
              {probe === "checking" ? "Checking server…" : probe === "online" ? "Online server ready" : "Online server offline"}
            </span>
          </div>
        </section>
      </div>
      <p className="menu-disclaimer">
        Inspired by NASA mission design &amp; public education resources. Not affiliated with or endorsed by NASA. Gameplay numbers are balance values.
      </p>
    </div>
  );
}
