// Download a run's rankings as CSV -- the replacement for the file that used to
// be overwritten in Google Drive.
//
//   ?run=latest    the current committed file (default)
//   ?run=preview   the uncommitted preview
//   ?run=<id>      any run in the history
//
// Same five columns, and the baseline's own line endings and quoting, so what
// comes out is shaped like what went in.
import { NextResponse } from "next/server";
import { operatorOrCron, RANKINGS_FILENAME } from "@/src/rankings/auth";
import { rankingsDbAvailable } from "@/src/rankings/db";
import { toRankingsCsv } from "@/src/rankings/csv";
import { getRows, getRun, latestCommitted, latestPreview } from "@/src/rankings/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!(await operatorOrCron(req)).ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rankingsDbAvailable()) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }

  const which = new URL(req.url).searchParams.get("run") ?? "latest";
  let id: number | null = null;
  let label = "";
  if (which === "latest") {
    id = (await latestCommitted())?.id ?? null;
  } else if (which === "preview") {
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
  const rows = await getRows(id);
  const csv = toRankingsCsv(rows, run.style ?? undefined);
  const filename = RANKINGS_FILENAME.replace(/\.csv$/, `${label}.csv`);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
