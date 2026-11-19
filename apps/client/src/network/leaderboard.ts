// Leaderboard HTTP API client (same server as multiplayer).
import type { Difficulty, LeaderboardBoard, LeaderboardMode, SavedBest, SoloRunRecord, SubmitResult } from "@sm/shared";
import { SERVER_URL } from "./socket";

const base = () => SERVER_URL.replace(/\/$/, "");

export async function fetchBoard(mode: LeaderboardMode, difficulty: Difficulty): Promise<LeaderboardBoard> {
  const r = await fetch(`${base()}/api/leaderboard?mode=${mode}&difficulty=${difficulty}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Leaderboard unavailable (${r.status})`);
  return (await r.json()) as LeaderboardBoard;
}

export async function submitSoloRun(rec: SoloRunRecord): Promise<SubmitResult> {
  try {
    const r = await fetch(`${base()}/api/leaderboard/solo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rec),
    });
    return (await r.json()) as SubmitResult;
  } catch {
    return { ok: false, reason: "Couldn't reach the leaderboard server." };
  }
}

/** Uploads a personal best saved before leaderboards existed. `null` means the server couldn't be reached. */
export async function importSavedBest(best: SavedBest): Promise<SubmitResult | null> {
  try {
    const r = await fetch(`${base()}/api/leaderboard/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(best),
    });
    if (r.status >= 500) return null;
    return (await r.json()) as SubmitResult;
  } catch {
    return null;
  }
}
