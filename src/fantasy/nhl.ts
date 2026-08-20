// NHL API access for the Fantasy tool.
//
// Strategy: one /v1/schedule/{date} call returns a whole 7-day game week, then we
// pull each game's box score and aggregate per player. That is ~60 requests for a
// full week instead of ~700 individual player game logs.
import { fantasyPoints, positionGroup } from "@/src/fantasy/scoring";
import type { PlayerWeek } from "@/src/fantasy/types";

const API = process.env.NHL_API_BASE ?? "https://api-web.nhle.com";

const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.nhl.com/",
  Origin: "https://www.nhl.com",
};

async function getJson<T>(path: string, revalidate = 3600): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: HEADERS, next: { revalidate } });
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Run promises with a concurrency cap so we don't hammer the API. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i]);
      } catch {
        out[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function toiSeconds(toi: string | undefined): number {
  if (!toi) return 0;
  const [m, s] = toi.split(":").map((n) => Number(n) || 0);
  return m * 60 + s;
}

interface SchedGame {
  id: number;
  gameState: string;
  gameType: number;
}
interface SchedDay {
  date: string;
  games?: SchedGame[];
}
interface SchedResponse {
  gameWeek?: SchedDay[];
}

interface BoxSkater {
  playerId: number;
  name?: { default?: string };
  position?: string;
  goals?: number;
  assists?: number;
  points?: number;
  plusMinus?: number;
  pim?: number;
  hits?: number;
  powerPlayGoals?: number;
  sog?: number;
  blockedShots?: number;
  toi?: string;
}
interface BoxGoalie {
  playerId: number;
  name?: { default?: string };
  position?: string;
  saves?: number;
  shotsAgainst?: number;
  goalsAgainst?: number;
  toi?: string;
  decision?: string;
  starter?: boolean;
}
interface BoxTeamStats {
  forwards?: BoxSkater[];
  defense?: BoxSkater[];
  goalies?: BoxGoalie[];
}
interface Boxscore {
  id: number;
  gameDate?: string;
  awayTeam?: { abbrev?: string };
  homeTeam?: { abbrev?: string };
  playerByGameStats?: { awayTeam?: BoxTeamStats; homeTeam?: BoxTeamStats };
}

const COMPLETED = ["OFF", "FINAL"];

/** Dates (YYYY-MM-DD) in the 7-day window ending at `endDate` inclusive. */
function windowDates(endDate: string): { from: string; to: string } {
  const end = new Date(`${endDate}T00:00:00Z`);
  const start = new Date(end.getTime() - 6 * 86400000);
  return { from: start.toISOString().slice(0, 10), to: endDate };
}

/**
 * Aggregate every player's production over the 7 days ending at `endDate`.
 * Only completed regular-season games count.
 */
export async function getWeekProduction(endDate: string): Promise<{
  players: PlayerWeek[];
  window: { from: string; to: string };
  gamesCounted: number;
}> {
  const win = windowDates(endDate);
  // The schedule endpoint returns the week containing the requested date, so ask
  // for the window start and keep only days inside our range.
  const sched = await getJson<SchedResponse>(`/v1/schedule/${win.from}`);
  const ids: number[] = [];
  for (const day of sched.gameWeek ?? []) {
    if (day.date < win.from || day.date > win.to) continue;
    for (const g of day.games ?? []) {
      if (g.gameType === 2 && COMPLETED.includes(g.gameState)) ids.push(g.id);
    }
  }

  const boxes = await pool(ids, 8, (id) =>
    getJson<Boxscore>(`/v1/gamecenter/${id}/boxscore`),
  );

  const acc = new Map<string, Omit<PlayerWeek, "fantasyPoints">>();
  const blank = (
    playerId: string,
    shortName: string,
    position: string,
    teamAbbr: string,
  ): Omit<PlayerWeek, "fantasyPoints"> => ({
    playerId,
    shortName,
    position,
    posGroup: positionGroup(position),
    teamAbbr,
    games: 0,
    goals: 0,
    assists: 0,
    points: 0,
    sog: 0,
    hits: 0,
    blocks: 0,
    ppGoals: 0,
    plusMinus: 0,
    wins: 0,
    saves: 0,
    goalsAgainst: 0,
    shutouts: 0,
    toiSeconds: 0,
  });

  let counted = 0;
  for (const box of boxes) {
    if (!box?.playerByGameStats) continue;
    counted++;
    const sides: Array<[BoxTeamStats | undefined, string]> = [
      [box.playerByGameStats.awayTeam, box.awayTeam?.abbrev ?? ""],
      [box.playerByGameStats.homeTeam, box.homeTeam?.abbrev ?? ""],
    ];
    for (const [side, abbr] of sides) {
      if (!side) continue;
      for (const s of [...(side.forwards ?? []), ...(side.defense ?? [])]) {
        const id = String(s.playerId);
        const rec =
          acc.get(id) ??
          blank(id, s.name?.default ?? "", s.position ?? "F", abbr);
        rec.games += 1;
        rec.goals += s.goals ?? 0;
        rec.assists += s.assists ?? 0;
        rec.points += s.points ?? 0;
        rec.sog += s.sog ?? 0;
        rec.hits += s.hits ?? 0;
        rec.blocks += s.blockedShots ?? 0;
        rec.ppGoals += s.powerPlayGoals ?? 0;
        rec.plusMinus += s.plusMinus ?? 0;
        rec.toiSeconds += toiSeconds(s.toi);
        rec.teamAbbr = abbr || rec.teamAbbr;
        acc.set(id, rec);
      }
      for (const g of side.goalies ?? []) {
        // Only count goalies who actually played.
        if (toiSeconds(g.toi) === 0) continue;
        const id = String(g.playerId);
        const rec = acc.get(id) ?? blank(id, g.name?.default ?? "", "G", abbr);
        rec.games += 1;
        rec.saves += g.saves ?? 0;
        rec.goalsAgainst += g.goalsAgainst ?? 0;
        if (g.decision === "W") rec.wins += 1;
        if ((g.goalsAgainst ?? 0) === 0 && toiSeconds(g.toi) >= 3000) rec.shutouts += 1;
        rec.toiSeconds += toiSeconds(g.toi);
        rec.teamAbbr = abbr || rec.teamAbbr;
        acc.set(id, rec);
      }
    }
  }

  const players: PlayerWeek[] = [...acc.values()].map((p) => ({
    ...p,
    fantasyPoints: fantasyPoints(p),
  }));
  return { players, window: win, gamesCounted: counted };
}

interface Landing {
  playerId: number;
  firstName?: { default?: string };
  lastName?: { default?: string };
  position?: string;
  headshot?: string;
  currentTeamAbbrev?: string;
}

/** Full name + headshot for one player (called only for shortlisted players). */
export async function getPlayerDetail(playerId: string): Promise<{
  firstName: string;
  lastName: string;
  headshotUrl: string | null;
  teamAbbr: string | null;
  position: string | null;
} | null> {
  try {
    const d = await getJson<Landing>(`/v1/player/${playerId}/landing`, 86400);
    return {
      firstName: d.firstName?.default ?? "",
      lastName: d.lastName?.default ?? "",
      headshotUrl: d.headshot ?? null,
      teamAbbr: d.currentTeamAbbrev ?? null,
      position: d.position ?? null,
    };
  } catch {
    return null;
  }
}

/** NHL action-shot URL (may 404; the renderer falls back). */
export function actionShotUrl(playerId: string): string {
  return `https://assets.nhle.com/mugs/actionshots/1296x729/${playerId}.jpg`;
}
