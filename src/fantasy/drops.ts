// "Time to Cut Bait" -- widely rostered players who have been bad for TWO weeks.
//
// Pure functions only (no network), so the rules can be tested and backtested.
//
// Rules, as agreed with AJ:
//   - rostered by a lot of people (Yahoo %), tiered so the list can loosen to reach 3 players;
//   - a TWO-WEEK slump, not one bad week: the 14-day fantasy points per game must be low AND neither
//     week may have been a rebound;
//   - skaters need real playing time in both weeks (a light schedule is not a slump);
//   - goalies need to have actually started (two or more games) and every week they played must be bad,
//     so one rough start never makes the list.
import { fantasyPoints } from "@/src/fantasy/scoring";
import { MAX_PER_GROUP, PICK, pickWithDiversity } from "@/src/fantasy/diversity";
import type { PlayerWeek } from "@/src/fantasy/types";

export interface DropTier {
  /** Minimum % rostered. */
  minOwn: number;
  /** Highest 14-day fantasy points per game for a skater. */
  skaterBar: number;
  /** Highest 14-day fantasy points per game for a goalie. */
  goalieBar: number;
}

/**
 * Tried in order until three players can be picked. The first tier is the real standard; the later ones
 * only loosen it as far as needed, and the caller is told which tier was used.
 */
export const DROP_TIERS: DropTier[] = [
  { minOwn: 90, skaterBar: 4, goalieBar: 4 },
  { minOwn: 90, skaterBar: 5, goalieBar: 5 },
  { minOwn: 80, skaterBar: 4, goalieBar: 4 },
  { minOwn: 80, skaterBar: 5, goalieBar: 5 },
  { minOwn: 70, skaterBar: 5, goalieBar: 5 },
];

/** Every individual week must also be below this multiple of the bar, so a rebound week disqualifies. */
export const WEEK_CAP_FACTOR = 1.5;
/** Skaters: games needed in EACH week, and in total. */
export const MIN_SKATER_GAMES_PER_WEEK = 2;
export const MIN_SKATER_GAMES_TOTAL = 6;
/** Goalies: games over the two weeks, and average minutes per game (filters out relief appearances). */
export const MIN_GOALIE_GAMES = 2;
export const MIN_GOALIE_AVG_TOI = 2400; // seconds

export interface DropCandidate {
  /** Both weeks summed; this is what the card and thread show. */
  combined: PlayerWeek;
  cur: PlayerWeek | null;
  prev: PlayerWeek | null;
  own: number;
  /** Fantasy points per game over the two weeks. */
  fpg: number;
}

const SUM_KEYS = [
  "games", "goals", "assists", "points", "sog", "hits", "blocks", "ppGoals", "ppPoints",
  "plusMinus", "wins", "saves", "goalsAgainst", "shutouts", "toiSeconds",
] as const;

export function combine(a: PlayerWeek | null, b: PlayerWeek | null): PlayerWeek {
  const base = a ?? b;
  if (!base) throw new Error("combine needs at least one week");
  const out: Omit<PlayerWeek, "fantasyPoints"> = { ...base };
  for (const k of SUM_KEYS) out[k] = (a?.[k] ?? 0) + (b?.[k] ?? 0);
  out.ppExact = (a?.ppExact ?? true) && (b?.ppExact ?? true);
  return { ...out, fantasyPoints: fantasyPoints(out) };
}

const fpg = (p: PlayerWeek | null): number | null => (p && p.games > 0 ? p.fantasyPoints / p.games : null);

/**
 * Everyone who played enough in the last two weeks to be judged and has a known ownership figure.
 * `ownership` is keyed by NHL player id.
 */
export function dropCandidates(
  cur: PlayerWeek[],
  prev: PlayerWeek[],
  ownership: Map<string, number>,
): DropCandidate[] {
  const curBy = new Map(cur.map((p) => [p.playerId, p]));
  const prevBy = new Map(prev.map((p) => [p.playerId, p]));
  const out: DropCandidate[] = [];
  for (const id of new Set([...curBy.keys(), ...prevBy.keys()])) {
    const own = ownership.get(id);
    if (own === undefined) continue;
    const c = curBy.get(id) ?? null;
    const p = prevBy.get(id) ?? null;
    const combined = combine(c, p);
    if (combined.posGroup === "G") {
      // Played in BOTH weeks: one rough start, or a goalie who only returned this week, is not a slump.
      if (!c || !p || combined.games < MIN_GOALIE_GAMES) continue;
      if (combined.toiSeconds / combined.games < MIN_GOALIE_AVG_TOI) continue;
    } else {
      if ((c?.games ?? 0) < MIN_SKATER_GAMES_PER_WEEK) continue;
      if ((p?.games ?? 0) < MIN_SKATER_GAMES_PER_WEEK) continue;
      if (combined.games < MIN_SKATER_GAMES_TOTAL) continue;
    }
    out.push({ combined, cur: c, prev: p, own, fpg: combined.fantasyPoints / combined.games });
  }
  return out;
}

export function qualifies(c: DropCandidate, tier: DropTier): boolean {
  if (c.own < tier.minOwn) return false;
  const bar = c.combined.posGroup === "G" ? tier.goalieBar : tier.skaterBar;
  if (c.fpg > bar) return false;
  // Every week they actually played must be bad too -- a big rebound week means the slump is over.
  for (const w of [fpg(c.cur), fpg(c.prev)]) {
    if (w !== null && w > bar * WEEK_CAP_FACTOR) return false;
  }
  return true;
}

export interface DropPick {
  picked: DropCandidate[];
  /** Index into `tiers` of the tier that finally produced the picks. */
  tierIndex: number;
  tier: DropTier;
  relaxed: boolean;
  relaxedTeam: boolean;
}

/** Walk the tiers until three players can be picked; if none can, return the loosest tier's best. */
export function pickDrops(
  cands: DropCandidate[],
  tiers: DropTier[] = DROP_TIERS,
  n = PICK,
): DropPick {
  let last: DropPick | null = null;
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const pool = cands
      .filter((c) => qualifies(c, tier))
      // Worst first; among equals the one more people are holding goes first.
      .sort((a, b) => a.fpg - b.fpg || b.own - a.own);
    const byPlayer = new Map(pool.map((c) => [c.combined.playerId, c]));
    const r = pickWithDiversity(pool.map((c) => c.combined), n, MAX_PER_GROUP, 1);
    last = {
      picked: r.picked.map((p) => byPlayer.get(p.playerId)!),
      tierIndex: i,
      tier,
      relaxed: r.relaxed,
      relaxedTeam: r.relaxedTeam,
    };
    if (r.picked.length >= n) return last;
  }
  return last ?? { picked: [], tierIndex: -1, tier: tiers[0], relaxed: false, relaxedTeam: false };
}
