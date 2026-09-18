// Shared-password gate for the hub.
//
// The deployment is public, so without this anyone with the URL can drive the
// generators and burn the RotoWire API quota. APP_PASSWORD was documented in
// .env.example from the start but was never actually enforced anywhere.
//
// The gate is ACTIVE ONLY when APP_PASSWORD is set. That is deliberate: making
// it mandatory would lock everyone out of the deployment the moment this shipped,
// before the variable existed. Setting APP_PASSWORD turns it on.
//
// The cookie never contains the password -- it holds a SHA-256 token derived
// from it, so a stolen cookie doesn't reveal the password itself. Middleware
// runs on the Edge runtime, so this uses Web Crypto rather than node:crypto.
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, safeEqual, tokenFor } from "@/src/auth/token";

/** Paths that must stay reachable without the password. */
function isExempt(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/login") ||
    // Called by GitHub Actions and already gated by CRON_SECRET.
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/x/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/logos/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next(); // gate not configured

  const { pathname, search } = req.nextUrl;
  if (isExempt(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value ?? "";
  const expected = await tokenFor(password);
  if (cookie && safeEqual(cookie, expected)) return NextResponse.next();

  // API calls get a status code; pages get the login form.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
