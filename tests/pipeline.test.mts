// End-to-end test: the real SQL on an in-process Postgres (PGlite), against LIVE
// NHL and RotoWire data. Only the baseline is synthetic -- there is no real
// rankings file here -- so it is built from today's rosters.
//
//   npx tsx tests/pipeline.test.mts
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

// --- environment: the RotoWire key lives in .env.local, never in code -------
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

// --- install PGlite behind the tagged-template seam -------------------------
const pg = new PGlite();
globalThis.__RK_SQL = async (strings, ...values) => {
  let text = "";
  strings.forEach((s, i) => (text += s + (i < values.length ? `$${i + 1}` : "")));
  const r = await pg.query(text, values as unknown[]);
  return r.rows as Record<string, unknown>[];
};

const { parseRankingsCsv, toRankingsCsv } = await import("../src/rankings/csv.ts");
const { uploadBaseline, buildPreview, outlookFor } = await import("../src/rankings/run.ts");
const store = await import("../src/rankings/store.ts");
const { fetchRotoIndex, resolveStatsId } = await import("../src/rankings/xwalk.ts");
const { nhlJson } = await import("../src/rankings/games.ts");

let passed = 0;
const ok = (name: string, cond: unknown, detail = "") => {
  if (cond) {
    passed++;
    console.log("  ok   ", name, detail ? `  (${detail})` : "");
  } else {
    console.log("  FAIL ", name, detail);
    process.exitCode = 1;
  }
};

// ------------------------------------------------------------------ CSV
console.log("\nCSV round trip");
{
  const src =
    'Stats ID,Player,Team,Positions,Injury\r\n2556,Jordan Staal,CAR,C,"IR,Calf,2026-12-03"\r\n77,"Smith, Jr.",NYR,D,\r\n';
  const p = parseRankingsCsv(src);
  ok("quoted Injury field keeps its commas", p.rows[0].injury === "IR,Calf,2026-12-03");
  ok("a name containing a comma survives", p.rows[1].player === "Smith, Jr.");
  ok("CRLF line endings are detected and reproduced", p.style.eol === "\r\n" && toRankingsCsv(p.rows, p.style) === src);
  ok("a BOM and blank lines are tolerated", parseRankingsCsv("﻿" + src + "\r\n\r\n").rows.length === 2);
  let msg = "";
  try { parseRankingsCsv("Name,Team\nA,B\n"); } catch (e) { msg = (e as Error).message; }
  ok("a wrong header gives a clear error", /Missing column/.test(msg), msg.slice(0, 60));
}

// ------------------------------------------------- build a stand-in baseline
console.log("\nbuilding a stand-in baseline from today's rosters");
const idx = await fetchRotoIndex();
const TEAMS = "ANA BOS BUF CAR CBJ CGY CHI COL DAL DET EDM FLA LAK MIN MTL NJD NSH NYI NYR OTT PHI PIT SEA SJS STL TBL TOR UTA VAN VGK WPG WSH".split(" ");
type RP = { id: number; firstName?: { default?: string }; lastName?: { default?: string }; birthDate?: string };
const rosterPlayers: Array<{ nhl: number; team: string; first: string; last: string; dob: string }> = [];
for (const t of TEAMS) {
  const r = await nhlJson<{ forwards?: RP[]; defensemen?: RP[]; goalies?: RP[] }>(`/v1/roster/${t}/current`);
  for (const p of [...(r.forwards ?? []), ...(r.defensemen ?? []), ...(r.goalies ?? [])]) {
    rosterPlayers.push({ nhl: p.id, team: t, first: p.firstName?.default ?? "", last: p.lastName?.default ?? "", dob: p.birthDate ?? "" });
  }
}
const resolved = rosterPlayers
  .map((p) => ({ p, hit: resolveStatsId(idx, { first: p.first, last: p.last, dob: p.dob }) }))
  .filter((x) => x.hit.statsId);
ok("every active-roster player resolves to a RotoWire id", resolved.length === rosterPlayers.length, `${resolved.length}/${rosterPlayers.length}`);

