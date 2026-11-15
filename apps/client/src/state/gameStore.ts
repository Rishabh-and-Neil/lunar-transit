// Global client state (Zustand). Pure UI/session state: never authoritative gameplay.
import { create } from "zustand";
import type { Difficulty, GameMode, MatchOutcome, PublicMatchSnapshot, PublicTaskInstance, RoomState } from "@sm/shared";
import type { RecordOutcome } from "./personalBests";

export type Screen = "menu" | "lobby" | "preparation" | "loading" | "game" | "results";
export type Modal = "bests" | "about" | null;
export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export interface PendingCommand {
  commandId: string;
  /** UI key, e.g. "buy:ion-thruster", "sell:ion-thruster", "ability:thruster-burn", "repair", "ready", "task". */
  key: string;
  sentAt: number;
}

export type ToastKind = "info" | "error" | "success" | "warn";
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface MatchmakingState {
  queued: boolean;
  mode?: "1v1" | "coop";
  position?: number;
  since?: number;
}

export interface MatchResultInfo {
  matchId: string;
  outcome: MatchOutcome;
  pb: RecordOutcome;
}

export interface GameStoreState {
  screen: Screen;
  modal: Modal;
  playerName: string;
  /** Mode the user picked in the menu (solo/1v1/coop). */
  mode: GameMode | null;
  difficulty: Difficulty;
  tutorial: boolean;
  /** Transport kind currently active. */
  transportKind: "local" | "socket" | null;

  // ---- online
  connection: ConnectionStatus;
  connectionError: string | null;
  playerId: string | null;
  room: RoomState | null;
  matchmaking: MatchmakingState;

  // ---- match
  snapshot: PublicMatchSnapshot | null;
  /** performance.now() when the latest snapshot arrived (for client-side clock smoothing). */
  snapshotAt: number;
  /** Task instances pushed separately by the server (task:assigned), keyed by assignedId. */
  assignedTasks: Record<string, PublicTaskInstance>;
  pending: Record<string, PendingCommand>;
  result: MatchResultInfo | null;

  toasts: Toast[];
}

const NAME_KEY = "lt.playerName";

function loadName(): string {
  try {
    const n = localStorage.getItem(NAME_KEY);
    if (n && n.trim()) return n.slice(0, 20);
  } catch {
    /* ignore */
  }
  return `Cadet-${Math.floor(100 + Math.random() * 900)}`;
}

const initial: GameStoreState = {
  screen: "menu",
  modal: null,
  playerName: loadName(),
  mode: null,
  difficulty: "normal",
  tutorial: false,
  transportKind: null,
  connection: "idle",
  connectionError: null,
  playerId: null,
  room: null,
  matchmaking: { queued: false },
  snapshot: null,
  snapshotAt: 0,
  assignedTasks: {},
  pending: {},
  result: null,
  toasts: [],
};

export const useGameStore = create<GameStoreState>()(() => ({ ...initial }));

// ---------------------------------------------------------------------------
// Plain actions (callable from anywhere, including non-React code)

const set = useGameStore.setState;
const get = useGameStore.getState;

export function setScreen(screen: Screen): void {
  set({ screen });
}

export function setModal(modal: Modal): void {
  set({ modal });
}

export function setPlayerName(name: string): void {
  const clean = name.replace(/\s+/g, " ").slice(0, 20);
  set({ playerName: clean });
  try {
    if (clean.trim()) localStorage.setItem(NAME_KEY, clean.trim());
  } catch {
    /* ignore */
  }
}

export function effectiveName(): string {
  return get().playerName.trim() || "Cadet";
}

let toastSeq = 1;
export function pushToast(text: string, kind: ToastKind = "info", ttlMs = 3800): void {
  const id = toastSeq++;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
  window.setTimeout(() => dismissToast(id), ttlMs);
}

export function dismissToast(id: number): void {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/** A pending flag never outlives this, so a lost response can't leave a button locked. */
const PENDING_TIMEOUT_MS = 5000;

export function addPending(p: PendingCommand): void {
  set((s) => ({ pending: { ...s.pending, [p.commandId]: p } }));
  setTimeout(() => removePending(p.commandId), PENDING_TIMEOUT_MS);
}

export function removePending(commandId: string): void {
  set((s) => {
    if (!s.pending[commandId]) return s;
    const next = { ...s.pending };
    delete next[commandId];
    return { pending: next };
  });
}

/**
 * Ingests a snapshot and clears all pending commands. Commands are applied before the next snapshot
 * (the local engine replies synchronously; the server snapshots right after an accepted command and
 * sends command:rejected otherwise), so any newer snapshot already reflects them. Keeping "recent"
 * commands pending here locked shop buttons in preparation, where no further snapshot arrives.
 */
export function ingestSnapshot(snapshot: PublicMatchSnapshot): void {
  const now = performance.now();
  set({ snapshot, snapshotAt: now, pending: {} });
}

export function resetMatchState(): void {
  set({ snapshot: null, snapshotAt: 0, assignedTasks: {}, pending: {}, result: null });
}

export function resetToMenu(): void {
  set({
    screen: "menu",
    mode: null,
    tutorial: false,
    transportKind: null,
    room: null,
    matchmaking: { queued: false },
    snapshot: null,
    snapshotAt: 0,
    assignedTasks: {},
    pending: {},
    result: null,
  });
}

/** True if any pending command has this UI key. */
export function selectIsPending(key: string) {
  return (s: GameStoreState): boolean => Object.values(s.pending).some((p) => p.key === key);
}
