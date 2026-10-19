// Everything the rankings page needs in one call.
import { NextResponse } from "next/server";
import { rankingsDbAvailable } from "@/src/rankings/db";
import { operatorOrCron } from "@/src/rankings/auth";
import { baselineThrough, getRun, latestCommitted, latestPreview, listRuns } from "@/src/rankings/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!(await operatorOrCron(req)).ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rankingsDbAvailable()) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }
  try {
    const [head, through, previewSummary, runs] = await Promise.all([
      latestCommitted(),
      baselineThrough(),
      latestPreview(),
      listRuns(30),
    ]);
    const preview = previewSummary ? await getRun(previewSummary.id) : null;
    return NextResponse.json({ head, through, preview, runs });
  } catch (e) {
    // an uncaught throw here gives the browser an EMPTY 500, which the page can only report as a JSON error
    return NextResponse.json({ error: `Database error: ${(e as Error).message}` }, { status: 500 });
  }
}
