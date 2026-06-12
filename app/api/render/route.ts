import { NextResponse } from "next/server";
import { renderGraphic } from "@/src/render";
import type { DealType, RenderRequest, ReturnPlayer } from "@/src/types";

export const runtime = "nodejs";

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(req: Request) {
  let body: Partial<RenderRequest>;
  try {
    body = (await req.json()) as Partial<RenderRequest>;
  } catch {
    return bad("Invalid JSON body");
  }

  const playerName = (body.playerName ?? "").trim();
  const oldTeamAbbr = (body.oldTeamAbbr ?? "").trim().toUpperCase();
  const newTeamAbbr = (body.newTeamAbbr ?? "").trim().toUpperCase();
  const dealText = (body.dealText ?? "").toString();
  const dealType: DealType = body.dealType === "TRADE" ? "TRADE" : "SIGNING";

  if (!playerName) return bad("playerName is required");
  if (!newTeamAbbr) return bad("newTeamAbbr is required");
  // Old team is only meaningful for trades.
  if (dealType === "TRADE" && !oldTeamAbbr) return bad("oldTeamAbbr is required for trades");

  // Return players: trades only, capped at 3, must have a name.
  const returnPlayers: ReturnPlayer[] =
    dealType === "TRADE" && Array.isArray(body.returnPlayers)
      ? body.returnPlayers
          .filter(
            (p): p is ReturnPlayer =>
              !!p && typeof p.name === "string" && p.name.trim().length > 0,
          )
          .slice(0, 3)
          .map((p) => ({ name: p.name.trim(), headshotUrl: p.headshotUrl ?? null }))
      : [];

  try {
    const png = await renderGraphic({
      playerName,
      headshotUrl: body.headshotUrl ?? null,
      oldTeamAbbr,
      newTeamAbbr,
      dealText,
      dealType,
      returnPlayers,
    });
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
