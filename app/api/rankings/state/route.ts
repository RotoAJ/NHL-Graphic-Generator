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
  const [head, through, previewSummary, runs] = await Promise.all([
    latestCommitted(),
    baselineThrough(),
    latestPreview(),
    listRuns(30),
  ]);
  const preview = previewSummary ? await getRun(previewSummary.id) : null;
  return NextResponse.json({ head, through, preview, runs });
}
