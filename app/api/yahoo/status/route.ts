import { NextResponse } from "next/server";
import {
  discoverLeagueKey,
  fetchOwnershipByName,
  isConnected,
  LEAGUE_ID,
  listLeagueKeys,
  redirectUri,
  yahooConfigured,
} from "@/src/fantasy/yahoo";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Diagnostic: is Yahoo usable, and can we see league 67213? No secrets returned. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const out: Record<string, unknown> = {
    configured: yahooConfigured(),
    connected: await isConnected(),
    leagueId: LEAGUE_ID,
    redirectUriToRegister: redirectUri(origin),
    connectUrl: `${origin}/api/yahoo/auth`,
  };
  if (!out.configured || !out.connected) return NextResponse.json(out);

  try {
    out.leagueKey = await discoverLeagueKey();
  } catch (e) {
    out.leagueError = (e as Error).message;
    try {
      out.visibleLeagues = await listLeagueKeys();
    } catch {
      /* ignore */
    }
    return NextResponse.json(out);
  }
  try {
    const map = await fetchOwnershipByName();
    out.ownershipPlayers = map.size;
    out.sample = [...map.entries()].slice(0, 5).map(([k, v]) => `${k}: ${v}%`);
  } catch (e) {
    out.ownershipError = (e as Error).message;
  }
  return NextResponse.json(out);
}
