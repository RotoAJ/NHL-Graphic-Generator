// Backtest for the "Time to Cut Bait" list using the real selection rules in src/fantasy/drops.ts.
//
//   npx tsx scripts/drop-backtest.mts [weekEnd ...]     (default: every Sunday from Oct 18 on)
//
// Needs two weeks of box scores per run. Caveat: Yahoo gives only TODAY's % rostered, so past weeks are
// scored against current ownership. Injuries are not applied (a player with games in both weeks was not out).
import { getWeekProduction, refineExactStats } from "@/src/fantasy/nhl";
import { fetchOwnershipByName, initialKey } from "@/src/fantasy/yahooPublic";
import { DROP_TIERS, dropCandidates, pickDrops, qualifies } from "@/src/fantasy/drops";
import type { PlayerWeek } from "@/src/fantasy/types";

function sundays(): string[] {
  const out: string[] = [];
  const d = new Date("2026-10-18T00:00:00Z");
  while (d.getTime() + 86400000 <= Date.now()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}
const minus7 = (iso: string) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - 7 * 86400000).toISOString().slice(0, 10);

const weeks = process.argv.length > 2 ? process.argv.slice(2) : sundays();
const byName = await fetchOwnershipByName(900);

for (const end of weeks) {
  const a = await getWeekProduction(end);
  const b = await getWeekProduction(minus7(end));
  const own = new Map<string, number>();
  for (const p of [...a.players, ...b.players]) {
    const o = byName.get(initialKey(p.shortName));
    if (o !== undefined) own.set(p.playerId, o);
  }
  // Exact PP points / shutouts only for people who could plausibly qualify (rostered 70%+).
  const rostered = (ps: PlayerWeek[]) => ps.filter((p) => (own.get(p.playerId) ?? 0) >= 70);
  await refineExactStats(rostered(a.players), a.window);
  await refineExactStats(rostered(b.players), b.window);

  const cands = dropCandidates(a.players, b.players, own);
  console.log(`=== ${b.window.from} to ${a.window.to}: ${cands.length} players eligible to be judged ===`);
  console.log("qualifying per tier (skaters / goalies):");
  DROP_TIERS.forEach((t, i) => {
    const q = cands.filter((c) => qualifies(c, t));
    const g = q.filter((c) => c.combined.posGroup === "G").length;
    console.log(`  tier ${i + 1}  >=${t.minOwn}% skater<=${t.skaterBar} goalie<=${t.goalieBar}:  ${q.length - g} / ${g}`);
  });
  const r = pickDrops(cands);
  console.log(`picked ${r.picked.length} using tier ${r.tierIndex + 1}${r.relaxed ? " (position cap relaxed)" : ""}${r.relaxedTeam ? " (team cap relaxed)" : ""}:`);
  for (const c of r.picked) {
    const p = c.combined;
    const line = p.posGroup === "G" ? `${p.wins}W ${p.saves}SV ${p.goalsAgainst}GA` : `${p.goals}G ${p.assists}A ${p.sog}SOG ${p.blocks}BLK ${p.plusMinus >= 0 ? "+" : ""}${p.plusMinus}`;
    const wk = (x: PlayerWeek | null) => (x && x.games ? (x.fantasyPoints / x.games).toFixed(1) : "-");
    console.log(`   ${p.shortName.padEnd(16)} ${p.position.padEnd(2)} ${p.teamAbbr.padEnd(4)} ${String(c.own).padStart(3)}%  ${p.games}GP ${p.fantasyPoints.toFixed(1).padStart(5)}FP ${c.fpg.toFixed(2)}/g (wk1 ${wk(c.prev)}, wk2 ${wk(c.cur)})  ${line}`);
  }
  // Goalie reference so the goalie bar can be sanity-checked.
  const goalies = cands.filter((c) => c.combined.posGroup === "G" && c.own >= 70).sort((x, y) => x.fpg - y.fpg).slice(0, 5);
  console.log("  lowest rostered goalies (14-day FP/g): " + goalies.map((c) => `${c.combined.shortName} ${c.fpg.toFixed(1)} (${c.combined.games}GP)`).join(", "));
  console.log();
}
