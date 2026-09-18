// RotoWire Projected Goalies -- the ONLY trigger for a matchup post.
//
// Schema confirmed against the live feed (see PRD-social-hub.md §5.1):
//
//   <Game Id="36716">
//     <Teams>
//       <Team IsHome="0" Code="STL"><Name>St. Louis Blues</Name>
//         <StartingGoalie Designation="CONFIRMED" Id="3851">
//           <Firstname>Jordan</Firstname><Lastname>Binnington</Lastname>
//
// Two deliberate constraints:
//   - `Designation` is WHITELISTED to CONFIRMED. Every historical row observed
//     was CONFIRMED, so the vocabulary for a merely *probable* starter has never
//     been seen. Whitelisting means an unknown status can never trigger a post.
//   - The feed's `Code` is RotoWire's, which differs from the NHL abbreviation
//     for 8 of 32 teams (LAS is Vegas, not Los Angeles), so it always goes
//     through toNhlAbbr rather than being used directly.
import { toNhlAbbr } from "@/src/goalies/teamcodes";

const BASE = "https://api.rotowire.com/Hockey/NHL";

export interface ProjectedSide {
  /** RotoWire team code straight from the feed. */
  rwCode: string;
  /** NHL abbreviation, mapped. */
  teamAbbr: string;
  teamName: string;
  goalieFirst: string;
  goalieLast: string;
  designation: string;
  isHome: boolean;
}

export interface ProjectedGame {
  /** RotoWire game id -- the dedupe key. */
  rwGameId: string;
  date: string;
  away: ProjectedSide;
  home: ProjectedSide;
}

export type FeedReason =
  | "ok"
  | "no-key"
  | "http-error"
  | "fetch-error"
  | "empty-parse";

export interface ProjectedResult {
  /** Games where BOTH starters are confirmed and both teams mapped cleanly. */
  confirmed: ProjectedGame[];
  /** Games seen in the feed at all, confirmed or not. */
  gamesSeen: number;
  available: boolean;
  reason: FeedReason;
  detail?: string;
}

/** MMDDYYYY, the format the feed's `date` parameter expects. */
export function feedDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}${d}${y}`;
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : "";
}

function firstTag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
}

/**
 * Parse one <Team> block. Returns null when the team has no StartingGoalie
 * element at all, which is how the feed represents "not announced yet".
 */
function parseSide(block: string): ProjectedSide | null {
  const teamTag = block.match(/<Team\b[^>]*>/)?.[0] ?? "";
  const rwCode = attr(teamTag, "Code");
  const isHome = attr(teamTag, "IsHome") === "1";
  const teamName = firstTag(block, "Name");

  const sg = block.match(/<StartingGoalie\b[^>]*>[\s\S]*?<\/StartingGoalie>/)?.[0];
  if (!sg) return null;
  const sgTag = sg.match(/<StartingGoalie\b[^>]*>/)?.[0] ?? "";

  const teamAbbr = toNhlAbbr(rwCode);
  if (!teamAbbr) return null;

  return {
    rwCode,
    teamAbbr,
    teamName,
    goalieFirst: firstTag(sg, "Firstname"),
    goalieLast: firstTag(sg, "Lastname"),
    designation: attr(sgTag, "Designation").toUpperCase(),
    isHome,
  };
}

/** Only this designation may trigger a post. */
const CONFIRMED = "CONFIRMED";

export async function getProjectedGoalies(dateISO: string): Promise<ProjectedResult> {
  const key = process.env.ROTOWIRE_API_KEY;
  const empty = { confirmed: [], gamesSeen: 0, available: false };
  if (!key) return { ...empty, reason: "no-key" };

  let xml: string;
  try {
    const res = await fetch(
      `${BASE}/ProjectedGoalies.php?key=${encodeURIComponent(key)}&format=xml&date=${feedDate(dateISO)}`,
      { headers: { Accept: "application/xml,text/xml,*/*" }, next: { revalidate: 120 } },
    );
    if (!res.ok) {
      return { ...empty, reason: "http-error", detail: `HTTP ${res.status}` };
    }
    xml = await res.text();
  } catch (e) {
    return { ...empty, reason: "fetch-error", detail: (e as Error).message };
  }

  const gameBlocks = xml.match(/<Game\b[^>]*>[\s\S]*?<\/Game>/g) ?? [];
  if (!gameBlocks.length) {
    return { ...empty, reason: "empty-parse", detail: `${xml.length} bytes` };
  }

  const confirmed: ProjectedGame[] = [];
  for (const g of gameBlocks) {
    const rwGameId = attr(g.match(/<Game\b[^>]*>/)?.[0] ?? "", "Id");
    const teamBlocks = g.match(/<Team\b[^>]*>[\s\S]*?<\/Team>/g) ?? [];
    const sides = teamBlocks.map(parseSide);

    // Both sides must be present, mapped, and CONFIRMED.
    if (sides.length !== 2 || sides.some((s) => s === null)) continue;
    const [a, b] = sides as ProjectedSide[];
    if (a.designation !== CONFIRMED || b.designation !== CONFIRMED) continue;

    const home = a.isHome ? a : b;
    const away = a.isHome ? b : a;
    if (home.teamAbbr === away.teamAbbr) continue; // malformed

    confirmed.push({
      rwGameId,
      date: dateISO,
      away,
      home,
    });
  }

  return {
    confirmed,
    gamesSeen: gameBlocks.length,
    available: true,
    reason: "ok",
  };
}
