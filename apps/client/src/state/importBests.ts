// Personal bests saved in this browser before global leaderboards launched had nowhere to go.
// On start-up we upload each of them once; runs finished since then are submitted as they happen.
import { LEADERBOARD_LAUNCH_AT } from "@sm/shared";
import { importSavedBest } from "../network/leaderboard";
import { getClientId } from "../network/clientId";
import { effectiveName } from "./gameStore";
import { loadPersonalBests } from "./personalBests";

const DONE_KEY = "lt.pbUploaded.v1";
let running = false;

function loadDone(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveDone(done: Set<string>): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    /* storage unavailable */
  }
}

/** Returns how many earlier bests were newly added to the leaderboard. */
export async function uploadEarlierBests(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const done = loadDone();
    let added = 0;
    for (const best of Object.values(loadPersonalBests())) {
      if (!best) continue;
      const id = `${best.mode}:${best.difficulty}:${best.totalMs}:${best.date}`;
      if (done.has(id)) continue;
      const setAt = Date.parse(best.date);
      // Bests set after launch were already submitted (and verified) when the run finished.
      if (!Number.isFinite(setAt) || setAt >= LEADERBOARD_LAUNCH_AT) {
        done.add(id);
        continue;
      }
      const res = await importSavedBest({
        mode: best.mode,
        difficulty: best.difficulty,
        name: effectiveName(),
        clientId: getClientId(),
        totalMs: Math.round(best.totalMs),
        setAt,
        attachments: best.attachments ?? [],
      });
      if (!res) break; // server asleep or offline: try again next visit
      if (!res.ok && /too many/i.test(res.reason ?? "")) break;
      if (res.ok) added++;
      done.add(id); // accepted, or permanently declined (e.g. already on the board)
    }
    saveDone(done);
    return added;
  } finally {
    running = false;
  }
}
