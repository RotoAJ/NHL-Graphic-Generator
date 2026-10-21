// Replays: baseline(through 10-15) -> build Mon(10-19) -> COMMIT -> build Wed(10-21). Are Mon's games counted again?
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const pg = new PGlite();
globalThis.__RK_SQL = async (strings, ...values) => {
  let text = "";
  strings.forEach((s, i) => (text += s + (i < values.length ? `$${i + 1}` : "")));
  return (await pg.query(text, values as unknown[])).rows as Record<string, unknown>[];
};
const { uploadBaseline, buildPreview } = await import("../src/rankings/run.ts");
const store = await import("../src/rankings/store.ts");
const { sql } = await import("../src/rankings/db.ts");
await uploadBaseline(readFileSync(process.argv[2], "utf8"), "2026-10-15");
const mon = await buildPreview({ today: "2026-10-19" });
console.log(`Monday build : label ${mon.windowFrom}..${mon.windowTo}, ${mon.gamesInWindow} games`);
console.log("commit:", (await store.commitRun(mon.runId)).ok);
const wed = await buildPreview({ today: "2026-10-21" });
console.log(`Wednesday    : label ${wed.windowFrom}..${wed.windowTo}, ${wed.gamesInWindow} games`);
const q = await sql();
const rows = await q`SELECT to_char(game_date,'YYYY-MM-DD') AS d, COUNT(*) AS n, COUNT(processed_run) AS processed FROM rk_games GROUP BY 1 ORDER BY 1 DESC LIMIT 7`;
console.log("games by date (n total / already processed by a committed run):");
for (const r of rows) console.log("  ", r.d, r.n, "/", r.processed);
await pg.close();
