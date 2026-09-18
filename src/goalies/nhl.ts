// NHL API access for the goalie matchup tool.
//
// Deliberately self-contained: the existing trade/signing generator's data layer
// (src/datasource/nhl.ts) is left untouched.
import type {
  GameLine,
  GoalieRef,
  GoalieSide,
  LastMeeting,
  LastStarts,
  MatchupData,
} from "@/src/goalies/types";

const API_BASE = process.env.NHL_API_BASE ?? "https://api-web.nhle.com";

// The NHL hosts 503 bare server requests (e.g. from Vercel); browser-like
// headers are required in production.
const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.nhl.com/",
  Origin: "https://www.nhl.com",
};

async function getJson<T>(path: string, revalidate = 900): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: HEADERS,
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

// ---------- raw payload shapes (only the fields we use) ----------

interface NamePair {
  firstName?: { default?: string };
  lastName?: { default?: string };
}
interface ClubStatsGoalie extends NamePair {
  playerId: number;
  headshot?: string;
}
interface ClubStatsResponse {
  season?: string | number;
  goalies?: ClubStatsGoalie[];
}
interface RosterGoalie extends NamePair {
  id: number;
  headshot?: string;
}
interface RosterResponse {
  goalies?: RosterGoalie[];
}
interface GameLogEntry {
  gameId: number;
  gameDate: string;
  gamesStarted?: number;
  decision?: string;
  shotsAgainst?: number;
  goalsAgainst?: number;
  toi?: string;
  opponentAbbrev?: string;
}
interface GameLogResponse {
  gameLog?: GameLogEntry[];
  playerStatsSeasons?: Array<{ season: number; gameTypes: number[] }>;
}
interface ScheduleGame {
  id: number;
  gameType: number;
  gameState: string;
  gameDate: string;
  awayTeam: { abbrev: string; score?: number };
  homeTeam: { abbrev: string; score?: number };
  gameOutcome?: { lastPeriodType?: string };
}
interface ScheduleResponse {
  previousSeason?: number;
  currentSeason?: number;
  games?: ScheduleGame[];
}

const REGULAR = 2;
const COMPLETED = ["OFF", "FINAL"];

function fullName(p: NamePair): string {
  return `${p.firstName?.default ?? ""} ${p.lastName?.default ?? ""}`.trim();
}

/** Strip accents + case so "Bobrovsky" and "Bobrovský" compare equal. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Parse a "60:00" time-on-ice string into seconds. */
function toiSeconds(toi: string | undefined): number {
  if (!toi) return 0;
  const [m, s] = toi.split(":").map((n) => Number(n) || 0);
  return m * 60 + s;
}

/**
 * The season whose stats we should show. In the offseason the NHL's
 * `club-stats/now` still resolves to the most recently completed season, which
 * is exactly what we want.
 */
export async function resolveSeason(teamAbbr: string): Promise<number> {
  try {
    const cs = await getJson<ClubStatsResponse>(`/v1/club-stats/${teamAbbr}/now`);
    if (cs.season) return Number(cs.season);
  } catch {
    // fall through
  }
  // Fallback: Sept 1 flips to the new season label.
  const now = new Date();
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 8 ? y : y - 1;
  return Number(`${start}${start + 1}`);
}

/**
 * Every goalie associated with a team: club-stats (everyone who has appeared --
 * comprehensive) merged with the current roster (catches newly signed goalies
 * with no stats yet).
 *
 * club-stats MUST come first: /v1/roster/WPG/20252026 returned only Hellebuyck
 * while club-stats returned Hellebuyck, Comrie and Milic. Roster snapshots drop
 * goalies who moved during the season.
 */
