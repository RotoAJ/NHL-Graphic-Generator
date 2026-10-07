// Capture the RotoWire news feed into Postgres.
//
// This replaces an hourly Claude task that fetched the same feed and merged it
// into a Google Drive JSON file. That work needs no judgment at all -- fetch,
// parse, insert anything new -- so running a language model for it was both the
// cost problem and the wrong tool. As plain code it is free, which means it can
// run far more often than hourly, and more often is strictly better: RotoWire
// permanently loses Updates once a day settles into the past, so the only
// defence is capturing them while they are still "today".
//
// Safe to run alongside the existing Claude task. They write to separate
// stores and never interact; the only shared resource is a cheap GET.
import { NextResponse } from "next/server";
import { fetchRecentNews } from "@/src/news/rotowire";
import {
  captureUpdates,
  hasDatabase,
  missingIds,
  recordRun,
  stats,
} from "@/src/news/store";
import { cronAuthorized, hubAuthorized } from "@/src/x/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req) && !(await hubAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ?dryRun=1 fetches and parses but writes nothing, so the feed side can be
  // exercised without a database and a live capture can be rehearsed safely.
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  if (!dryRun && !hasDatabase()) {
    return NextResponse.json(
      { error: "No database configured — nothing can be captured." },
      { status: 503 },
    );
  }

  const before = dryRun ? null : await stats();
  const { updates, buckets } = await fetchRecentNews();

  const usable = buckets.filter((b) => b.reason === "ok");
  if (!usable.length) {
    return NextResponse.json(
      { error: "Feed unavailable", buckets, stored: before },
      { status: 502 },
    );
  }

  const added = dryRun ? [] : await captureUpdates(updates);
  const after = dryRun ? null : await stats();

  // Report holes inside the range we just saw. A hole is either RotoWire's
  // known data loss or a window we failed to capture; either way it is the
  // thing worth knowing about, so surface it rather than let it stay silent.
  const fetchedMin = updates.length ? updates[0].id : null;
  const fetchedMax = updates.length ? updates[updates.length - 1].id : null;
  const gaps =
    fetchedMin !== null && fetchedMax !== null
      ? dryRun
        ? []
        : await missingIds(fetchedMin, fetchedMax)
      : [];

  // Record the run itself, even when it stored nothing. A run that adds no
  // rows is still a healthy run; without this a quiet job is indistinguishable
  // from a stopped one.
  if (!dryRun) await recordRun(updates.length, added.length, fetchedMax);

  return NextResponse.json({
    ok: true,
    dryRun,
    buckets,
    fetched: updates.length,
    fetchedIdRange: fetchedMin === null ? null : [fetchedMin, fetchedMax],
    added: added.length,
    addedIds: added.slice(0, 50),
    gapsInFetchedRange: gaps,
    stored: { before, after },
  });
}