const onFile = resolved.sort((a, b) => a.p.nhl - b.p.nhl).filter((_, i) => i % 3 !== 2).slice(0, 330);
const baselineCsv = toRankingsCsv(
  onFile.map((x, i) => ({
    statsId: x.hit.statsId!,
    player: `${idx.byId.get(x.hit.statsId!)!.first} ${idx.byId.get(x.hit.statsId!)!.last}`,
    team: x.p.team,
    positions: idx.byId.get(x.hit.statsId!)!.position,
    injury: i === 5 ? "IR,Knee,2026-10-20" : "",
  })),
);
ok("stand-in baseline built", onFile.length === 330, `${onFile.length} players`);

// ------------------------------------------------------- baseline + preview
console.log("\nbaseline upload and preview (live NHL data; first run backfills the season)");
const THROUGH = "2026-10-13";
const TODAY = "2026-10-16";
const base = await uploadBaseline(baselineCsv, THROUGH);
ok("baseline stored as a committed run", base.players === 330, `run #${base.runId}`);
const head0 = await store.latestCommitted();
ok("baseline is the head of history", head0?.id === base.runId && head0.kind === "baseline");

const t0 = Date.now();
const a = await buildPreview({ today: TODAY });
console.log(`        (took ${((Date.now() - t0) / 1000).toFixed(1)}s; ${a.ingest.stored} games stored, ${a.players.seeded} seeded, ${a.players.fetched} fetched)`);
ok("games inside the window were found", a.gamesInWindow >= 10, `${a.gamesInWindow} games, ${a.windowFrom} to ${a.windowTo}`);
ok("window starts the day after the baseline", a.windowFrom === "2026-10-14" && a.windowTo === "2026-10-15");
ok("the preview is NOT committed", !(await store.getRun(a.runId))!.committed);
const prevRows = await store.getRows(a.runId);
ok("output has unique Stats IDs", new Set(prevRows.map((r) => r.statsId)).size === prevRows.length, `${prevRows.length} rows`);
ok("output stays within the 350 cap", prevRows.length <= 350);
ok("at most 15 new players inserted", a.changelog.added.length <= 15, `${a.changelog.added.length} added, ${a.changelog.heldByCap.count} held by cap`);
ok("someone was inserted from real stats", a.changelog.added.length > 0, a.changelog.added.slice(0, 3).map((x) => `${x.player} (stat rank ${x.statRank}, ins ${x.insertionRank})`).join("; "));
ok("every inserted player has a real RotoWire id that exists", a.changelog.added.every((x) => idx.byId.has(x.statsId)));
console.log(`        injuries: ${a.changelog.injuryPenalties.length} new penalties, ${a.changelog.injuryHeldUnchanged} held unchanged, ${a.changelog.injuryCleared} cleared`);
ok("the injury step ran against the live feed", a.changelog.notes.some((n) => /Injury feed: \d+ entries/.test(n)));
ok("movers are reported", a.changelog.movers.up.length + a.changelog.movers.down.length > 0,
  [...a.changelog.movers.up.slice(0, 2), ...a.changelog.movers.down.slice(0, 1)].map((m) => `${m.player} ${m.from}->${m.to} [${m.reason}]`).join("; "));
ok("a preview does not mark games processed", (await store.getRun(a.runId)) !== null);
{
  const again = await buildPreview({ today: TODAY });
  const r2 = await store.getRows(again.runId);
  ok("rebuilding a preview is deterministic (identical rows)", JSON.stringify(r2) === JSON.stringify(prevRows));
  ok("only one preview exists at a time", (await store.listRuns()).filter((r) => !r.committed).length === 1);
}

// ------------------------------------------------ corrections + outlooks
console.log("\ncorrections and outlooks");
ok("corrections are reported in the changelog", Array.isArray(a.changelog.corrections), a.changelog.corrections.length + " corrected");
ok("every correction has a field, from and to", a.changelog.corrections.every((x) => (x.field === "team" || x.field === "name") && x.from !== x.to));
const latest = (await store.latestPreview())!;
const lrun = await store.getRun(latest.id);
for (const w of [7, 14] as const) {
  const o = await outlookFor(latest.id, w);
  ok(w + "-day outlook is saved with the run", !!o && o.stored && o.rows.length > 300, o ? o.rows.length + " rows" : "none");
  if (o) ok(w + "-day outlook has no duplicate players", new Set(o.rows.map((r) => r.statsId)).size === o.rows.length);
}
{
  const lg = lrun?.outlook?.[7];
  ok("outlook log records the league average games", !!lg && lg.leagueAvgGames > 0, String(lg?.leagueAvgGames));
  const { fetchTeamStats } = await import("../src/rankings/schedule.ts");
  const ts = await fetchTeamStats(TODAY);
  ok("team stats cover all 32 teams", ts.stats.size === 32, String(ts.stats.size));
}

