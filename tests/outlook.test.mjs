// Outlook-engine tests. Expected values are worked out BY HAND from the skill's text, not copied from the
// engine's own output. Players are placed on a 100-player list so that a few percent moves them past a known
// number of others; "points" below are N - rank + 1.
import assert from "node:assert/strict";
import { runOutlook, returnDateOf, addDays } from "../src/rankings/outlook.ts";

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

const TODAY = "2026-10-16"; // 7-day window ends 2026-10-23, 14-day window ends 2026-10-30
const g = (date, opp) => ({ date, opp });
const row = (id, team, o = {}) => ({ statsId: String(id), player: `P${id}`, team, positions: "C", injury: "", ...o });
/** 100 fillers: rank r has points 101 - r. The test player replaces rank 40 => 61 points, so no filler has 61. */
const fill = (n, team) => Array.from({ length: n }, (_, i) => row(100 + i, team));
const indexOf = (out, id) => out.rows.findIndex((r) => r.statsId === String(id));

// ------------------------------------------------------------- games effect
// Four teams. Games in the 7-day window: A 3, B 3, C 2, D 4  => league average 3.0
const schedule = () =>
  new Map([
    ["A", [g("2026-10-17", "B"), g("2026-10-19", "C"), g("2026-10-21", "D")]],
    ["B", [g("2026-10-17", "A"), g("2026-10-20", "C"), g("2026-10-22", "D")]],
    ["C", [g("2026-10-19", "A"), g("2026-10-20", "B")]],
    ["D", [g("2026-10-18", "A"), g("2026-10-21", "A"), g("2026-10-22", "B"), g("2026-10-23", "C")]],
  ]);
const flat = (over = {}) =>
  new Map(["A", "B", "C", "D"].map((tm) => [tm, { gfpg: 3.0, gapg: 3.0, basis: "current", ...(over[tm] ?? {}) }]));
const run = (rows, o = {}) => runOutlook({ rows, today: TODAY, window: 7, schedule: schedule(), teamStats: flat(), ...o });

console.log("\ngames in window (Step 4)");
t("league average comes from every team's FULL schedule: (3+3+2+4)/4 = 3.0", () => {
  assert.equal(run([row(1, "A")]).log.leagueAvgGames, 3.0);
});
t("an average team (3 games) is not moved at all", () => {
  assert.deepEqual(run([row(1, "A"), row(2, "A")]).rows.map((r) => r.statsId), ["1", "2"]);
});
t("+1 game over average = +4% (team D): 61 * 1.04 = 63.44, so the 37 players with 64..100 are above him", () => {
  const rows = fill(100, "A");
  rows[39] = row(900, "D");
  assert.equal(indexOf(run(rows), 900), 37);
});
t("-1 game under average = -4% (team C): 61 * 0.96 = 58.56; points 59..100 is 42 values, minus the missing 61 = 41", () => {
  const rows = fill(100, "A");
  rows[39] = row(900, "C");
  assert.equal(indexOf(run(rows), 900), 41);
});
t("14-day window is 2.5% per game: 61 * 1.025 = 62.525, so points 63..100 (38 players) are above him", () => {
  const rows = fill(100, "A");
  rows[39] = row(900, "D");
  const out = runOutlook({ rows, today: TODAY, window: 14, schedule: schedule(), teamStats: flat() });
  assert.equal(indexOf(out, 900), 38);
});
t("games effect is capped at +16% (E has 10 games vs a 4.4 average = +22.4% uncapped)", () => {
  const sched = schedule();
  sched.set("E", Array.from({ length: 10 }, (_, i) => g(`2026-10-${17 + (i % 6)}`, "A")));
  const stats = new Map([...flat(), ["E", { gfpg: 3, gapg: 3, basis: "current" }]]);
  const rows = fill(100, "A");
  rows[59] = row(900, "E"); // rank 60 => 41 points * 1.16 = 47.56
  const out = runOutlook({ rows, today: TODAY, window: 7, schedule: sched, teamStats: stats });
  // every team-A filler plays 3 vs 4.4 = -5.6%: a filler is above him when pts * 0.944 > 47.56, i.e. pts >= 51:
  // that is 50 fillers (51..100), so he sits at index 50
  assert.equal(indexOf(out, 900), 50);
});

