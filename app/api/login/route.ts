import { NextResponse } from "next/server";
import { AUTH_COOKIE, safeEqual, tokenFor } from "@/middleware";

export const runtime = "nodejs";

interface Body {
  password?: string;
}

export async function POST(req: Request) {
  const configured = process.env.APP_PASSWORD;
  if (!configured) {
    return NextResponse.json({ error: "No password is configured." }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supplied = (body.password ?? "").trim();
  // Compare derived tokens rather than the raw strings so the check is
  // fixed-length regardless of what was submitted.
  const ok = safeEqual(await tokenFor(supplied), await tokenFor(configured));
  if (!ok) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: AUTH_COOKIE,
    value: await tokenFor(configured),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
