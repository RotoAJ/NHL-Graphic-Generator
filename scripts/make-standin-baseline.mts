// Writes a stand-in rankings CSV (330 real active players, real RotoWire ids) so
// the rankings page can be tried before the real file is uploaded.
//
//   npx tsx scripts/make-standin-baseline.mts <output.csv>
import { readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { fetchRotoIndex, resolveStatsId } = await import("../src/rankings/xwalk.ts");
const { toRankingsCsv } = await import("../src/rankings/csv.ts");
const { nhlJson } = await import("../src/rankings/games.ts");

const out = process.argv[2];
if (!out) throw new Error("usage: make-standin-baseline.mts <output.csv>");

const idx = await fetchRotoIndex();
const TEAMS = "ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH".split(" ");
type RP = { id: number; firstName?: { default?: string }; lastName?: { default?: string }; birthDate?: string };
const players: Array<{ nhl: number; team: string; id: string }> = [];
for (const t of TEAMS) {
  const r = await nhlJson<{ forwards?: RP[]; defensemen?: RP[]; goalies?: RP[] }>(`/v1/roster/${t}/current`);
  for (const p of [...(r.forwards ?? []), ...(r.defensemen ?? []), ...(r.goalies ?? [])]) {
    const hit = resolveStatsId(idx, { first: p.firstName?.default ?? "", last: p.lastName?.default ?? "", dob: p.birthDate ?? null });
    if (hit.statsId) players.push({ nhl: p.id, team: t, id: hit.statsId });
  }
}
const chosen = players.sort((a, b) => a.nhl - b.nhl).filter((_, i) => i % 3 !== 2).slice(0, 330);
writeFileSync(
  out,
  toRankingsCsv(
    chosen.map((p, i) => ({
      statsId: p.id,
      player: `${idx.byId.get(p.id)!.first} ${idx.byId.get(p.id)!.last}`,
      team: p.team,
      positions: idx.byId.get(p.id)!.position,
      injury: i === 5 ? "IR,Knee,2026-10-20" : "",
    })),
  ),
);
console.log(`wrote ${chosen.length} players to ${out}`);
