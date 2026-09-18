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