export async function listTeamGoalies(teamAbbr: string): Promise<GoalieRef[]> {
  const byId = new Map<string, GoalieRef>();
  const add = (id: number, name: string, headshot: string | undefined) => {
    const key = String(id);
    if (!name || byId.has(key)) return;
    byId.set(key, {
      id: key,
      fullName: name,
      teamAbbr,
      headshotUrl: headshot ?? null,
    });
  };

  const [stats, roster] = await Promise.allSettled([
    getJson<ClubStatsResponse>(`/v1/club-stats/${teamAbbr}/now`),
    getJson<RosterResponse>(`/v1/roster/${teamAbbr}/current`),
  ]);
  if (stats.status === "fulfilled") {
    for (const g of stats.value.goalies ?? []) {
      add(g.playerId, fullName(g), g.headshot);
    }
  }
  if (roster.status === "fulfilled") {
    for (const g of roster.value.goalies ?? []) {
      add(g.id, fullName(g), g.headshot);
    }
  }
  return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * Resolve a goalie by name within a team (the ProjectedGoalies feed carries no
 * NHL id). Team-scoped, so there are only 2-3 candidates. Returns null rather
 * than guessing -- a wrong match would publish the wrong player's photo.
 */
export async function resolveGoalieByName(
  teamAbbr: string,
  firstName: string,
  lastName: string,
): Promise<GoalieRef | null> {
  const candidates = await listTeamGoalies(teamAbbr);
  const first = norm(firstName);
  const last = norm(lastName);
  const exact = candidates.find((c) => {
    const parts = norm(c.fullName).split(" ");
    return parts[0] === first && parts.slice(1).join(" ") === last;
  });
  if (exact) return exact;
  const byLast = candidates.filter((c) => norm(c.fullName).endsWith(last));
  return byLast.length === 1 ? byLast[0] : null;
}

async function gameLog(playerId: string, season: number): Promise<GameLogResponse> {
  return getJson<GameLogResponse>(
    `/v1/player/${playerId}/game-log/${season}/${REGULAR}`,
  );
}

function startsBefore(entries: GameLogEntry[], beforeDate?: string): GameLogEntry[] {
  return entries
    .filter((e) => e.gamesStarted === 1)
    .filter((e) => (beforeDate ? e.gameDate < beforeDate : true))
    .sort((a, b) => b.gameDate.localeCompare(a.gameDate));
}

function summarize(
  starts: GameLogEntry[],
  season: number | null,
  fromPriorSeason: boolean,
): LastStarts {
  let wins = 0;
  let losses = 0;
  let otLosses = 0;
  let ga = 0;
  let sa = 0;
  let seconds = 0;
  for (const s of starts) {
    if (s.decision === "W") wins++;
    else if (s.decision === "L") losses++;
    else if (s.decision === "O") otLosses++;
    ga += s.goalsAgainst ?? 0;
    sa += s.shotsAgainst ?? 0;
    seconds += toiSeconds(s.toi);
  }
  return {
    count: starts.length,
    wins,
    losses,
    otLosses,
    gaa: seconds > 0 ? ga / (seconds / 3600) : null,
    savePct: sa > 0 ? (sa - ga) / sa : null,
    season,
    fromPriorSeason,
  };
}

/**
 * Aggregate a goalie's most recent starts (default 5). Falls back to the prior
 * season when the current one hasn't produced enough starts yet -- the common
 * case in October.
 */
export async function getLastStarts(
  playerId: string,
  season: number,
  opts: { limit?: number; beforeDate?: string } = {},
): Promise<LastStarts> {
  const limit = opts.limit ?? 5;
  let log: GameLogResponse;
  try {
    log = await gameLog(playerId, season);
  } catch {
    return summarize([], null, false);
  }
  let starts = startsBefore(log.gameLog ?? [], opts.beforeDate);
  let fromPrior = false;

  if (starts.length < limit) {
    const prior = (log.playerStatsSeasons ?? [])
      .map((s) => s.season)
      .filter((s) => s < season)
      .sort((a, b) => b - a)[0];
    if (prior) {
      try {
        const older = await gameLog(playerId, prior);
        const more = startsBefore(older.gameLog ?? []);
        if (more.length) {
          // Prior-season games are older, so appending preserves newest-first.
          starts = [...starts, ...more];
          fromPrior = true;
        }
      } catch {
        // keep what we have
      }
    }
  }

  const used = starts.slice(0, limit);
  // Only flag prior-season if it actually contributed to the sample shown.
  const usedPrior = fromPrior && used.length > startsBefore(log.gameLog ?? [], opts.beforeDate).length;
  return summarize(used, used.length ? season : null, usedPrior);
}

/** A goalie's line in one specific game (used for the last-meeting footer). */
export async function getGoalieLineInGame(
  playerId: string,
  season: number,
  gameId: number,
): Promise<GameLine | null> {
  try {
    const log = await gameLog(playerId, season);
    const e = (log.gameLog ?? []).find((g) => g.gameId === gameId);
    if (!e) return null;
    const sa = e.shotsAgainst ?? 0;
    return {
      decision: e.decision ?? null,
      saves: sa - (e.goalsAgainst ?? 0),
      shotsAgainst: sa,
    };
  } catch {
    return null;
  }
}

/**
 * Most recent completed meeting between two clubs. Falls back to the previous
 * season when they haven't met yet this season.
 */
export async function getLastMeeting(
  teamA: string,
  teamB: string,
  season: number,
  opts: { beforeDate?: string } = {},
): Promise<LastMeeting | null> {
  const find = async (
    s: number,
    fromPrior: boolean,
  ): Promise<{ meeting: LastMeeting | null; previousSeason?: number }> => {
    let sched: ScheduleResponse;
    try {
      sched = await getJson<ScheduleResponse>(
        `/v1/club-schedule-season/${teamA}/${s}`,
      );
    } catch {
      return { meeting: null };
    }
    const games = (sched.games ?? []).filter(
      (g) =>
        g.gameType === REGULAR &&
        COMPLETED.includes(g.gameState) &&
        (opts.beforeDate ? g.gameDate < opts.beforeDate : true) &&
        (g.awayTeam.abbrev === teamB || g.homeTeam.abbrev === teamB),
    );
    const g = games[games.length - 1];
    if (!g) return { meeting: null, previousSeason: sched.previousSeason };
    return {
      meeting: {
        gameId: g.id,
        date: g.gameDate,
        awayAbbr: g.awayTeam.abbrev,
        awayScore: g.awayTeam.score ?? 0,
        homeAbbr: g.homeTeam.abbrev,
        homeScore: g.homeTeam.score ?? 0,
        periodType: g.gameOutcome?.lastPeriodType ?? "REG",
        season: s,
        fromPriorSeason: fromPrior,
      },
      previousSeason: sched.previousSeason,
    };
  };

  const current = await find(season, false);
  if (current.meeting) return current.meeting;
  if (current.previousSeason) {
    return (await find(current.previousSeason, true)).meeting;
  }
  return null;
}

/** Assemble everything the renderer needs for one matchup. */
export async function buildMatchup(input: {
  away: GoalieRef;
  home: GoalieRef;
  gameTime?: string | null;
  /** Only consider games before this date (YYYY-MM-DD) -- used for backtests. */
  beforeDate?: string;
}): Promise<MatchupData> {
  const { away, home, gameTime, beforeDate } = input;
  const season = await resolveSeason(home.teamAbbr);

  const [awayStarts, homeStarts, lastMeeting] = await Promise.all([
    getLastStarts(away.id, season, { beforeDate }),
    getLastStarts(home.id, season, { beforeDate }),
    getLastMeeting(away.teamAbbr, home.teamAbbr, season, { beforeDate }),
  ]);

  const line = async (g: GoalieRef): Promise<GameLine | null> =>
    lastMeeting
      ? getGoalieLineInGame(g.id, lastMeeting.season, lastMeeting.gameId)
      : null;
  const [awayLine, homeLine] = await Promise.all([line(away), line(home)]);

  const side = (
    goalie: GoalieRef,
    lastStarts: LastStarts,
    lastMeetingLine: GameLine | null,
  ): GoalieSide => ({ goalie, lastStarts, lastMeetingLine });

  return {
    away: side(away, awayStarts, awayLine),
    home: side(home, homeStarts, homeLine),
    lastMeeting,
    gameTime: gameTime ?? null,
  };
}
