// Commit, discard or restore a run. One small route per action keeps each one
// obvious: committing is the only step that changes the rankings file.
import { NextResponse } from "next/server";
import { operatorOrCron } from "@/src/rankings/auth";
import { commitRun, discardRun, restoreRun } from "@/src/rankings/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await operatorOrCron(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { runId?: number; action?: string };
  try {
    body = (await req.json()) as { runId?: number; action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const runId = Number(body.runId);
  if (!Number.isFinite(runId) || runId <= 0) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }

  switch (body.action ?? "commit") {
    case "commit": {
      const r = await commitRun(runId);
      return r.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: r.reason }, { status: 400 });
    }
    case "discard": {
      const done = await discardRun(runId);
      return done
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "Only an uncommitted preview can be discarded." }, { status: 400 });
    }
    case "restore": {
      const r = await restoreRun(runId);
      return r.ok
        ? NextResponse.json({ ok: true, newRunId: r.newRunId })
        : NextResponse.json({ error: r.reason }, { status: 400 });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
