// Session controller: owns transport lifecycle and routes snapshots into the store + renderBridge.
import type { Difficulty, MatchResultPayload, PublicMatchSnapshot } from "@sm/shared";
import {
  effectiveName,
  ingestSnapshot,
  pushToast,
  removePending,
  resetMatchState,
  resetToMenu,
  useGameStore,
  type Screen,
} from "../state/gameStore";
import { recordFromSnapshot } from "../state/personalBests";
import { renderBridge } from "../state/renderBridge";
import { playSfx } from "../audio/sfx";
import { LocalTransport } from "./localTransport";
import { fetchBoard, submitSoloRun } from "./leaderboard";
import { SocketTransport, getSessionId, type SocketHandlers } from "./socket";
import { getActiveTransport, setActiveTransport, type TransportHandlers } from "./transport";

const set = useGameStore.setState;
const get = useGameStore.getState;

/** Delay between the match finishing and the Results screen (lets the final moment breathe). */
const RESULTS_DELAY_MS = 2600;

let resultsTimer: number | null = null;
const recordedMatches = new Set<string>();

function screenForStatus(snap: PublicMatchSnapshot): Screen | null {
  switch (snap.status) {
    case "preparation":
      return "preparation";
    case "countdown":
      return "loading";
    case "active":
      return "game";
    case "finished":
      return null; // handled separately
  }
}

