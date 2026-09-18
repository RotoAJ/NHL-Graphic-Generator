// One-shot check that the X media-upload path actually works.
//
// Why this exists: /2/users/me is a plain GET, so a successful credential check
// proves very little. The posting path does something much harder -- an OAuth
// 1.0a signed multipart POST -- and a malformed signature base string is the
// usual way that fails. Without this, the first time that code ran would be
// unattended on a game night in October.
//
// Nothing is published. An uploaded media id is private until a post references
// it, and this never creates a post. The upload simply expires unused.
import { NextResponse } from "next/server";
import { createCanvas } from "@napi-rs/canvas";
import { cronAuthorized, hubAuthorized } from "@/src/x/auth";
import { credentialsFromEnv } from "@/src/x/oauth1";
import { uploadMedia } from "@/src/x/client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req) && !(await hubAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const creds = credentialsFromEnv();
  if (!creds) {
    return NextResponse.json(
      { error: "X credentials are not configured." },
      { status: 400 },
    );
  }

  // A small throwaway image; the content is irrelevant, the signature is not.
  const canvas = createCanvas(320, 180);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#002248";
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = "#F22E45";
  ctx.fillRect(20, 20, 280, 140);
  const png = canvas.toBuffer("image/png");

  const started = Date.now();
  try {
    const mediaId = await uploadMedia(png, creds);
    return NextResponse.json({
      ok: true,
      mediaId,
      bytes: png.length,
      ms: Date.now() - started,
      note:
        "Upload succeeded, so OAuth 1.0a signing and the media endpoint both work. " +
        "Nothing was published: an unused media id simply expires.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: (e as Error).message,
        ms: Date.now() - started,
        note: "The posting path would fail with this error. Nothing was published.",
      },
      { status: 502 },
    );
  }
}
