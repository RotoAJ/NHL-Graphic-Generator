import { TEAMS } from "@/src/teams";
import type { PlayerDataSource } from "@/src/datasource/types";
import type { PlayerDetail, PlayerSearchResult } from "@/src/types";

const API_BASE = process.env.NHL_API_BASE ?? "https://api-web.nhle.com";
const SEARCH_BASE = process.env.NHL_SEARCH_BASE ?? "https://search.d3.nhle.com";

// Shape of an entry returned by the NHL player search endpoint.
interface NhlSearchEntry {
  playerId: string;
  name: string;
  teamAbbrev?: string;
  lastTeamAbbrev?: string;
  positionCode?: string;
  active?: boolean;
}

// Shape of the api-web team roster payload.
interface RosterPlayer {
  id: number;
  firstName?: { default?: string };
  lastName?: { default?: string };
  positionCode?: string;
}
interface RosterResponse {
  forwards?: RosterPlayer[];
  defensemen?: RosterPlayer[];
  goalies?: RosterPlayer[];
}

// Subset of the NHL player "landing" payload we rely on.
interface NhlLanding {
  playerId: number;
  firstName?: { default?: string };
  lastName?: { default?: string };
  currentTeamAbbrev?: string;
  isActive?: boolean;
  position?: string;
  headshot?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    // Browser-like headers: the NHL search host (search.d3.nhle.com) returns 503
    // to bare server requests (e.g. from Vercel). A realistic UA + Referer gets
    // through; harmless for the other NHL hosts.
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: "https://www.nhl.com/",
      Origin: "https://www.nhl.com",
    },
    // NHL data changes slowly; let Next cache briefly to stay responsive.
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`NHL API ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

// In-memory index of every current roster player, built from api-web (which,
// unlike search.d3.nhle.com, is reachable from Vercel). Cached per instance.
let rosterCache: PlayerSearchResult[] | null = null;
let rosterCacheAt = 0;
const ROSTER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function buildRosterIndex(): Promise<PlayerSearchResult[]> {
  const now = Date.now();
  if (rosterCache && now - rosterCacheAt < ROSTER_TTL_MS) return rosterCache;
  const lists = await Promise.all(
    TEAMS.map(async (t) => {
      try {
        const r = await fetchJson<RosterResponse>(
          `${API_BASE}/v1/roster/${t.abbr}/current`,
        );
        const players = [
          ...(r.forwards ?? []),
          ...(r.defensemen ?? []),
          ...(r.goalies ?? []),
        ];
        return players.map((p) => ({
          id: String(p.id),
          fullName: `${p.firstName?.default ?? ""} ${p.lastName?.default ?? ""}`.trim(),
          teamAbbr: t.abbr,
          lastTeamAbbr: t.abbr,
          positionCode: p.positionCode ?? null,
        }));
      } catch {
        return [] as PlayerSearchResult[];
      }
    }),
  );
  const flat = lists.flat();
  // Only cache a successful (non-empty) build.
  if (flat.length) {
    rosterCache = flat;
    rosterCacheAt = now;
  }
  return flat;
}

async function searchD3(q: string): Promise<PlayerSearchResult[]> {
  const url =
    `${SEARCH_BASE}/api/v1/search/player` +
    `?culture=en-us&limit=20&active=true&q=${encodeURIComponent(q)}`;
  const entries = await fetchJson<NhlSearchEntry[]>(url);
  return entries.map((e) => ({
    id: String(e.playerId),
    fullName: e.name,
    teamAbbr: e.teamAbbrev?.trim() || null,
    lastTeamAbbr: e.lastTeamAbbrev?.trim() || null,
    positionCode: e.positionCode ?? null,
  }));
}

export const nhlDataSource: PlayerDataSource = {
  async search(query: string): Promise<PlayerSearchResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    // Primary: roster index via api-web (works from Vercel). search.d3 is only
    // a last resort because it 503s for datacenter IPs.
    try {
      const idx = await buildRosterIndex();
      const needle = q.toLowerCase();
      const hits = idx
        .filter((p) => p.fullName.toLowerCase().includes(needle))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .slice(0, 20);
      if (hits.length) return hits;
    } catch {
      // fall through
    }
    try {
      return await searchD3(q);
    } catch {
      return [];
    }
  },

  async getPlayer(id: string): Promise<PlayerDetail | null> {
    const url = `${API_BASE}/v1/player/${encodeURIComponent(id)}/landing`;
    let data: NhlLanding;
    try {
      data = await fetchJson<NhlLanding>(url);
    } catch {
      return null;
    }
    const fullName = [data.firstName?.default, data.lastName?.default]
      .filter(Boolean)
      .join(" ")
      .trim();
    return {
      id: String(data.playerId ?? id),
      fullName: fullName || "Unknown Player",
      teamAbbr: data.currentTeamAbbrev?.trim() || null,
      positionCode: data.position ?? null,
      headshotUrl: data.headshot ?? null,
    };
  },
};
