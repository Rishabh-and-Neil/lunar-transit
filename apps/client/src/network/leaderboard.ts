// Leaderboard HTTP API client (same server as multiplayer).
import type { Difficulty, LeaderboardBoard, LeaderboardMode, SoloRunRecord, SubmitResult } from "@sm/shared";
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
