// Mon/Wed/Fri NHL rankings update -- the rules engine.
//
// A faithful port of the "nhl-rankings-monwedfri-update" skill's Steps 1 and 4-7.
// It is a PURE function: no network, no database, no clock. Everything it needs is
// passed in, which is what makes every rule testable in isolation, and the same
// input always yields the same output. That determinism is the point of moving
// this out of a language model, which was doing this arithmetic over ~350 rows
// every run.
//
// Deliberately self-contained (no imports) so it can be exercised directly by a
// test script without any build tooling.

// ---------------------------------------------------------------- constants

/** Rules lifted from the skill. Kept together so retuning is a one-place edit. */
export const RULES = {
  rosterCap: 350,
  insertionCapPerRun: 15,
  floorOffset: 15, // conservative_floor = N - 15
  floorWeight: 0.75,
  statRankWeight: 0.25,
  debutBackstop: 100, // first appearance may not rank better than N - 100
  hotSkaterPoints: 3,
  hotGoalieSavePct: 0.93,
  gamesFloorFraction: 0.4,
  gamesFloorMin: 2,
  injuryBasePct: 0.02,
  injuryPerWeekPct: 0.01,
  injuryMaxPct: 0.15,
  prodSkaterPerPoint: 0.01,
  prodCap: 0.04,
  tiTopForward: 18,
  tiTopDefense: 22,
  tiBottom: 12,
  tiBonus: 0.005,
  goalieWin: 0.015,
  goalieLoss: 0.01,
  goalieShutout: 0.01,
  goalieSaveHigh: 0.92,
  goalieSaveHighBonus: 0.01,
  goalieSaveLow: 0.89,
  goalieSaveLowPenalty: 0.015,
  seasonEnd: "2027-04-10",
} as const;

// -------------------------------------------------------------------- types

export interface RankRow {
  statsId: string;
  player: string;
  team: string;
  positions: string;
  injury: string;
}

/** Production over the window being processed ("since last run"). */
export interface Prod {
  games: number;
  points: number;
  toiSec: number;
  wins: number;
  losses: number; // regulation losses only -- matches ESPN's "losses"
  saves: number;
  shotsAgainst: number;
  shutouts: number;
}

/** One NHL player's season line plus this window's production. */
export interface PoolEntry {
  nhlId: number;
  statsId: string | null; // RotoWire id; null when it could not be resolved
  name: string; // RotoWire's spelling when resolved, so new rows match the file
  team: string; // in the rankings file's team-code convention
  positions: string;
  isGoalie: boolean;
  seasonGames: number;
  seasonPoints: number;
  seasonGoals: number;
  seasonWins: number;
  teamGames: number;
  delta: Prod | null;
}

export interface InjuryEntry {
  type: string;
  status: string;
  returnDate: string | null; // ISO date
}

/** A fix for a row already on the file: where it disagrees with the authoritative source. */
export interface Correction {
  team?: string;
  name?: string;
}

export interface EngineInput {
  rows: RankRow[];
  pool: PoolEntry[];
  injuries: Map<string, InjuryEntry>;
  /**
   * Corrections keyed by Stats ID: a traded player's new team (from the NHL's own
   * rosters) and RotoWire's spelling of a name. The skill never updated either,
   * so a trade left a stale team on the file indefinitely.
   */
  corrections?: Map<string, Correction>;
  /** Today in US Eastern, ISO (YYYY-MM-DD). */
  today: string;
  /** First day of the window being processed, ISO. */
  windowFrom: string;
}

export interface Mover {
  player: string;
  from: number;
  to: number;
  reason: string;
}

export interface Changelog {
  startCount: number;
  endCount: number;
  corrections: Array<{ player: string; field: "team" | "name"; from: string; to: string }>;
  removed: Array<{ player: string; reason: string }>;
  added: Array<{
    player: string;
    team: string;
    statsId: string;
    signal: string;
    statRank: number;
    insertionRank: number;
  }>;
  heldNoId: Array<{ player: string; signal: string }>;
  heldByCap: { count: number; names: string[] };
  droppedCap: Array<{ player: string; fellFrom: number }>;
  injuryPenalties: Array<{ player: string; pct: number; returnDate: string | null; daysOut: number | null }>;
  injuryHeldUnchanged: number;
  injuryCleared: number;
  contradictions: string[];
  unmatchedProduction: Array<{ name: string; team: string; games: number }>;
  movers: { up: Mover[]; down: Mover[] };
  notes: string[];
}

// ------------------------------------------------------------------ helpers

/** Accepts ISO, "ISO hh:mm:ss", or M/D/YYYY (the formats a hand-kept file might hold). */
export function parseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso);
}

