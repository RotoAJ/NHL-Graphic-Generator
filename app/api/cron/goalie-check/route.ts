// Confirmed-starter poller: detect -> render -> post to X.
//
// Runs unattended on game days, so the ordering below is deliberate:
//
//   1. claim the game in Postgres FIRST (UNIQUE on rw_game_id), so two
//      overlapping cron runs can never both post the same matchup;
//   2. resolve both goalies to NHL ids, and BAIL if either fails -- posting the
//      wrong player's photo is worse than posting nothing;
//   3. render, then post;
//   4. on any failure before the post lands, release the claim so the next poll
//      retries instead of the game being silently dropped.
//
// Posting itself is gated by X_POSTING_ENABLED, which lets posting be stopped
// from the Vercel dashboard without a redeploy.
import { NextResponse } from "next/server";
import { buildMatchup, resolveGoalieByName } from "@/src/goalies/nhl";
import { easternToday, getGameTime } from "@/src/goalies/gametime";
import { getProjectedGoalies, type ProjectedGame } from "@/src/goalies/projected";
import {
  claimGame,
  hasDatabase,
  postedGameIds,
  recordResult,
  releaseGame,
} from "@/src/goalies/posted";
import { matchupTweet } from "@/src/goalies/tweet";
import { renderMatchup } from "@/src/render/matchup";
import { postingEnabled, verifyCredentials, xConfigured } from "@/src/x/client";
import { postWithImage } from "@/src/x/client";
import { cronAuthorized, hubAuthorized } from "@/src/x/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

interface GameOutcome {
  rwGameId: string;
  matchup: string;
  status:
    | "posted"
    | "dry-run"
    | "already-posted"
    | "unresolved-goalie"
    | "not-regular-season"
    | "error";
  tweetId?: string | null;
  detail?: string;
}