console.log("\ninjuries (Step 2, and the return-date rule in Step 3)");
t("return date AFTER window end (10-24) is left out, and logged", () => {
  const out = run([row(1, "A", { injury: "IR,Knee,2026-10-24" }), row(2, "A")]);
  assert.deepEqual(out.rows.map((r) => r.statsId), ["2"]);
  assert.deepEqual(out.log.excluded, [{ player: "P1", returnDate: "2026-10-24" }]);
});
t("return date ON window end (10-23) is kept", () => {
  assert.equal(run([row(1, "A", { injury: "IR,Knee,2026-10-23" })]).rows.length, 1);
});
t("returning 10-19: team A has 2 games from then on vs a 3.0 average = -4% => same 41 as the C case", () => {
  const rows = fill(100, "A");
  rows[39] = row(900, "A", { injury: "OUT,Knee,2026-10-19" });
  assert.equal(indexOf(run(rows), 900), 41);
});
t("returning on the last day with no game left: (0 - 3) * 4% = -12%: 61 * 0.88 = 53.68; points 54..100 (47) minus 61 = 46", () => {
  const rows = fill(100, "A");
  rows[39] = row(900, "A", { injury: "OUT,Knee,2026-10-23" });
  assert.equal(indexOf(run(rows), 900), 46);
});
t("a return date already past is treated as healthy for scheduling (same as an uninjured D player: 37)", () => {
  const rows = fill(100, "A");
  rows[39] = row(900, "D", { injury: "DAY-TO-DAY,Upper Body,2026-10-15" });
  assert.equal(indexOf(run(rows), 900), 37);
});
t("the Injury text is carried over unchanged", () => {
  assert.equal(run([row(1, "A", { injury: "DAY-TO-DAY,Upper Body,2026-10-18" })]).rows[0].injury, "DAY-TO-DAY,Upper Body,2026-10-18");
});

// ------------------------------------------------------------------ matchups
// Four teams, all with exactly 3 games, so there is NO games effect. The fillers play team F, who face Y three
// times; the test player plays team T, who face X three times. Fillers and test player see DIFFERENT opponents,
// which is the only way relative order can change. (A first draft put them on one team, so every matchup test
// passed for the wrong reason.)
console.log("\nmatchups (Step 5)");
const sched2 = () => {
  const mk = (opp) => ["2026-10-17", "2026-10-18", "2026-10-19"].map((d) => g(d, opp));
  return new Map([["F", mk("Y")], ["T", mk("X")], ["X", mk("T")], ["Y", mk("F")]]);
};
const st2 = (over = {}) =>
  new Map(["F", "T", "X", "Y"].map((tm) => [tm, { gfpg: 3.0, gapg: 3.0, basis: "current", ...(over[tm] ?? {}) }]));
const mrun = (rows, over) => runOutlook({ rows, today: TODAY, window: 7, schedule: sched2(), teamStats: st2(over) });
const fillF = () => fill(100, "F");

