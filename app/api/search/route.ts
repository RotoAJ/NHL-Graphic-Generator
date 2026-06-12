import { NextResponse } from "next/server";
import { nhlDataSource } from "@/src/datasource/nhl";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }
  try {
    const results = await nhlDataSource.search(q);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { results: [], error: (err as Error).message },
      { status: 502 },
    );
  }
}
