// Database access for the rankings feature.
//
// One tiny seam: sql() returns a tagged-template query function. In production
// that is the Neon driver. Tests install a PGlite-backed function on
// globalThis.__RK_SQL instead, so the real queries run locally against a real
// Postgres engine -- this feature is mostly SQL and there is no local database
// to test against otherwise.
//
// Conventions that keep the two engines interchangeable:
//   - bulk writes go through jsonb_to_recordset(<json string>::jsonb)
//   - id lists go through jsonb_array_elements_text(<json string>::jsonb)
//   - dates are read with to_char(..., 'YYYY-MM-DD') because Neon returns DATE as
//     a string while PGlite returns a JS Date
//   - BIGINT is wrapped in Number() because Neon returns it as a string
import { neon } from "@neondatabase/serverless";
import { connectionString } from "@/src/fantasy/db";

export type Row = Record<string, unknown>;
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

let migrated = false;

declare global {
  // eslint-disable-next-line no-var
  var __RK_SQL: Sql | undefined;
}

export function rankingsDbAvailable(): boolean {
  return !!globalThis.__RK_SQL || !!connectionString();
}

export async function sql(): Promise<Sql> {
  const injected = globalThis.__RK_SQL;
  let q: Sql;
  if (injected) q = injected;
  else {
    const cs = connectionString();
    if (!cs) throw new Error("No database configured.");
    q = neon(cs) as unknown as Sql;
  }
  if (injected) {
    await migrate(q);
    return q;
  }
  if (!migrated) {
    // Several queries arrive at once on a cold start; they must share ONE migration, or on a brand-new database
    // they race to CREATE the same table and Postgres rejects the loser ("duplicate key ... pg_class_relname").
    migrating ??= migrateWithRetry(q)
      .then(() => {
        migrated = true;
      })
      .finally(() => {
        migrating = null;
      });
    await migrating;
  }
  return q;
}

let migrating: Promise<void> | null = null;

/** Another server instance can still be creating the same tables at the same moment: wait and look again. */
async function migrateWithRetry(q: Sql): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await migrate(q);
      return;
    } catch (e) {
      if (attempt < 4 && /duplicate key|already exists/i.test((e as Error).message)) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

async function migrate(q: Sql): Promise<void> {
  await q`
    CREATE TABLE IF NOT EXISTS rk_runs (
      id           SERIAL PRIMARY KEY,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      kind         TEXT NOT NULL,
      committed    BOOLEAN NOT NULL DEFAULT FALSE,
      committed_at TIMESTAMPTZ,
      base_run_id  INTEGER,
      window_from  DATE,
      window_to    DATE,
      player_count INTEGER NOT NULL DEFAULT 0,
      note         TEXT,
      changelog    JSONB,
      meta         JSONB
    )`;
  await q`
    CREATE TABLE IF NOT EXISTS rk_rows (
      run_id    INTEGER NOT NULL REFERENCES rk_runs(id) ON DELETE CASCADE,
      rank      INTEGER NOT NULL,
      stats_id  TEXT NOT NULL,
      player    TEXT NOT NULL,
      team      TEXT NOT NULL DEFAULT '',
      positions TEXT NOT NULL DEFAULT '',
      injury    TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (run_id, rank)
    )`;
  await q`
    CREATE TABLE IF NOT EXISTS rk_games (
      game_id       BIGINT PRIMARY KEY,
      game_date     DATE NOT NULL,
      home          TEXT NOT NULL,
      away          TEXT NOT NULL,
      processed_run INTEGER
    )`;
  await q`
    CREATE TABLE IF NOT EXISTS rk_lines (
      game_id       BIGINT NOT NULL REFERENCES rk_games(game_id) ON DELETE CASCADE,
      nhl_id        BIGINT NOT NULL,
      team          TEXT NOT NULL,
      position      TEXT NOT NULL DEFAULT '',
      is_goalie     BOOLEAN NOT NULL DEFAULT FALSE,
      goals         INTEGER NOT NULL DEFAULT 0,
      assists       INTEGER NOT NULL DEFAULT 0,
      points        INTEGER NOT NULL DEFAULT 0,
      toi_sec       INTEGER NOT NULL DEFAULT 0,
      decision      TEXT,
      saves         INTEGER NOT NULL DEFAULT 0,
      shots_against INTEGER NOT NULL DEFAULT 0,
      goals_against INTEGER NOT NULL DEFAULT 0,
      shutout       BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (game_id, nhl_id)
    )`;
  await q`CREATE INDEX IF NOT EXISTS rk_lines_nhl_idx ON rk_lines (nhl_id)`;
  await q`
    CREATE TABLE IF NOT EXISTS rk_players (
      nhl_id      BIGINT PRIMARY KEY,
      first_name  TEXT,
      last_name   TEXT,
      dob         DATE,
      position    TEXT,
      team        TEXT,
      stats_id    TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await q`CREATE INDEX IF NOT EXISTS rk_players_stats_idx ON rk_players (stats_id)`;
  await q`
    CREATE TABLE IF NOT EXISTS rk_outlooks (
      run_id    INTEGER NOT NULL REFERENCES rk_runs(id) ON DELETE CASCADE,
      win       INTEGER NOT NULL,
      rank      INTEGER NOT NULL,
      stats_id  TEXT NOT NULL,
      player    TEXT NOT NULL,
      team      TEXT NOT NULL DEFAULT '',
      positions TEXT NOT NULL DEFAULT '',
      injury    TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (run_id, win, rank)
    )`;
  await q`
    CREATE TABLE IF NOT EXISTS rk_outlook_logs (
      run_id   INTEGER NOT NULL REFERENCES rk_runs(id) ON DELETE CASCADE,
      win      INTEGER NOT NULL,
      built_for DATE,
      log      JSONB,
      PRIMARY KEY (run_id, win)
    )`;
  await q`
    CREATE TABLE IF NOT EXISTS rk_run_games (
      run_id  INTEGER NOT NULL REFERENCES rk_runs(id) ON DELETE CASCADE,
      game_id BIGINT NOT NULL,
      PRIMARY KEY (run_id, game_id)
    )`;
}

export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
export const idsJson = (ids: Array<number | string>): string => JSON.stringify(ids.map(String));
