// Replay a Cowork outlook run and compare the hub's result with the real output.
//   npx tsx scripts/replay-outlook.mts <rankings.csv> <7-day.csv> <14-day.csv> <YYYY-MM-DD run date>
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { parseRankingsCsv } = await import("../src/rankings/csv.ts");
const { runOutlook, addDays } = await import("../src/rankings/outlook.ts");
const { fetchTeamSchedules, fetchTeamStats } = await import("../src/rankings/schedule.ts");

const [rankingsPath, sevenPath, fourteenPath, today] = process.argv.slice(2);
const rows = parseRankingsCsv(readFileSync(rankingsPath, "utf8")).rows;
const expected = {
  7: parseRankingsCsv(readFileSync(sevenPath, "utf8")).rows,
  14: parseRankingsCsv(readFileSync(fourteenPath, "utf8")).rows,
};

// The Cowork run happened in the morning, so use standings as of the previous day.
const asOf = addDays(today, -1);
const { stats, teams } = await fetchTeamStats(asOf);
const schedule = await fetchTeamSchedules(today, addDays(today, 14), teams);
console.log(`run date ${today} | standings as of ${asOf} | ${teams.length} teams`);
console.log(`teams on this season's stats: ${[...stats].filter(([, s]) => s.basis === "current").map(([t]) => t).join(" ") || "none"}`);
console.log(`teams on last season's stats: ${[...stats].filter(([, s]) => s.basis === "prior").length}`);

function spearman(a: string[], b: string[]): number {
  const common = a.filter((x) => b.includes(x));
  const ra = new Map(common.map((x, i) => [x, i]));
  const rb = new Map(b.filter((x) => ra.has(x)).map((x, i) => [x, i]));
  const n = common.length;
  let d2 = 0;
  for (const x of common) d2 += (ra.get(x)! - rb.get(x)!) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

for (const window of [7, 14] as const) {
  for (const endInclusive of [true, false]) {
    const { rows: out, log } = runOutlook({ rows, today, window, schedule, teamStats: stats, endInclusive });
    const mine = out.map((r) => r.statsId);
    const theirs = expected[window].map((r) => r.statsId);
    const onlyMine = mine.filter((x) => !theirs.includes(x));
    const onlyTheirs = theirs.filter((x) => !mine.includes(x));
    const common = mine.filter((x) => theirs.includes(x));
    const pos = (list: string[], id: string) => list.indexOf(id);
    let exact = 0, w2 = 0, w5 = 0;
    for (const id of common) {
      const d = Math.abs(pos(mine, id) - pos(theirs, id));
      if (d === 0) exact++;
      if (d <= 2) w2++;
      if (d <= 5) w5++;
    }
    const top = (n: number) => mine.slice(0, n).filter((x) => theirs.slice(0, n).includes(x)).length;
    console.log(
      `\n${window}-day, window end ${endInclusive ? "inclusive" : "exclusive"}: league avg ${log.leagueAvgGames.toFixed(2)} games/team`,
    );
    console.log(`  same players kept: ${common.length}/${theirs.length} (hub-only ${onlyMine.length}, cowork-only ${onlyTheirs.length})`);
    const name = (id: string) => rows.find((r) => r.statsId === id)?.player ?? id;
    if (onlyMine.length) console.log(`    hub kept but cowork dropped: ${onlyMine.slice(0, 5).map(name).join("; ")}`);
    if (onlyTheirs.length) console.log(`    cowork kept but hub dropped: ${onlyTheirs.slice(0, 5).map(name).join("; ")}`);
    console.log(`  order agreement: Spearman ${spearman(mine, theirs).toFixed(4)} | exact same slot ${exact}/${common.length} | within 2: ${w2} | within 5: ${w5}`);
    console.log(`  top 10 overlap ${top(10)}/10 | top 25 overlap ${top(25)}/25 | top 50 overlap ${top(50)}/50`);
  }
}
