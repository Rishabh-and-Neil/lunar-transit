// Global leaderboards: one board per mode (solo, co-op) x difficulty (easy, normal, hard).
// Solo times are verified by replaying the browser's recorded run; co-op times come from the server's own match.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pg from "pg";
import {
  ATTACHMENTS, LEADERBOARD_KEEP, LEADERBOARD_SHOW, replaySoloRun, zSavedBest, zSoloRunRecord,
  type Difficulty, type LeaderboardBoard, type LeaderboardEntry, type LeaderboardMode, type MatchState,
  type AttachmentId, type SpacecraftState, type SubmitResult,
} from "@sm/shared";

interface StoredEntry extends LeaderboardEntry {
  /** Prevents the same run being submitted twice. */
  fingerprint: string;
}

interface LeaderboardStore {
  readonly kind: string;
  init(): Promise<void>;
  /** Sorted fastest first. */
  list(mode: LeaderboardMode, difficulty: Difficulty, limit: number): Promise<{ entries: StoredEntry[]; total: number }>;
  has(fingerprint: string): Promise<boolean>;
  add(e: StoredEntry): Promise<void>;
  /** True if this name already has an entry at least as fast on the board. */
  nameHasAtLeast(mode: LeaderboardMode, difficulty: Difficulty, name: string, timeMs: number): Promise<boolean>;
  /** Number of entries strictly faster than timeMs. */
  fasterThan(mode: LeaderboardMode, difficulty: Difficulty, timeMs: number): Promise<number>;
}

