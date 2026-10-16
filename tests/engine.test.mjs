// Rules-engine tests. Expected values are worked out BY HAND from the skill's text,
// not copied from the engine's own output.
import assert from "node:assert/strict";
import { runRankings, productionPct, parseDate, storedReturnDate } from "../src/rankings/engine.ts";

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed++;
    console.log("  ok   ", name);
  } catch (e) {
    console.log("  FAIL ", name, "\n        ", String(e.message).split("\n")[0]);
    process.exitCode = 1;
  }
};
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m ?? ""} expected ${b}, got ${a}`);

const row = (i, over = {}) => ({ statsId: String(1000 + i), player: `P${i}`, team: "NYR", positions: "C", injury: "", ...over });
const rowsN = (n) => Array.from({ length: n }, (_, i) => row(i + 1));
const prod = (o = {}) => ({ games: 1, points: 0, toiSec: 0, wins: 0, losses: 0, saves: 0, shotsAgainst: 0, shutouts: 0, ...o });
const pe = (id, o = {}) => ({
  nhlId: id, statsId: String(id), name: `N${id}`, team: "NYR", positions: "C", isGoalie: false,
  seasonGames: 0, seasonPoints: 0, seasonGoals: 0, seasonWins: 0, teamGames: 10, delta: null, ...o,
});
const TODAY = { today: "2026-10-16", windowFrom: "2026-10-14" };
const base = (o = {}) => ({ rows: rowsN(10), pool: [], injuries: new Map(), ...TODAY, ...o });
const big = (pool, rows = rowsN(350)) => runRankings({ rows, pool, injuries: new Map(), ...TODAY });

console.log("\nproduction adjustment (Step 6)");
t("skater: 2 points = +2%", () => near(productionPct(prod({ points: 2, toiSec: 900 }), "C"), 0.02));
t("skater: points cap at +4%", () => near(productionPct(prod({ points: 9, toiSec: 900 }), "C"), 0.04));
t("forward 18+ min = +0.5%", () => near(productionPct(prod({ points: 1, toiSec: 18 * 60 }), "LW"), 0.015));
t("defenseman needs 22+ min, 20 is not enough", () => near(productionPct(prod({ points: 1, toiSec: 20 * 60 }), "D"), 0.01));
t("defenseman 22 min = +0.5%", () => near(productionPct(prod({ points: 0, toiSec: 22 * 60 }), "D"), 0.005));
t("under 12 min = -0.5%", () => near(productionPct(prod({ points: 0, toiSec: 10 * 60 }), "C"), -0.005));
t("total capped at 4% even with the TOI bonus", () => near(productionPct(prod({ points: 4, toiSec: 20 * 60 }), "C"), 0.04));
t("zero games = no adjustment", () => near(productionPct(prod({ games: 0, points: 5 }), "C"), 0));
t("goalie: win + .933 sv = 1.5% + 1% = 2.5%", () => near(productionPct(prod({ wins: 1, saves: 28, shotsAgainst: 30 }), "G"), 0.025));
t("goalie: win + shutout, .914 sv = 1.5% + 1% = 2.5%", () => near(productionPct(prod({ wins: 1, shutouts: 1, saves: 32, shotsAgainst: 35 }), "G"), 0.025));
t("goalie: regulation loss at .850 = -1% - 1.5% = -2.5%", () => near(productionPct(prod({ losses: 1, saves: 17, shotsAgainst: 20 }), "G"), -0.025));
t("goalie: capped at -4%", () => near(productionPct(prod({ games: 3, losses: 3, saves: 40, shotsAgainst: 50 }), "G"), -0.04));
t("goalie sv% exactly .920 earns nothing (strictly greater)", () => near(productionPct(prod({ saves: 92, shotsAgainst: 100 }), "G"), 0));

console.log("\ninjuries (Step 5)");
const inj = (statsId, status, type, returnDate) => [statsId, { status, type, returnDate }];
t("new injury, 14 days out: 2% + 2 weeks * 1% = 4%, one-time", () => {
  const r = runRankings(base({ injuries: new Map([inj("1005", "IR", "Knee", "2026-10-30")]) }));
  const e = r.log.injuryPenalties.find((x) => x.player === "P5");
  near(e.pct, 0.04);
  assert.equal(e.daysOut, 14);
  assert.equal(r.rows.find((x) => x.player === "P5").injury, "IR,Knee,2026-10-30");
});
t("penalty is capped at 15% for a long absence", () => {
  const r = runRankings(base({ injuries: new Map([inj("1005", "IR", "Knee", "2027-03-01")]) }));
  near(r.log.injuryPenalties[0].pct, 0.15);
});
t("UNCHANGED return date: no new penalty, stored text kept byte-for-byte", () => {
  const rows = rowsN(10);
  rows[4].injury = "IR,Knee,10/30/2026";
  const r = runRankings(base({ rows, injuries: new Map([inj("1005", "IR", "Knee", "2026-10-30")]) }));
  assert.equal(r.log.injuryPenalties.length, 0);
  assert.equal(r.log.injuryHeldUnchanged, 1);
  assert.equal(r.rows.find((x) => x.player === "P5").injury, "IR,Knee,10/30/2026");
});
t("CHANGED return date is penalised again", () => {
  const rows = rowsN(10);
  rows[4].injury = "IR,Knee,2026-10-30";
  const r = runRankings(base({ rows, injuries: new Map([inj("1005", "IR", "Knee", "2026-11-13")]) }));
  assert.equal(r.log.injuryPenalties.length, 1);
});
t("recovered (no feed entry) clears the field with no penalty", () => {
  const rows = rowsN(10);
  rows[2].injury = "IR,Knee,2026-10-30";
  const r = runRankings(base({ rows }));
  assert.equal(r.rows.find((x) => x.player === "P3").injury, "");
  assert.equal(r.log.injuryPenalties.length, 0);
});
t("return date today-or-earlier clears, no penalty", () => {
  const rows = rowsN(10);
  rows[2].injury = "IR,Knee,2026-10-14";
  const r = runRankings(base({ rows, injuries: new Map([inj("1003", "IR", "Knee", "2026-10-16")]) }));
  assert.equal(r.rows.find((x) => x.player === "P3").injury, "");
  assert.equal(r.log.injuryPenalties.length, 0);
});
t("return date beyond season end removes the player", () => {
  const r = runRankings(base({ injuries: new Map([inj("1005", "IR", "Knee", "2027-04-11")]) }));
  assert.equal(r.rows.length, 9);
  assert.ok(r.log.removed.some((x) => x.player === "P5"));
});
t("return date ON season end is kept", () => {
  const r = runRankings(base({ injuries: new Map([inj("1005", "IR", "Knee", "2027-04-10")]) }));
  assert.equal(r.rows.length, 10);
});
t("an injured top player drops from the top (realistic 350-player file: 9% of 350 pts = ~31 places)", () => {
  const r = runRankings({ rows: rowsN(350), pool: [], injuries: new Map([inj("1001", "IR", "Knee", "2026-12-04")]), ...TODAY });
  const at = r.rows.findIndex((x) => x.player === "P1");
  assert.ok(at >= 30 && at <= 32, "expected to fall to about rank 32, got index " + at);
});
t("tiny file: the same penalty is smaller than the rank gap, so order holds (rank gaps are 1 point)", () => {
  const r = runRankings(base({ injuries: new Map([inj("1001", "IR", "Knee", "2026-12-04")]) }));
  assert.equal(r.rows[0].player, "P1");
});

console.log("\nStep 1 / basics");
t("blank team is dropped and logged", () => {
  const rows = rowsN(10);
  rows[3].team = "  ";
  const r = runRankings(base({ rows }));
  assert.equal(r.rows.length, 9);
  assert.ok(r.log.removed.some((x) => /no team/.test(x.reason)));
});
t("no inputs => order unchanged", () => {
  assert.deepEqual(runRankings(base()).rows.map((x) => x.player), rowsN(10).map((x) => x.player));
});
t("deterministic: same input twice gives identical output", () => {
  const inp = base({ pool: [pe(7001, { seasonGames: 5, seasonPoints: 9, seasonGoals: 4 })] });
  assert.deepEqual(runRankings(inp).rows, runRankings(inp).rows);
});

console.log("\nnew players (Step 4)");
t("insertion rank: N=350, stat_rank 40 => round(.75*335 + .25*40) = 261", () => {
  const pool = [pe(9001, { seasonGames: 8, seasonPoints: 12 })];
  // 39 other skaters outrank him, so his season rank is 40. They are ALREADY ON THE FILE (ids 1001..1039), so
  // they count toward the leaderboard without becoming candidates or taking insertion-cap slots.
  for (let i = 0; i < 39; i++) pool.push(pe(8000 + i, { statsId: String(1001 + i), seasonGames: 8, seasonPoints: 30 + i }));
  const a = big(pool).log.added.find((x) => x.player === "N9001");
  assert.equal(a.statRank, 40);
  assert.equal(a.insertionRank, 261);
});
t("insertion rank: stat_rank 1 => round(251.25 + .25) = 252", () => {
  assert.equal(big([pe(9001, { seasonGames: 8, seasonPoints: 50 })]).log.added[0].insertionRank, 252);
});
t("debut backstop binds for a large file: N=400, stat_rank 1 => max(289, 300) = 300", () => {
  assert.equal(big([pe(9001, { seasonGames: 8, seasonPoints: 50 })], rowsN(400)).log.added[0].insertionRank, 300);
});
t("cap: 20 qualifying => 15 inserted, 5 deferred, best stat ranks win", () => {
  const pool = Array.from({ length: 20 }, (_, i) => pe(7000 + i, { seasonGames: 6, seasonPoints: 40 - i }));
  const r = big(pool);
  assert.equal(r.log.added.length, 15);
  assert.equal(r.log.heldByCap.count, 5);
  assert.ok(r.log.added.every((a) => a.statRank <= 15));
});
t("per the skill the cap is applied BEFORE ids are resolved, so an id-less player uses a slot and is not backfilled", () => {
  const pool = Array.from({ length: 16 }, (_, i) => pe(7000 + i, { statsId: i === 0 ? null : String(7000 + i), seasonGames: 6, seasonPoints: 40 - i }));
  const r = big(pool);
  assert.equal(r.log.heldNoId.length, 1);
  assert.equal(r.log.added.length, 14, "15 chosen, 1 of them unresolvable => 14 inserted, the 16th stays deferred");
});
t("no RotoWire Stats ID => held out, never inserted", () => {
  const r = big([pe(9001, { statsId: null, seasonGames: 8, seasonPoints: 50 })]);
  assert.equal(r.log.added.length, 0);
  assert.equal(r.log.heldNoId.length, 1);
});
t("games floor scales: 1 game on a 10-game team (floor 4) does not qualify", () => {
  assert.equal(big([pe(9001, { seasonGames: 1, seasonPoints: 9, teamGames: 10 })]).log.added.length, 0);
});
t("floor is never below 2 games", () => {
  assert.equal(big([pe(9001, { seasonGames: 1, seasonPoints: 9, teamGames: 2 })]).log.added.length, 0);
});
t("hot-week skater: 3 points in the window qualifies on its own", () => {
  const r = big([pe(9001, { seasonGames: 1, seasonPoints: 3, delta: prod({ points: 3 }) })]);
  assert.equal(r.log.added.length, 1);
  assert.match(r.log.added[0].signal, /hot-week/);
});
t("2 points is not hot", () => {
  assert.equal(big([pe(9001, { seasonGames: 1, seasonPoints: 2, delta: prod({ points: 2 }) })]).log.added.length, 0);
});
t("hot goalie: win+shutout yes; win at .930 yes; win at .925 no", () => {
  const g = (d) => pe(9001, { isGoalie: true, positions: "G", seasonGames: 1, seasonWins: 0, delta: prod(d) });
  // seasonWins 0 and rank is last, but N=350 so the season signal can still fire: use a rank-beyond-N pool
  const filler = Array.from({ length: 351 }, (_, i) => pe(5000 + i, { isGoalie: true, positions: "G", statsId: null, seasonGames: 5, seasonWins: 3 }));
  const mk = (d) => big([...filler, g(d)]).log.added.filter((x) => x.player === "N9001").length;
  assert.equal(mk({ wins: 1, shutouts: 1, saves: 20, shotsAgainst: 20 }), 1);
  assert.equal(mk({ wins: 1, saves: 93, shotsAgainst: 100 }), 1);
  assert.equal(mk({ wins: 1, saves: 925, shotsAgainst: 1000 }), 0);
});
t("a player already on the file is never a candidate", () => {
  assert.equal(runRankings(base({ pool: [pe(1003, { seasonGames: 9, seasonPoints: 99, delta: prod({ points: 9 }) })] })).log.added.length, 0);
});

console.log("\nroster cap (Step 4c)");
t("350 + 3 new => the 3 lowest-scoring fall off, and are logged", () => {
  const pool = [1, 2, 3].map((k) => pe(7000 + k, { seasonGames: 6, seasonPoints: 40 - k }));
  const r = big(pool);
  assert.equal(r.rows.length, 350);
  assert.equal(r.log.droppedCap.length, 3);
  assert.ok(!r.rows.some((x) => x.player === "P350"));
});
t("under the cap: nothing dropped", () => assert.equal(runRankings(base()).log.droppedCap.length, 0));
t("output ids are unique", () => {
  const r = big([pe(7001, { seasonGames: 6, seasonPoints: 40 })]);
  assert.equal(new Set(r.rows.map((x) => x.statsId)).size, r.rows.length);
});

console.log("\ncorrections (stale team / misspelled name)");
t("team correction is applied and logged", () => {
  const r = runRankings(base({ corrections: new Map([["1003", { team: "VGK" }]]) }));
  assert.equal(r.rows.find((x) => x.statsId === "1003").team, "VGK");
  assert.deepEqual(r.log.corrections, [{ player: "P3", field: "team", from: "NYR", to: "VGK" }]);
});
t("name correction is applied and logged", () => {
  const r = runRankings(base({ corrections: new Map([["1003", { name: "Fixed Name" }]]) }));
  assert.equal(r.rows.find((x) => x.statsId === "1003").player, "Fixed Name");
  assert.deepEqual(r.log.corrections, [{ player: "P3", field: "name", from: "P3", to: "Fixed Name" }]);
});
t("a correction equal to the current value logs nothing", () => {
  const r = runRankings(base({ corrections: new Map([["1003", { team: "NYR", name: "P3" }]]) }));
  assert.equal(r.log.corrections.length, 0);
});
t("a blank team repaired by a correction is kept, not dropped", () => {
  const rows = rowsN(10);
  rows[2].team = "";
  const r = runRankings(base({ rows, corrections: new Map([["1003", { team: "BOS" }]]) }));
  assert.equal(r.rows.find((x) => x.statsId === "1003")?.team, "BOS");
});
t("a blank team with no correction is still dropped", () => {
  const rows = rowsN(10);
  rows[2].team = "";
  assert.ok(!runRankings(base({ rows })).rows.some((x) => x.statsId === "1003"));
});

console.log("\nhelpers");
t("parseDate accepts ISO, ISO timestamp, M/D/YYYY, M/D/YY", () => {
  assert.equal(parseDate("2026-10-30"), "2026-10-30");
  assert.equal(parseDate("2026-10-30 00:00:00"), "2026-10-30");
  assert.equal(parseDate("10/30/2026"), "2026-10-30");
  assert.equal(parseDate("1/5/27"), "2027-01-05");
  assert.equal(parseDate("soon"), null);
});
t("storedReturnDate reads the last comma-separated part", () => {
  assert.equal(storedReturnDate("IR,Lower Body,2026-12-03"), "2026-12-03");
  assert.equal(storedReturnDate(""), null);
  assert.equal(storedReturnDate("IR,Knee,"), null);
});

console.log(`\n${passed} passed${process.exitCode ? " -- WITH FAILURES" : ", 0 failed"}`);
