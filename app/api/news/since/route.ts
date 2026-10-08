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
import {
  hasDatabase,
  lastRun,
  missingIds,
  stats,
  updatesAfterId,
  updatesByIds,
  updatesSince,
} from "@/src/news/store";
import { cronAuthorized, hubAuthorized } from "@/src/x/auth";
import { safeEqual } from "@/src/auth/token";

export const runtime = "nodejs";

/**
 * A read-only key that opens THIS endpoint and nothing else.
 *
 * The digest skill fetches with WebFetch, which cannot send an Authorization
 * header, so its credential has to travel in the URL. Reusing the cron secret
 * for that would hand the skill -- and any log that records its URLs -- the
 * ability to trigger the goalie poster. This key can only read captured news,
 * so a leak costs a re-key rather than an unwanted post.
 */
function readKeyValid(req: Request): boolean {
  const expected = process.env.NEWS_READ_SECRET;
  if (!expected) return false;
  const supplied = new URL(req.url).searchParams.get("key") ?? "";
  return supplied.length > 0 && safeEqual(supplied, expected);
}

export async function GET(req: Request) {
  if (!readKeyValid(req) && !cronAuthorized(req) && !(await hubAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasDatabase()) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }

  const url = new URL(req.url);

  // ?compact=1 drops the Analysis paragraph. The digest's own format rule is
  // to never copy Analysis in, and it is most of each record's size; WebFetch
  // passes content through a small summarising model, so a large payload risks
  // being truncated -- a silent shortfall, which is the exact failure this
  // endpoint exists to remove. Use ?ids=1,2,3 to pull full records, Analysis
  // included, for just the borderline items that need a close read.
  const compact = url.searchParams.get("compact") === "1";
  const project = <T extends { analysis: string }>(rows: T[]) =>
    compact ? rows.map(({ analysis: _a, ...rest }) => rest) : rows;

  const idsRaw = url.searchParams.get("ids");
  if (idsRaw) {
    const ids = idsRaw
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 50);
    if (!ids.length) {
      return NextResponse.json({ error: "ids must be comma-separated numbers" }, { status: 400 });
    }
    const rows = await updatesByIds(ids);
    return NextResponse.json({
      count: rows.length,
      notFound: ids.filter((i) => !rows.some((r) => r.id === i)),
      updates: rows,
    });
  }

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

  // Continuity from where the caller left off. The real feed's Ids are gapless,
  // so any hole is a genuine miss. In afterId mode the range starts at
  // afterId + 1 rather than at the first returned item: otherwise a hole
  // immediately after the caller's last-seen Id would go unreported, and that is
  // exactly where a missed capture shows up.
  const rangeStart = afterIdRaw !== null ? Number(afterIdRaw) + 1 : updates[0]?.id;
  const rangeEnd = updates.length ? updates[updates.length - 1].id : null;
  const gaps =
    updates.length && rangeStart !== undefined && rangeEnd !== null
      ? await missingIds(rangeStart, rangeEnd)
      : [];

  // Liveness. An empty result is ambiguous: a quiet stretch and a stopped
  // capture both return nothing. The run heartbeat disambiguates, so the
  // caller can refuse to report "nothing new" off a store that has gone stale.
  const run = await lastRun();
  const ageMin = run ? Math.round((Date.now() - new Date(run.ranAt).getTime()) / 60000) : null;
  const stale = ageMin === null || ageMin > 90;

  return NextResponse.json({
    count: updates.length,
    idRange: updates.length ? [updates[0].id, updates[updates.length - 1].id] : null,
    gaps,
    // true when the capture job has not run for 90+ minutes -- do NOT treat an
    // empty result as "nothing happened" in that case.
    stale,
    lastRunMinutesAgo: ageMin,
    truncated: updates.length === limit,
    store,
    updates: project(updates),
  });
}
