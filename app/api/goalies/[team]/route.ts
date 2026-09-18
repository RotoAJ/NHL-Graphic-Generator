import { NextResponse } from "next/server";
import { listTeamGoalies } from "@/src/goalies/nhl";
import { TEAM_BY_ABBR } from "@/src/teams";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ team: string }> },
) {
  const { team } = await ctx.params;
  const abbr = team.trim().toUpperCase();
  if (!TEAM_BY_ABBR[abbr]) {
    return NextResponse.json({ error: `Unknown team ${abbr}` }, { status: 400 });
  }
  try {
    const goalies = await listTeamGoalies(abbr);
    return NextResponse.json({ goalies });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