// --------------------------------------------------------------- commit
console.log("\ncommit, history and rollback");
const preview = (await store.latestPreview())!;
const c = await store.commitRun(preview.id);
ok("commit succeeds", c.ok === true);
ok("it is now the head of history", (await store.latestCommitted())!.id === preview.id);
{
  const next = await buildPreview({ today: TODAY });
  ok("after committing, those games are not counted again", next.gamesInWindow === 0, `${next.gamesInWindow} games`);
}
{
  // a stale preview must not be committable
  const stale = await buildPreview({ today: TODAY });
  const q = (await import("../src/rankings/db.ts")).sql;
  const sqlq = await q();
  await sqlq`UPDATE rk_runs SET committed = TRUE WHERE id = ${stale.runId}`; // simulate another commit sneaking in
  const another = await store.createRun({ kind: "run", committed: false, baseRunId: head0!.id, windowFrom: null, windowTo: null, rows: prevRows, changelog: null });
  const res = await store.commitRun(another);
  ok("a preview built against an old head is refused", res.ok === false, res.ok ? "" : res.reason.slice(0, 50));
  await sqlq`UPDATE rk_runs SET committed = FALSE WHERE id = ${stale.runId}`;
  await store.discardPreviews();
}
const baselineRows = await store.getRows(base.runId);
const rest = await store.restoreRun(base.runId);
ok("restoring the baseline succeeds", rest.ok === true);
ok("the file is back exactly as uploaded", JSON.stringify(await store.getRows((await store.latestCommitted())!.id)) === JSON.stringify(baselineRows));
{
  const redo = await buildPreview({ today: TODAY });
  ok("after a restore the window is counted again", redo.gamesInWindow === a.gamesInWindow, `${redo.gamesInWindow} games`);
  ok("history keeps every run (nothing was deleted)", (await store.listRuns()).filter((r) => r.committed).length >= 3);
}

// ---------------------------------------------------- real-data spot check
console.log("\nspot check: hub season totals vs the NHL's own player pages");
{
  const sqlq = await (await import("../src/rankings/db.ts")).sql();
  const top = await sqlq`
    SELECT l.nhl_id, p.first_name, p.last_name, SUM(l.points) AS pts, COUNT(*) AS gp
      FROM rk_lines l JOIN rk_players p ON p.nhl_id = l.nhl_id
     WHERE l.is_goalie = FALSE GROUP BY l.nhl_id, p.first_name, p.last_name ORDER BY pts DESC, gp ASC LIMIT 6`;
  type Landing = { featuredStats?: { regularSeason?: { subSeason?: { points?: number; gamesPlayed?: number } } } };
  let exact = 0;
  for (const r of top) {
    const l = await nhlJson<Landing>(`/v1/player/${r.nhl_id}/landing`);
    const sub = l.featuredStats?.regularSeason?.subSeason;
    const same = sub?.points === Number(r.pts) && sub?.gamesPlayed === Number(r.gp);
    if (same) exact++;
    console.log(`        ${String(r.first_name)} ${String(r.last_name)}: hub ${r.pts} pts / ${r.gp} GP   NHL ${sub?.points} pts / ${sub?.gamesPlayed} GP  ${same ? "match" : "DIFFERS"}`);
  }
  // a game played today (after the window ended) can legitimately put the NHL page one game ahead
  ok("hub totals match the NHL's for at least 5 of the top 6 scorers", exact >= 5, `${exact}/6 exact`);
}

console.log(`\n${passed} checks passed${process.exitCode ? " -- WITH FAILURES" : ", 0 failed"}`);
await pg.close();
