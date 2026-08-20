// Postgres-backed featured-player history (Neon serverless driver).
//
// Vercel's Postgres offering is Neon, and @vercel/postgres is deprecated in
// favour of Neon's own SDK -- hence @neondatabase/serverless.
//
// Connection string comes from DATABASE_URL / POSTGRES_URL, which Vercel's Neon
// integration sets automatically when a database is attached to the project.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { FeaturedStore } from "@/src/fantasy/featured";
import type { FeaturedRecord, ThreadType } from "@/src/fantasy/types";

export function connectionString(): string | null {
  return (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    null
  );
}

export function hasDatabase(): boolean {
  return !!connectionString();
}

let migrated = false;

/** Idempotent schema creation -- safe to call on every request. */
async function ensureSchema(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (migrated) return;
  await sql`
    CREATE TABLE IF NOT EXISTS featured_players (
      id          SERIAL PRIMARY KEY,
      player_id   TEXT NOT NULL,
      player_name TEXT NOT NULL,
      position    TEXT NOT NULL,
      thread_type TEXT NOT NULL,
      featured_on DATE NOT NULL DEFAULT CURRENT_DATE
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS featured_players_featured_on_idx
      ON featured_players (featured_on)
  `;
  migrated = true;
}

interface Row {
  player_id: string;
  player_name: string;
  position: string;
  thread_type: string;
  featured_on: string | Date;
}

function toISO(v: string | Date): string {
  return typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

export const postgresStore: FeaturedStore = {
  name: "postgres",
  persistent: true,

  async recentIds(days) {
    const cs = connectionString();
    if (!cs) return new Set();
    const sql = neon(cs);
    await ensureSchema(sql);
    // Bind the interval as a parameter rather than interpolating into SQL.
    const rows = (await sql`
      SELECT DISTINCT player_id
      FROM featured_players
      WHERE featured_on > CURRENT_DATE - (${String(days)} || ' days')::interval
    `) as Array<{ player_id: string }>;
    return new Set(rows.map((r) => r.player_id));
  },

  async add(records) {
    if (!records.length) return;
    const cs = connectionString();
    if (!cs) return;
    const sql = neon(cs);
    await ensureSchema(sql);
    for (const r of records) {
      await sql`
        INSERT INTO featured_players
          (player_id, player_name, position, thread_type, featured_on)
        VALUES (${r.playerId}, ${r.playerName}, ${r.position}, ${r.threadType}, ${r.featuredOn})
      `;
    }
  },

  async all() {
    const cs = connectionString();
    if (!cs) return [];
    const sql = neon(cs);
    await ensureSchema(sql);
    const rows = (await sql`
      SELECT player_id, player_name, position, thread_type, featured_on
      FROM featured_players
      ORDER BY featured_on DESC, id DESC
      LIMIT 500
    `) as Row[];
    return rows.map(
      (r): FeaturedRecord => ({
        playerId: r.player_id,
        playerName: r.player_name,
        position: r.position,
        threadType: (r.thread_type === "sleepers" ? "sleepers" : "stars") as ThreadType,
        featuredOn: toISO(r.featured_on),
      }),
    );
  },
};