t("no games effect in this setup: every team has 3 games => league average 3.0", () => {
  assert.equal(mrun([row(1, "F")]).log.leagueAvgGames, 3.0);
});
t("skater: X allows 4.0 vs average 3.25 => +0.75 * 8% = +6%; fillers (vs Y 3.0) are -2%: 61*1.06=64.66, fillers need pts*0.98>64.66 => pts>=66 => 35", () => {
  const rows = fillF();
  rows[39] = row(900, "T");
  assert.equal(indexOf(mrun(rows, { X: { gapg: 4.0 } }), 900), 35);
});
t("skater matchup is capped at +8%: X allows 6.0 (avg 3.75, +18% uncapped) => 61*1.08=65.88; fillers -6%, need pts*0.94>65.88 => pts>=71 => 30", () => {
  const rows = fillF();
  rows[39] = row(900, "T");
  assert.equal(indexOf(mrun(rows, { X: { gapg: 6.0 } }), 900), 30);
});
t("skater matchup is capped at -8%: X allows 0.0 (avg 2.25) => 61*0.92=56.12; fillers +6%, need pts*1.06>56.12 => pts>=53 => 48, minus 61 => 47", () => {
  const rows = fillF();
  rows[39] = row(900, "T");
  assert.equal(indexOf(mrun(rows, { X: { gapg: 0.0 } }), 900), 47);
});
t("goalie: a weak-SCORING opponent is the easy matchup: X scores 2.5 (avg 2.875) => +3% => 61*1.03=62.83; pts>=63 above => 38", () => {
  const rows = fillF();
  rows[39] = row(900, "T", { positions: "G" });
  assert.equal(indexOf(mrun(rows, { X: { gfpg: 2.5 } }), 900), 38);
});
t("goalie: a HIGH-scoring opponent must cost rank, not help: X scores 4.5 => capped -8% => 61*0.92=56.12 => 43", () => {
  const rows = fillF();
  rows[39] = row(900, "T", { positions: "G" });
  assert.equal(indexOf(mrun(rows, { X: { gfpg: 4.5 } }), 900), 43);
});
t("a skater is NOT affected by goals-for, only goals-against (X scores 9, still 39)", () => {
  const rows = fillF();
  rows[39] = row(900, "T");
  assert.equal(indexOf(mrun(rows, { X: { gfpg: 9 } }), 900), 39);
});
t("with zero games the matchup step is skipped: returns after the last game => only -12% applies; fillers (vs Y) get -6% from the X=6.0 average: pts*0.94>53.68 => pts>=58 => 43, minus 61 => 42", () => {
  const rows = fillF();
  rows[39] = row(900, "T", { injury: "OUT,Knee,2026-10-23" });
  assert.equal(indexOf(mrun(rows, { X: { gapg: 6.0 } }), 900), 42);
});

// ----------------------------------------------------------------- structure
console.log("\nstructure");
t("a team with no schedule is skipped and reported, never guessed", () => {
  const out = run([row(1, "ZZZ"), row(2, "A")]);
  assert.deepEqual(out.log.teamsWithoutSchedule, ["ZZZ"]);
  assert.deepEqual(out.rows.map((r) => r.statsId), ["1", "2"]);
});
t("ties keep the source order", () => {
  assert.deepEqual(run([row(1, "A"), row(2, "A"), row(3, "A")]).rows.map((r) => r.statsId), ["1", "2", "3"]);
});
t("end of window exclusive drops the 10-23 game: D falls to 3, league average = (3+3+2+3)/4 = 2.75", () => {
  assert.equal(run([row(1, "A")], { endInclusive: false }).log.leagueAvgGames, 2.75);
});
t("basis is reported: teams on last season's numbers are listed", () => {
  const out = run([row(1, "A")], { teamStats: flat({ A: { basis: "prior" }, B: { basis: "prior" } }) });
  assert.deepEqual(out.log.basis.prior, ["A", "B"]);
  assert.deepEqual(out.log.basis.current, ["C", "D"]);
});
t("deterministic", () => {
  const rows = [...fill(60, "A"), row(900, "D"), row(901, "C")];
  assert.deepEqual(run(rows).rows, run(rows).rows);
});
t("helpers: returnDateOf, addDays", () => {
  assert.equal(returnDateOf("IR,Knee,2026-12-03"), "2026-12-03");
  assert.equal(returnDateOf(""), null);
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
});

console.log(`\n${passed} passed${process.exitCode ? " -- WITH FAILURES" : ", 0 failed"}`);
