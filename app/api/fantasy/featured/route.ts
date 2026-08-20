import { NextResponse } from "next/server";
import { getFeaturedStore, makeRecord, RECENCY_DAYS } from "@/src/fantasy/featured";
import type { ThreadType } from "@/src/fantasy/types";

export const runtime = "nodejs";

/** History, newest first. */
export async function GET() {
  const store = getFeaturedStore();
  const all = await store.all();
  return NextResponse.json({
    store: store.name,
    persistent: store.persistent,
    recencyDays: RECENCY_DAYS,
    records: all.sort((a, b) => b.featuredOn.localeCompare(a.featuredOn)),
  });
}

interface Body {
  players?: Array<{
    playerId: string;
    fullName: string;
    position: string;
    threadType: ThreadType;
  }>;
}

/** Record a confirmed set so those players are excluded for the next 2 weeks. */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const players = (body.players ?? []).filter((p) => p?.playerId && p?.fullName);
  if (!players.length) {
    return NextResponse.json({ error: "players is required" }, { status: 400 });
  }
  const store = getFeaturedStore();
  await store.add(
    players.map((p) =>
      makeRecord(p.playerId, p.fullName, p.position, p.threadType === "sleepers" ? "sleepers" : "stars"),
    ),
  );
  return NextResponse.json({ ok: true, added: players.length, persistent: store.persistent });
}
