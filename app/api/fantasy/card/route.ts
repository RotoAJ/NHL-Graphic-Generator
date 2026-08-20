import { NextResponse } from "next/server";
import { renderFantasyCard } from "@/src/render/card";
import type { Finalist, ThreadType } from "@/src/fantasy/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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
