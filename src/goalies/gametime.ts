// Puck drop for the graphic and tweet copy.
//
// The ProjectedGoalies feed carries no start time -- its <Date> is always
// 00:00:00 -- so the time comes from the NHL schedule, matched on the two team
// abbreviations. Also returns the NHL game id, which is useful for logging.
const API = process.env.NHL_API_BASE ?? "https://api-web.nhle.com";

const HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.nhl.com/",
};

interface SchedGame {
  id: number;
  startTimeUTC?: string;
  gameType?: number;
  awayTeam?: { abbrev?: string };
  homeTeam?: { abbrev?: string };
}
interface SchedDay {
  date: string;
  games?: SchedGame[];
}
interface SchedResponse {
  gameWeek?: SchedDay[];
}

/** "7:00 PM ET" in US Eastern, which is how NHL start times are quoted. */
export function easternLabel(startTimeUTC: string): string {
  const d = new Date(startTimeUTC);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${parts.replace(/ /g, " ")} ET`;
}

export interface GameTimeInfo {
  gameTime: string | null;
  nhlGameId: number | null;
  startTimeUTC: string | null;
}

/**
 * Look up the scheduled start for awayAbbr @ homeAbbr on `dateISO`.
 * Returns nulls rather than throwing -- a missing time only costs the label.
 */
export async function getGameTime(
  dateISO: string,
  awayAbbr: string,
  homeAbbr: string,
): Promise<GameTimeInfo> {
  const miss: GameTimeInfo = { gameTime: null, nhlGameId: null, startTimeUTC: null };
  try {
    const res = await fetch(`${API}/v1/schedule/${dateISO}`, {
      headers: HEADERS,
      next: { revalidate: 300 },
    });
    if (!res.ok) return miss;
    const sched = (await res.json()) as SchedResponse;
    for (const day of sched.gameWeek ?? []) {
      if (day.date !== dateISO) continue;
      for (const g of day.games ?? []) {
        const away = g.awayTeam?.abbrev;
        const home = g.homeTeam?.abbrev;
        // Accept either orientation: the feed's IsHome is authoritative for the
        // graphic, but a mismatch shouldn't lose us the start time.
        const match =
          (away === awayAbbr && home === homeAbbr) ||
          (away === homeAbbr && home === awayAbbr);
        if (!match) continue;
        return {
          gameTime: g.startTimeUTC ? easternLabel(g.startTimeUTC) : null,
          nhlGameId: g.id ?? null,
          startTimeUTC: g.startTimeUTC ?? null,
        };
      }
    }
    return miss;
  } catch {
    return miss;
  }
}

/** Today's date in US Eastern -- game days roll over on Eastern, not UTC. */
export function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
