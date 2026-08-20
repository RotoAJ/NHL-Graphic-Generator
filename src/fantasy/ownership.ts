// Ownership ("% rostered") provider.
//
// Behind an interface so the Yahoo implementation drops in without touching
// selection or rendering. Yahoo's league-wide `percent_owned` is the real source;
// the fixture keeps the tool demoable before Yahoo is connected.
import { fetchOwnershipByName, initialKey, isConnected, yahooConfigured } from "@/src/fantasy/yahoo";

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

export const yahooOwnership: OwnershipProvider = {
  name: "yahoo",
  isReal: true,
  async get(candidates) {
    const byName = await fetchOwnershipByName();
    const m = new Map<string, number>();
    for (const c of candidates) {
      const pct = byName.get(initialKey(c.shortName));
      if (typeof pct === "number") m.set(c.playerId, pct);
    }
    return m;
  },
};

/**
 * Yahoo when it's both configured and connected; otherwise the fixture.
 * Async because "connected" means a refresh token exists in the database.
 */
export async function getOwnershipProvider(): Promise<OwnershipProvider> {
  if (yahooConfigured() && (await isConnected())) return yahooOwnership;
  return fixtureOwnership;
}
