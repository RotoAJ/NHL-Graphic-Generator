// Game-level NHL data for the rankings update.
//
// This replaces the skill's "season-cumulative snapshot from ESPN, diffed against
// the previous run" trick. That approach existed only because the NHL's own
// stats host is blocked from Cowork's sandbox. The hub is not under that block
// (it already reads api-web.nhle.com for the fantasy and goalie tools), so it can
// read real box scores instead -- and with real games a window is exact:
//
//   - each game is counted ONCE, tracked by game id, rather than approximated by
//     the difference between two season totals;
//   - there is no snapshot file to lose and so no "bootstrap run";
//   - time on ice is the real per-game figure for the window, not derived.
//
// A final box score never changes, so each one is fetched once and stored. A
// later NHL outage then delays a run rather than breaking it.
import { num, sql } from "@/src/rankings/db";

const API = process.env.NHL_API_BASE ?? "https://api-web.nhle.com";
const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.nhl.com/",
  Origin: "https://www.nhl.com",
};

/** First day to look for regular-season games. Games before it are ignored. */
export const SEASON_START = process.env.RK_SEASON_START ?? "2026-09-28";

export async function nhlJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Season id (e.g. 20262027) containing a date. NHL seasons straddle new year. */
export function seasonFor(isoDate: string): number {
  const [y, m] = isoDate.split("-").map(Number);
  const start = m >= 9 ? y : y - 1;
  return Number(`${start}${start + 1}`);
}

async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          out[i] = await fn(items[i]);
        } catch {
          out[i] = null;
        }
      }
    }),
  );
  return out;
}

const toiSeconds = (t?: string): number => {
  if (!t) return 0;
  const [m, s] = t.split(":").map((n) => Number(n) || 0);
  return m * 60 + s;
};

// ------------------------------------------------------------ discovery

interface SchedGame {
  id: number;
  gameType?: number;
  gameState?: string;
  awayTeam?: { abbrev?: string };
  homeTeam?: { abbrev?: string };
}
interface SchedResponse {
  nextStartDate?: string;
  gameWeek?: Array<{ date: string; games?: SchedGame[] }>;
}

export interface FoundGame {
  id: number;
  date: string;
  home: string;
  away: string;
}

/** Completed regular-season games in [from, to], walking the schedule a week at a time. */
export async function discoverGames(from: string, to: string): Promise<FoundGame[]> {
  const found = new Map<number, FoundGame>();
  let cursor = from;
  for (let guard = 0; guard < 60 && cursor <= to; guard++) {
    const sched = await nhlJson<SchedResponse>(`/v1/schedule/${cursor}`);
    for (const day of sched.gameWeek ?? []) {
      if (day.date < from || day.date > to) continue;
      for (const g of day.games ?? []) {
        if (g.gameType !== 2) continue;
        if (!["OFF", "FINAL"].includes(g.gameState ?? "")) continue;
        found.set(g.id, { id: g.id, date: day.date, home: g.homeTeam?.abbrev ?? "", away: g.awayTeam?.abbrev ?? "" });
      }
    }
    const next = sched.nextStartDate && sched.nextStartDate > cursor ? sched.nextStartDate : addDays(cursor, 7);
    cursor = next;
  }
  return [...found.values()].sort((a, b) => a.id - b.id);
}

// ------------------------------------------------------------- box scores

interface BoxSkater {
  playerId: number;
  position?: string;
  goals?: number;
  assists?: number;
  points?: number;
  toi?: string;
}
interface BoxGoalie {
  playerId: number;
  position?: string;
  toi?: string;
  decision?: string;
  saves?: number;
  shotsAgainst?: number;
  goalsAgainst?: number;
}
interface BoxSide {
  forwards?: BoxSkater[];
  defense?: BoxSkater[];
  goalies?: BoxGoalie[];
}
interface Box {
  awayTeam?: { abbrev?: string };
  homeTeam?: { abbrev?: string };
  playerByGameStats?: { awayTeam?: BoxSide; homeTeam?: BoxSide };
}

export interface LineRow {
  game_id: number;
  nhl_id: number;
  team: string;
  position: string;
  is_goalie: boolean;
  goals: number;
  assists: number;
  points: number;
  toi_sec: number;
  decision: string | null;
  saves: number;
  shots_against: number;
  goals_against: number;
}

/** Player lines for one game. Players with no ice time are skipped: no game played. */
export function parseBox(gameId: number, box: Box): LineRow[] {
  const out: LineRow[] = [];
  const sides: Array<[BoxSide | undefined, string]> = [
    [box.playerByGameStats?.awayTeam, box.awayTeam?.abbrev ?? ""],
    [box.playerByGameStats?.homeTeam, box.homeTeam?.abbrev ?? ""],
  ];
  for (const [side, team] of sides) {
    if (!side) continue;
    for (const s of [...(side.forwards ?? []), ...(side.defense ?? [])]) {
      const toi = toiSeconds(s.toi);
      if (toi <= 0) continue;
      out.push({
        game_id: gameId,
        nhl_id: s.playerId,
        team,
        position: s.position ?? "",
        is_goalie: false,
        goals: s.goals ?? 0,
        assists: s.assists ?? 0,
        points: s.points ?? (s.goals ?? 0) + (s.assists ?? 0),
        toi_sec: toi,
        decision: null,
        saves: 0,
        shots_against: 0,
        goals_against: 0,
      });
    }
    for (const g of side.goalies ?? []) {
      const toi = toiSeconds(g.toi);
      if (toi <= 0) continue;
      out.push({
        game_id: gameId,
        nhl_id: g.playerId,
        team,
        position: "G",
        is_goalie: true,
        goals: 0,
        assists: 0,
        points: 0,
        toi_sec: toi,
        decision: g.decision ?? null,
        saves: g.saves ?? 0,
        shots_against: g.shotsAgainst ?? 0,
        goals_against: g.goalsAgainst ?? 0,
      });
    }
  }
  return out;
}

