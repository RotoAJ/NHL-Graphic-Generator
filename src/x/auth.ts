// Shared request auth for the operational endpoints.
//
// The repo and the deployed app are both public, so anything that reports
// posting state has to be gated: the X status endpoint would otherwise tell any
// caller which account is wired up, whether posting is armed, and what X last
// complained about.
//
// Fails CLOSED in production. An unset CRON_SECRET is a convenience for local
// development only; in production a missing secret means "refuse", never
// "allow everyone".
/**
 * True when the caller is a signed-in operator (valid hub cookie).
 *
 * This exists so the status endpoint can be opened in a browser. CRON_SECRET is
 * stored as a Vercel secret and cannot be read back, so requiring it would mean
 * the person running this had no way to check their own credentials.
 */
export async function hubAuthorized(req: Request): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return false; // no gate configured -> no session to trust

  const raw = req.headers.get("cookie") ?? "";
  const match = raw.match(/(?:^|;\s*)hub_auth=([^;]+)/);
  if (!match) return false;

  const data = new TextEncoder().encode(`${password}|rotowire-nhl-hub|v1`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const expected = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return safeEqual(decodeURIComponent(match[1]), expected);
}

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const header = req.headers.get("x-cron-secret") ?? "";
  let qs = "";
  try {
    qs = new URL(req.url).searchParams.get("secret") ?? "";
  } catch {
    qs = "";
  }
  return bearer === secret || header === secret || qs === secret;
}
