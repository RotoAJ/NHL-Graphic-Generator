// One-off helper for moving to a fresh database: mark today's games that were ALREADY posted as done, so the
// poller does not post them again.
//
//   /api/goalies/seed?games=NYR@BOS,TOR@MTL     (AWAY@HOME, NHL abbreviations, as on the cards)
//   /api/goalies/seed?all=1                     every game currently confirmed for today
//   /api/goalies/seed                           just lists today's games, changes nothing
//
// Needs a signed-in session or the cron secret. It only ever ADDS "already posted" rows; it cannot post anything.
import { NextResponse } from "next/server";
import { easternToday } from "@/src/goalies/gametime";
import { getProjectedGoalies } from "@/src/goalies/projected";
import { hasDatabase, seedPosted } from "@/src/goalies/posted";
import { operatorOrCron } from "@/src/rankings/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!(await operatorOrCron(req)).ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasDatabase()) return NextResponse.json({ error: "No database configured." }, { status: 503 });

  const url = new URL(req.url);
  const date = (url.searchParams.get("date") || easternToday()).trim();
  const feed = await getProjectedGoalies(date);
  if (!feed.available) return NextResponse.json({ error: `Feed unavailable: ${feed.reason}` }, { status: 502 });

  const label = (g: (typeof feed.confirmed)[number]) => `${g.away.teamAbbr}@${g.home.teamAbbr}`;
  const available = feed.confirmed.map(label);
  const all = url.searchParams.get("all") === "1";
  const wanted = (url.searchParams.get("games") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase().replace("-", "@"))
    .filter(Boolean);

  if (!all && !wanted.length) {
    return NextResponse.json({ date, confirmedNow: available, note: "Nothing changed. Add ?games=AWAY@HOME,... or ?all=1." });
  }

  const marked: string[] = [];
  const alreadyThere: string[] = [];
  try {
    for (const g of feed.confirmed) {
      if (!all && !wanted.includes(label(g))) continue;
      (await seedPosted(g.rwGameId, label(g))) ? marked.push(label(g)) : alreadyThere.push(label(g));
    }
  } catch (e) {
    return NextResponse.json({ error: `Database error: ${(e as Error).message}` }, { status: 500 });
  }
  const notFound = wanted.filter((w) => !available.includes(w));
  return NextResponse.json({ date, marked, alreadyThere, notConfirmedOrNotFound: notFound, confirmedNow: available });
}
