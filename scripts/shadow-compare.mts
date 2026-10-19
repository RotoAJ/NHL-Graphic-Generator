// Shadow run: replays a hub preview locally (PGlite + live NHL/RotoWire data) from a real baseline file, then
// writes the hub's rankings and both outlooks next to Cowork's for comparison. Nothing touches production.
//
//   npx tsx scripts/shadow-compare.mts <baseline.csv> <through YYYY-MM-DD> <today YYYY-MM-DD> <outDir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const [baselinePath, through, today, outDir] = process.argv.slice(2);
if (!baselinePath || !through || !today || !outDir) throw new Error("usage: baseline.csv through today outDir");

const pg = new PGlite();
globalThis.__RK_SQL = async (strings, ...values) => {
  let text = "";
  strings.forEach((s, i) => (text += s + (i < values.length ? `$${i + 1}` : "")));
  return (await pg.query(text, values as unknown[])).rows as Record<string, unknown>[];
};

const { uploadBaseline, buildPreview, outlookFor } = await import("../src/rankings/run.ts");
const { toRankingsCsv } = await import("../src/rankings/csv.ts");
const store = await import("../src/rankings/store.ts");

mkdirSync(outDir, { recursive: true });
await uploadBaseline(readFileSync(baselinePath, "utf8"), through);
const r = await buildPreview({ today });
console.log(`window ${r.windowFrom}..${r.windowTo}, ${r.gamesInWindow} games, run #${r.runId}`);

const style = (await store.getRun(r.runId))!.style ?? undefined;
writeFileSync(`${outDir}/hub-rankings.csv`, toRankingsCsv(await store.getRows(r.runId), style));
for (const w of [7, 14] as const) {
  const o = await outlookFor(r.runId, w);
  writeFileSync(`${outDir}/hub-${w}.csv`, toRankingsCsv(o!.rows, style));
}
writeFileSync(`${outDir}/hub-changelog.json`, JSON.stringify(r.changelog, null, 1));

// what the page's state route does -- if this throws or won't serialise, that is the page error
const head = await store.latestCommitted();
const preview = await store.getRun((await store.latestPreview())!.id);
const runs = await store.listRuns(30);
const body = JSON.stringify({ head, through: await store.baselineThrough(), preview, runs });
console.log(`state payload: ${(body.length / 1024).toFixed(0)} KB, ${runs.length} runs`);
await pg.close();