async function handleGame(
  game: ProjectedGame,
  opts: { dryRun: boolean },
): Promise<GameOutcome> {
  const label = `${game.away.teamAbbr} @ ${game.home.teamAbbr}`;

  // 1. Claim before doing any work, so concurrent runs can't double-post.
  let claimed = true;
  if (!opts.dryRun) {
    try {
      claimed = await claimGame(game.rwGameId, label);
    } catch (e) {
      return { rwGameId: game.rwGameId, matchup: label, status: "error", detail: (e as Error).message };
    }
    if (!claimed) {
      return { rwGameId: game.rwGameId, matchup: label, status: "already-posted" };
    }
  }

  try {
    // 2. Names -> NHL ids. Never guess: a wrong match publishes a wrong photo.
    const [away, home] = await Promise.all([
      resolveGoalieByName(game.away.teamAbbr, game.away.goalieFirst, game.away.goalieLast),
      resolveGoalieByName(game.home.teamAbbr, game.home.goalieFirst, game.home.goalieLast),
    ]);
    if (!away || !home) {
      if (!opts.dryRun) await releaseGame(game.rwGameId);
      const missing = [
        !away ? `${game.away.goalieFirst} ${game.away.goalieLast} (${game.away.teamAbbr})` : null,
        !home ? `${game.home.goalieFirst} ${game.home.goalieLast} (${game.home.teamAbbr})` : null,
      ].filter(Boolean);
      return {
        rwGameId: game.rwGameId,
        matchup: label,
        status: "unresolved-goalie",
        detail: `could not resolve ${missing.join(" and ")}`,
      };
    }

    const { gameTime, gameType } = await getGameTime(
      game.date,
      away.teamAbbr,
      home.teamAbbr,
    );

    // Only regular-season games post. The RotoWire feed does not distinguish
    // preseason, so without this the poller would start tweeting exhibition
    // matchups in late September. Skipped only when the schedule positively
    // identifies another type -- an unknown type still proceeds, so a failed
    // schedule lookup cannot silently suppress a real game.
    if (gameType !== null && gameType !== 2) {
      if (!opts.dryRun) await releaseGame(game.rwGameId);
      return {
        rwGameId: game.rwGameId,
        matchup: label,
        status: "not-regular-season",
        detail: `NHL gameType ${gameType}`,
      };
    }
    // beforeDate excludes today's game from its own history. Without it the
    // "last meeting" footer showed the very game being previewed whenever the
    // poll ran after puck drop, and last-5 lines would absorb the live result.
    const data = await buildMatchup({
      away,
      home,
      gameTime,
      beforeDate: game.date,
    });
    const text = matchupTweet(data);

    if (opts.dryRun) {
      return {
        rwGameId: game.rwGameId,
        matchup: `${away.fullName} (${away.teamAbbr}) @ ${home.fullName} (${home.teamAbbr})`,
        status: "dry-run",
        detail: text,
      };
    }

    // 3. Render, then post.
    const png = await renderMatchup(data);
    const result = await postWithImage(text, png);
    await recordResult(game.rwGameId, result.tweetId, result.dryRun);

    return {
      rwGameId: game.rwGameId,
      matchup: label,
      status: result.dryRun ? "dry-run" : "posted",
      tweetId: result.tweetId,
      detail: result.dryRun ? "X_POSTING_ENABLED is not 1" : `@${result.account}`,
    };
  } catch (e) {
    // 4. Failed before posting -- let the next poll retry.
    if (!opts.dryRun) await releaseGame(game.rwGameId);
    return {
      rwGameId: game.rwGameId,
      matchup: label,
      status: "error",
      detail: (e as Error).message,
    };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  // The cron secret grants full access; that is how GitHub Actions calls this.
  // A signed-in operator may run DRY RUNS ONLY, so opening this URL in a
  // browser can never publish -- convenient for testing, and a stray visit or
  // a prefetch cannot fire a real post.
  if (!cronAuthorized(req)) {
    const session = await hubAuthorized(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!dryRun) {
      return NextResponse.json(
        {
          error:
            "A signed-in session may only run dry runs. Add ?dryRun=1, or call " +
            "with CRON_SECRET to post for real.",
        },
        { status: 403 },
      );
    }
  }
  const date = (url.searchParams.get("date") || easternToday()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const warnings: string[] = [];
  if (!xConfigured()) warnings.push("X credentials are not configured — nothing can post.");
  if (!postingEnabled()) warnings.push("X_POSTING_ENABLED is not 1 — running as a dry run.");
  if (!hasDatabase()) {
    warnings.push("No database configured — dedupe is disabled, so repeat posts are possible.");
  }

  const feed = await getProjectedGoalies(date);
  if (!feed.available) {
    return NextResponse.json(
      {
        date,
        error: `Projected goalies feed unavailable: ${feed.reason}`,
        detail: feed.detail,
        warnings,
      },
      { status: 502 },
    );
  }

  // Confirm the credentials resolve to the expected account. Done on a dry run
  // or when there is something to post, so empty days cost no API calls -- this
  // is how the credentials get verified without exposing CRON_SECRET to a browser.
  let account: string | null = null;
  if (xConfigured() && (dryRun || feed.confirmed.length > 0)) {
    try {
      const a = await verifyCredentials();
      account = `@${a.username}`;
      const expect = (process.env.X_NHL_EXPECTED_HANDLE ?? "").replace(/^@/, "").trim();
      if (expect && a.username.toLowerCase() !== expect.toLowerCase()) {
        warnings.push(
          `Credentials resolve to @${a.username} but X_NHL_EXPECTED_HANDLE is @${expect} — posting will refuse.`,
        );
      }
    } catch (e) {
      warnings.push(`X credential check failed: ${(e as Error).message}`);
    }
  }

  const already = dryRun ? new Set<string>() : await postedGameIds();
  const pending = feed.confirmed.filter((g) => !already.has(g.rwGameId));

  const results: GameOutcome[] = [];
  // Sequential on purpose: each game renders a 1600x900 PNG and uploads it.
  for (const g of pending) {
    results.push(await handleGame(g, { dryRun }));
  }

  return NextResponse.json({
    date,
    dryRun,
    account,
    gamesSeen: feed.gamesSeen,
    bothConfirmed: feed.confirmed.length,
    skippedAlreadyPosted: feed.confirmed.length - pending.length,
    posted: results.filter((r) => r.status === "posted").length,
    results,
    warnings,
  });
}
