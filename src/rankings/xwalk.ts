// Mapping between RotoWire player ids (what the rankings file is keyed on) and
// NHL player ids (what the box scores are keyed on).
//
// RotoWire's Players feed carries no NHL id, but it does carry date of birth.
// Matching on date of birth + surname resolved 787 of 787 players on active NHL
// rosters with zero ambiguity (name alone leaves the nickname cases -- Tommy /
// Thomas Novak -- that the skill kept a hand-maintained alias map for, and two
// players sharing a name are separated by their birthdays).
import { idsJson, num, sql, str } from "@/src/rankings/db";
import { nhlJson } from "@/src/rankings/games";

const RW = "https://api.rotowire.com/Hockey/NHL";

export const norm = (s: string): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

export interface RwPlayer {
  id: string;
  first: string;
  last: string;
  nFirst: string;
  nLast: string;
  dob: string;
  position: string;
  level: string;
}

export interface RwIndex {
  byId: Map<string, RwPlayer>;
  byDobLast: Map<string, RwPlayer[]>;
  byDob: Map<string, RwPlayer[]>;
  size: number;
}

export function parseRotoPlayers(xml: string): RwPlayer[] {
  const out: RwPlayer[] = [];
  for (const seg of xml.split('<Player Id="').slice(1)) {
    const id = (seg.match(/^(\d+)"/) ?? [])[1];
    if (!id) continue;
    const first = (seg.match(/<FirstName>([^<]*)<\/FirstName>/) ?? [])[1] ?? "";
    const last = (seg.match(/<LastName>([^<]*)<\/LastName>/) ?? [])[1] ?? "";
    out.push({
      id,
      first,
      last,
      nFirst: norm(first),
      nLast: norm(last),
      dob: (seg.match(/<Birth Date="(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? "",
      position: (seg.match(/<Position>([^<]*)<\/Position>/) ?? [])[1] ?? "",
      level: (seg.match(/<LeagueLevel>([^<]*)<\/LeagueLevel>/) ?? [])[1] ?? "",
    });
  }
  return out;
}

export function buildIndex(players: RwPlayer[]): RwIndex {
  const byId = new Map<string, RwPlayer>();
  const byDobLast = new Map<string, RwPlayer[]>();
  const byDob = new Map<string, RwPlayer[]>();
  for (const p of players) {
    byId.set(p.id, p);
    if (!p.dob) continue;
    const k = `${p.dob}|${p.nLast}`;
    (byDobLast.get(k) ?? byDobLast.set(k, []).get(k)!).push(p);
    (byDob.get(p.dob) ?? byDob.set(p.dob, []).get(p.dob)!).push(p);
  }
  return { byId, byDobLast, byDob, size: players.length };
}

let cached: { at: number; idx: RwIndex } | null = null;

export async function fetchRotoIndex(): Promise<RwIndex> {
  if (cached && Date.now() - cached.at < 6 * 3600 * 1000) return cached.idx;
  const key = process.env.ROTOWIRE_API_KEY;
  if (!key) throw new Error("ROTOWIRE_API_KEY is not set.");
  const res = await fetch(`${RW}/Players.php?key=${encodeURIComponent(key)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`RotoWire Players feed returned HTTP ${res.status}`);
  const players = parseRotoPlayers(await res.text());
  // The feed lists ~2,600 players. A short one would silently leave most of the
  // league unresolved, so refuse rather than limp on.
  if (players.length < 1500) {
    throw new Error(`RotoWire Players feed looks incomplete (${players.length} players).`);
  }
  const idx = buildIndex(players);
  cached = { at: Date.now(), idx };
  return idx;
}

/** Test hook: install a prebuilt index instead of fetching one. */
export function setRotoIndexForTests(idx: RwIndex | null): void {
  cached = idx ? { at: Date.now(), idx } : null;
}

export interface Resolved {
  statsId: string | null;
  how: "dob+surname" | "dob+first-name" | "ambiguous" | "none";
}

export function resolveStatsId(
  idx: RwIndex,
  p: { first: string; last: string; dob: string | null },
): Resolved {
  if (!p.dob) return { statsId: null, how: "none" };
  const nFirst = norm(p.first);
  const nLast = norm(p.last);

  const cands = idx.byDobLast.get(`${p.dob}|${nLast}`) ?? [];
  if (cands.length === 1) return { statsId: cands[0].id, how: "dob+surname" };
  if (cands.length > 1) {
    // two people with one surname and one birthday: separate by first name
    const f = cands.filter((c) => c.nFirst === nFirst || c.nFirst.startsWith(nFirst[0] ?? "~"));
    if (f.length === 1) return { statsId: f[0].id, how: "dob+surname" };
    return { statsId: null, how: "ambiguous" };
  }
  // surname spelled differently between the two sources: fall back to birthday + first name
  const sameDay = (idx.byDob.get(p.dob) ?? []).filter((c) => c.nFirst === nFirst);
  if (sameDay.length === 1) return { statsId: sameDay[0].id, how: "dob+first-name" };
  return { statsId: null, how: "none" };
}

// ------------------------------------------------------------ NHL side

interface Roster {
  forwards?: RosterPlayer[];
  defensemen?: RosterPlayer[];
  goalies?: RosterPlayer[];
}
interface RosterPlayer {
  id: number;
  firstName?: { default?: string };
  lastName?: { default?: string };
  birthDate?: string;
  positionCode?: string;
}
interface Landing {
  playerId: number;
  firstName?: { default?: string };
  lastName?: { default?: string };
  birthDate?: string;
  position?: string;
  currentTeamAbbrev?: string;
}

const TEAMS =
  "ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH".split(
    " ",
  );

interface PlayerRow {
  nhl_id: number;
  first_name: string;
  last_name: string;
  dob: string | null;
  position: string;
  team: string;
}

async function upsertPlayers(rows: PlayerRow[]): Promise<void> {
  if (!rows.length) return;
  const q = await sql();
  for (let i = 0; i < rows.length; i += 800) {
    await q`
      INSERT INTO rk_players (nhl_id, first_name, last_name, dob, position, team)
      SELECT x.nhl_id, x.first_name, x.last_name, x.dob, x.position, x.team
        FROM jsonb_to_recordset(${JSON.stringify(rows.slice(i, i + 800))}::jsonb)
          AS x(nhl_id bigint, first_name text, last_name text, dob date, position text, team text)
      ON CONFLICT (nhl_id) DO UPDATE
         SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
             dob = COALESCE(EXCLUDED.dob, rk_players.dob), position = EXCLUDED.position,
             team = EXCLUDED.team, updated_at = NOW()`;
  }
}

/** Seed from the 32 active rosters: ~790 players for 32 requests. */
async function seedFromRosters(): Promise<number> {
  const rosters = await Promise.all(
    TEAMS.map(async (t) => {
      try {
        return { t, r: await nhlJson<Roster>(`/v1/roster/${t}/current`) };
      } catch {
        return { t, r: null };
      }
    }),
  );
  const rows: PlayerRow[] = [];
  for (const { t, r } of rosters) {
    for (const p of [...(r?.forwards ?? []), ...(r?.defensemen ?? []), ...(r?.goalies ?? [])]) {
      rows.push({
        nhl_id: p.id,
        first_name: p.firstName?.default ?? "",
        last_name: p.lastName?.default ?? "",
        dob: p.birthDate ?? null,
        position: p.positionCode ?? "",
        team: t,
      });
    }
  }
  await upsertPlayers(rows);
  return rows.length;
}

/**
 * Each active player's CURRENT NHL team, keyed by RotoWire id, read from the 32
 * team rosters. This is the authority on trades: the rankings file only ever
 * carried whatever team a player had when he was first entered.
 *
 * A roster that fails to load is simply absent from the result -- its players
 * keep the team already on file rather than being guessed.
 */
export async function fetchRosterTeams(idx: RwIndex): Promise<{ teams: Map<string, string>; failed: string[] }> {
  const teams = new Map<string, string>();
  const failed: string[] = [];
  const rosters = await Promise.all(
    TEAMS.map(async (t) => {
      try {
        return { t, r: await nhlJson<Roster>(`/v1/roster/${t}/current`) };
      } catch {
        failed.push(t);
        return { t, r: null };
      }
    }),
  );
  for (const { t, r } of rosters) {
    for (const p of [...(r?.forwards ?? []), ...(r?.defensemen ?? []), ...(r?.goalies ?? [])]) {
      const hit = resolveStatsId(idx, {
        first: p.firstName?.default ?? "",
        last: p.lastName?.default ?? "",
        dob: p.birthDate ?? null,
      });
      if (hit.statsId) teams.set(hit.statsId, t);
    }
  }
  return { teams, failed };
}

export interface EnsureResult {
  seeded: number;
  fetched: number;
  resolved: number;
  unresolved: number;
}

/**
 * Make sure every NHL id has a row, and that each row has a RotoWire id where one
 * can be found. Rosters are a snapshot and omit call-ups, so anyone they miss is
 * fetched individually (the same trap that hid Brett Berard from search earlier).
 */
export async function ensurePlayers(nhlIds: number[], idx: RwIndex): Promise<EnsureResult> {
  const q = await sql();
  const res: EnsureResult = { seeded: 0, fetched: 0, resolved: 0, unresolved: 0 };
  if (!nhlIds.length) return res;

  const knownCount = num((await q`SELECT COUNT(*) AS n FROM rk_players`)[0].n);
  const have = async () =>
    new Set(
      (
        await q`SELECT nhl_id FROM rk_players
                 WHERE nhl_id IN (SELECT (x)::bigint FROM jsonb_array_elements_text(${idsJson(nhlIds)}::jsonb) x)`
      ).map((r) => num(r.nhl_id)),
    );

  let known = await have();
  if (knownCount < 500 && nhlIds.some((i) => !known.has(i))) {
    res.seeded = await seedFromRosters();
    known = await have();
  }

  const missing = nhlIds.filter((i) => !known.has(i));
  if (missing.length) {
    const rows: PlayerRow[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, missing.length) }, async () => {
        for (;;) {
          const i = next++;
          if (i >= missing.length) return;
          try {
            const l = await nhlJson<Landing>(`/v1/player/${missing[i]}/landing`);
            rows.push({
              nhl_id: missing[i],
              first_name: l.firstName?.default ?? "",
              last_name: l.lastName?.default ?? "",
              dob: l.birthDate ?? null,
              position: l.position ?? "",
              team: l.currentTeamAbbrev ?? "",
            });
          } catch {
            /* left unresolved; reported by the run */
          }
        }
      }),
    );
    await upsertPlayers(rows);
    res.fetched = rows.length;
  }

  // resolve every relevant row that has no RotoWire id yet
  const todo = await q`
    SELECT nhl_id, first_name, last_name, to_char(dob, 'YYYY-MM-DD') AS dob FROM rk_players
     WHERE stats_id IS NULL
       AND nhl_id IN (SELECT (x)::bigint FROM jsonb_array_elements_text(${idsJson(nhlIds)}::jsonb) x)`;
  const updates: Array<{ nhl_id: number; stats_id: string }> = [];
  for (const r of todo) {
    const hit = resolveStatsId(idx, { first: str(r.first_name), last: str(r.last_name), dob: r.dob ? str(r.dob) : null });
    if (hit.statsId) updates.push({ nhl_id: num(r.nhl_id), stats_id: hit.statsId });
    else res.unresolved++;
  }
  if (updates.length) {
    await q`
      UPDATE rk_players p SET stats_id = x.stats_id
        FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS x(nhl_id bigint, stats_id text)
       WHERE p.nhl_id = x.nhl_id`;
    res.resolved = updates.length;
  }
  return res;
}
