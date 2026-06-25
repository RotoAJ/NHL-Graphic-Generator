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

export const nhlDataSource: PlayerDataSource = {
  async search(query: string): Promise<PlayerSearchResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];
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
