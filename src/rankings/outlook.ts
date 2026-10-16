// 7-day and 14-day schedule outlook.
//
// A faithful port of the "nhl-rankings-schedule-outlook" skill: take the freshly
// updated rankings, reweight each player by how many games his team plays in the
// window (against the league average) and how soft or tough the opponents are,
// and drop anyone who will not be back in time. PURE: no network, database or
// clock, so every rule is testable on its own. It deliberately has no imports.
//
// The skill's difficulties were all about getting data out of Cowork -- scraping
// JS-rendered schedule grids, hand-counting doubleheaders, tracking Drive file
// ids that change every run. With exact per-team schedules and standings handed
// in, none of that exists here.

export const OUTLOOK_RULES = {
  perGamePct: { 7: 0.04, 14: 0.025 } as Record<number, number>,
  gamesCap: 0.16,
  matchupPerGoal: 0.08,
  matchupCap: 0.08,
  /** Games a team must have played before its current-season stats replace last season's. */
  currentSeasonMinGames: 10,
} as const;

export interface OutlookRow {
  statsId: string;
  player: string;
  team: string;
  positions: string;
  injury: string;
}

export interface TeamGame {
  date: string; // ISO
  opp: string;
}

export interface TeamStat {
  /** Goals for / against per game, on whichever basis applies to this team. */
  gfpg: number;
  gapg: number;
  basis: "current" | "prior";
}

export interface OutlookInput {
  rows: OutlookRow[];
  /** Today, US Eastern, ISO. The window runs from today to today + window days. */
  today: string;
  window: 7 | 14;
  /** Every team's schedule for the window, regular season only. */
  schedule: Map<string, TeamGame[]>;
  teamStats: Map<string, TeamStat>;
  /** Count games ON window_end? The skill says "from today through window_end". */
  endInclusive?: boolean;
}

export interface OutlookMover {
  player: string;
  from: number;
  to: number;
  reason: string;
}

export interface OutlookLog {
  window: number;
  today: string;
  windowEnd: string;
  leagueAvgGames: number;
  excluded: Array<{ player: string; returnDate: string }>;
  movers: { up: OutlookMover[]; down: OutlookMover[] };
  teamsWithoutSchedule: string[];
  playersSkipped: string[];
  basis: { current: string[]; prior: string[] };
  notes: string[];
}

// ------------------------------------------------------------------ helpers

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/** The injury field is "status,body part,return date"; the date is last. */
export function returnDateOf(injury: string): string | null {
  if (!injury.trim()) return null;
  const parts = injury.split(",");
  return parseDate(parts[parts.length - 1]);
}

const isGoalie = (positions: string): boolean => positions.split(/[\/,\s]+/).includes("G");
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp = (v: number, cap: number): number => Math.max(-cap, Math.min(cap, v));

// ------------------------------------------------------------------- engine

interface Scored {
  row: OutlookRow;
  rank: number;
  points: number;
  gamesPct: number;
  matchupPct: number;
  eligible: number | null;
  final: number;
}

