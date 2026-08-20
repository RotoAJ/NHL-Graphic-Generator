import { NextResponse } from "next/server";
import { getAuthUrl, redirectUri, yahooConfigured } from "@/src/fantasy/yahoo";

export const runtime = "nodejs";

/** Kicks off the Yahoo consent flow. Visit this once to connect. */
export async function GET(req: Request) {
  if (!yahooConfigured()) {
    return NextResponse.json(
      { error: "Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in Vercel first." },
      { status: 503 },
    );
  }
  const origin = new URL(req.url).origin;
  // Yahoo requires the redirect URI to match the app registration exactly.
  const state = Math.random().toString(36).slice(2);
  const res = NextResponse.redirect(getAuthUrl(origin, state));
  res.cookies.set("yahoo_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  res.headers.set("x-redirect-uri-used", redirectUri(origin));
  return res;
}
