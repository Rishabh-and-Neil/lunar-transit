// Global leaderboards: one board per mode (solo, co-op) x difficulty (easy, normal, hard).
// Solo times are verified by replaying the browser's recorded run; co-op times come from the server's own match.
// Each player (one browser, identified by a private client id) has ONE row per board: their best.
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
  /** Whose row this is: "c:<clientId>" (co-op: both ids), or "name:<names>" for results with no client id. */
  owner: string;
}

/** Owner key from names, used for rows recorded before client ids existed. */
export function nameOwner(names: string[]): string {
  return `name:${names.map((n) => n.trim().toLowerCase()).sort().join("+")}`;
}

interface LeaderboardStore {
  readonly kind: string;
  init(): Promise<void>;
  /** Sorted fastest first. */
  list(mode: LeaderboardMode, difficulty: Difficulty, limit: number): Promise<{ entries: StoredEntry[]; total: number }>;
  has(fingerprint: string): Promise<boolean>;
  byOwner(mode: LeaderboardMode, difficulty: Difficulty, owner: string): Promise<StoredEntry | undefined>;
  /** Replaces the row `replaceId` (if any) with `e`. */
  put(e: StoredEntry, replaceId?: string): Promise<void>;
  setOwner(id: string, owner: string): Promise<void>;
  /** Number of entries strictly faster than timeMs. */
  fasterThan(mode: LeaderboardMode, difficulty: Difficulty, timeMs: number): Promise<number>;
}