export function runOutlook(input: OutlookInput): { rows: OutlookRow[]; log: OutlookLog } {
  const { rows, today, window, schedule, teamStats } = input;
  const endInclusive = input.endInclusive ?? true;
  const windowEnd = addDays(today, window);
  const N = rows.length;

  const inWindow = (d: string): boolean => d >= today && (endInclusive ? d <= windowEnd : d < windowEnd);

  const log: OutlookLog = {
    window,
    today,
    windowEnd,
    leagueAvgGames: 0,
    excluded: [],
    movers: { up: [], down: [] },
    teamsWithoutSchedule: [],
    playersSkipped: [],
    basis: { current: [], prior: [] },
    notes: [],
  };

  // ---- league average games: every team's FULL schedule, not injury-adjusted.
  const teamCounts: number[] = [];
  for (const games of schedule.values()) teamCounts.push(games.filter((g) => inWindow(g.date)).length);
  const leagueAvgGames = mean(teamCounts);
  log.leagueAvgGames = leagueAvgGames;

  // ---- league average opponent stat, over the 32 teams' chosen basis.
  const gfLeague = mean([...teamStats.values()].map((t) => t.gfpg));
  const gaLeague = mean([...teamStats.values()].map((t) => t.gapg));
  for (const [team, t] of teamStats) (t.basis === "current" ? log.basis.current : log.basis.prior).push(team);
  log.basis.current.sort();
  log.basis.prior.sort();
  const noSched = new Set<string>();

  const kept: Scored[] = [];
  rows.forEach((row, i) => {
    const rank = i + 1;
    const points = N - rank + 1;

    // ---- Step 2: out until after the window ends => not in this outlook at all.
    const rd = returnDateOf(row.injury);
    if (rd && rd > windowEnd) {
      log.excluded.push({ player: row.player, returnDate: rd });
      return;
    }

    const games = schedule.get(row.team);
    if (!games) {
      // a schedule we cannot find is flagged, never guessed
      if (row.team) noSched.add(row.team);
      log.playersSkipped.push(row.player);
      kept.push({ row, rank, points, gamesPct: 0, matchupPct: 0, eligible: null, final: points });
      return;
    }

    // ---- Step 3: only games from the return date forward are available to him.
    const from = rd && rd > today ? rd : today;
    const mine = games.filter((g) => inWindow(g.date) && g.date >= from);
    const eligible = mine.length;

    // ---- Step 4: games in window against the league average.
    const gamesPct = clamp((eligible - leagueAvgGames) * OUTLOOK_RULES.perGamePct[window], OUTLOOK_RULES.gamesCap);

    // ---- Step 5: matchup ease. Skip with no games: Step 4 already reflects zero.
    let matchupPct = 0;
    if (eligible > 0) {
      const goalie = isGoalie(row.positions);
      const stats = mine.map((g) => teamStats.get(g.opp)).filter((s): s is TeamStat => !!s);
      if (stats.length) {
        // skaters: how many goals the opponent ALLOWS; goalies: how many it SCORES.
        //
        // The skill's formula reads "diff = stat - league_avg" for everyone, but its own
        // rationale says a positive diff must mean good fantasy conditions, and that
        // "a weak-scoring opponent is the easy matchup for a goaltender". For a goalie
        // those two statements conflict. Replaying a real run showed Cowork applied the
        // literal sign in one outlook and the intended sign in the other, so its goalie
        // ordering was inconsistent between the 7-day and 14-day files. The intended
        // sign is used here, for both.
        const stat = mean(stats.map((s) => (goalie ? s.gfpg : s.gapg)));
        const league = goalie ? gfLeague : gaLeague;
        const diff = goalie ? league - stat : stat - league; // positive = good fantasy conditions
        matchupPct = clamp(diff * OUTLOOK_RULES.matchupPerGoal, OUTLOOK_RULES.matchupCap);
      }
    }

    kept.push({
      row,
      rank,
      points,
      gamesPct,
      matchupPct,
      eligible,
      final: points * (1 + gamesPct + matchupPct),
    });
  });
  log.teamsWithoutSchedule = [...noSched].sort();

  // ---- Step 6: re-sort (ties keep the original order), renumber.
  const ordered = [...kept].sort((a, b) => b.final - a.final || a.rank - b.rank);
  const movers: OutlookMover[] = ordered.map((s, i) => {
    const bigger = Math.abs(s.gamesPct) >= Math.abs(s.matchupPct) ? "games" : "matchup";
    const parts: string[] = [];
    if (s.gamesPct !== 0) parts.push(`${s.eligible} game(s) (${s.gamesPct > 0 ? "+" : ""}${(s.gamesPct * 100).toFixed(1)}%)`);
    if (s.matchupPct !== 0) parts.push(`matchups ${s.matchupPct > 0 ? "easier" : "tougher"} (${s.matchupPct > 0 ? "+" : ""}${(s.matchupPct * 100).toFixed(1)}%)`);
    return {
      player: s.row.player,
      from: s.rank,
      to: i + 1,
      reason: parts.length ? `${parts.join(", ")}; ${bigger} dominated` : "no adjustment",
    };
  });
  log.movers.up = [...movers].filter((m) => m.to < m.from).sort((a, b) => b.from - b.to - (a.from - a.to)).slice(0, 5);
  log.movers.down = [...movers].filter((m) => m.to > m.from).sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 5);

  if (log.basis.prior.length) {
    log.notes.push(
      `Prior-season goals for/against used for ${log.basis.prior.length} team(s) with fewer than ` +
        `${OUTLOOK_RULES.currentSeasonMinGames} games played this season.`,
    );
  }

  return { rows: ordered.map((s) => s.row), log };
}
