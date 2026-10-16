// One-off check of a REAL rankings file against the hub's assumptions.
//   npx tsx scripts/check-real-baseline.mts "<path to csv>"
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { parseRankingsCsv, toRankingsCsv } = await import("../src/rankings/csv.ts");
const { fetchRotoIndex, norm } = await import("../src/rankings/xwalk.ts");
const { fetchInjuries } = await import("../src/rankings/injuries.ts");
const { runRankings, storedReturnDate } = await import("../src/rankings/engine.ts");
const { nhlJson } = await import("../src/rankings/games.ts");

const path = process.argv[2];
const raw = readFileSync(path, "utf8");
const parsed = parseRankingsCsv(raw);
const rows = parsed.rows;

console.log("== FILE ==");
console.log(`rows: ${rows.length} | line endings: ${JSON.stringify(parsed.style.eol)} | every field quoted: ${parsed.style.quoteAll} | warnings: ${parsed.warnings.length}`);
console.log(`round trip reproduces the file byte-for-byte: ${toRankingsCsv(rows, parsed.style) === raw.replace(/^﻿/, "")}`);
const goalies = rows.filter((r) => r.positions.split(",").includes("G")).length;
const injured = rows.filter((r) => r.injury).length;
console.log(`goalies: ${goalies} | rows with an injury: ${injured} | multi-position rows: ${rows.filter((r) => r.positions.includes(",")).length}`);
console.log(`teams in file: ${[...new Set(rows.map((r) => r.team))].sort().join(" ")}`);

console.log("\n== IS 'Stats ID' REALLY RotoWire's player Id? ==");
const idx = await fetchRotoIndex();
let found = 0;
const nameMismatch: string[] = [];
const notFound: string[] = [];
for (const r of rows) {
  const p = idx.byId.get(r.statsId);
  if (!p) { notFound.push(`${r.player} (${r.statsId})`); continue; }
  found++;
  if (norm(`${p.first} ${p.last}`) !== norm(r.player)) nameMismatch.push(`${r.player} vs RotoWire "${p.first} ${p.last}"`);
}
console.log(`ids found in RotoWire's Players feed: ${found}/${rows.length}`);
console.log(`names that differ from the feed's spelling: ${nameMismatch.length}${nameMismatch.length ? "  e.g. " + nameMismatch.slice(0, 4).join("; ") : ""}`);
if (notFound.length) console.log(`NOT FOUND: ${notFound.slice(0, 8).join("; ")}`);

console.log("\n== CAN EACH PLAYER BE MATCHED TO AN NHL PLAYER (date of birth + surname)? ==");
const TEAMS = "ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH".split(" ");
type RP = { id: number; firstName?: { default?: string }; lastName?: { default?: string }; birthDate?: string };
const nhlByKey = new Map<string, { id: number; team: string }>();
for (const t of TEAMS) {
  const r = await nhlJson<{ forwards?: RP[]; defensemen?: RP[]; goalies?: RP[] }>(`/v1/roster/${t}/current`);
  for (const p of [...(r.forwards ?? []), ...(r.defensemen ?? []), ...(r.goalies ?? [])]) {
    nhlByKey.set(`${p.birthDate}|${norm(p.lastName?.default ?? "")}`, { id: p.id, team: t });
  }
}
let matched = 0;
const unmatched: string[] = [];
const teamDiff: string[] = [];
for (const r of rows) {
  const p = idx.byId.get(r.statsId);
  const hit = p ? nhlByKey.get(`${p.dob}|${p.nLast}`) : undefined;
  if (hit) { matched++; if (hit.team !== r.team) teamDiff.push(`${r.player}: file ${r.team}, NHL ${hit.team}`); }
  else unmatched.push(`${r.player} (${r.team})`);
}
console.log(`matched to an active NHL roster: ${matched}/${rows.length}`);
console.log(`not on an active roster (no games to count, so harmless): ${unmatched.length}${unmatched.length ? "  " + unmatched.slice(0, 8).join("; ") : ""}`);
console.log(`team code differs from the NHL roster: ${teamDiff.length}${teamDiff.length ? "  " + teamDiff.slice(0, 6).join("; ") : ""}`);

console.log("\n== INJURY RULES, DRY RUN ON THIS FILE (no games, injuries only; 'today' = 2026-10-16) ==");
const inj = await fetchInjuries();
const { rows: out, log } = runRankings({ rows, pool: [], injuries: inj.map, today: "2026-10-16", windowFrom: "2026-10-16" });
console.log(`feed entries: ${inj.count} | players: ${log.startCount} -> ${log.endCount}`);
console.log(`held at rank (return date unchanged): ${log.injuryHeldUnchanged} | cleared: ${log.injuryCleared} | NEW penalties: ${log.injuryPenalties.length} | removed: ${log.removed.length}`);
const cleared = rows.filter((r, i) => r.injury && out.find((o) => o.statsId === r.statsId)?.injury === "");
console.log(`cleared (return date today or earlier, or recovered): ${cleared.slice(0, 8).map((r) => `${r.player} [${r.injury}]`).join("; ")}`);
console.log(`new penalties: ${log.injuryPenalties.slice(0, 8).map((p) => `${p.player} -${(p.pct * 100).toFixed(1)}% (return ${p.returnDate})`).join("; ")}`);
console.log(`removed: ${log.removed.map((r) => `${r.player} (${r.reason})`).join("; ") || "none"}`);
// the key test of the "unchanged" logic against the file's REAL injury text
const sameInFeed = rows.filter((r) => r.injury && inj.map.get(r.statsId)?.returnDate === storedReturnDate(r.injury)).length;
console.log(`file injuries whose stored return date equals the live feed's: ${sameInFeed} of ${injured}`);