// ---------------------------------------------------------------- file store (local dev / fallback)
class FileStore implements LeaderboardStore {
  readonly kind = "file";
  private entries: StoredEntry[] = [];
  constructor(private file: string) {}
  async init(): Promise<void> {
    try {
      if (existsSync(this.file)) this.entries = JSON.parse(readFileSync(this.file, "utf8")) as StoredEntry[];
    } catch {
      this.entries = [];
    }
  }
  private board(mode: LeaderboardMode, difficulty: Difficulty): StoredEntry[] {
    return this.entries.filter((e) => e.mode === mode && e.difficulty === difficulty).sort((a, b) => a.timeMs - b.timeMs || a.at - b.at);
  }
  async list(mode: LeaderboardMode, difficulty: Difficulty, limit: number) {
    const b = this.board(mode, difficulty);
    return { entries: b.slice(0, limit), total: b.length };
  }
  async has(fingerprint: string) {
    return this.entries.some((e) => e.fingerprint === fingerprint);
  }
  async nameHasAtLeast(mode: LeaderboardMode, difficulty: Difficulty, name: string, timeMs: number) {
    const n = name.trim().toLowerCase();
    return this.board(mode, difficulty).some((e) => e.timeMs <= timeMs && e.names.some((x) => x.trim().toLowerCase() === n));
  }
  async fasterThan(mode: LeaderboardMode, difficulty: Difficulty, timeMs: number) {
    return this.board(mode, difficulty).filter((e) => e.timeMs < timeMs).length;
  }
  async add(e: StoredEntry) {
    this.entries.push(e);
    // keep only the best LEADERBOARD_KEEP per board
    const keep = new Set<string>();
    for (const m of ["solo", "coop"] as const) for (const d of ["easy", "normal", "hard"] as const) this.board(m, d).slice(0, LEADERBOARD_KEEP).forEach((x) => keep.add(x.id));
    this.entries = this.entries.filter((x) => keep.has(x.id));
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.entries));
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------- Postgres store (persistent, for production)
class PgStore implements LeaderboardStore {
  readonly kind = "postgres";
  private pool: pg.Pool;
  constructor(url: string) {
    // Render's internal URL (host like "dpg-xxxx-a", no dot) needs no SSL; external/hosted URLs do.
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      /* leave empty */
    }
    const needsSsl = host.includes(".") && !/^(localhost|127\.0\.0\.1)$/.test(host);
    this.pool = new pg.Pool({ connectionString: url, max: 3, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  }
  async init(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS leaderboard (
      id text PRIMARY KEY, mode text NOT NULL, difficulty text NOT NULL, names jsonb NOT NULL,
      time_ms integer NOT NULL, at bigint NOT NULL, loadout jsonb NOT NULL, fingerprint text UNIQUE NOT NULL)`);
    await this.pool.query(`ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS leaderboard_board ON leaderboard (mode, difficulty, time_ms)`);
  }
  private row(r: Record<string, unknown>): StoredEntry {
    return {
      id: String(r.id), mode: r.mode as LeaderboardMode, difficulty: r.difficulty as Difficulty, names: r.names as string[],
      timeMs: Number(r.time_ms), at: Number(r.at), loadout: r.loadout as string[], fingerprint: String(r.fingerprint),
      ...(r.imported ? { imported: true } : {}),
    };
  }
  async list(mode: LeaderboardMode, difficulty: Difficulty, limit: number) {
    const rows = await this.pool.query(`SELECT * FROM leaderboard WHERE mode=$1 AND difficulty=$2 ORDER BY time_ms, at LIMIT $3`, [mode, difficulty, limit]);
    const total = await this.pool.query(`SELECT count(*)::int AS n FROM leaderboard WHERE mode=$1 AND difficulty=$2`, [mode, difficulty]);
    return { entries: rows.rows.map((r) => this.row(r)), total: Number(total.rows[0]?.n ?? 0) };
  }
  async has(fingerprint: string) {
    const r = await this.pool.query(`SELECT 1 FROM leaderboard WHERE fingerprint=$1`, [fingerprint]);
    return (r.rowCount ?? 0) > 0;
  }
  async nameHasAtLeast(mode: LeaderboardMode, difficulty: Difficulty, name: string, timeMs: number) {
    const r = await this.pool.query(
      `SELECT 1 FROM leaderboard WHERE mode=$1 AND difficulty=$2 AND time_ms <= $3 AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(names) x WHERE lower(trim(x)) = $4) LIMIT 1`,
      [mode, difficulty, timeMs, name.trim().toLowerCase()],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async fasterThan(mode: LeaderboardMode, difficulty: Difficulty, timeMs: number) {
    const r = await this.pool.query(`SELECT count(*)::int AS n FROM leaderboard WHERE mode=$1 AND difficulty=$2 AND time_ms < $3`, [mode, difficulty, timeMs]);
    return Number(r.rows[0]?.n ?? 0);
  }
  async add(e: StoredEntry) {
    await this.pool.query(
      `INSERT INTO leaderboard (id, mode, difficulty, names, time_ms, at, loadout, fingerprint, imported) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (fingerprint) DO NOTHING`,
      [e.id, e.mode, e.difficulty, JSON.stringify(e.names), e.timeMs, e.at, JSON.stringify(e.loadout), e.fingerprint, e.imported === true],
    );
  }
}

// ---------------------------------------------------------------- service
function loadoutNames(ship: SpacecraftState | undefined): string[] {
  if (!ship) return [];
  const names = ship.attachments.map((a) => ATTACHMENTS[a].name);
  if (ship.hasRepairDrone) names.push(ship.repairUpgraded ? "Repair Drone+" : "Repair Drone");
  return names;
}
const publicEntry = ({ fingerprint: _f, ...e }: StoredEntry): LeaderboardEntry => e;

export class LeaderboardService {
  private store: LeaderboardStore;
  private recent = new Map<string, number[]>();
  constructor(private log: (line: string) => void = () => undefined, opts: { databaseUrl?: string; file?: string } = {}) {
    const url = opts.databaseUrl ?? process.env.DATABASE_URL;
    this.store = url ? new PgStore(url) : new FileStore(opts.file ?? process.env.LEADERBOARD_FILE ?? resolve(process.cwd(), "data/leaderboard.json"));
  }

  get storage(): string {
    return this.store.kind;
  }

  async init(): Promise<void> {
    try {
      await this.store.init();
      this.log(`[leaderboard] storage: ${this.store.kind}`);
    } catch (err) {
      this.log(`[leaderboard] storage init failed (${err instanceof Error ? err.message : String(err)}); using memory`);
      this.store = new FileStore(resolve(process.cwd(), "data/leaderboard.json"));
      await this.store.init();
    }
  }

  async board(mode: LeaderboardMode, difficulty: Difficulty): Promise<LeaderboardBoard> {
    const { entries, total } = await this.store.list(mode, difficulty, LEADERBOARD_SHOW);
    return { mode, difficulty, entries: entries.map(publicEntry), total };
  }

  /** At most 6 submissions per minute per client. */
  private rateLimited(client: string): boolean {
    const now = Date.now();
    const list = (this.recent.get(client) ?? []).filter((t) => now - t < 60_000);
    list.push(now);
    this.recent.set(client, list);
    if (this.recent.size > 5000) this.recent.clear();
    return list.length > 6;
  }

  private async insert(e: StoredEntry): Promise<SubmitResult> {
    if (await this.store.has(e.fingerprint)) return { ok: false, reason: "This run is already on the leaderboard." };
    await this.store.add(e);
    const faster = await this.store.fasterThan(e.mode, e.difficulty, e.timeMs);
    const rank = faster + 1;
    return { ok: true, entry: publicEntry(e), rank: rank <= LEADERBOARD_KEEP ? rank : null };
  }

  /** Verifies a solo run by deterministic replay, then records it. */
  async submitSolo(body: unknown, client: string): Promise<SubmitResult> {
    if (this.rateLimited(client)) return { ok: false, reason: "Too many submissions — try again in a minute." };
    const parsed = zSoloRunRecord.safeParse(body);
    if (!parsed.success) return { ok: false, reason: "Invalid run record." };
    const rec = parsed.data;
    const t0 = Date.now();
    const r = replaySoloRun(rec);
    if (!r.ok) {
      this.log(`[leaderboard] solo run rejected: ${r.reason}`);
      return { ok: false, reason: `Run could not be verified (${r.reason}).` };
    }
    const fingerprint = createHash("sha256").update(JSON.stringify([rec.seed, rec.difficulty, rec.commands])).digest("hex");
    const res = await this.insert({
      id: randomUUID(), mode: "solo", difficulty: rec.difficulty, names: [rec.name], timeMs: r.totalMs,
      at: Date.now(), loadout: loadoutNames(r.state.spacecraft[0]), fingerprint,
    });
    this.log(`[leaderboard] solo ${rec.difficulty} ${(r.totalMs / 1000).toFixed(2)}s by ${rec.name} verified in ${Date.now() - t0}ms → rank ${res.rank ?? "-"}`);
    return res;
  }

  /**
   * Adds a personal best that a browser saved before leaderboards launched. These have no replay to
   * check, so they are bounds-checked, limited to one per saved record, and shown as "earlier runs".
   */
  async importSavedBest(body: unknown, client: string): Promise<SubmitResult> {
    if (this.rateLimited(`import:${client}`)) return { ok: false, reason: "Too many submissions — try again in a minute." };
    const parsed = zSavedBest.safeParse(body);
    if (!parsed.success) return { ok: false, reason: "Invalid saved best." };
    const b = parsed.data;
    if (await this.store.nameHasAtLeast(b.mode, b.difficulty, b.name, b.totalMs)) return { ok: false, reason: "This run is already on the leaderboard." };
    const fingerprint = createHash("sha256").update(JSON.stringify(["saved", b.mode, b.difficulty, b.name.trim().toLowerCase(), b.totalMs, b.setAt])).digest("hex");
    const loadout = b.attachments.filter((id): id is AttachmentId => id in ATTACHMENTS).map((id) => ATTACHMENTS[id].name);
    const res = await this.insert({
      id: randomUUID(), mode: b.mode, difficulty: b.difficulty, names: [b.name], timeMs: b.totalMs,
      at: b.setAt, loadout, fingerprint, imported: true,
    });
    this.log(`[leaderboard] imported earlier ${b.mode} ${b.difficulty} best ${(b.totalMs / 1000).toFixed(2)}s by ${b.name} → rank ${res.rank ?? "-"}`);
    return res;
  }

  /** Records a finished co-op mission straight from the server's authoritative state. */
  async recordCoop(state: MatchState): Promise<SubmitResult | null> {
    const o = state.outcome;
    if (state.mode !== "coop" || state.tutorial || !o || o.kind !== "coop-complete") return null;
    const byRole = (role: string) => state.players.find((p) => p.role === role)?.name;
    const names = [byRole("pilot"), byRole("engineer")].filter((n): n is string => !!n);
    const res = await this.insert({
      id: randomUUID(), mode: "coop", difficulty: state.difficulty, names, timeMs: o.totalMs,
      at: Date.now(), loadout: loadoutNames(state.spacecraft[0]), fingerprint: `coop:${state.id}`,
    });
    this.log(`[leaderboard] coop ${state.difficulty} ${(o.totalMs / 1000).toFixed(2)}s by ${names.join(" & ")} → rank ${res.rank ?? "-"}`);
    return res;
  }
}