const better = (a: StoredEntry, b: StoredEntry) => a.timeMs - b.timeMs || a.at - b.at || (a.id < b.id ? -1 : 1);

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
    // migrate: give old rows a name owner, then keep only each owner's best per board
    for (const e of this.entries) e.owner ??= nameOwner(e.names);
    const best = new Map<string, StoredEntry>();
    for (const e of this.entries) {
      const k = `${e.mode}|${e.difficulty}|${e.owner}`;
      const cur = best.get(k);
      if (!cur || better(e, cur) < 0) best.set(k, e);
    }
    if (best.size !== this.entries.length) {
      this.entries = [...best.values()];
      this.save();
    }
  }
  private board(mode: LeaderboardMode, difficulty: Difficulty): StoredEntry[] {
    return this.entries.filter((e) => e.mode === mode && e.difficulty === difficulty).sort(better);
  }
  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.entries));
    } catch {
      /* best effort */
    }
  }
  async list(mode: LeaderboardMode, difficulty: Difficulty, limit: number) {
    const b = this.board(mode, difficulty);
    return { entries: b.slice(0, limit), total: b.length };
  }
  async has(fingerprint: string) {
    return this.entries.some((e) => e.fingerprint === fingerprint);
  }
  async byOwner(mode: LeaderboardMode, difficulty: Difficulty, owner: string) {
    return this.entries.find((e) => e.mode === mode && e.difficulty === difficulty && e.owner === owner);
  }
  async fasterThan(mode: LeaderboardMode, difficulty: Difficulty, timeMs: number) {
    return this.board(mode, difficulty).filter((e) => e.timeMs < timeMs).length;
  }
  async setOwner(id: string, owner: string) {
    const e = this.entries.find((x) => x.id === id);
    if (e) e.owner = owner;
    this.save();
  }
  async put(e: StoredEntry, replaceId?: string) {
    this.entries = this.entries.filter((x) => x.id !== replaceId);
    this.entries.push(e);
    // keep only the best LEADERBOARD_KEEP per board
    const keep = new Set<string>();
    for (const m of ["solo", "coop"] as const) for (const d of ["easy", "normal", "hard"] as const) this.board(m, d).slice(0, LEADERBOARD_KEEP).forEach((x) => keep.add(x.id));
    this.entries = this.entries.filter((x) => keep.has(x.id));
    this.save();
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
    const q = (sql: string) => this.pool.query(sql);
    await q(`CREATE TABLE IF NOT EXISTS leaderboard (
      id text PRIMARY KEY, mode text NOT NULL, difficulty text NOT NULL, names jsonb NOT NULL,
      time_ms integer NOT NULL, at bigint NOT NULL, loadout jsonb NOT NULL, fingerprint text UNIQUE NOT NULL)`);
    await q(`ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false`);
    await q(`ALTER TABLE leaderboard ADD COLUMN IF NOT EXISTS owner text`);
    // rows from before owners existed belong to their name(s)
    await q(`UPDATE leaderboard SET owner = 'name:' || (
      SELECT string_agg(lower(trim(x)), '+' ORDER BY lower(trim(x)) COLLATE "C") FROM jsonb_array_elements_text(names) x
    ) WHERE owner IS NULL`);
    // one row per owner per board: keep the fastest (earliest on ties)
    await q(`DELETE FROM leaderboard a USING leaderboard b
      WHERE a.mode = b.mode AND a.difficulty = b.difficulty AND a.owner = b.owner AND a.id <> b.id
        AND (a.time_ms > b.time_ms OR (a.time_ms = b.time_ms AND (a.at > b.at OR (a.at = b.at AND a.id > b.id))))`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_owner ON leaderboard (mode, difficulty, owner)`);
    await q(`CREATE INDEX IF NOT EXISTS leaderboard_board ON leaderboard (mode, difficulty, time_ms)`);
  }
  private row(r: Record<string, unknown>): StoredEntry {
    return {
      id: String(r.id), mode: r.mode as LeaderboardMode, difficulty: r.difficulty as Difficulty, names: r.names as string[],
      timeMs: Number(r.time_ms), at: Number(r.at), loadout: r.loadout as string[], fingerprint: String(r.fingerprint),
      owner: String(r.owner),
      ...(r.imported ? { imported: true } : {}),
    };
  }
  async list(mode: LeaderboardMode, difficulty: Difficulty, limit: number) {
    const rows = await this.pool.query(`SELECT * FROM leaderboard WHERE mode=$1 AND difficulty=$2 ORDER BY time_ms, at, id LIMIT $3`, [mode, difficulty, limit]);
    const total = await this.pool.query(`SELECT count(*)::int AS n FROM leaderboard WHERE mode=$1 AND difficulty=$2`, [mode, difficulty]);
    return { entries: rows.rows.map((r) => this.row(r)), total: Number(total.rows[0]?.n ?? 0) };
  }
  async has(fingerprint: string) {
    const r = await this.pool.query(`SELECT 1 FROM leaderboard WHERE fingerprint=$1`, [fingerprint]);
    return (r.rowCount ?? 0) > 0;
  }
  async byOwner(mode: LeaderboardMode, difficulty: Difficulty, owner: string) {
    const r = await this.pool.query(`SELECT * FROM leaderboard WHERE mode=$1 AND difficulty=$2 AND owner=$3`, [mode, difficulty, owner]);
    return r.rows[0] ? this.row(r.rows[0]) : undefined;
  }
  async fasterThan(mode: LeaderboardMode, difficulty: Difficulty, timeMs: number) {
    const r = await this.pool.query(`SELECT count(*)::int AS n FROM leaderboard WHERE mode=$1 AND difficulty=$2 AND time_ms < $3`, [mode, difficulty, timeMs]);
    return Number(r.rows[0]?.n ?? 0);
  }
  async setOwner(id: string, owner: string) {
    await this.pool.query(`UPDATE leaderboard SET owner=$2 WHERE id=$1`, [id, owner]);
  }
  async put(e: StoredEntry, replaceId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (replaceId) await client.query(`DELETE FROM leaderboard WHERE id=$1`, [replaceId]);
      await client.query(
        `INSERT INTO leaderboard (id, mode, difficulty, names, time_ms, at, loadout, fingerprint, imported, owner) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [e.id, e.mode, e.difficulty, JSON.stringify(e.names), e.timeMs, e.at, JSON.stringify(e.loadout), e.fingerprint, e.imported === true, e.owner],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

// ---------------------------------------------------------------- service
function loadoutNames(ship: SpacecraftState | undefined): string[] {
  if (!ship) return [];
  const names = ship.attachments.map((a) => ATTACHMENTS[a].name);
  if (ship.hasRepairDrone) names.push(ship.repairUpgraded ? "Repair Drone+" : "Repair Drone");
  return names;
}
const publicEntry = ({ fingerprint: _f, owner: _o, ...e }: StoredEntry): LeaderboardEntry => e;

export class LeaderboardService {
  private store: LeaderboardStore;
  private recent = new Map<string, number[]>();
  /** Serialises writes so one player's two quick results can't race into two rows. */
  private queue: Promise<unknown> = Promise.resolve();
  private perMinute: number;
  constructor(private log: (line: string) => void = () => undefined, opts: { databaseUrl?: string; file?: string; submissionsPerMinute?: number } = {}) {
    this.perMinute = opts.submissionsPerMinute ?? 6;
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

  /** At most `perMinute` submissions per minute per client (default 6). */
  private rateLimited(client: string): boolean {
    const now = Date.now();
    const list = (this.recent.get(client) ?? []).filter((t) => now - t < 60_000);
    list.push(now);
    this.recent.set(client, list);
    if (this.recent.size > 5000) this.recent.clear();
    return list.length > this.perMinute;
  }

  private async rankOf(e: StoredEntry): Promise<number | null> {
    const rank = (await this.store.fasterThan(e.mode, e.difficulty, e.timeMs)) + 1;
    return rank <= LEADERBOARD_KEEP ? rank : null;
  }

  /**
   * Records `e` as its owner's row on the board, but only if it beats their current best.
   * A player with a client id also takes over the row recorded under their name before ids existed.
   */
  private insert(e: StoredEntry): Promise<SubmitResult> {
    const run = async (): Promise<SubmitResult> => {
      if (await this.store.has(e.fingerprint)) return { ok: false, reason: "This run is already on the leaderboard." };
      let cur = await this.store.byOwner(e.mode, e.difficulty, e.owner);
      const legacy = nameOwner(e.names);
      if (!cur && e.owner !== legacy) {
        cur = await this.store.byOwner(e.mode, e.difficulty, legacy);
        if (cur) {
          await this.store.setOwner(cur.id, e.owner);
          cur = { ...cur, owner: e.owner };
        }
      }
      if (cur && cur.timeMs <= e.timeMs) return { ok: true, kept: true, entry: publicEntry(cur), rank: await this.rankOf(cur) };
      await this.store.put(e, cur?.id);
      return { ok: true, entry: publicEntry(e), rank: await this.rankOf(e) };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Verifies a solo run by deterministic replay, then records it if it is the player's best. */
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
      owner: rec.clientId ? `c:${rec.clientId}` : nameOwner([rec.name]),
    });
    this.log(`[leaderboard] solo ${rec.difficulty} ${(r.totalMs / 1000).toFixed(2)}s by ${rec.name} verified in ${Date.now() - t0}ms → ${res.kept ? "kept earlier best" : `rank ${res.rank ?? "-"}`}`);
    return res;
  }

  /**
   * Adds a personal best that a browser saved before leaderboards launched. These have no replay to
   * check, so they are bounds-checked and shown as "earlier runs". Like any result, it only replaces
   * the player's row if it is faster.
   */
  async importSavedBest(body: unknown, client: string): Promise<SubmitResult> {
    if (this.rateLimited(`import:${client}`)) return { ok: false, reason: "Too many submissions — try again in a minute." };
    const parsed = zSavedBest.safeParse(body);
    if (!parsed.success) return { ok: false, reason: "Invalid saved best." };
    const b = parsed.data;
    const fingerprint = createHash("sha256").update(JSON.stringify(["saved", b.mode, b.difficulty, b.clientId ?? b.name.trim().toLowerCase(), b.totalMs, b.setAt])).digest("hex");
    const loadout = b.attachments.filter((id): id is AttachmentId => id in ATTACHMENTS).map((id) => ATTACHMENTS[id].name);
    const res = await this.insert({
      id: randomUUID(), mode: b.mode, difficulty: b.difficulty, names: [b.name], timeMs: b.totalMs,
      at: b.setAt, loadout, fingerprint, imported: true,
      owner: b.clientId ? `c:${b.clientId}` : nameOwner([b.name]),
    });
    this.log(`[leaderboard] earlier ${b.mode} ${b.difficulty} best ${(b.totalMs / 1000).toFixed(2)}s by ${b.name} → ${res.kept ? "kept faster best" : `rank ${res.rank ?? "-"}`}`);
    return res;
  }

  /** Records a finished co-op mission straight from the server's authoritative state, if it is the crew's best. */
  async recordCoop(state: MatchState, clientIdOf: (playerId: string) => string | undefined = () => undefined): Promise<SubmitResult | null> {
    const o = state.outcome;
    if (state.mode !== "coop" || state.tutorial || !o || o.kind !== "coop-complete") return null;
    const byRole = (role: string) => state.players.find((p) => p.role === role);
    const crew = [byRole("pilot"), byRole("engineer")].filter((p): p is NonNullable<typeof p> => !!p);
    const names = crew.map((p) => p.name);
    const ids = crew.map((p) => clientIdOf(p.id));
    const owner = ids.length > 0 && ids.every(Boolean) ? `c:${[...(ids as string[])].sort().join("+")}` : nameOwner(names);
    const res = await this.insert({
      id: randomUUID(), mode: "coop", difficulty: state.difficulty, names, timeMs: o.totalMs,
      at: Date.now(), loadout: loadoutNames(state.spacecraft[0]), fingerprint: `coop:${state.id}`, owner,
    });
    this.log(`[leaderboard] coop ${state.difficulty} ${(o.totalMs / 1000).toFixed(2)}s by ${names.join(" & ")} → ${res.kept ? "kept crew best" : `rank ${res.rank ?? "-"}`}`);
    return res;
  }
}
