// Record of matchups already posted -- dedupe plus an audit trail.
//
// Dedupe is the single most important guard in an unattended poster: the cron
// runs repeatedly on a game day and the feed keeps reporting the same confirmed
// starters, so without this every run would post the same matchup again.
//
// The key is the RotoWire game id, which is stable across polls. UNIQUE on that
// column means a duplicate is impossible even if two cron runs overlap.
import { neon } from "@neondatabase/serverless";
import { connectionString, hasDatabase } from "@/src/fantasy/db";

export interface PostedRecord {
  rwGameId: string;
  matchup: string;
  tweetId: string | null;
  dryRun: boolean;
  postedAt: string;
}

let migrated = false;

async function db() {
  const cs = connectionString();
  if (!cs) throw new Error("No database configured");
  const sql = neon(cs);
  if (!migrated) {
    await sql`
      CREATE TABLE IF NOT EXISTS posted_matchups (
        id         SERIAL PRIMARY KEY,
        rw_game_id TEXT NOT NULL UNIQUE,
        matchup    TEXT NOT NULL,
        tweet_id   TEXT,
        dry_run    BOOLEAN NOT NULL DEFAULT FALSE,
        posted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    migrated = true;
  }
  return sql;
}

export { hasDatabase };

/** Game ids already handled, so the poller can skip them. */
export async function postedGameIds(): Promise<Set<string>> {
  if (!hasDatabase()) return new Set();
  try {
    const sql = await db();
    // Only look back a few days; the table is an audit log, not a working set.
    // A row blocks a game permanently only once it actually resolved -- a tweet
    // id, or a recorded dry run. A row that is merely *claimed* blocks for ten
    // minutes and then becomes eligible again.
    //
    // This matters because releaseGame() lives in a catch block, and a function
    // killed by a hard timeout never runs its catch. Without the expiry, one
    // timeout would leave a game claimed forever: never posted, never retried,
    // and silent. Ten minutes is comfortably longer than a full run.
    const rows = (await sql`
      SELECT rw_game_id FROM posted_matchups
       WHERE posted_at > NOW() - INTERVAL '7 days'
         AND (
           tweet_id IS NOT NULL
           OR dry_run = TRUE
           OR posted_at > NOW() - INTERVAL '10 minutes'
         )
    `) as Array<{ rw_game_id: string }>;
    return new Set(rows.map((r) => r.rw_game_id));
  } catch {
    // A read failure must not cause a re-post, so fail closed by pretending
    // everything is already posted.
    return new Set(["__db-unavailable__"]);
  }
}

/** True when this run should proceed; false when the game was already claimed. */
export async function claimGame(
  rwGameId: string,
  matchup: string,
): Promise<boolean> {
  if (!hasDatabase()) return true; // dev without a database
  const sql = await db();
  // One atomic statement decides all four cases, so two concurrent runs can
  // never both win:
  //   new game            -> INSERT succeeds, claimed
  //   already resolved     -> conflict, WHERE fails, NOT claimed
  //   claimed < 10 min ago -> conflict, WHERE fails, NOT claimed
  //   stale claim          -> conflict, WHERE passes, posted_at refreshed and
  //                           re-claimed, so a timed-out run is retried
  const rows = (await sql`
    INSERT INTO posted_matchups (rw_game_id, matchup)
    VALUES (${rwGameId}, ${matchup})
    ON CONFLICT (rw_game_id) DO UPDATE
       SET posted_at = NOW(), matchup = EXCLUDED.matchup
     WHERE posted_matchups.tweet_id IS NULL
       AND posted_matchups.dry_run = FALSE
       AND posted_matchups.posted_at < NOW() - INTERVAL '10 minutes'
    RETURNING id
  `) as Array<{ id: number }>;
  return rows.length > 0;
}

/** Attach the result once the post lands (or was skipped as a dry run). */
export async function recordResult(
  rwGameId: string,
  tweetId: string | null,
  dryRun: boolean,
): Promise<void> {
  if (!hasDatabase()) return;
  const sql = await db();
  await sql`
    UPDATE posted_matchups
       SET tweet_id = ${tweetId}, dry_run = ${dryRun}, posted_at = NOW()
     WHERE rw_game_id = ${rwGameId}
  `;
}

/**
 * Release a claim when the run failed before posting, so the next poll can
 * retry rather than the game being silently lost.
 */
export async function releaseGame(rwGameId: string): Promise<void> {
  if (!hasDatabase()) return;
  try {
    const sql = await db();
    await sql`
      DELETE FROM posted_matchups
       WHERE rw_game_id = ${rwGameId} AND tweet_id IS NULL AND dry_run = FALSE
    `;
  } catch {
    /* leaving the claim in place is the safe failure */
  }
}

export async function recentPosts(limit = 20): Promise<PostedRecord[]> {
  if (!hasDatabase()) return [];
  const sql = await db();
  const rows = (await sql`
    SELECT rw_game_id, matchup, tweet_id, dry_run, posted_at
      FROM posted_matchups
     ORDER BY posted_at DESC
     LIMIT ${limit}
  `) as Array<{
    rw_game_id: string;
    matchup: string;
    tweet_id: string | null;
    dry_run: boolean;
    posted_at: string | Date;
  }>;
  return rows.map((r) => ({
    rwGameId: r.rw_game_id,
    matchup: r.matchup,
    tweetId: r.tweet_id,
    dryRun: r.dry_run,
    postedAt:
      typeof r.posted_at === "string" ? r.posted_at : r.posted_at.toISOString(),
  }));
}
