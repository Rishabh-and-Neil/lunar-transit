// Shared leaderboard types for the HTTP API (server) and the leaderboard screen (client).
import { z } from "zod";
import { zClientId, zDifficulty, zName } from "./protocol";
import type { Difficulty } from "./types";

export type LeaderboardMode = "solo" | "coop";
export const LEADERBOARD_MODES: LeaderboardMode[] = ["solo", "coop"];
export const LEADERBOARD_DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];
/** Entries kept per board; the screen shows the top ones. */
export const LEADERBOARD_KEEP = 100;
export const LEADERBOARD_SHOW = 25;

/** Each player (one browser) has a single entry per board: their best. */
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
  /** A personal best saved in a player's browser before leaderboards existed (not replay-verified). */
  imported?: boolean;
}

export interface LeaderboardBoard {
  mode: LeaderboardMode;
  difficulty: Difficulty;
  entries: LeaderboardEntry[];
  total: number;
}

export interface SubmitResult {
  ok: boolean;
  /** The run was fine but slower than this player's best, which stays on the board (entry/rank describe that best). */
  kept?: boolean;
  reason?: string;
  entry?: LeaderboardEntry;
  /** 1-based rank on its board, or null if it did not make the kept list. */
  rank?: number | null;
}

/**
 * Leaderboards went live on 19 Nov 2026. Personal bests saved in a browser before then had no
 * leaderboard to go to, so the browser uploads them once. Later runs are submitted (and verified) as they finish.
 */
export const LEADERBOARD_LAUNCH_AT = Date.UTC(2026, 10, 19, 20, 0, 0);
/** Sanity bounds for imported times: nothing can reach the Moon and finish its task faster than this. */
export const SAVED_BEST_LIMITS = { minMs: 90_000, maxMs: 30 * 60_000 } as const;

export const zSavedBest = z.object({
  mode: z.enum(["solo", "coop"]),
  difficulty: zDifficulty,
  name: zName,
  clientId: zClientId.optional(),
  totalMs: z.number().int().min(SAVED_BEST_LIMITS.minMs).max(SAVED_BEST_LIMITS.maxMs),
  /** When the best was set (epoch ms); must be before leaderboards launched. */
  setAt: z.number().int().min(Date.UTC(2026, 0, 1)).max(LEADERBOARD_LAUNCH_AT),
  /** Attachment ids; the server turns known ones into names. */
  attachments: z.array(z.string().max(40)).max(14),
});
export type SavedBest = z.infer<typeof zSavedBest>;
