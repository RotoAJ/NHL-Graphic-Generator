import { NextResponse } from "next/server";
import { selectPlayers } from "@/src/fantasy/select";
import { sleepersThread, starsThread } from "@/src/fantasy/threads";

export const runtime = "nodejs";
// A full week is ~60 box-score fetches on a cold cache.
export const maxDuration = 120;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const endDate = (url.searchParams.get("date") || todayISO()).trim();
  const ignoreRecency = url.searchParams.get("ignoreRecency") === "1";
  const minGames = Number(url.searchParams.get("minGames") || "1") || 1;
  // ?preview=1 shows placeholder ownership so Sleeper cards can be reviewed.
  const allowPlaceholderOwnership = url.searchParams.get("preview") === "1";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const result = await selectPlayers({
      endDate,
      ignoreRecency,
      minGames,
      allowPlaceholderOwnership,
    });
    return NextResponse.json({
      window: result.window,
      warnings: result.warnings,
      stars: result.stars,
      sleepers: result.sleepers,
      threads: {
        stars: starsThread(result),
        sleepers: sleepersThread(result),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
