// Scheduled rankings update (Mon / Wed / Fri).
//
// Builds a PREVIEW by default. It only commits when explicitly told to, either by
// ?commit=1 or by setting RK_AUTOCOMMIT=1 once the output has earned trust. That
// is the "preview first" default: a run changes nothing until a person has seen
// it, which matters because the skill this replaces once inserted 130 players
// in a single run.
//
// Guards, because a scheduler configured by hand can fire at the wrong time:
//   - committing only happens on Monday, Wednesday or Friday (Eastern);
//   - it will not commit a second time on the same Eastern day;
//   - a signed-in session may build previews but can never commit from here.
// ?force=1 overrides the weekday and same-day guards.
import { NextResponse } from "next/server";
import { easternToday } from "@/src/goalies/gametime";
import { operatorOrCron, statusFor } from "@/src/rankings/auth";
import { rankingsDbAvailable } from "@/src/rankings/db";
import { buildPreview } from "@/src/rankings/run";
import { commitRun, latestCommitted } from "@/src/rankings/store";

export const runtime = "nodejs";
export const maxDuration = 300;

function easternWeekday(): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date());
}

export async function GET(req: Request) {
  const auth = await operatorOrCron(req);
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rankingsDbAvailable()) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const wantCommit = url.searchParams.get("commit") === "1" || process.env.RK_AUTOCOMMIT === "1";
  const weekday = easternWeekday();

  if (!force && !["Mon", "Wed", "Fri"].includes(weekday)) {
    return NextResponse.json({ skipped: true, reason: `Eastern weekday is ${weekday}, not Mon/Wed/Fri.` });
  }

  // already produced today?
  const head = await latestCommitted();
  if (!force && head?.kind === "run" && head.committedAt?.slice(0, 10) === easternToday()) {
    return NextResponse.json({ skipped: true, reason: "A run was already committed today.", runId: head.id });
  }

  try {
    const r = await buildPreview();
    let committed = false;
    let commitNote: string | null = null;
    if (wantCommit) {
      if (!auth.viaCron) {
        commitNote = "A signed-in session cannot commit from this route; the preview was left for review.";
      } else {
        const c = await commitRun(r.runId);
        committed = c.ok;
        if (!c.ok) commitNote = c.reason;
      }
    }
    const log = r.changelog;
    return NextResponse.json({
      ok: true,
      committed,
      commitNote,
      runId: r.runId,
      window: { from: r.windowFrom, to: r.windowTo, games: r.gamesInWindow },
      summary: {
        added: log.added.length,
        removed: log.removed.length,
        droppedForCap: log.droppedCap.length,
        heldByCap: log.heldByCap.count,
        heldNoId: log.heldNoId.length,
        injuryPenalties: log.injuryPenalties.length,
        players: log.endCount,
      },
    });
  } catch (e) {
    const message = (e as Error).message;
    if (/Nothing to process/i.test(message)) return NextResponse.json({ skipped: true, reason: message });
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
