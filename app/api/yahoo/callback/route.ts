import { NextResponse } from "next/server";
import { exchangeCode, saveRefreshToken } from "@/src/fantasy/yahoo";

export const runtime = "nodejs";

/**
 * Yahoo redirects here after consent. Stores the refresh token in Postgres so
 * the user never has to copy a token by hand, then shows a plain confirmation.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const expected = req.headers
    .get("cookie")
    ?.match(/yahoo_oauth_state=([^;]+)/)?.[1];

  const page = (title: string, body: string, ok: boolean) =>
    new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>${title}</title>
       <body style="font-family:system-ui;background:#0f0f11;color:#f2f2f5;padding:48px;line-height:1.6">
       <h1 style="color:${ok ? "#D9FC07" : "#ff6b6b"}">${title}</h1>
       <p>${body}</p>
       <p><a style="color:#F22E45" href="/fantasy">Back to Fantasy Hockey</a></p></body>`,
      { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

  if (error) return page("Yahoo declined", `Yahoo returned: ${error}`, false);
  if (!code) return page("Missing code", "Yahoo did not return an authorization code.", false);
  if (expected && state && expected !== state) {
    return page("State mismatch", "The request could not be verified. Please try again.", false);
  }

  try {
    const refresh = await exchangeCode(code, url.origin);
    await saveRefreshToken(refresh);
    return page(
      "Yahoo connected",
      "Ownership percentages will now come from Yahoo. You can close this tab.",
      true,
    );
  } catch (e) {
    return page("Connection failed", (e as Error).message, false);
  }
}
