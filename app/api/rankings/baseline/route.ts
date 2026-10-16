// Upload the current rankings file as the starting point.
import { NextResponse } from "next/server";
import { operatorOrCron, statusFor } from "@/src/rankings/auth";
import { rankingsDbAvailable } from "@/src/rankings/db";
import { uploadBaseline } from "@/src/rankings/run";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await operatorOrCron(req)).ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rankingsDbAvailable()) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }
  let body: { csv?: string; through?: string };
  try {
    body = (await req.json()) as { csv?: string; through?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.csv || !body.through) {
    return NextResponse.json({ error: "Both the CSV file and the cut-off date are required." }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await uploadBaseline(body.csv, body.through)) });
  } catch (e) {
    const message = (e as Error).message;
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
