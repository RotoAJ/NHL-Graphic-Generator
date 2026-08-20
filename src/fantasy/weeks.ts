// Saved weekly sets, so each Monday's output gets a stable permalink
// (/fantasy/week/YYYY-MM-DD) with both threads and all six cards.
//
// This is what makes delivery independent of Slack: a notification only ever has
// to carry a link, and the cards are served from the saved set rather than pushed
// as file uploads.
import { neon } from "@neondatabase/serverless";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { connectionString, hasDatabase } from "@/src/fantasy/db";
import type { Finalist } from "@/src/fantasy/types";

export interface WeeklySet {
  weekEnd: string;
  window: { from: string; to: string };
  stars: Finalist[];
  sleepers: Finalist[];
  threads: { stars: string; sleepers: string };
  warnings: string[];
  createdAt: string;
}

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "weeks.json");

let migrated = false;

async function ensureSchema(): Promise<void> {
  if (migrated) return;
  const cs = connectionString();
  if (!cs) return;
  const sql = neon(cs);
  await sql`
    CREATE TABLE IF NOT EXISTS weekly_sets (
      week_end   DATE PRIMARY KEY,
      payload    JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  migrated = true;
}

async function readFileStore(): Promise<Record<string, WeeklySet>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Record<string, WeeklySet>;
  } catch {
    return {};
  }
}

/** Upsert -- re-running a week overwrites it rather than duplicating. */
export async function saveWeek(set: WeeklySet): Promise<void> {
  if (hasDatabase()) {
    await ensureSchema();
    const sql = neon(connectionString()!);
    await sql`
      INSERT INTO weekly_sets (week_end, payload)
      VALUES (${set.weekEnd}, ${JSON.stringify(set)}::jsonb)
      ON CONFLICT (week_end)
      DO UPDATE SET payload = EXCLUDED.payload, created_at = now()
    `;
    return;
  }
  const all = await readFileStore();
  all[set.weekEnd] = set;
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
}

export async function loadWeek(weekEnd: string): Promise<WeeklySet | null> {
  if (hasDatabase()) {
    await ensureSchema();
    const sql = neon(connectionString()!);
    const rows = (await sql`
      SELECT payload FROM weekly_sets WHERE week_end = ${weekEnd}
    `) as Array<{ payload: WeeklySet }>;
    return rows[0]?.payload ?? null;
  }
  return (await readFileStore())[weekEnd] ?? null;
}

/** Most recent saved weeks, newest first. */
export async function listWeeks(limit = 20): Promise<
  Array<{ weekEnd: string; createdAt: string; starCount: number; sleeperCount: number }>
> {
  if (hasDatabase()) {
    await ensureSchema();
    const sql = neon(connectionString()!);
    const rows = (await sql`
      SELECT week_end, created_at, payload FROM weekly_sets
      ORDER BY week_end DESC LIMIT ${limit}
    `) as Array<{ week_end: string | Date; created_at: string | Date; payload: WeeklySet }>;
    return rows.map((r) => ({
      weekEnd:
        typeof r.week_end === "string" ? r.week_end.slice(0, 10) : r.week_end.toISOString().slice(0, 10),
      createdAt: String(r.created_at),
      starCount: r.payload?.stars?.length ?? 0,
      sleeperCount: r.payload?.sleepers?.length ?? 0,
    }));
  }
  const all = await readFileStore();
  return Object.values(all)
    .sort((a, b) => b.weekEnd.localeCompare(a.weekEnd))
    .slice(0, limit)
    .map((w) => ({
      weekEnd: w.weekEnd,
      createdAt: w.createdAt,
      starCount: w.stars.length,
      sleeperCount: w.sleepers.length,
    }));
}
