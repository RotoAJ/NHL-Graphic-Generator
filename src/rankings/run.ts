// Orchestration: baseline upload, and building a run (always a PREVIEW first).
//
// The window needs no bookkeeping of dates. A run counts every stored game that
// no committed run has counted yet and that is after the baseline's cut-off, so
// "since last run" is simply "not yet counted". A game that failed to fetch one
// time is picked up by the next run automatically instead of being lost.
import { easternToday } from "@/src/goalies/gametime";
import { parseRankingsCsv } from "@/src/rankings/csv";
import { idsJson, num, sql, str } from "@/src/rankings/db";
import {
  runRankings,
  type Changelog,
  type PoolEntry,
  type RankRow,
} from "@/src/rankings/engine";
import { addDays, ingestGames, windowGameIds, type IngestResult } from "@/src/rankings/games";
import { fetchInjuries } from "@/src/rankings/injuries";
import {
  baselineThrough,
  createRun,
  discardPreviews,
  getRows,
  getRun,
  latestCommitted,
} from "@/src/rankings/store";
import { ensurePlayers, fetchRotoIndex, type EnsureResult, type RwIndex } from "@/src/rankings/xwalk";

// -------------------------------------------------------------- baseline

export async function uploadBaseline(
  csvText: string,
  through: string,
): Promise<{ runId: number; players: number; warnings: string[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new Error("The cut-off date must be YYYY-MM-DD.");
  if (through > addDays(easternToday(), 0)) throw new Error("The cut-off date cannot be in the future.");
  const parsed = parseRankingsCsv(csvText);
  const warnings = [...parsed.warnings];
  if (parsed.rows.length < 50) {
    warnings.push(`Only ${parsed.rows.length} players were found, which is far fewer than a full file.`);
  }
  const prev = await latestCommitted();
  const runId = await createRun({
    kind: "baseline",
    committed: true,
    baseRunId: prev?.id ?? null,
    windowFrom: null,
    windowTo: through,
    rows: parsed.rows,
    changelog: null,
    note: `Uploaded file; games through ${through} are already reflected`,
    style: parsed.style,
  });
  // A fresh baseline redefines what has been counted: anything after its
  // cut-off has not been, whatever an earlier run recorded.
  const q = await sql();
  await q`UPDATE rk_games SET processed_run = NULL WHERE game_date > ${through}::date`;
  await q`UPDATE rk_games SET processed_run = ${runId} WHERE game_date <= ${through}::date`;
  await discardPreviews();
  return { runId, players: parsed.rows.length, warnings };
}

// ----------------------------------------------------------------- build

export interface BuildOptions {
  /** Last day to count (default: yesterday, US Eastern). Used to align a shadow run with another run's window. */
  to?: string;
  /** Override "today" for injury timing (default: today, US Eastern). */
  today?: string;
}

export interface BuildResult {
  runId: number;
  baseRunId: number;
  windowFrom: string;
  windowTo: string;
  gamesInWindow: number;
  ingest: IngestResult;
  players: EnsureResult;
  injuryEntries: number;
  changelog: Changelog;
}

const POS_MAP: Record<string, string> = { L: "LW", R: "RW" };

interface AggRow {
  nhl_id: number;
  stats_id: string | null;
  first_name: string;
  last_name: string;
  is_goalie: boolean;
  team: string;
  position: string;
  season_games: number;
  season_points: number;
  season_goals: number;
  season_wins: number;
  d_games: number;
  d_points: number;
  d_toi: number;
  d_wins: number;
  d_losses: number;
  d_saves: number;
  d_sa: number;
  d_so: number;
}

async function aggregate(to: string, windowIds: number[]): Promise<AggRow[]> {
  const q = await sql();
  const ids = idsJson(windowIds);
  const rows = await q`
    WITH w AS (SELECT (x)::bigint AS game_id FROM jsonb_array_elements_text(${ids}::jsonb) x)
    SELECT l.nhl_id,
           MAX(p.stats_id) AS stats_id,
           MAX(p.first_name) AS first_name,
           MAX(p.last_name) AS last_name,
           BOOL_OR(l.is_goalie) AS is_goalie,
           (ARRAY_AGG(l.team ORDER BY g.game_date DESC, l.game_id DESC))[1] AS team,
           (ARRAY_AGG(l.position ORDER BY g.game_date DESC, l.game_id DESC))[1] AS position,
           COUNT(*) AS season_games,
           SUM(l.points) AS season_points,
           SUM(l.goals) AS season_goals,
           COUNT(*) FILTER (WHERE l.decision = 'W') AS season_wins,
           COUNT(*) FILTER (WHERE l.game_id IN (SELECT game_id FROM w)) AS d_games,
           COALESCE(SUM(l.points) FILTER (WHERE l.game_id IN (SELECT game_id FROM w)), 0) AS d_points,
           COALESCE(SUM(l.toi_sec) FILTER (WHERE l.game_id IN (SELECT game_id FROM w)), 0) AS d_toi,
           COUNT(*) FILTER (WHERE l.decision = 'W' AND l.game_id IN (SELECT game_id FROM w)) AS d_wins,
           COUNT(*) FILTER (WHERE l.decision = 'L' AND l.game_id IN (SELECT game_id FROM w)) AS d_losses,
           COALESCE(SUM(l.saves) FILTER (WHERE l.game_id IN (SELECT game_id FROM w)), 0) AS d_saves,
           COALESCE(SUM(l.shots_against) FILTER (WHERE l.game_id IN (SELECT game_id FROM w)), 0) AS d_sa,
           COUNT(*) FILTER (WHERE l.shutout AND l.game_id IN (SELECT game_id FROM w)) AS d_so
      FROM rk_lines l
      JOIN rk_games g ON g.game_id = l.game_id
      LEFT JOIN rk_players p ON p.nhl_id = l.nhl_id
     WHERE g.game_date <= ${to}::date
     GROUP BY l.nhl_id`;
  return rows.map((r) => ({
    nhl_id: num(r.nhl_id),
    stats_id: r.stats_id ? str(r.stats_id) : null,
    first_name: str(r.first_name),
    last_name: str(r.last_name),
    is_goalie: Boolean(r.is_goalie),
    team: str(r.team),
    position: str(r.position),
    season_games: num(r.season_games),
    season_points: num(r.season_points),
    season_goals: num(r.season_goals),
    season_wins: num(r.season_wins),
    d_games: num(r.d_games),
    d_points: num(r.d_points),
    d_toi: num(r.d_toi),
    d_wins: num(r.d_wins),
    d_losses: num(r.d_losses),
    d_saves: num(r.d_saves),
    d_sa: num(r.d_sa),
    d_so: num(r.d_so),
  }));
}

async function teamGames(to: string): Promise<Map<string, number>> {
  const q = await sql();
  const rows = await q`
    SELECT team, COUNT(*) AS n FROM (
      SELECT home AS team FROM rk_games WHERE game_date <= ${to}::date
      UNION ALL
      SELECT away AS team FROM rk_games WHERE game_date <= ${to}::date
    ) t GROUP BY team`;
  return new Map(rows.map((r) => [str(r.team), num(r.n)]));
}

/**
 * The rankings file may spell a team differently from the NHL (ESPN's LA/NJ/SJ/TB
 * were the known mismatches there). Rather than assume a convention, learn it
 * from the file itself: for every player already on it, count which file code sits
 * beside which NHL team, and use the majority.
 */
function learnTeamMap(rows: RankRow[], pool: PoolEntry[], nhlTeamOf: Map<number, string>): Map<string, string> {
  const byStats = new Map<string, PoolEntry>();
  for (const p of pool) if (p.statsId) byStats.set(p.statsId, p);
  const votes = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const p = byStats.get(r.statsId);
    const nhl = p ? nhlTeamOf.get(p.nhlId) : undefined;
    if (!nhl || !r.team) continue;
    const m = votes.get(nhl) ?? votes.set(nhl, new Map()).get(nhl)!;
    m.set(r.team, (m.get(r.team) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [nhl, m] of votes) {
    let best = "";
    let bc = -1;
    for (const [code, c] of m) if (c > bc) (best = code), (bc = c);
    out.set(nhl, best);
  }
  return out;
}

function displayName(idx: RwIndex, statsId: string | null, fallback: string): string {
  const p = statsId ? idx.byId.get(statsId) : undefined;
  return p ? `${p.first} ${p.last}`.trim() : fallback;
}

export async function buildPreview(opts: BuildOptions = {}): Promise<BuildResult> {
  const base = await latestCommitted();
  const through = await baselineThrough();
  if (!base || !through) {
    throw new Error("There is no baseline yet. Upload the current rankings file first.");
  }

  const today = opts.today ?? easternToday();
  const to = opts.to ?? addDays(today, -1);
  const from = addDays(through, 1);
  if (to < from) {
    throw new Error(`Nothing to process yet: the baseline covers through ${through} and the window ends ${to}.`);
  }

  // 1. make sure every completed game up to `to` is stored (a backfill may need several passes)
  const ingest: IngestResult = { discovered: 0, stored: 0, remaining: 0, failed: 0 };
  const deadline = Date.now() + 200_000;
  for (;;) {
    const r = await ingestGames(to, 120);
    ingest.discovered = r.discovered;
    ingest.stored += r.stored;
    ingest.failed += r.failed;
    ingest.remaining = r.remaining;
    if (r.remaining === 0 || Date.now() > deadline) break;
  }
  if (ingest.remaining > 0) {
    throw new Error(
      `Still loading this season's games (${ingest.remaining} left). Run it again to continue; ` +
        `it picks up where it stopped.`,
    );
  }

  const windowIds = await windowGameIds(from, to, through);

  // 2. identities for everyone who has played
  const q = await sql();
  const played = (
    await q`SELECT DISTINCT l.nhl_id FROM rk_lines l JOIN rk_games g ON g.game_id = l.game_id
             WHERE g.game_date <= ${to}::date`
  ).map((r) => num(r.nhl_id));
  const idx = await fetchRotoIndex();
  const players = await ensurePlayers(played, idx);

  // 3. season + window production per player
  const agg = await aggregate(to, windowIds);
  const tg = await teamGames(to);
  const nhlTeamOf = new Map(agg.map((a) => [a.nhl_id, a.team] as const));

  const provisional: PoolEntry[] = agg.map((a) => ({
    nhlId: a.nhl_id,
    statsId: a.stats_id,
    name: displayName(idx, a.stats_id, `${a.first_name} ${a.last_name}`.trim() || `NHL #${a.nhl_id}`),
    team: a.team,
    positions: (a.stats_id ? idx.byId.get(a.stats_id)?.position : "") || POS_MAP[a.position] || a.position,
    isGoalie: a.is_goalie,
    seasonGames: a.season_games,
    seasonPoints: a.season_points,
    seasonGoals: a.season_goals,
    seasonWins: a.season_wins,
    teamGames: tg.get(a.team) ?? 0,
    delta:
      a.d_games > 0
        ? {
            games: a.d_games,
            points: a.d_points,
            toiSec: a.d_toi,
            wins: a.d_wins,
            losses: a.d_losses,
            saves: a.d_saves,
            shotsAgainst: a.d_sa,
            shutouts: a.d_so,
          }
        : null,
  }));

  // 4. team codes in the file's own convention
  const baseRows = await getRows(base.id);
  const teamMap = learnTeamMap(baseRows, provisional, nhlTeamOf);
  const unmappedTeams = new Set<string>();
  const pool = provisional.map((p) => {
    const mapped = teamMap.get(p.team);
    if (!mapped && p.team) unmappedTeams.add(p.team);
    return { ...p, team: mapped ?? p.team };
  });

  // 5. injuries, then the rules
  const inj = await fetchInjuries();
  const { rows, log } = runRankings({ rows: baseRows, pool, injuries: inj.map, today, windowFrom: from });

  log.notes.unshift(
    `Window: ${windowIds.length} game(s) not yet counted, ${from} to ${to}. ` +
      `Injury feed: ${inj.count} entries. Players resolved to RotoWire ids: ${players.resolved} new, ${players.unresolved} unresolved.`,
  );
  if (ingest.failed > 0) {
    log.notes.push(
      `${ingest.failed} game(s) could not be fetched from the NHL this time; they will be included in the next run.`,
    );
  }
  if (unmappedTeams.size) {
    log.notes.push(`No team-code convention could be learned for: ${[...unmappedTeams].join(", ")} (NHL code used as is).`);
  }

  // 6. save as a preview; one preview at a time
  await discardPreviews();
  const baseRun = await getRun(base.id);
  const runId = await createRun({
    kind: "run",
    committed: false,
    baseRunId: base.id,
    windowFrom: from,
    windowTo: to,
    rows,
    changelog: log,
    style: baseRun?.style ?? null,
    gameIds: windowIds,
  });

  return {
    runId,
    baseRunId: base.id,
    windowFrom: from,
    windowTo: to,
    gamesInWindow: windowIds.length,
    ingest,
    players,
    injuryEntries: inj.count,
    changelog: log,
  };
}
