// What the digest skill reads instead of doing its own collection.
//
// Today that skill fetches two ~70KB XML buckets, downloads an ever-growing
// Drive log, merges them, and reasons about Id continuity -- all before any
// actual editorial work begins. All of that is deterministic, so it belongs in
// code. One call here returns the new items plus an explicit gap report, and
// the skill is left with the part that genuinely needs judgment: deciding what
// matters and writing it well.
//
// Query by either:
//   ?afterId=594971   everything captured after that Id (preferred -- the
//                     digest already states its Id range, so it can feed its
//                     own last range straight back in)
//   ?since=2026-10-06T12:00:00Z   everything with a feed DateTime at or after
import { NextResponse } from "next/server";
import { hasDatabase, missingIds, stats, updatesAfterId, updatesSince } from "@/src/news/store";
import { cronAuthorized, hubAuthorized } from "@/src/x/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!cronAuthorized(req) && !(await hubAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasDatabase()) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }

  const url = new URL(req.url);
  const afterIdRaw = url.searchParams.get("afterId");
  const since = url.searchParams.get("since");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 300) || 300, 500);

  const store = await stats();

  let updates;
  if (afterIdRaw !== null) {
    const afterId = Number(afterIdRaw);
    if (!Number.isFinite(afterId)) {
      return NextResponse.json({ error: "afterId must be a number" }, { status: 400 });
    }
    updates = await updatesAfterId(afterId, limit);
  } else if (since) {
    updates = await updatesSince(since, limit);
  } else {
    return NextResponse.json(
      { error: "Pass ?afterId=<id> or ?since=<ISO timestamp>." },
      { status: 400 },
    );
  }

  // Continuity inside what we're returning. The underlying feed's Ids are
  // gapless, so a hole here is a real miss and the digest should say so.
  const gaps =
    updates.length > 1
      ? await missingIds(updates[0].id, updates[updates.length - 1].id)
      : [];

  return NextResponse.json({
    count: updates.length,
    idRange: updates.length ? [updates[0].id, updates[updates.length - 1].id] : null,
    gaps,
    truncated: updates.length === limit,
    store,
    updates,
  });
}
