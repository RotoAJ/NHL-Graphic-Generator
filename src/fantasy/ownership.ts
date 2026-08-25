// Ownership ("% rostered") provider.
//
// Behind an interface so the Yahoo implementation drops in without touching
// selection or rendering. Yahoo's league-wide `percent_owned` is the real source;
// the fixture keeps the tool demoable before Yahoo is connected.
import {
  fetchOwnershipByName as fetchOAuthOwnership,
  initialKey as oauthInitialKey,
  isConnected,
  yahooConfigured,
} from "@/src/fantasy/yahoo";
import {
  fetchOwnershipByName as fetchPublicOwnership,
  initialKey,
} from "@/src/fantasy/yahooPublic";

/**
 * Candidates carry the box-score name because Yahoo returns names, not NHL ids.
 * Matching is "first-initial + surname", the same approach the injury filter uses.
 */
export interface OwnershipCandidate {
  playerId: string;
  shortName: string;
  teamAbbr: string;
}

export interface OwnershipProvider {
  readonly name: string;
  readonly isReal: boolean;
  /** Returns playerId -> percent owned. Missing entries simply aren't included. */
  get(candidates: OwnershipCandidate[]): Promise<Map<string, number>>;
}

/** Stable hash -> 0..1 */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export const fixtureOwnership: OwnershipProvider = {
  name: "fixture",
  isReal: false,
  async get(candidates) {
    const m = new Map<string, number>();
    for (const c of candidates) {
      // Deterministic so the Sleepers list doesn't reshuffle on every refresh.
      m.set(c.playerId, Math.round(2 + hash01(c.playerId) * 96));
    }
    return m;
  },
};

/**
 * PRIMARY provider: Yahoo's public read-only host. Needs no OAuth, no developer
 * app and no approval, and returns the same league-wide percent_owned.
 */
export const yahooPublicOwnership: OwnershipProvider = {
  name: "yahoo-public",
  isReal: true,
  async get(candidates) {
    const byName = await fetchPublicOwnership();
    const m = new Map<string, number>();
    for (const c of candidates) {
      const pct = byName.get(initialKey(c.shortName));
      if (typeof pct === "number") m.set(c.playerId, pct);
    }
    return m;
  },
};

/** OAuth variant, kept as a fallback if the public host ever changes. */
export const yahooOwnership: OwnershipProvider = {
  name: "yahoo-oauth",
  isReal: true,
  async get(candidates) {
    const byName = await fetchOAuthOwnership();
    const m = new Map<string, number>();
    for (const c of candidates) {
      const pct = byName.get(oauthInitialKey(c.shortName));
      if (typeof pct === "number") m.set(c.playerId, pct);
    }
    return m;
  },
};

/**
 * The public host is the default because it needs no setup at all. The OAuth
 * path is only preferred when explicitly configured AND connected, in case we
 * ever want league-specific figures instead of league-wide.
 */
export async function getOwnershipProvider(): Promise<OwnershipProvider> {
  if (process.env.YAHOO_PREFER_OAUTH === "1" && yahooConfigured() && (await isConnected())) {
    return yahooOwnership;
  }
  return yahooPublicOwnership;
}
