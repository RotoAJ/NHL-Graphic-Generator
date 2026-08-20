// X thread text. Templates live here so copy tweaks are a one-file change.
import type { Finalist, SelectionResult } from "@/src/fantasy/types";

function statLine(f: Finalist): string {
  if (f.posGroup === "G") {
    return `${f.wins}W, ${f.saves} SV, ${f.goalsAgainst} GA in ${f.games} GP`;
  }
  return `${f.goals}G ${f.assists}A in ${f.games} GP`;
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[m - 1]} ${d}`;
}

export function starsThread(r: SelectionResult): string {
  const head = `Three Stars of the Week ⭐ (${prettyDate(r.window.from)}–${prettyDate(r.window.to)})`;
  const body = r.stars.map(
    (f, i) =>
      `${i + 1}. ${f.fullName} (${f.position} — ${f.teamAbbr}) — ${statLine(f)} · ${f.fantasyPoints.toFixed(1)} FP`,
  );
  return [head, "", ...body].join("\n");
}

export function sleepersThread(r: SelectionResult): string {
  const head = `Sleepers to Grab 🔍 (${prettyDate(r.window.from)}–${prettyDate(r.window.to)})`;
  const body = r.sleepers.map((f, i) => {
    const own = f.ownership === null ? "" : ` · ${f.ownership}% rostered`;
    return `${i + 1}. ${f.fullName} (${f.position} — ${f.teamAbbr}) — ${statLine(f)}${own}`;
  });
  return [head, "", ...body].join("\n");
}
