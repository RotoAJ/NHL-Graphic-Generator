// Yahoo Fantasy Sports integration -- league-wide "% rostered" (percent_owned).
//
// Design notes
// ------------
// * OAuth2. The refresh token is stored in Postgres by the callback route, so the
//   user never copies a token by hand; access tokens are cached in memory.
// * The league key is DISCOVERED, not guessed: game keys change every season, so
//   hardcoding one would silently break each October. We ask Yahoo which NHL
//   leagues the authenticated user is in and match league id 67213.
// * Yahoo returns names, not NHL player ids, so ownership is matched on
//   "first-initial + surname" -- the same trick the injury filter uses.
import { neon } from "@neondatabase/serverless";
import { connectionString, hasDatabase } from "@/src/fantasy/db";

const AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const API = "https://fantasysports.yahooapis.com/fantasy/v2";
const SCOPE = "fspt-r"; // Fantasy Sports, read-only
export const LEAGUE_ID = process.env.YAHOO_LEAGUE_ID ?? "67213";

export function yahooConfigured(): boolean {
  return !!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET);
}

export function redirectUri(origin: string): string {
  return process.env.YAHOO_REDIRECT_URI ?? `${origin}/api/yahoo/callback`;
}

export function getAuthUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.YAHOO_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${p}`;
}

// ---------- refresh-token storage ----------

let migrated = false;
async function ensureSchema(): Promise<void> {
  if (migrated || !hasDatabase()) return;
  const sql = neon(connectionString()!);
  await sql`
    CREATE TABLE IF NOT EXISTS yahoo_tokens (
      id            INT PRIMARY KEY DEFAULT 1,
      refresh_token TEXT NOT NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT yahoo_tokens_single_row CHECK (id = 1)
    )
  `;
  migrated = true;
}

export async function saveRefreshToken(token: string): Promise<void> {
  if (!hasDatabase()) throw new Error("No database configured to store the Yahoo token");
  await ensureSchema();
  const sql = neon(connectionString()!);
  await sql`
    INSERT INTO yahoo_tokens (id, refresh_token) VALUES (1, ${token})
    ON CONFLICT (id) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, updated_at = now()
  `;
}

async function loadRefreshToken(): Promise<string | null> {
  // An env var wins, so the token can also be supplied manually if preferred.
  if (process.env.YAHOO_REFRESH_TOKEN) return process.env.YAHOO_REFRESH_TOKEN;
  if (!hasDatabase()) return null;
  await ensureSchema();
  const sql = neon(connectionString()!);
  const rows = (await sql`SELECT refresh_token FROM yahoo_tokens WHERE id = 1`) as Array<{
    refresh_token: string;
  }>;
  return rows[0]?.refresh_token ?? null;
}

export async function isConnected(): Promise<boolean> {
  try {
    return !!(await loadRefreshToken());
  } catch {
    return false;
  }
}

// ---------- tokens ----------

function basicAuth(): string {
  const id = process.env.YAHOO_CLIENT_ID ?? "";
  const secret = process.env.YAHOO_CLIENT_SECRET ?? "";
  return Buffer.from(`${id}:${secret}`).toString("base64");
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Exchange an authorization code for tokens; returns the refresh token. */
export async function exchangeCode(code: string, origin: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: redirectUri(origin),
    code,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const j = (await res.json()) as TokenResponse;
  if (!res.ok || !j.refresh_token) {
    throw new Error(
      `Yahoo token exchange failed: ${j.error_description ?? j.error ?? res.status}`,
    );
  }
  return j.refresh_token;
}

let cachedAccess: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedAccess && cachedAccess.expiresAt > Date.now() + 60_000) {
    return cachedAccess.token;
  }
  const refresh = await loadRefreshToken();
  if (!refresh) throw new Error("Yahoo is not connected (no refresh token stored)");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  const j = (await res.json()) as TokenResponse;
  if (!res.ok || !j.access_token) {
    throw new Error(
      `Yahoo token refresh failed: ${j.error_description ?? j.error ?? res.status}`,
    );
  }
  cachedAccess = {
    token: j.access_token,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  return cachedAccess.token;
}

async function apiGet(path: string): Promise<unknown> {
  const token = await accessToken();
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}format=json`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Yahoo API ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

// ---------- league discovery ----------

/**
 * Yahoo's JSON is deeply nested and positional. Rather than model it, walk the
 * whole structure collecting anything that looks like what we need -- far more
 * robust to their shape changing between endpoints.
 */
function collect(node: unknown, want: string, out: unknown[] = []): unknown[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const v of node) collect(v, want, out);
    return out;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === want) out.push(v);
    collect(v, want, out);
  }
  return out;
}

let cachedLeagueKey: string | null = null;

/** Find the league key for LEAGUE_ID among the user's NHL leagues. */
export async function discoverLeagueKey(): Promise<string> {
  if (cachedLeagueKey) return cachedLeagueKey;
  const data = await apiGet("/users;use_login=1/games;game_codes=nhl/leagues");
  const keys = collect(data, "league_key")
    .filter((k): k is string => typeof k === "string")
    .filter((k) => k.endsWith(`.l.${LEAGUE_ID}`));
  if (!keys.length) {
    const all = collect(data, "league_key").filter((k): k is string => typeof k === "string");
    throw new Error(
      `League ${LEAGUE_ID} not found for this Yahoo account. Leagues visible: ${
        all.length ? all.join(", ") : "(none)"
      }`,
    );
  }
  cachedLeagueKey = keys[0];
  return cachedLeagueKey;
}

/** All NHL league keys visible to the account (for diagnostics). */
export async function listLeagueKeys(): Promise<string[]> {
  const data = await apiGet("/users;use_login=1/games;game_codes=nhl/leagues");
  return collect(data, "league_key").filter((k): k is string => typeof k === "string");
}

// ---------- ownership ----------

/** "Brandon Brink" -> "b brink"; "B. Brink" -> "b brink" */
export function initialKey(name: string): string {
  const clean = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\./g, "")
    .replace(/[^A-Za-z\s'-]/g, "")
    .toLowerCase()
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return clean;
  return `${parts[0][0]} ${parts.slice(1).join(" ")}`;
}

let ownershipCache: { at: number; map: Map<string, number> } | null = null;
const OWNERSHIP_TTL = 6 * 60 * 60 * 1000;

/**
 * Build a name -> percent_owned map for the league's player pool.
 * Yahoo pages 25 at a time; we walk enough pages to cover everyone relevant.
 */
export async function fetchOwnershipByName(maxPlayers = 600): Promise<Map<string, number>> {
  if (ownershipCache && Date.now() - ownershipCache.at < OWNERSHIP_TTL) {
    return ownershipCache.map;
  }
  const leagueKey = await discoverLeagueKey();
  const map = new Map<string, number>();

  for (let start = 0; start < maxPlayers; start += 25) {
    const data = await apiGet(
      `/league/${leagueKey}/players;sort=AR;start=${start};count=25/percent_owned`,
    );
    // Names and ownership values appear in parallel positions in the payload;
    // collect both and pair by order within each player object.
    const players = collect(data, "player");
    let added = 0;
    for (const p of players) {
      const fullNames = collect(p, "full").filter((v): v is string => typeof v === "string");
      const pcts = collect(p, "value")
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100);
      if (!fullNames.length || !pcts.length) continue;
      const key = initialKey(fullNames[0]);
      if (!map.has(key)) {
        map.set(key, pcts[0]);
        added++;
      }
    }
    if (added === 0) break; // no more useful pages
  }

  ownershipCache = { at: Date.now(), map };
  return map;
}
