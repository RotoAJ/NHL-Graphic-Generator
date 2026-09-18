// One deliberate test post, authorised by AJ, to validate POST /2/tweets.
//
// This is the only piece of the chain that cannot be exercised without
// publishing: X has no draft or sandbox mode. The upload probe already proved
// OAuth signing, the media endpoint and write permission, so what remains is
// the post call itself and how the card actually looks in a timeline.
//
// It runs the REAL pipeline -- feed -> confirmed game -> goalie resolution ->
// stats -> render -> post -- so a pass means production works, not that a
// simplified imitation of it works.
//
// Three separate things must all be true before anything publishes:
//   1. the caller is authenticated (session or cron secret)
//   2. ?confirm=POST-FOR-REAL is present, so no stray visit or prefetch posts
//   3. X_POSTING_ENABLED is "1", the same switch that governs the poller
//
// It deliberately does NOT record to posted_matchups: this is a test, and
// claiming that game id would stop the real game posting later.
import { NextResponse } from "next/server";
import { buildMatchup, resolveGoalieByName } from "@/src/goalies/nhl";
import { getGameTime } from "@/src/goalies/gametime";
import { getProjectedGoalies } from "@/src/goalies/projected";
import { matchupTweet } from "@/src/goalies/tweet";
import { renderMatchup } from "@/src/render/matchup";
import { cronAuthorized, hubAuthorized } from "@/src/x/auth";
import { postingEnabled, postWithImage, xConfigured } from "@/src/x/client";

export const runtime = "nodejs";
export const maxDuration = 120;

const CONFIRM = "POST-FOR-REAL";

export async function GET(req: Request) {
  if (!cronAuthorized(req) && !(await hubAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("confirm") !== CONFIRM) {
    return NextResponse.json(
      {
        error: `This publishes a real post to X. Add ?confirm=${CONFIRM} to proceed.`,
        willPost: false,
      },
      { status: 400 },
    );
  }
  // Disarmed by default now that the chain is validated. This endpoint really
  // does publish to the brand account, and leaving it permanently live on a
  // public deployment is a standing risk for no ongoing benefit. Set
  // X_ALLOW_TEST_POST=1 to re-enable it -- e.g. to re-validate after an X API
  // change -- then unset it again.
  if (process.env.X_ALLOW_TEST_POST !== "1") {
    return NextResponse.json(
      {
        error:
          "Test posting is disabled. Set X_ALLOW_TEST_POST=1 and redeploy to re-enable it.",
        willPost: false,
      },
      { status: 403 },
    );
  }
  if (!xConfigured()) {
    return NextResponse.json({ error: "X credentials are not configured." }, { status: 400 });
  }
  if (!postingEnabled()) {
    return NextResponse.json(
      {
        error:
          "X_POSTING_ENABLED is not 1, so posting is disabled. Set it to 1 and redeploy " +
          "to run this test.",
        willPost: false,
      },
      { status: 409 },
    );
  }

  // Default to a date known to have six confirmed matchups; it is the offseason,
  // so there is no live game to use.
  const date = (url.searchParams.get("date") || "2026-03-15").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const feed = await getProjectedGoalies(date);
  if (!feed.available) {
    return NextResponse.json(
      { error: `Feed unavailable: ${feed.reason}`, detail: feed.detail },
      { status: 502 },
    );
  }
  const game = feed.confirmed[0];
  if (!game) {
    return NextResponse.json(
      { error: `No game on ${date} had both starters confirmed.` },
      { status: 404 },
    );
  }

  const [away, home] = await Promise.all([
    resolveGoalieByName(game.away.teamAbbr, game.away.goalieFirst, game.away.goalieLast),
    resolveGoalieByName(game.home.teamAbbr, game.home.goalieFirst, game.home.goalieLast),
  ]);
  if (!away || !home) {
    return NextResponse.json({ error: "Could not resolve both goalies." }, { status: 502 });
  }

  const { gameTime } = await getGameTime(game.date, away.teamAbbr, home.teamAbbr);
  const data = await buildMatchup({ away, home, gameTime, beforeDate: game.date });
  const text = matchupTweet(data);

  try {
    const png = await renderMatchup(data);
    const result = await postWithImage(text, png);
    return NextResponse.json({
      ok: true,
      posted: !result.dryRun,
      tweetId: result.tweetId,
      url: result.tweetId
        ? `https://x.com/${result.account}/status/${result.tweetId}`
        : null,
      account: `@${result.account}`,
      matchup: `${away.fullName} (${away.teamAbbr}) @ ${home.fullName} (${home.teamAbbr})`,
      text,
      imageBytes: png.length,
      note:
        "This was a TEST post. Review how the card looks in the timeline, then delete it. " +
        "It was not recorded to posted_matchups, so the real game can still post later.",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, text },
      { status: 502 },
    );
  }
}
