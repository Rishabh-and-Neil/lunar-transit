// Personal-best records in localStorage. Only written from validated, finished results
// (snapshot status "finished" with outcome solo-complete / coop-complete, non-tutorial).
import type { AttachmentId, Difficulty, PublicMatchSnapshot } from "@sm/shared";

const KEY = "lt.personalBests.v1";

export type BestMode = "solo" | "coop";

export interface PersonalBest {
  mode: BestMode;
  difficulty: Difficulty;
  totalMs: number;
  date: string; // ISO
  arrivalMs?: number;
  damageTaken: number;
  creditsSpent: number;
  abilitiesUsed: number;
  taskAttempts: number;
  attachments: AttachmentId[];
}

export type PersonalBestTable = Partial<Record<string, PersonalBest>>;

export function bestKey(mode: BestMode, difficulty: Difficulty): string {
  return `${mode}:${difficulty}`;
}

function isBest(v: unknown): v is PersonalBest {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o.mode === "solo" || o.mode === "coop") &&
    (o.difficulty === "easy" || o.difficulty === "normal" || o.difficulty === "hard") &&
    typeof o.totalMs === "number" &&
    Number.isFinite(o.totalMs) &&
    o.totalMs > 0 &&
    typeof o.date === "string"
  );
}

export function loadPersonalBests(): PersonalBestTable {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: PersonalBestTable = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (isBest(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function save(table: PersonalBestTable): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(table));
  } catch {
    /* storage unavailable */
  }
}

export function getPersonalBest(mode: BestMode, difficulty: Difficulty): PersonalBest | undefined {
  return loadPersonalBests()[bestKey(mode, difficulty)];
}

export interface RecordOutcome {
  eligible: boolean;
  isNewBest: boolean;
  previous?: PersonalBest;
  record?: PersonalBest;
}

/** Records a result if (and only if) the snapshot is a validated finished solo/coop completion. */
export function recordFromSnapshot(snap: PublicMatchSnapshot): RecordOutcome {
  if (snap.tutorial || snap.status !== "finished" || !snap.outcome) return { eligible: false, isNewBest: false };
  const o = snap.outcome;
  if (o.kind !== "solo-complete" && o.kind !== "coop-complete") return { eligible: false, isNewBest: false };
  if (!Number.isFinite(o.totalMs) || o.totalMs <= 0) return { eligible: false, isNewBest: false };
  const mode: BestMode = o.kind === "solo-complete" ? "solo" : "coop";
  const ship = snap.spacecraft.find((s) => s.id === snap.viewerShipId) ?? snap.spacecraft[0];
  const abilitiesUsed = ship ? Object.values(ship.stats.abilitiesUsed).reduce<number>((a, b) => a + (b ?? 0), 0) : 0;
  const record: PersonalBest = {
    mode,
    difficulty: snap.difficulty,
    totalMs: o.totalMs,
    date: new Date().toISOString(),
    arrivalMs: ship?.arrivedAtMs,
    damageTaken: Math.round(ship?.stats.damageTaken ?? 0),
    creditsSpent: ship ? ship.stats.creditsSpentEquipment + ship.stats.creditsSpentAbilities + ship.stats.creditsSpentRepairs : 0,
    abilitiesUsed,
    taskAttempts: snap.tasks.reduce((a, t) => a + t.attempts, 0),
    attachments: ship ? [...ship.attachments] : [],
  };
  const table = loadPersonalBests();
  const key = bestKey(mode, snap.difficulty);
  const previous = table[key];
  const isNewBest = !previous || record.totalMs < previous.totalMs;
  if (isNewBest) {
    table[key] = record;
    save(table);
  }
  return { eligible: true, isNewBest, previous, record };
}

export function clearPersonalBests(): void {
  save({});
}
