// One-off import of the existing Google Drive snapshot log.
//
// That log holds everything the hourly Claude task captured since Sept 22,
// 2026 -- genuinely irreplaceable, because RotoWire permanently loses Updates
// once a day has settled. Without this the hub would start blind and that
// history would be stranded in a file nothing reads.
//
// Accepts the log's own shape, { updates: { "<id>": {...} } }, as well as a
// plain array of records. Existing rows are never overwritten (see
// captureUpdates), so this is safe to run more than once.
import { NextResponse } from "next/server";
import { captureUpdates, hasDatabase, stats } from "@/src/news/store";
import type { NewsUpdate } from "@/src/news/rotowire";
import { cronAuthorized, hubAuthorized } from "@/src/x/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

interface LogEntry {
  id?: number | string;
  Id?: number | string;
  datetime?: string;
  dateTime?: string;
  DateTime?: string;
  priority?: number | string;
  headline?: string;
  notes?: string;
  analysis?: string;
  player?: string;
  playerName?: string;
  position?: string;
  team?: string;
  teamCode?: string;
}

function toUpdate(id: number, e: LogEntry): NewsUpdate {
  const priority = Number(e.priority);
  return {
    id,
    dateTime: e.datetime ?? e.dateTime ?? e.DateTime ?? "",
    priority: Number.isFinite(priority) ? priority : null,
    headline: e.headline ?? "",
    notes: e.notes ?? "",
    analysis: e.analysis ?? "",
    playerId: null,
    playerName: e.player ?? e.playerName ?? null,
    position: e.position ?? null,
    leagueLevel: null,
    injuryStatus: null,
    injuryType: null,
    teamCode: e.team ?? e.teamCode ?? null,
  };
}

export async function POST(req: Request) {
  if (!cronAuthorized(req) && !(await hubAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasDatabase()) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const records: NewsUpdate[] = [];
  const skipped: string[] = [];

  const push = (rawId: unknown, entry: LogEntry) => {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      skipped.push(String(rawId));
      return;
    }
    records.push(toUpdate(id, entry));
  };

  const asObj = body as { updates?: unknown };
  if (asObj && typeof asObj === "object" && asObj.updates && !Array.isArray(asObj.updates)) {
    for (const [k, v] of Object.entries(asObj.updates as Record<string, LogEntry>)) {
      push((v && (v.id ?? v.Id)) ?? k, v ?? {});
    }
  } else if (Array.isArray(body)) {
    for (const v of body as LogEntry[]) push(v?.id ?? v?.Id, v ?? {});
  } else if (Array.isArray(asObj?.updates)) {
    for (const v of asObj.updates as LogEntry[]) push(v?.id ?? v?.Id, v ?? {});
  } else {
    return NextResponse.json(
      { error: 'Expected { updates: { "<id>": {...} } } or an array of records.' },
      { status: 400 },
    );
  }

  const before = await stats();
  const added = await captureUpdates(records);
  const after = await stats();

  return NextResponse.json({
    ok: true,
    received: records.length,
    skippedIds: skipped.slice(0, 20),
    added: added.length,
    alreadyPresent: records.length - added.length,
    store: { before, after },
  });
}
