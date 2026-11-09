import {
  actionShotUrl,
  getPlayerDetail,
  getWeekProduction,
  refineExactStats,
} from "@/src/fantasy/nhl";
import { getInjuries } from "@/src/fantasy/injuries";
import { getFeaturedStore, RECENCY_DAYS } from "@/src/fantasy/featured";
import {
  fixtureOwnership,
  getOwnershipProvider,
  type OwnershipProvider,
} from "@/src/fantasy/ownership";
import { positionLabel } from "@/src/fantasy/scoring";
import { MAX_PER_GROUP, PICK, pickWithDiversity } from "@/src/fantasy/diversity";
import { DROP_TIERS, dropCandidates, pickDrops, type DropTier } from "@/src/fantasy/drops";
import type { Finalist, PlayerWeek, PosGroup, SelectionResult } from "@/src/fantasy/types";

export const OWNERSHIP_CEILING = 50; // "under-rostered" threshold

const TOP_POOL = 15; // spec: top 15 by fantasy points feeds the Stars pick
const SLEEPER_POOL = 60; // wider pool to score under-rostered candidates from
const REFINE_POOL = 90; // players whose PP points are looked up exactly

/**
 * Team caps per set of 3.
 *
 * Without these, one hot team takes over: a real week produced three Rangers in
 * Sleepers plus a Ranger leading Stars -- four of six players from one club.
 * The data was right, but it reads as though the tool wasn't paying attention.
 * Stars is stricter (1) because it is the headline post.
 */
const MAX_PER_TEAM = { stars: 1, sleepers: 2 } as const;

/** "B. Brink" -> "b brink"; also built from ("Brandon","Brink"). */
function initialKey(shortName: string): string {
  const clean = shortName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\./g, "")
    .toLowerCase()
    .trim();
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return clean;
  return `${parts[0][0]} ${parts.slice(1).join(" ")}`;
}
function initialKeyFromFull(first: string, last: string): string {
  return initialKey(`${first?.[0] ?? ""}. ${last}`);
}

function normalize(v: number, min: number, max: number): number {
  if (max <= min) return 50;
  return ((v - min) / (max - min)) * 100;
}

function shiftDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

function describeTier(t: DropTier): string {
  return `${t.minOwn}%+ rostered, skaters ≤${t.skaterBar} and goalies ≤${t.goalieBar} fantasy points per game`;
}