function humanizeReason(reason: string): string {
  const r = reason.trim();
  if (!r) return "Command rejected";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function finishMatch(snap: PublicMatchSnapshot): void {
  if (!snap.outcome) return;
  if (!recordedMatches.has(snap.id)) {
    recordedMatches.add(snap.id);
    const pb = recordFromSnapshot(snap);
    set({ result: { matchId: snap.id, outcome: snap.outcome, pb } });
    void reportToLeaderboard(snap);
  }
  if (snap.tutorial) return; // tutorial overlay handles the ending
  const s = get();
  if (s.screen === "results" || resultsTimer !== null) return;
  // If the match ended before we ever reached the game screen (e.g. abandoned), go straight to results.
  const delay = s.screen === "game" ? RESULTS_DELAY_MS : 0;
  const matchId = snap.id;
  resultsTimer = window.setTimeout(() => {
    resultsTimer = null;
    const cur = get();
    if (cur.snapshot?.id === matchId && cur.transportKind !== null) set({ screen: "results" });
  }, delay);
}

/** Solo: send the run's replay for server verification. Co-op: the server already recorded it; look up the rank. */
async function reportToLeaderboard(snap: PublicMatchSnapshot): Promise<void> {
  const o = snap.outcome;
  if (snap.tutorial || !o || (o.kind !== "solo-complete" && o.kind !== "coop-complete")) {
    set({ lbSubmit: { status: "idle" } });
    return;
  }
  set({ lbSubmit: { status: "pending" } });
  if (o.kind === "solo-complete") {
    const t = getActiveTransport();
    if (!(t instanceof LocalTransport)) return void set({ lbSubmit: { status: "error", reason: "Run not recorded." } });
    const res = await submitSoloRun(t.getRunRecord());
    if (get().result?.matchId !== snap.id) return; // player moved on
    set({ lbSubmit: res.ok ? { status: "ok", rank: res.rank ?? null, entryId: res.entry?.id } : { status: "error", reason: res.reason ?? "Not accepted." } });
    return;
  }
  // co-op: give the server a moment to store it, then find our team on the board
  await new Promise((r) => setTimeout(r, 800));
  try {
    const board = await fetchBoard("coop", snap.difficulty);
    const names = snap.players.map((p) => p.name).sort().join("|");
    const i = board.entries.findIndex((e) => e.timeMs === o.totalMs && [...e.names].sort().join("|") === names);
    if (get().result?.matchId !== snap.id) return;
    set({ lbSubmit: { status: "ok", rank: i >= 0 ? i + 1 : null, entryId: i >= 0 ? board.entries[i].id : undefined } });
  } catch {
    set({ lbSubmit: { status: "error", reason: "Couldn't reach the leaderboard server." } });
  }
}

function onSnapshot(snap: PublicMatchSnapshot): void {
  if (get().transportKind === null) return;
  const prev = get().snapshot;
  if (prev && prev.id !== snap.id) {
    // A new match replaced the previous one (e.g. server recreated it after reconfigure / rematch).
    renderBridge.reset();
    set({ assignedTasks: {}, result: null });
  }
  ingestSnapshot(snap);
  renderBridge.push(snap);
  if (snap.status === "finished") {
    finishMatch(snap);
    return;
  }
  const target = screenForStatus(snap);
  if (target && get().screen !== target) set({ screen: target, modal: null });
}

function onRejected(commandId: string, reason: string): void {
  removePending(commandId);
  pushToast(humanizeReason(reason), "error");
  playSfx("error");
}

const baseHandlers: TransportHandlers = {
  onSnapshot,
  onRejected,
  onTaskAssigned(assignedId, instance) {
    set((s) => ({ assignedTasks: { ...s.assignedTasks, [assignedId]: instance } }));
  },
  onResult(payload: MatchResultPayload) {
    onSnapshot(payload.snapshot);
  },
};

function clearResultsTimer(): void {
  if (resultsTimer !== null) window.clearTimeout(resultsTimer);
  resultsTimer = null;
}

// ---------------------------------------------------------------------------
// Local (solo / tutorial)

function startLocal(difficulty: Difficulty, tutorial: boolean): void {
  clearResultsTimer();
  setActiveTransport(null);
  renderBridge.reset();
  resetMatchState();
  set({ mode: "solo", tutorial, difficulty, transportKind: "local", modal: null, room: null, matchmaking: { queued: false } });
  const playerId = `local-${getSessionId().slice(0, 8)}`;
  let t: LocalTransport;
  try {
    t = new LocalTransport({ playerId, name: effectiveName(), difficulty, tutorial }, baseHandlers);
  } catch (e) {
    console.error(e);
    set({ transportKind: null, mode: null, tutorial: false });
    pushToast(`Could not start the mission simulator: ${e instanceof Error ? e.message : "unknown error"}`, "error", 6000);
    playSfx("error");
    return;
  }
  setActiveTransport(t);
  set({ playerId });
  t.start();
}

export function startSolo(difficulty: Difficulty = get().difficulty): void {
  startLocal(difficulty, false);
}

export function startTutorial(): void {
  startLocal("easy", true);
}

/** Solo preparation: change difficulty (rebuilds the local match, keeping the loadout). */
export function setSoloDifficulty(d: Difficulty): void {
  set({ difficulty: d });
  const t = getActiveTransport();
  if (t instanceof LocalTransport) t.setDifficulty(d);
}

/** Tutorial only: fast-forward the local simulation. */
export function setTutorialTimeScale(scale: number): void {
  const t = getActiveTransport();
  if (t instanceof LocalTransport && get().tutorial) t.setTimeScale(scale);
}

/** Tutorial only: pause/resume the local simulation while a tutorial card is being read. */
export function setTutorialPaused(paused: boolean): void {
  const t = getActiveTransport();
  if (t instanceof LocalTransport && get().tutorial) t.setPaused(paused);
}

// ---------------------------------------------------------------------------
// Online

function socketTransport(): SocketTransport | null {
  const t = getActiveTransport();
  return t instanceof SocketTransport ? t : null;
}

const socketHandlers: SocketHandlers = {
  ...baseHandlers,
  onConnection(state, error) {
    set({ connection: state, connectionError: state === "connected" ? null : error ?? null });
    if (state === "connected") {
      const t = socketTransport();
      if (t) set({ playerId: t.playerId });
    }
  },
  onWelcome(playerId) {
    set({ playerId });
  },
  onRoom(room) {
    set({ room });
    if (room) {
      set({ difficulty: room.difficulty, matchmaking: { queued: false } });
    }
  },
  onMatchmaking(p) {
    set((s) => ({ matchmaking: { ...p, since: p.queued ? s.matchmaking.since ?? Date.now() : undefined } }));
  },
};

/** Ensures a socket transport exists (connects lazily). */
export function ensureOnline(): SocketTransport {
  const existing = socketTransport();
  if (existing) {
    existing.setName(effectiveName());
    return existing;
  }
  const t = new SocketTransport(effectiveName(), socketHandlers);
  setActiveTransport(t);
  set({ transportKind: "socket", playerId: t.playerId });
  return t;
}

export function openOnline(mode: "1v1" | "coop"): void {
  clearResultsTimer();
  renderBridge.reset();
  resetMatchState();
  set({ mode, tutorial: false, screen: "lobby", modal: null });
  ensureOnline();
}

async function roomAction<T>(p: Promise<{ ok: true; data?: T } | { ok: false; reason: string }>, okMsg?: string): Promise<boolean> {
  const res = await p;
  if (!res.ok) {
    pushToast(humanizeReason(res.reason), "error");
    playSfx("error");
    return false;
  }
  if (okMsg) pushToast(okMsg, "success");
  return true;
}

export async function createRoom(): Promise<boolean> {
  const s = get();
  const mode = s.mode === "coop" ? "coop" : "1v1";
  const t = ensureOnline();
  const res = await t.createRoom(mode, effectiveName(), s.difficulty);
  if (res.ok && res.data) set({ room: res.data });
  return roomAction(Promise.resolve(res));
}

export async function joinRoom(code: string): Promise<boolean> {
  const clean = code.trim().toUpperCase();
  if (clean.length < 3) {
    pushToast("Enter a valid room code.", "error");
    return false;
  }
  const t = ensureOnline();
  const res = await t.joinRoom(clean, effectiveName());
  if (res.ok && res.data) set({ room: res.data });
  return roomAction(Promise.resolve(res));
}

export async function configureRoom(p: { difficulty?: Difficulty; swapRoles?: boolean }): Promise<boolean> {
  const t = socketTransport();
  if (!t) return false;
  const res = await t.configureRoom(p);
  if (res.ok && res.data) set({ room: res.data });
  return roomAction(Promise.resolve(res));
}

export async function quickMatch(): Promise<boolean> {
  const s = get();
  const mode = s.mode === "coop" ? "coop" : "1v1";
  const t = ensureOnline();
  set({ matchmaking: { queued: true, mode, since: Date.now() } });
  const ok = await roomAction(t.joinMatchmaking(mode, effectiveName()));
  if (!ok) set({ matchmaking: { queued: false } });
  return ok;
}

export function cancelMatchmaking(): void {
  socketTransport()?.leaveMatchmaking();
  set({ matchmaking: { queued: false } });
}

export function leaveRoom(): void {
  socketTransport()?.leaveRoom();
  renderBridge.reset();
  resetMatchState();
  set({ room: null, screen: "lobby" });
}

// ---------------------------------------------------------------------------
// Common

/** Leaves whatever is running and returns to the main menu. */
export function returnToMenu(): void {
  clearResultsTimer();
  const t = socketTransport();
  if (t) {
    if (get().matchmaking.queued) t.leaveMatchmaking();
    t.leaveRoom();
  }
  setActiveTransport(null);
  renderBridge.reset();
  resetToMenu();
  set({ connection: "idle", connectionError: null });
}

export function playAgain(): void {
  const s = get();
  if (s.transportKind === "local" && !s.tutorial) {
    startSolo(s.difficulty);
    return;
  }
  if (s.transportKind === "socket" && (s.mode === "1v1" || s.mode === "coop")) {
    const mode = s.mode;
    clearResultsTimer();
    socketTransport()?.leaveRoom();
    renderBridge.reset();
    resetMatchState();
    set({ room: null, screen: "lobby", mode });
    return;
  }
  returnToMenu();
}
