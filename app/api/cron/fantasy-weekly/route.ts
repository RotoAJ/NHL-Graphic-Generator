import { NextResponse } from "next/server";
import { cronAuthorized } from "@/src/x/auth";
import { getFeaturedStore, makeRecord } from "@/src/fantasy/featured";
import { selectPlayers } from "@/src/fantasy/select";
import { postMessage, slackConfigured, uploadCard } from "@/src/fantasy/slack";
import { sleepersThread, starsThread } from "@/src/fantasy/threads";
import { loadWeek, saveWeek } from "@/src/fantasy/weeks";
import { renderFantasyCard } from "@/src/render/card";
import type { Finalist, ThreadType } from "@/src/fantasy/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Current weekday in US Eastern, e.g. "Mon". */
function easternWeekday(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date());
}

/** Yesterday in Eastern terms -- a Monday run should cover Mon-Sun. */
function windowEndDate(now = new Date()): string {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(et.getDate() - 1);
  return et.toISOString().slice(0, 10);
}

/**
 * Weekly job: build both threads, render six cards, post to Slack, and record
 * the featured players.
 *
 * Scheduled from GitHub Actions (see .github/workflows/fantasy-weekly.yml).
 * Because cron schedules run in UTC, the workflow fires at two UTC times so the
 * job still lands at 8am Eastern on both sides of the daylight-saving change;
 * this handler runs only when it really is 8am Eastern, so the other firing is a
 * cheap no-op. `?force=1` bypasses the hour check for manual runs.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dryRun = url.searchParams.get("dryRun") === "1";
  const ignoreRecency = url.searchParams.get("ignoreRecency") === "1";

  // Auth via the shared helper, so this endpoint accepts the same secrets as
  // the goalie poller -- including the external scheduler's own key.
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Monday is enforced HERE as well as in the scheduler. It used to be implied
  // by the GitHub cron expression; with scheduling moved to an external service
  // that is configured by hand, a job accidentally set to fire daily would
  // otherwise produce a new "weekly" set every morning.
  const weekday = easternWeekday();
  if (!force && weekday !== "Mon") {
    return NextResponse.json({
      skipped: true,
      reason: `Eastern weekday is ${weekday}, not Mon — this firing is a no-op.`,
    });
  }

  const endDate = url.searchParams.get("date") ?? windowEndDate();

  // Idempotency replaces the old "only at 8am Eastern" check.
  //
  // That check cost two weeks of output without ever reporting a failure: a
  // run arriving at any other hour returned 200 with skipped:true, so GitHub
  // (firing 6-8 hours late) and then a cron job set to 08:00 UTC both looked
  // perfectly healthy while producing nothing. The hour was never the point --
  // what matters is that the week gets produced exactly once.
  //
  // So: run on Monday unless this week's set already exists. A delayed or
  // mistimed firing now yields a late post instead of silence, and a repeat
  // firing is a no-op rather than a duplicate.
  if (!force) {
    const existing = await loadWeek(endDate);
    if (existing) {
      return NextResponse.json({
        skipped: true,
        reason: `Week ending ${endDate} has already been produced.`,
        permalink: `/fantasy/week/${endDate}`,
      });
    }
  }

  try {
    const result = await selectPlayers({ endDate, ignoreRecency });
    const threads = { stars: starsThread(result), sleepers: sleepersThread(result) };

    if (!result.stars.length && !result.sleepers.length) {
      return NextResponse.json({
        posted: false,
        reason: "No qualifying players (no completed games in the window?)",
        warnings: result.warnings,
        window: result.window,
      });
    }

    // Save the week and record the players BEFORE any Slack work. The permalink
    // is the real deliverable and must not depend on Slack; recording here also
    // means the 14-day filter still advances when Slack isn't configured at all
    // (otherwise the same players would resurface every week).
    const weekEnd = result.window.to;
    const permalink = `/fantasy/week/${weekEnd}`;
    const store = getFeaturedStore();

    if (!dryRun) {
      await saveWeek({
        weekEnd,
        window: result.window,
        stars: result.stars,
        sleepers: result.sleepers,
        threads,
        warnings: result.warnings,
        createdAt: new Date().toISOString(),
      });
      await store.add([
        ...result.stars.map((p) => makeRecord(p.playerId, p.fullName, p.position, "stars")),
        ...result.sleepers.map((p) =>
          makeRecord(p.playerId, p.fullName, p.position, "sleepers"),
        ),
      ]);
    }

    if (dryRun || !slackConfigured()) {
      return NextResponse.json({
        posted: false,
        dryRun,
        saved: !dryRun,
        recorded: dryRun ? 0 : result.stars.length + result.sleepers.length,
        permalink,
        slackConfigured: slackConfigured(),
        store: store.name,
        persistent: store.persistent,
        window: result.window,
        warnings: result.warnings,
        threads,
        stars: result.stars.map((p) => p.fullName),
        sleepers: result.sleepers.map((p) => p.fullName),
      });
    }

    // --- post to Slack ---
    const header =
      `*Fantasy Hockey — week of ${result.window.from} to ${result.window.to}*\n` +
      (result.warnings.length ? `\n_Notes: ${result.warnings.join(" · ")}_\n` : "");
    const ts = await postMessage(`${header}\n${threads.stars}\n\n${threads.sleepers}`);

    const jobs: Array<[ThreadType, Finalist]> = [
      ...result.stars.map((p) => ["stars", p] as [ThreadType, Finalist]),
      ...result.sleepers.map((p) => ["sleepers", p] as [ThreadType, Finalist]),
    ];
    const uploaded: string[] = [];
    for (const [threadType, player] of jobs) {
      try {
        const png = await renderFantasyCard(player, threadType);
        await uploadCard(
          `${threadType}-${player.lastName.toLowerCase()}.png`,
          png,
          `${player.fullName} — ${threadType === "stars" ? "Three Stars" : "Sleeper"}`,
          ts,
        );
        uploaded.push(player.fullName);
      } catch {
        // One bad card shouldn't lose the whole post.
      }
    }

    // (players were already recorded above, before the Slack work)
    return NextResponse.json({
      posted: true,
      permalink,
      window: result.window,
      uploaded,
      store: store.name,
      persistent: store.persistent,
      warnings: result.warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
