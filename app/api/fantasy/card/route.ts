import { NextResponse } from "next/server";
import { renderFantasyCard } from "@/src/render/card";
import { loadWeek } from "@/src/fantasy/weeks";
import type { Finalist, ThreadType } from "@/src/fantasy/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET variant for the weekly permalink page: renders a card straight from the
 * saved week, so an <img src> works with no client-supplied data.
 *   /api/fantasy/card?week=2026-10-05&playerId=8482109&type=stars
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const week = (url.searchParams.get("week") ?? "").trim();
  const playerId = (url.searchParams.get("playerId") ?? "").trim();
  const threadType: ThreadType =
    url.searchParams.get("type") === "sleepers" ? "sleepers" : "stars";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !playerId) {
    return NextResponse.json({ error: "week and playerId are required" }, { status: 400 });
  }

  const set = await loadWeek(week);
  if (!set) {
    return NextResponse.json({ error: `No saved set for ${week}` }, { status: 404 });
  }
  const list = threadType === "sleepers" ? set.sleepers : set.stars;
  const player = list.find((p) => p.playerId === playerId);
  if (!player) {
    return NextResponse.json({ error: "Player not in that set" }, { status: 404 });
  }

  try {
    const png = await renderFantasyCard(player, threadType);
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        // Saved sets never change, so let the browser cache the render.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

interface Body {
  player?: Finalist;
  threadType?: ThreadType;
}

/**
 * Renders one card. The client posts back a finalist object it received from
 * /api/fantasy/generate -- six 1200x1500 PNGs in a single JSON payload would
 * exceed the serverless response limit, so cards are fetched one at a time.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const p = body.player;
  if (!p || !p.playerId || !p.firstName || !p.lastName) {
    return NextResponse.json({ error: "player is required" }, { status: 400 });
  }
  const threadType: ThreadType = body.threadType === "sleepers" ? "sleepers" : "stars";

  try {
    const png = await renderFantasyCard(p, threadType);
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