async function enrich(
  p: PlayerWeek,
  ownership: number | null,
): Promise<Finalist> {
  const d = await getPlayerDetail(p.playerId);
  const first = d?.firstName || p.shortName.split(" ")[0].replace(".", "");
  const last = d?.lastName || p.shortName.split(" ").slice(1).join(" ");
  return {
    ...p,
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`.trim(),
    positionLabel: positionLabel(d?.position ?? p.position),
    headshotUrl: d?.headshotUrl ?? null,
    actionShotUrl: actionShotUrl(p.playerId),
    ownership,
  };
}

export interface SelectOptions {
  /** Last day of the 7-day window (YYYY-MM-DD). */
  endDate: string;
  /** Minimum games in the window to be eligible. */
  minGames?: number;
  /** Skip the "featured recently" filter (useful when experimenting). */
  ignoreRecency?: boolean;
  ownershipProvider?: OwnershipProvider;
  /**
   * Opt in to placeholder ownership for previewing what Sleeper cards look like.
   * OFF by default: without real Yahoo data the Sleepers set is withheld rather
   * than published with invented percentages.
   */
  allowPlaceholderOwnership?: boolean;
}

export async function selectPlayers(opts: SelectOptions): Promise<SelectionResult> {
  const minGames = opts.minGames ?? 1;
  const warnings: string[] = [];

  const { players, window, gamesCounted } = await getWeekProduction(opts.endDate);
  if (!gamesCounted) {
    return {
      stars: [],
      sleepers: [],
      drops: [],
      dropWindow: window,
      window,
      warnings: [
        `No completed NHL games between ${window.from} and ${window.to}. ` +
          `Pick a date inside a season (e.g. 2026-03-15) to preview with real data.`,
      ],
    };
  }

  const eligible = players.filter((p) => p.games >= minGames);

  // --- filters that apply to both lists ---
  const injuries = await getInjuries();
  if (!injuries.available) {
    const why =
      injuries.reason === "no-key"
        ? "ROTOWIRE_API_KEY is not set"
        : `injury feed ${injuries.reason}${injuries.detail ? ` (${injuries.detail})` : ""}`;
    warnings.push(`Injury filter skipped — ${why}. Injured players may appear.`);
  }
  const store = getFeaturedStore();
  const recent = opts.ignoreRecency
    ? new Set<string>()
    : await store.recentIds(RECENCY_DAYS);
  if (!store.persistent) {
    warnings.push(
      "Featured history is using the dev file store — it will not persist on Vercel until Postgres is connected.",
    );
  }

  const passes = (p: PlayerWeek) =>
    !injuries.unavailable.has(initialKey(p.shortName)) && !recent.has(p.playerId);

  // Box scores carry neither PP assists nor shutouts. Rank once using PP goals
  // as a stand-in, then read exact power-play points (skaters) and shutouts
  // (goalies) from the game logs of the plausible contenders and re-rank. Both
  // matter here: a PP assist is worth 6 (4 assist + 2 PPP) and a shutout 5.
  const shortlist = [...eligible]
    .sort((a, b) => b.fantasyPoints - a.fantasyPoints)
    .slice(0, REFINE_POOL);
  await refineExactStats(shortlist, window);

  const byFp = [...eligible].sort((a, b) => b.fantasyPoints - a.fantasyPoints);

  // ---------- Three Stars: top 15 by fantasy points ----------
  const starPool = byFp.slice(0, TOP_POOL).filter(passes);
  const starPick = pickWithDiversity(starPool, PICK, MAX_PER_GROUP, MAX_PER_TEAM.stars);
  if (starPick.relaxedTeam) {
    warnings.push("Stars: one-per-team cap relaxed to fill three players.");
  }
  if (starPick.relaxed) {
    warnings.push("Stars: position-diversity cap relaxed to fill three players.");
  }
  if (starPick.picked.length < PICK) {
    warnings.push(
      `Stars: only ${starPick.picked.length} of ${PICK} players passed the filters.`,
    );
  }
  const starIds = new Set(starPick.picked.map((p) => p.playerId));

  // ---------- Sleepers: under-rostered, combined score ----------
  let provider: OwnershipProvider | null = opts.ownershipProvider ?? null;
  if (!provider) {
    const auto = await getOwnershipProvider();
    provider = auto.isReal
      ? auto
      : opts.allowPlaceholderOwnership
        ? fixtureOwnership
        : null;
  }
  const sleeperPoolRaw = byFp
    .slice(0, SLEEPER_POOL)
    .filter((p) => passes(p) && !starIds.has(p.playerId));

  let ownershipMap = new Map<string, number>();
  if (!provider) {
    // Sleepers are withheld until real ownership data exists -- publishing a
    // fabricated "% rostered" under the RotoWire brand is not acceptable.
    warnings.push(
      "Sleepers withheld — real ownership data is unavailable (Yahoo Fantasy API access is pending approval). Three Stars is unaffected.",
    );
  }
  try {
    if (provider) ownershipMap = await provider.get(
      sleeperPoolRaw.map((p) => ({
        playerId: p.playerId,
        shortName: p.shortName,
        teamAbbr: p.teamAbbr,
      })),
    );
  } catch (e) {
    warnings.push(`Ownership unavailable (${(e as Error).message}). Sleepers skipped.`);
  }
  if (provider && !provider.isReal) {
    warnings.push(
      "Ownership figures are PLACEHOLDERS (preview mode) — do not publish these numbers.",
    );
  } else if (provider && ownershipMap.size < sleeperPoolRaw.length / 2) {
    warnings.push(
      `Yahoo ownership matched only ${ownershipMap.size} of ${sleeperPoolRaw.length} candidates — some names may not have matched.`,
    );
  }

  const under = sleeperPoolRaw.filter((p) => {
    const own = ownershipMap.get(p.playerId);
    return own !== undefined && own < OWNERSHIP_CEILING;
  });

  let sleeperPick: { picked: PlayerWeek[]; relaxed: boolean; relaxedTeam: boolean } = {
    picked: [],
    relaxed: false,
    relaxedTeam: false,
  };
  if (under.length) {
    const fps = under.map((p) => p.fantasyPoints);
    const minFp = Math.min(...fps);
    const maxFp = Math.max(...fps);
    const gaps = under.map((p) => OWNERSHIP_CEILING - (ownershipMap.get(p.playerId) ?? 0));
    const minGap = Math.min(...gaps);
    const maxGap = Math.max(...gaps);
    // Both terms normalized to 0-100 first so the 70/30 split is honoured
    // (raw fantasy points and raw ownership gap live on different scales).
    const scored = under
      .map((p) => {
        const gap = OWNERSHIP_CEILING - (ownershipMap.get(p.playerId) ?? 0);
        const score =
          normalize(p.fantasyPoints, minFp, maxFp) * 0.7 +
          normalize(gap, minGap, maxGap) * 0.3;
        return { p, score };
      })
      .sort((a, b) => b.score - a.score || b.p.fantasyPoints - a.p.fantasyPoints)
      .map((s) => s.p);
    sleeperPick = pickWithDiversity(scored, PICK, MAX_PER_GROUP, MAX_PER_TEAM.sleepers);
    if (sleeperPick.relaxedTeam) {
      warnings.push("Sleepers: two-per-team cap relaxed to fill three players.");
    }
    if (sleeperPick.relaxed) {
      warnings.push("Sleepers: position-diversity cap relaxed to fill three players.");
    }
  } else if (ownershipMap.size) {
    warnings.push(`No candidates under ${OWNERSHIP_CEILING}% rostered.`);
  }

  // ---------- Time to Cut Bait: widely rostered players in a two-week slump ----------
  let dropFinalists: Finalist[] = [];
  let dropWindow = window;
  if (!provider || !provider.isReal) {
    warnings.push("Cut Bait withheld — real ownership data is unavailable.");
  } else {
    try {
      const prev = await getWeekProduction(shiftDays(opts.endDate, -7));
      dropWindow = { from: prev.window.from, to: window.to };
      const everyone = [...players, ...prev.players];
      const own = await provider.get(
        [...new Map(everyone.map((x) => [x.playerId, x])).values()].map((x) => ({
          playerId: x.playerId,
          shortName: x.shortName,
          teamAbbr: x.teamAbbr,
        })),
      );
      // Exact power-play points and shutouts, only for people who could actually qualify.
      const floor = Math.min(...DROP_TIERS.map((t) => t.minOwn));
      const toRefine = (ps: PlayerWeek[]) =>
        ps.filter((x) => !x.ppExact && (own.get(x.playerId) ?? 0) >= floor);
      await refineExactStats(toRefine(players), window);
      await refineExactStats(toRefine(prev.players), prev.window);

      const cands = dropCandidates(players, prev.players, own).filter((c) => passes(c.combined));
      const pick = pickDrops(cands);
      if (pick.picked.length < PICK) {
        warnings.push(
          `Cut Bait: only ${pick.picked.length} of ${PICK} players met even the loosest standard (${describeTier(pick.tier)}).`,
        );
      } else if (pick.tierIndex > 0) {
        warnings.push(
          `Cut Bait: the standard (${describeTier(DROP_TIERS[0])}) found too few players, so it was loosened to ${describeTier(pick.tier)}.`,
        );
      }
      if (pick.relaxedTeam) warnings.push("Cut Bait: one-per-team cap relaxed to fill three players.");
      if (pick.relaxed) warnings.push("Cut Bait: position-diversity cap relaxed to fill three players.");
      dropFinalists = await Promise.all(
        pick.picked.map(async (c) => ({ ...(await enrich(c.combined, c.own)), windowDays: 14 })),
      );
    } catch (e) {
      warnings.push(`Cut Bait skipped (${(e as Error).message}).`);
    }
  }

  // ---------- enrich only the finalists ----------
  const stars = await Promise.all(
    starPick.picked.map((p) => enrich(p, ownershipMap.get(p.playerId) ?? null)),
  );
  const sleepers = await Promise.all(
    sleeperPick.picked.map((p) => enrich(p, ownershipMap.get(p.playerId) ?? null)),
  );

  // Day-to-day players survived the filter; flag them so a human can judge.
  for (const f of [...stars, ...sleepers, ...dropFinalists]) {
    if (injuries.dayToDay.has(initialKeyFromFull(f.firstName, f.lastName))) {
      warnings.push(`${f.fullName} is listed day-to-day — verify before posting.`);
    }
  }

  return { stars, sleepers, drops: dropFinalists, dropWindow, window, warnings };
}
