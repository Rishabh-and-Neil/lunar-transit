import { useState } from "react";
import { DIFFICULTY, type Difficulty, type PlayerRole, type RoomState } from "@sm/shared";
import { pushToast, useGameStore } from "../state/gameStore";
import {
  cancelMatchmaking,
  configureRoom,
  createRoom,
  joinRoom,
  leaveRoom,
  quickMatch,
  returnToMenu,
} from "../network/session";
import { playSfx } from "../audio/sfx";
import { useNow } from "../hud/hooks";
import { formatClock } from "../state/selectors";

export const ROLE_INFO: Record<PlayerRole, { label: string; icon: string; desc: string }> = {
  pilot: {
    label: "Pilot",
    icon: "🧑‍🚀",
    desc: "Flies the ship: Thruster Burn, Gravity Assist, Navigation Lock. Lunar tasks: communications, orbit calibration, terrain mapping.",
  },
  engineer: {
    label: "Engineer",
    icon: "🔧",
    desc: "Keeps the ship alive: Deflector Surge, Hull Patch, Repair Drone. Lunar tasks: communications, surface analysis, power calibration.",
  },
  competitor: { label: "Commander", icon: "🚀", desc: "Identical ship, 1,000 credits. Boost yourself, deter your rival." },
  solo: { label: "Commander", icon: "🚀", desc: "Solo mission." },
};

export function ConnectionBadge() {
  const connection = useGameStore((s) => s.connection);
  const err = useGameStore((s) => s.connectionError);
  const label =
    connection === "connected"
      ? "Connected"
      : connection === "connecting"
        ? "Connecting…"
        : connection === "reconnecting"
          ? "Reconnecting…"
          : connection === "error"
            ? "Connection failed"
            : "Offline";
  return (
    <span className={`server-pill conn-${connection}`} title={err ?? undefined}>
      <span className="server-dot" />
      {label}
    </span>
  );
}

function DifficultyPicker(props: { value: Difficulty; disabled?: boolean; onChange: (d: Difficulty) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Difficulty">
      {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
        <button
          key={d}
          role="radio"
          aria-checked={props.value === d}
          className={`seg ${props.value === d ? "seg-on" : ""} seg-${d}`}
          disabled={props.disabled}
          onClick={() => {
            playSfx("click");
            props.onChange(d);
          }}
        >
          {DIFFICULTY[d].label}
        </button>
      ))}
    </div>
  );
}
export { DifficultyPicker };

function Searching() {
  const mm = useGameStore((s) => s.matchmaking);
  const now = useNow(4);
  void now;
  const waited = mm.since ? Date.now() - mm.since : 0;
  return (
    <div className="searching">
      <div className="radar">
        <div className="radar-sweep" />
        <div className="radar-ring r1" />
        <div className="radar-ring r2" />
        <div className="radar-ring r3" />
        <div className="radar-blip" />
      </div>
      <h3>Searching for a {mm.mode === "coop" ? "crewmate" : "rival commander"}…</h3>
      <p className="muted">
        Waiting {formatClock(waited)}
        {mm.position !== undefined ? ` · queue position ${mm.position}` : ""} · difficulty Normal
      </p>
      <button
        className="btn btn-danger"
        onClick={() => {
          playSfx("click");
          cancelMatchmaking();
        }}
      >
        Cancel search
      </button>
    </div>
  );
}