/** The injury field stores "status,body part,return date"; the date is last. */
export function storedReturnDate(injury: string): string | null {
  if (!injury.trim()) return null;
  const parts = injury.split(",");
  return parseDate(parts[parts.length - 1]);
}

function isGoalieRow(positions: string): boolean {
  return positions.split(/[\/,\s]+/).includes("G");
}

function isDefense(positions: string): boolean {
  return positions.split(/[\/,\s]+/).includes("D");
}

function savePct(p: Prod): number | null {
  return p.shotsAgainst > 0 ? p.saves / p.shotsAgainst : null;
}

/** Production adjustment as a fraction, e.g. 0.03 for +3%. Zero if no games. */
export function productionPct(p: Prod | undefined, positions: string): number {
  if (!p || p.games <= 0) return 0;
  const cap = (v: number) => Math.max(-RULES.prodCap, Math.min(RULES.prodCap, v));

  if (isGoalieRow(positions)) {
    let pct = p.wins * RULES.goalieWin - p.losses * RULES.goalieLoss + p.shutouts * RULES.goalieShutout;
    const sv = savePct(p);
    if (sv !== null) {
      if (sv > RULES.goalieSaveHigh) pct += RULES.goalieSaveHighBonus;
      if (sv < RULES.goalieSaveLow) pct -= RULES.goalieSaveLowPenalty;
    }
    return cap(pct);
  }

  let pct = Math.min(RULES.prodCap, p.points * RULES.prodSkaterPerPoint);
  // Incremental average TOI (this window only), not the season average, which
  // would dilute a hot or cold stretch with the whole season.
  const avgMin = p.toiSec / p.games / 60;
  const top = isDefense(positions) ? RULES.tiTopDefense : RULES.tiTopForward;
  if (avgMin >= top) pct += RULES.tiBonus;
  if (avgMin < RULES.tiBottom) pct -= RULES.tiBonus;
  return cap(pct);
}

// ------------------------------------------------------------------- engine

interface Work {
  row: RankRow;
  prevRank: number | null; // null for a new entrant
  startRank: number; // rank used for the points conversion
  injPct: number;
  prodPct: number;
  isNew: boolean;
}

