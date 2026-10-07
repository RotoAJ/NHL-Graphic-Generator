// Durable store for captured news Updates.
//
// Replaces a Google Drive JSON blob that had to be trashed and recreated on
// every write, because that connector cannot edit a file in place. A table
// gives real upserts, real queries, and no rewrite-the-world step.
//
// Capture is append-only in spirit: an Id already stored is never overwritten.
// The whole point is that the first copy we saw is the trustworthy one -- a
// later fetch of the same day can come back damaged, and we must not let a
// damaged re-read clobber good data.
import { neon } from "@neondatabase/serverless";
import { connectionString, hasDatabase } from "@/src/fantasy/db";
import type { NewsUpdate } from "@/src/news/rotowire";

export { hasDatabase };

let migrated = false;

async function db() {
  const cs = connectionString();
  if (!cs) throw new Error("No database configured");
  const sql = neon(cs);
  if (!migrated) {
    await sql`
      CREATE TABLE IF NOT EXISTS news_updates (
        id            BIGINT PRIMARY KEY,
        date_time     TIMESTAMPTZ,
        priority      INTEGER,
        headline      TEXT NOT NULL DEFAULT '',
        notes         TEXT NOT NULL DEFAULT '',
        analysis      TEXT NOT NULL DEFAULT '',
        player_id     TEXT,
        player_name   TEXT,
        position      TEXT,
        league_level  TEXT,
        injury_status TEXT,
        injury_type   TEXT,
        team_code     TEXT,
        captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS news_updates_date_time_idx ON news_updates (date_time)`;
    migrated = true;
  }
  return sql;
}

/**
 * Insert any Ids we haven't seen. Returns the ids actually added.
 *
 * ON CONFLICT DO NOTHING is deliberate: never overwrite an existing row. A
 * re-fetch of a day RotoWire has since damaged would otherwise replace good
 * captured content with worse.
 */
export async function captureUpdates(updates: NewsUpdate[]): Promise<number[]> {
  if (!updates.length || !hasDatabase()) return [];
  const sql = await db();
  const added: number[] = [];
  for (const u of updates) {
    const rows = (await sql`
      INSERT INTO news_updates (
        id, date_time, priority, headline, notes, analysis,
        player_id, player_name, position, league_level,
        injury_status, injury_type, team_code
      ) VALUES (
        ${u.id}, ${u.dateTime || null}, ${u.priority}, ${u.headline}, ${u.notes},
        ${u.analysis}, ${u.playerId}, ${u.playerName}, ${u.position},
        ${u.leagueLevel}, ${u.injuryStatus}, ${u.injuryType}, ${u.teamCode}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `) as Array<{ id: string | number }>;
    if (rows.length) added.push(Number(rows[0].id));
  }
  return added;
}

export interface StoredUpdate extends NewsUpdate {
  capturedAt: string;
}

interface Row {
  id: string | number;
  date_time: string | Date | null;
  priority: number | null;
  headline: string;
  notes: string;
  analysis: string;
  player_id: string | null;
  player_name: string | null;
  position: string | null;
  league_level: string | null;
  injury_status: string | null;
  injury_type: string | null;
  team_code: string | null;
  captured_at: string | Date;
}

function toUpdate(r: Row): StoredUpdate {
  const iso = (v: string | Date | null) =>
    v === null ? "" : typeof v === "string" ? v : v.toISOString();
  return {
    id: Number(r.id),
    dateTime: iso(r.date_time),
    priority: r.priority,
    headline: r.headline,
    notes: r.notes,
    analysis: r.analysis,
    playerId: r.player_id,
    playerName: r.player_name,
    position: r.position,
    leagueLevel: r.league_level,
    injuryStatus: r.injury_status,
    injuryType: r.injury_type,
    teamCode: r.team_code,
    capturedAt: iso(r.captured_at),
  };
}

/** Everything captured after `afterId`, oldest first. */
export async function updatesAfterId(afterId: number, limit = 300): Promise<StoredUpdate[]> {
  if (!hasDatabase()) return [];
  const sql = await db();
  const rows = (await sql`
    SELECT * FROM news_updates WHERE id > ${afterId} ORDER BY id ASC LIMIT ${limit}
  `) as Row[];
  return rows.map(toUpdate);
}

/** Everything with a feed DateTime at or after `sinceIso`, oldest first. */
export async function updatesSince(sinceIso: string, limit = 300): Promise<StoredUpdate[]> {
  if (!hasDatabase()) return [];
  const sql = await db();
  const rows = (await sql`
    SELECT * FROM news_updates WHERE date_time >= ${sinceIso} ORDER BY id ASC LIMIT ${limit}
  `) as Row[];
  return rows.map(toUpdate);
}

export async function stats(): Promise<{
  total: number;
  minId: number | null;
  maxId: number | null;
  lastCapturedAt: string | null;
}> {
  if (!hasDatabase()) return { total: 0, minId: null, maxId: null, lastCapturedAt: null };
  const sql = await db();
  const rows = (await sql`
    SELECT COUNT(*)::int AS total, MIN(id) AS min_id, MAX(id) AS max_id,
           MAX(captured_at) AS last_captured
      FROM news_updates
  `) as Array<{
    total: number;
    min_id: string | number | null;
    max_id: string | number | null;
    last_captured: string | Date | null;
  }>;
  const r = rows[0];
  return {
    total: r?.total ?? 0,
    minId: r?.min_id === null || r?.min_id === undefined ? null : Number(r.min_id),
    maxId: r?.max_id === null || r?.max_id === undefined ? null : Number(r.max_id),
    lastCapturedAt:
      !r?.last_captured
        ? null
        : typeof r.last_captured === "string"
          ? r.last_captured
          : r.last_captured.toISOString(),
  };
}

/**
 * Ids missing from a contiguous run. The real feed's Ids are gapless, so any
 * hole is either RotoWire's data loss or a capture we missed.
 */
export async function missingIds(fromId: number, toId: number): Promise<number[]> {
  if (!hasDatabase() || toId <= fromId) return [];
  const sql = await db();
  const rows = (await sql`
    SELECT id FROM news_updates WHERE id BETWEEN ${fromId} AND ${toId} ORDER BY id ASC
  `) as Array<{ id: string | number }>;
  const have = new Set(rows.map((r) => Number(r.id)));
  const gaps: number[] = [];
  for (let i = fromId; i <= toId; i++) if (!have.has(i)) gaps.push(i);
  return gaps;
}
