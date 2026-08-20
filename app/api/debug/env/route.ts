import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostic: which expected environment variables can the RUNNING app see?
 *
 * Reports presence only -- never values, never partial values. Used to tell
 * "the variable is missing at runtime" apart from "the network call failed",
 * which the injury-filter warning previously conflated.
 */
const EXPECTED = [
  "ROTOWIRE_API_KEY",
  "CRON_SECRET",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "SLACK_BOT_TOKEN",
  "SLACK_CHANNEL_ID",
  "YAHOO_CLIENT_ID",
  "YAHOO_CLIENT_SECRET",
  "YAHOO_REFRESH_TOKEN",
] as const;

export async function GET() {
  const present: Record<string, boolean> = {};
  for (const name of EXPECTED) {
    present[name] = typeof process.env[name] === "string" && process.env[name] !== "";
  }
  // Names only, so we can spot typos/casing problems without exposing anything.
  const rotowireLike = Object.keys(process.env)
    .filter((k) => /roto|slack|yahoo|cron/i.test(k))
    .sort();

  return NextResponse.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    present,
    matchingNamesVisible: rotowireLike,
  });
}