export function runRankings(input: EngineInput): { rows: RankRow[]; log: Changelog } {
  const { pool, injuries, today, windowFrom } = input;
  const log: Changelog = {
    startCount: input.rows.length,
    endCount: 0,
    corrections: [],
    removed: [],
    added: [],
    heldNoId: [],
    heldByCap: { count: 0, names: [] },
    droppedCap: [],
    injuryPenalties: [],
    injuryHeldUnchanged: 0,
    injuryCleared: 0,
    contradictions: [],
    unmatchedProduction: [],
    movers: { up: [], down: [] },
    notes: [],
  };

  // ---- Step 0: correct what is demonstrably stale, BEFORE anything else looks at it.
  // This runs ahead of the blank-team drop so a player whose team is missing but
  // known from the roster is repaired rather than removed.
  const fixed: RankRow[] = input.rows.map((r) => {
    const c = input.corrections?.get(r.statsId);
    if (!c) return { ...r };
    const next = { ...r };
    if (c.team !== undefined && c.team !== r.team) {
      log.corrections.push({ player: r.player, field: "team", from: r.team || "(blank)", to: c.team });
      next.team = c.team;
    }
    if (c.name !== undefined && c.name !== r.player) {
      log.corrections.push({ player: r.player, field: "name", from: r.player, to: c.name });
      next.player = c.name;
    }
    return next;
  });

  // ---- Step 1: a blank Team silently breaks every team-based step downstream,
  // so those players are dropped and can re-enter once their team is known.
  let rows: RankRow[] = [];
  for (const r of fixed) {
    if (!r.team.trim()) log.removed.push({ player: r.player, reason: "no team designation" });
    else rows.push(r);
  }
  const N = rows.length;

  const byStatsId = new Map<string, PoolEntry>();
  for (const p of pool) if (p.statsId && !byStatsId.has(p.statsId)) byStatsId.set(p.statsId, p);
  const onFile = new Set(rows.map((r) => r.statsId));

  // ---- Step 4a: detect candidates not already on the file.
  const skaters = pool.filter((p) => !p.isGoalie);
  const goalies = pool.filter((p) => p.isGoalie);
  const seasonRank = new Map<number, number>();
  [...skaters]
    .sort(
      (a, b) =>
        b.seasonPoints - a.seasonPoints ||
        b.seasonGoals - a.seasonGoals ||
        a.seasonGames - b.seasonGames ||
        a.name.localeCompare(b.name),
    )
    .forEach((p, i) => seasonRank.set(p.nhlId, i + 1));
  [...goalies]
    .sort((a, b) => b.seasonWins - a.seasonWins || a.seasonGames - b.seasonGames || a.name.localeCompare(b.name))
    .forEach((p, i) => seasonRank.set(p.nhlId, i + 1));

  // Substitute ranking for a hot-week-only candidate: by this window's production.
  const deltaRank = new Map<number, number>();
  [...skaters.filter((p) => (p.delta?.points ?? 0) > 0)]
    .sort((a, b) => (b.delta!.points - a.delta!.points) || a.name.localeCompare(b.name))
    .forEach((p, i) => deltaRank.set(p.nhlId, i + 1));
  [...goalies.filter((p) => (p.delta?.wins ?? 0) > 0)]
    .sort((a, b) => (b.delta!.wins - a.delta!.wins) || a.name.localeCompare(b.name))
    .forEach((p, i) => deltaRank.set(p.nhlId, i + 1));

  interface Cand {
    p: PoolEntry;
    hot: boolean;
    season: boolean;
    statRank: number;
  }
  const cands: Cand[] = [];
  for (const p of pool) {
    if (p.statsId && onFile.has(p.statsId)) continue;
    const d = p.delta;
    let hot = false;
    if (d && d.games > 0) {
      if (p.isGoalie) {
        const sv = savePct(d);
        hot =
          (d.wins >= 1 && d.shutouts >= 1) ||
          (d.wins >= 1 && sv !== null && sv >= RULES.hotGoalieSavePct);
      } else {
        hot = d.points >= RULES.hotSkaterPoints;
      }
    }
    const sRank = seasonRank.get(p.nhlId) ?? Infinity;
    const floor = p.isGoalie
      ? 1
      : Math.max(RULES.gamesFloorMin, Math.round(p.teamGames * RULES.gamesFloorFraction));
    const season = p.seasonGames >= floor && sRank <= N;
    if (!hot && !season) continue;
    // Out past the end of the season: never insert them (they would only be removed by Step 5, and would burn
    // one of the 15 insertion slots and show up as "added" first).
    const feedRd = p.statsId ? injuries.get(p.statsId)?.returnDate : undefined;
    if (feedRd && feedRd > RULES.seasonEnd) {
      log.removed.push({ player: p.name, reason: `not inserted -- return date ${feedRd} beyond season end` });
      continue;
    }
    const statRank = season ? sRank : (deltaRank.get(p.nhlId) ?? sRank);
    cands.push({ p, hot, season, statRank });
  }

  // ---- insertion cap: best stat_rank first, a hot-week hit breaking ties.
  cands.sort((a, b) => a.statRank - b.statRank || Number(b.hot) - Number(a.hot) || a.p.name.localeCompare(b.p.name));
  const chosen = cands.slice(0, RULES.insertionCapPerRun);
  const deferred = cands.slice(RULES.insertionCapPerRun);
  log.heldByCap = { count: deferred.length, names: deferred.slice(0, 20).map((c) => c.p.name) };

  // ---- Step 4b: insertion rank, and a REAL Stats ID or no insertion at all.
  const work: Work[] = rows.map((row, i) => ({
    row,
    prevRank: i + 1,
    startRank: i + 1,
    injPct: 0,
    prodPct: 0,
    isNew: false,
  }));
  const floorRank = N - RULES.floorOffset;
  const taken = new Set(onFile);
  for (const c of chosen) {
    const signal = c.hot && c.season ? "hot-week + season leaderboard" : c.hot ? "hot-week" : "season leaderboard";
    if (!c.p.statsId || taken.has(c.p.statsId)) {
      log.heldNoId.push({ player: c.p.name, signal });
      continue;
    }
    let ins = Math.round(RULES.floorWeight * floorRank + RULES.statRankWeight * c.statRank);
    ins = Math.max(ins, N - RULES.debutBackstop); // debut backstop
    ins = Math.max(1, Math.min(ins, N));
    taken.add(c.p.statsId);
    work.push({
      row: { statsId: c.p.statsId, player: c.p.name, team: c.p.team, positions: c.p.positions, injury: "" },
      prevRank: null,
      startRank: ins,
      injPct: 0,
      prodPct: 0,
      isNew: true,
    });
    log.added.push({
      player: c.p.name,
      team: c.p.team,
      statsId: c.p.statsId,
      signal,
      statRank: c.statRank,
      insertionRank: ins,
    });
  }

  // ---- Step 5: injuries -- a ONE-TIME hit per new or changed return date.
  const toRemove = new Set<Work>();
  for (const w of work) {
    const feed = injuries.get(w.row.statsId);
    const stored = w.row.injury.trim();
    const storedDate = storedReturnDate(stored);

    if (!feed) {
      if (stored) {
        w.row.injury = ""; // recovered
        log.injuryCleared++;
      }
      continue;
    }
    const rd = feed.returnDate;
    if (rd && daysBetween(today, rd) <= 0) {
      if (stored) log.injuryCleared++;
      w.row.injury = ""; // already returning
      continue;
    }
    if (rd && rd > RULES.seasonEnd) {
      toRemove.add(w);
      log.removed.push({ player: w.row.player, reason: `return date ${rd} beyond season end` });
      continue;
    }
    const nextInjury = `${feed.status},${feed.type},${rd ?? ""}`;
    const unchanged = stored !== "" && storedDate === rd;
    if (unchanged) {
      log.injuryHeldUnchanged++; // keep the stored text exactly -- it is the baseline
      continue;
    }
    // new or changed
    if (rd) {
      const daysOut = daysBetween(today, rd);
      const pct = Math.min(
        RULES.injuryMaxPct,
        RULES.injuryBasePct + (daysOut / 7) * RULES.injuryPerWeekPct,
      );
      w.injPct = pct;
      log.injuryPenalties.push({ player: w.row.player, pct, returnDate: rd, daysOut });
    } else {
      log.notes.push(`${w.row.player}: injury listed with no return date, so no penalty applied.`);
    }
    w.row.injury = nextInjury;
  }

  // ---- Step 6: production adjustment (every run; 0 for anyone who did not play).
  for (const w of work) {
    const p = w.row.statsId ? byStatsId.get(w.row.statsId) : undefined;
    w.prodPct = productionPct(p?.delta ?? undefined, w.row.positions);
    // a player listed as still out who nonetheless played in the window
    const feed = injuries.get(w.row.statsId);
    const sd = storedReturnDate(w.row.injury);
    if (
      feed?.returnDate &&
      daysBetween(today, feed.returnDate) > 0 &&
      (p?.delta?.games ?? 0) > 0 &&
      (sd === null || sd >= windowFrom)
    ) {
      log.contradictions.push(
        `${w.row.player}: listed out until ${feed.returnDate} but played ${p!.delta!.games} game(s) in the window.`,
      );
    }
  }

  // ---- Step 7: combine, re-sort, cap, renumber.
  const scored = work
    .filter((w) => !toRemove.has(w))
    .map((w) => ({
      w,
      final: (N - w.startRank + 1) * (1 - w.injPct) * (1 + w.prodPct),
    }));
  scored.sort(
    (a, b) =>
      b.final - a.final ||
      Number(b.w.isNew) - Number(a.w.isNew) || // a new entrant sits ahead of the incumbent it displaces
      (a.w.prevRank ?? 0) - (b.w.prevRank ?? 0),
  );

  let ordered = scored;
  if (ordered.length > RULES.rosterCap) {
    const dropped = ordered.slice(RULES.rosterCap);
    ordered = ordered.slice(0, RULES.rosterCap);
    for (const d of dropped) {
      log.droppedCap.push({ player: d.w.row.player, fellFrom: ordered.length + dropped.indexOf(d) + 1 });
    }
  } else {
    log.notes.push(`Roster is at ${ordered.length}, under the ${RULES.rosterCap} cap, so no cap-driven drops were needed.`);
  }

  // movers
  const movers: Mover[] = [];
  ordered.forEach((s, i) => {
    if (s.w.prevRank === null) return;
    const to = i + 1;
    if (to === s.w.prevRank) return;
    const parts: string[] = [];
    if (s.w.injPct > 0) parts.push("injury (newly applied)");
    if (s.w.prodPct !== 0) parts.push(`production ${s.w.prodPct > 0 ? "+" : ""}${(s.w.prodPct * 100).toFixed(1)}%`);
    movers.push({
      player: s.w.row.player,
      from: s.w.prevRank,
      to,
      reason: parts.length ? parts.join(" + ") : "displaced by others' movement",
    });
  });
  log.movers.up = [...movers].sort((a, b) => b.from - b.to - (a.from - a.to)).filter((m) => m.to < m.from).slice(0, 5);
  log.movers.down = [...movers].sort((a, b) => b.to - b.from - (a.to - a.from)).filter((m) => m.to > m.from).slice(0, 5);

  // production we could not attribute to anyone on the file or in the pool
  for (const p of pool) {
    if (!p.statsId && p.delta && p.delta.games > 0) {
      log.unmatchedProduction.push({ name: p.name, team: p.team, games: p.delta.games });
    }
  }

  const out = ordered.map((s) => s.w.row);
  log.endCount = out.length;
  return { rows: out, log };
}
