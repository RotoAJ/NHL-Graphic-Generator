// Download the 7-day or 14-day outlook for a run -- the replacement for the two
// "NHL 7-Day Outlook" / "NHL 14-Day Outlook" files that were overwritten in Drive.
//
//   ?window=7|14   (default 7)
//   ?run=latest    the current committed file (default)
//   ?run=preview   the uncommitted preview
//   ?run=<id>      any run in the history
//
// A run's own outlook is saved when the run is built, so a committed run's files
// stay as they were. A run without one (the uploaded baseline) gets one computed
// fresh for today. Same five columns as the rankings file.
import { NextResponse } from "next/server";
import { operatorOrCron } from "@/src/rankings/auth";
import { toRankingsCsv } from "@/src/rankings/csv";
import { rankingsDbAvailable } from "@/src/rankings/db";
import { outlookFor } from "@/src/rankings/run";
import { getRun, latestCommitted, latestPreview } from "@/src/rankings/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!(await operatorOrCron(req)).ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rankingsDbAvailable()) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }

  const url = new URL(req.url);
  const win = url.searchParams.get("window") === "14" ? 14 : 7;
  const which = url.searchParams.get("run") ?? "latest";

  let id: number | null = null;
  let label = "";
  if (which === "latest") id = (await latestCommitted())?.id ?? null;
  else if (which === "preview") {
    id = (await latestPreview())?.id ?? null;
    label = " (preview)";
  } else {
    const n = Number(which);
    id = Number.isFinite(n) && n > 0 ? n : null;
    label = ` (run ${n})`;
  }
  if (!id) return NextResponse.json({ error: "No such rankings file yet." }, { status: 404 });

  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });

  try {
    const out = await outlookFor(id, win);
    if (!out) return NextResponse.json({ error: "Nothing to build an outlook from." }, { status: 404 });
    return new NextResponse(toRankingsCsv(out.rows, run.style ?? undefined), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="NHL ${win}-Day Outlook${label}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Could not build the outlook: ${(e as Error).message}` }, { status: 502 });
  }
}
