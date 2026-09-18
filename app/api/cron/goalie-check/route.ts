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
import { postingEnabled, xConfigured } from "@/src/x/client";
import { postWithImage } from "@/src/x/client";

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
    | "error";
  tweetId?: string | null;
  detail?: string;
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset in dev
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const header = req.headers.get("x-cron-secret") ?? "";
  const qs = new URL(req.url).searchParams.get("secret") ?? "";
  return bearer === secret || header === secret || qs === secret;
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

    const { gameTime } = await getGameTime(game.date, away.teamAbbr, home.teamAbbr);
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
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
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
    gamesSeen: feed.gamesSeen,
    bothConfirmed: feed.confirmed.length,
    skippedAlreadyPosted: feed.confirmed.length - pending.length,
    posted: results.filter((r) => r.status === "posted").length,
    results,
    warnings,
  });
}
