import { NextResponse } from "next/server";
import { buildMatchup, listTeamGoalies } from "@/src/goalies/nhl";
import { renderMatchup } from "@/src/render/matchup";
import { TEAM_BY_ABBR } from "@/src/teams";
import type { GoalieRef } from "@/src/goalies/types";

export const runtime = "nodejs";
// Rendering fetches several NHL endpoints plus two headshots.
export const maxDuration = 60;

interface Body {
  awayTeam?: string;
  awayGoalieId?: string;
  homeTeam?: string;
  homeGoalieId?: string;
  gameTime?: string;
  /** Only count games before this date (YYYY-MM-DD) -- for replaying past dates. */
  beforeDate?: string;
}

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/** Look the goalie up server-side so the graphic can't be fed arbitrary
 *  names/photos from the client. */
async function pick(team: string, id: string): Promise<GoalieRef | null> {
  const goalies = await listTeamGoalies(team);
  return goalies.find((g) => g.id === id) ?? null;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("Invalid JSON body");
  }

  const awayTeam = (body.awayTeam ?? "").trim().toUpperCase();
  const homeTeam = (body.homeTeam ?? "").trim().toUpperCase();
  const awayGoalieId = (body.awayGoalieId ?? "").trim();
  const homeGoalieId = (body.homeGoalieId ?? "").trim();

  if (!TEAM_BY_ABBR[awayTeam]) return bad("awayTeam is required");
  if (!TEAM_BY_ABBR[homeTeam]) return bad("homeTeam is required");
  if (awayTeam === homeTeam) return bad("Teams must differ");
  if (!awayGoalieId) return bad("awayGoalieId is required");
  if (!homeGoalieId) return bad("homeGoalieId is required");

  try {
    const [away, home] = await Promise.all([
      pick(awayTeam, awayGoalieId),
      pick(homeTeam, homeGoalieId),
    ]);
    if (!away) return bad(`Goalie ${awayGoalieId} not found on ${awayTeam}`);
    if (!home) return bad(`Goalie ${homeGoalieId} not found on ${homeTeam}`);

    const data = await buildMatchup({
      away,
      home,
      gameTime: body.gameTime?.trim() || null,
      beforeDate: body.beforeDate?.trim() || undefined,
    });
    const png = await renderMatchup(data);
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
