// Shared leaderboard types for the HTTP API (server) and the leaderboard screen (client).
import type { Difficulty } from "./types";

export type LeaderboardMode = "solo" | "coop";
export const LEADERBOARD_MODES: LeaderboardMode[] = ["solo", "coop"];
export const LEADERBOARD_DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];
/** Entries kept per board; the screen shows the top ones. */
export const LEADERBOARD_KEEP = 100;
export const LEADERBOARD_SHOW = 25;

export interface LeaderboardEntry {
  id: string;
  mode: LeaderboardMode;
  difficulty: Difficulty;
  /** One name for solo, two (Pilot, Engineer) for co-op. */
  names: string[];
  /** Launch to task complete, verified by the server. */
  timeMs: number;
  /** Epoch ms when recorded. */
  at: number;
  /** Equipment names, for curiosity. */
  loadout: string[];
}

export interface LeaderboardBoard {
  mode: LeaderboardMode;
  difficulty: Difficulty;
  entries: LeaderboardEntry[];
  total: number;
}

export interface SubmitResult {
  ok: boolean;
  reason?: string;
  entry?: LeaderboardEntry;
  /** 1-based rank on its board, or null if it did not make the kept list. */
  rank?: number | null;
}
