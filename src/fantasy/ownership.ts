// Ownership ("% rostered") provider.
//
// Behind an interface so the Yahoo implementation can drop in without touching
// selection or rendering -- the same pattern as the trade tool's PlayerDataSource.
//
// Yahoo's league-wide `percent_owned` is the real source. Until OAuth credentials
// exist we use a DETERMINISTIC stand-in so the tool is fully demoable and the same
// player always gets the same number (a random stand-in would reshuffle the
// Sleepers list on every refresh, which would look like a bug).

export interface OwnershipProvider {
  readonly name: string;
  readonly isReal: boolean;
  get(playerIds: string[]): Promise<Map<string, number>>;
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
  async get(playerIds) {
    const m = new Map<string, number>();
    for (const id of playerIds) {
      // Spread across 2-98% so both the <50% filter and the >50% side are exercised.
      m.set(id, Math.round(2 + hash01(id) * 96));
    }
    return m;
  },
};

/** Placeholder for the Yahoo implementation (PRD milestone 6). */
export const yahooOwnership: OwnershipProvider = {
  name: "yahoo",
  isReal: true,
  async get() {
    throw new Error(
      "Yahoo ownership not configured. Set YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET / " +
        "YAHOO_REFRESH_TOKEN, or run with the fixture provider.",
    );
  },
};

export function getOwnershipProvider(): OwnershipProvider {
  const configured =
    process.env.YAHOO_CLIENT_ID &&
    process.env.YAHOO_CLIENT_SECRET &&
    process.env.YAHOO_REFRESH_TOKEN;
  return configured ? yahooOwnership : fixtureOwnership;
}
