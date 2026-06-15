import { NextResponse } from "next/server";
import { renderPoster, type PosterOptions } from "@/src/render/poster";
import type { DealType, RenderRequest } from "@/src/types";

export const runtime = "nodejs";

function bad(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function POST(req: Request) {
  let body: Partial<RenderRequest> & {
    headlineStyle?: string;
    photo?: string;
    photoUrl?: string;
  };
  try {
    body = await req.json();
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
  if (dealType === "TRADE" && !oldTeamAbbr) return bad("oldTeamAbbr is required for trades");

  const opts: PosterOptions = {
    headlineStyle: body.headlineStyle === "metallic" ? "metallic" : "team",
    photo: body.photo === "headshot" ? "headshot" : "action",
    photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null,
  };

  try {
    const png = await renderPoster(
      {
        playerName,
        headshotUrl: body.headshotUrl ?? null,
        oldTeamAbbr,
        newTeamAbbr,
        dealText,
        dealType,
      },
      opts,
    );
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