// --------------------------------------------------------------- ingest

export interface IngestResult {
  discovered: number;
  stored: number;
  remaining: number;
  failed: number;
}

/**
 * Make sure every completed regular-season game up to `toDate` is stored.
 * Stores at most `limit` new games per call and reports how many remain, so a
 * first-time backfill can be done in several short calls rather than one long one.
 */
export async function ingestGames(toDate: string, limit = 120): Promise<IngestResult> {
  const q = await sql();
  const discovered = await discoverGames(SEASON_START, toDate);
  const have = new Set(
    (await q`SELECT game_id FROM rk_games`).map((r) => num(r.game_id)),
  );
  const missing = discovered.filter((g) => !have.has(g.id));
  const batch = missing.slice(0, limit);

  const boxes = await pool(batch, 8, async (g) => ({ g, box: await nhlJson<Box>(`/v1/gamecenter/${g.id}/boxscore`) }));
  let stored = 0;
  let failed = 0;
  const games: Array<Record<string, unknown>> = [];
  const lines: LineRow[] = [];
  for (let i = 0; i < batch.length; i++) {
    const b = boxes[i];
    if (!b || !b.box.playerByGameStats) {
      failed++;
      continue;
    }
    const parsed = parseBox(b.g.id, b.box);
    if (!parsed.length) {
      failed++;
      continue;
    }
    games.push({ game_id: b.g.id, game_date: b.g.date, home: b.g.home, away: b.g.away });
    lines.push(...parsed);
    stored++;
  }

  if (games.length) {
    await q`
      INSERT INTO rk_games (game_id, game_date, home, away)
      SELECT x.game_id, x.game_date, x.home, x.away
        FROM jsonb_to_recordset(${JSON.stringify(games)}::jsonb)
          AS x(game_id bigint, game_date date, home text, away text)
      ON CONFLICT (game_id) DO NOTHING`;
    // chunk the lines so a single statement stays a reasonable size
    for (let i = 0; i < lines.length; i += 1500) {
      await q`
        INSERT INTO rk_lines (game_id, nhl_id, team, position, is_goalie, goals, assists, points,
                              toi_sec, decision, saves, shots_against, goals_against)
        SELECT x.game_id, x.nhl_id, x.team, x.position, x.is_goalie, x.goals, x.assists, x.points,
               x.toi_sec, x.decision, x.saves, x.shots_against, x.goals_against
          FROM jsonb_to_recordset(${JSON.stringify(lines.slice(i, i + 1500))}::jsonb)
            AS x(game_id bigint, nhl_id bigint, team text, position text, is_goalie boolean, goals int,
                 assists int, points int, toi_sec int, decision text, saves int, shots_against int,
                 goals_against int)
        ON CONFLICT (game_id, nhl_id) DO NOTHING`;
    }
    await markShutouts(toDate);
  }

  return { discovered: discovered.length, stored, remaining: Math.max(0, missing.length - batch.length), failed };
}

interface GoalieLog {
  gameLog?: Array<{ gameId: number; shutouts?: number }>;
}

/**
 * Box scores carry no shutout flag, and inferring one from "no goals against"
 * is wrong for a goalie relieved after a scoreless spell. The goalie's game log
 * has it explicitly, so look it up -- but only for goalies who allowed no goals
 * and played most of a game, which is a small handful.
 */
async function markShutouts(toDate: string): Promise<void> {
  const q = await sql();
  const cand = await q`
    SELECT DISTINCT nhl_id FROM rk_lines
     WHERE is_goalie = TRUE AND goals_against = 0 AND toi_sec >= 3000 AND shutout = FALSE`;
  const ids = cand.map((r) => num(r.nhl_id));
  if (!ids.length) return;
  const season = seasonFor(toDate);
  const logs = await pool(ids, 8, (id) => nhlJson<GoalieLog>(`/v1/player/${id}/game-log/${season}/2`));
  const goalieOf: Array<{ nhl_id: number; game_id: number }> = [];
  logs.forEach((log, i) => {
    for (const g of log?.gameLog ?? []) {
      if ((g.shutouts ?? 0) > 0) goalieOf.push({ nhl_id: ids[i], game_id: g.gameId });
    }
  });
  if (!goalieOf.length) return;
  await q`
    UPDATE rk_lines SET shutout = TRUE
     WHERE (game_id, nhl_id) IN (
       SELECT x.game_id, x.nhl_id
         FROM jsonb_to_recordset(${JSON.stringify(goalieOf)}::jsonb) AS x(game_id bigint, nhl_id bigint))`;
}

/** Games not yet counted by a committed run, inside the window and after the baseline. */
export async function windowGameIds(from: string, to: string, through: string): Promise<number[]> {
  const q = await sql();
  const rows = await q`
    SELECT game_id FROM rk_games
     WHERE processed_run IS NULL
       AND game_date > ${through}::date
       AND game_date BETWEEN ${from}::date AND ${to}::date
     ORDER BY game_id`;
  return rows.map((r) => num(r.game_id));
}

