// Schedule and standings data for the outlook, straight from the NHL API.
//
// Replaces scraping JS-rendered schedule grids and hand-counting doubleheaders:
// every team's games for a date range come back as exact (date, opponent) pairs,
// so a back-to-back against the same opponent is simply two games.
import { OUTLOOK_RULES, addDays, type TeamGame, type TeamStat } from "@/src/rankings/outlook";
import { nhlJson } from "@/src/rankings/games";

interface SchedGame {
  gameType?: number;
  awayTeam?: { abbrev?: string };
  homeTeam?: { abbrev?: string };
}
interface SchedResponse {
  nextStartDate?: string;
  gameWeek?: Array<{ date: string; games?: SchedGame[] }>;
}

/**
 * Every team's regular-season games from `from` to `to` inclusive.
 * Teams are seeded from `teams`, so a team with no games in the window appears
 * with an empty list rather than being missing -- a bye week still counts as
 * zero games in the league average.
 */
export async function fetchTeamSchedules(
  from: string,
  to: string,
  teams: string[],
): Promise<Map<string, TeamGame[]>> {
  const out = new Map<string, TeamGame[]>(teams.map((t) => [t, []]));
  let cursor = from;
  for (let guard = 0; guard < 12 && cursor <= to; guard++) {
    const sched = await nhlJson<SchedResponse>(`/v1/schedule/${cursor}`);
    for (const day of sched.gameWeek ?? []) {
      if (day.date < from || day.date > to) continue;
      for (const g of day.games ?? []) {
        if (g.gameType !== 2) continue; // preseason and playoffs are not part of the outlook
        const away = g.awayTeam?.abbrev;
        const home = g.homeTeam?.abbrev;
        if (!away || !home) continue;
        (out.get(away) ?? out.set(away, []).get(away)!).push({ date: day.date, opp: home });
        (out.get(home) ?? out.set(home, []).get(home)!).push({ date: day.date, opp: away });
      }
    }
    cursor = sched.nextStartDate && sched.nextStartDate > cursor ? sched.nextStartDate : addDays(cursor, 7);
  }
  for (const games of out.values()) games.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

interface Standing {
  teamAbbrev?: { default?: string };
  gamesPlayed?: number;
  goalFor?: number;
  goalAgainst?: number;
}
interface StandingsResponse {
  standings?: Standing[];
}
interface SeasonsResponse {
  seasons?: Array<{ id: number; standingsStart: string; standingsEnd: string }>;
}

export interface TeamStandings {
  gp: number;
  gfpg: number;
  gapg: number;
}

function toMap(s: StandingsResponse): Map<string, TeamStandings> {
  const m = new Map<string, TeamStandings>();
  for (const t of s.standings ?? []) {
    const abbr = t.teamAbbrev?.default;
    const gp = t.gamesPlayed ?? 0;
    if (!abbr) continue;
    m.set(abbr, {
      gp,
      gfpg: gp ? (t.goalFor ?? 0) / gp : 0,
      gapg: gp ? (t.goalAgainst ?? 0) / gp : 0,
    });
  }
  return m;
}

/**
 * Per-team goals for/against per game, and which season they come from.
 *
 * Early in a season a team's own numbers are noise (a few games), so each team
 * uses LAST season's full-season average until it has played
 * currentSeasonMinGames games, then switches to this season's. The switch is
 * made team by team, because teams do not all reach the threshold on one date.
 *
 * `asOf` selects the standings as of a date (default: now); the replay check uses
 * it to reproduce a run from the past.
 */
export async function fetchTeamStats(asOf?: string): Promise<{
  stats: Map<string, TeamStat>;
  teams: string[];
}> {
  const seasons = (await nhlJson<SeasonsResponse>("/v1/standings-season")).seasons ?? [];
  const ref = asOf ?? new Date().toISOString().slice(0, 10);
  const sorted = [...seasons].sort((a, b) => a.id - b.id);
  const current = [...sorted].reverse().find((s) => s.standingsStart <= ref) ?? sorted[sorted.length - 1];
  const prior = [...sorted].reverse().find((s) => s.id < current.id);

  const [cur, pri] = await Promise.all([
    nhlJson<StandingsResponse>(`/v1/standings/${asOf ?? "now"}`),
    prior ? nhlJson<StandingsResponse>(`/v1/standings/${prior.standingsEnd}`) : Promise.resolve({} as StandingsResponse),
  ]);
  const curMap = toMap(cur);
  const priMap = toMap(pri);

  const stats = new Map<string, TeamStat>();
  for (const [team, c] of curMap) {
    const p = priMap.get(team);
    const useCurrent = c.gp >= OUTLOOK_RULES.currentSeasonMinGames || !p || p.gp === 0;
    const pick = useCurrent ? c : p!;
    stats.set(team, { gfpg: pick.gfpg, gapg: pick.gapg, basis: useCurrent ? "current" : "prior" });
  }
  return { stats, teams: [...curMap.keys()].sort() };
}
