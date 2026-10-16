// Build a preview run, or read one run's details.
import { NextResponse } from "next/server";
import { operatorOrCron, statusFor } from "@/src/rankings/auth";
import { rankingsDbAvailable } from "@/src/rankings/db";
import { buildPreview } from "@/src/rankings/run";
import { getRun } from "@/src/rankings/store";

export const runtime = "nodejs";
// The first run after a baseline loads the whole season's games before it can
// compute anything. Later runs only need the few new games.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!(await operatorOrCron(req)).ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rankingsDbAvailable()) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }
  let body: { to?: string } = {};
  try {
    body = (await req.json()) as { to?: string };
  } catch {
    /* an empty body is fine */
  }
  if (body.to && !/^\d{4}-\d{2}-\d{2}$/.test(body.to)) {
    return NextResponse.json({ error: "to must be YYYY-MM-DD" }, { status: 400 });
  }
  try {
    const r = await buildPreview({ to: body.to });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const message = (e as Error).message;
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function GET(req: Request) {
  if (!(await operatorOrCron(req)).ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  return NextResponse.json({ run });
}
