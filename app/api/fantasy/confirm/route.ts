import { NextResponse } from "next/server";
import { getFeaturedStore, makeRecord } from "@/src/fantasy/featured";
import { saveWeek, type WeeklySet } from "@/src/fantasy/weeks";
import type { Finalist } from "@/src/fantasy/types";

export const runtime = "nodejs";

interface Body {
  weekEnd?: string;
  window?: { from: string; to: string };
  stars?: Finalist[];
  sleepers?: Finalist[];
  threads?: { stars: string; sleepers: string };
  warnings?: string[];
}

/**
 * Confirms a generated set: saves it under a permalink and records the players
 * so they sit out the next 14 days. Both happen together so a published week and
 * the recency history can't drift apart.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const weekEnd = (body.weekEnd ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
    return NextResponse.json({ error: "weekEnd (YYYY-MM-DD) is required" }, { status: 400 });
  }
  const stars = body.stars ?? [];
  const sleepers = body.sleepers ?? [];
  if (!stars.length && !sleepers.length) {
    return NextResponse.json({ error: "nothing to confirm" }, { status: 400 });
  }

  const set: WeeklySet = {
    weekEnd,
    window: body.window ?? { from: weekEnd, to: weekEnd },
    stars,
    sleepers,
    threads: body.threads ?? { stars: "", sleepers: "" },
    warnings: body.warnings ?? [],
    createdAt: new Date().toISOString(),
  };

  try {
    await saveWeek(set);
    const store = getFeaturedStore();
    await store.add([
      ...stars.map((p) => makeRecord(p.playerId, p.fullName, p.position, "stars")),
      ...sleepers.map((p) => makeRecord(p.playerId, p.fullName, p.position, "sleepers")),
    ]);
    return NextResponse.json({
      ok: true,
      permalink: `/fantasy/week/${weekEnd}`,
      recorded: stars.length + sleepers.length,
      store: store.name,
      persistent: store.persistent,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