function RoomView({ room }: { room: RoomState }) {
  const playerId = useGameStore((s) => s.playerId);
  const isHost = room.hostId === playerId;
  const [copied, setCopied] = useState(false);
  const full = room.players.length >= 2;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast("Copy failed — select the code manually.", "warn");
    }
  };
  return (
    <div className="room">
      {room.isPrivate && (
        <div className="room-code-block">
          <span className="field-label">Private room code</span>
          <button className="room-code" onClick={copy} title="Click to copy">
            {room.code.split("").map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </button>
          <span className="muted small">{copied ? "Copied to clipboard ✓" : "Share this code with your " + (room.mode === "coop" ? "crewmate" : "opponent")}</span>
        </div>
      )}

      <div className="room-players">
        {[0, 1].map((i) => {
          const p = room.players[i];
          if (!p)
            return (
              <div key={i} className="player-slot empty">
                <div className="slot-pulse" />
                <span>Waiting for player…</span>
              </div>
            );
          const info = ROLE_INFO[p.role];
          return (
            <div key={p.id} className={`player-slot ${p.id === playerId ? "me" : ""}`}>
              <div className="slot-head">
                <span className="slot-icon">{info.icon}</span>
                <div>
                  <strong>
                    {p.name}
                    {p.id === playerId && <span className="tag">YOU</span>}
                    {p.id === room.hostId && <span className="tag tag-host">HOST</span>}
                  </strong>
                  <div className="slot-role">{info.label}</div>
                </div>
                <span className={`conn-dot ${p.connected ? "on" : "off"}`} title={p.connected ? "Connected" : "Disconnected"} />
              </div>
              {room.mode === "coop" && <p className="slot-desc">{info.desc}</p>}
            </div>
          );
        })}
      </div>

      <div className="room-controls">
        <div>
          <span className="field-label">Difficulty {isHost ? "" : "(host sets)"}</span>
          <DifficultyPicker value={room.difficulty} disabled={!isHost} onChange={(d) => void configureRoom({ difficulty: d })} />
        </div>
        {room.mode === "coop" && isHost && (
          <button className="btn" onClick={() => void configureRoom({ swapRoles: true })}>
            ⇄ Swap roles
          </button>
        )}
      </div>
      <p className="muted small center">
        {full ? "Crew assembled — preparing spacecraft…" : "The match opens automatically when both players are here."}
      </p>
      <div className="row center">
        <button
          className="btn btn-ghost"
          onClick={() => {
            playSfx("click");
            leaveRoom();
          }}
        >
          Leave room
        </button>
      </div>
    </div>
  );
}

export function Lobby() {
  const mode = useGameStore((s) => s.mode);
  const room = useGameStore((s) => s.room);
  const mm = useGameStore((s) => s.matchmaking);
  const difficulty = useGameStore((s) => s.difficulty);
  const connection = useGameStore((s) => s.connection);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "create" | "join" | "queue">(null);
  const isCoop = mode === "coop";

  const run = async (kind: "create" | "join" | "queue", fn: () => Promise<boolean>) => {
    playSfx("click");
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="screen-center">
      <div className="panel lobby">
        <div className="panel-head">
          <button className="icon-btn" aria-label="Back to menu" onClick={returnToMenu}>
            ←
          </button>
          <div>
            <div className="kicker">{isCoop ? "CO-OP MISSION" : "ONLINE 1v1"}</div>
            <h2>{room ? "Mission Room" : isCoop ? "Assemble your crew" : "Find a rival"}</h2>
          </div>
          <ConnectionBadge />
        </div>

        {room ? (
          <RoomView room={room} />
        ) : mm.queued ? (
          <Searching />
        ) : (
          <div className="lobby-options">
            <div className="lobby-card">
              <h3>🔒 Private room</h3>
              <p className="muted">Create a room and share the code.</p>
              <div className="field">
                <span className="field-label">Difficulty</span>
                <DifficultyPicker value={difficulty} onChange={(d) => useGameStore.setState({ difficulty: d })} />
              </div>
              <button className="btn btn-primary" disabled={busy !== null} onClick={() => void run("create", createRoom)}>
                {busy === "create" ? "Creating…" : "Create room"}
              </button>
            </div>
            <div className="lobby-card">
              <h3>🔑 Join by code</h3>
              <p className="muted">Enter the code your friend shared.</p>
              <form
                className="join-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("join", () => joinRoom(code));
                }}
              >
                <input
                  className="input input-code"
                  value={code}
                  maxLength={12}
                  placeholder="ABCDE"
                  aria-label="Room code"
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                />
                <button className="btn" type="submit" disabled={busy !== null || code.trim().length < 3}>
                  {busy === "join" ? "Joining…" : "Join"}
                </button>
              </form>
            </div>
            <div className="lobby-card">
              <h3>🛰️ Quick match</h3>
              <p className="muted">Get paired with another {isCoop ? "crewmate" : "commander"} (Normal difficulty).</p>
              <button className="btn btn-accent2" disabled={busy !== null} onClick={() => void run("queue", quickMatch)}>
                {busy === "queue" ? "Joining queue…" : "Find match"}
              </button>
            </div>
          </div>
        )}
        {connection === "error" || connection === "reconnecting" ? (
          <p className="lobby-warning">Can't reach the mission server. It keeps retrying automatically — make sure the server is running.</p>
        ) : null}
        {isCoop && !room && (
          <div className="role-explainer">
            {(["pilot", "engineer"] as const).map((r) => (
              <div key={r} className="role-card">
                <span className="slot-icon">{ROLE_INFO[r].icon}</span>
                <div>
                  <strong>{ROLE_INFO[r].label}</strong>
                  <p>{ROLE_INFO[r].desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
