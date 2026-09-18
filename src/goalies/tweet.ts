// Tweet copy for a confirmed-starters post.
//
// Kept in its own file so wording changes never touch the poller. Per the PRD:
// matchup plus stats, no handles and no hashtags. "Fantasy Hockey" is included
// for the same reason the weekly threads lead with it -- it is the term people
// search on.
import type { GoalieSide, LastMeeting, MatchupData } from "@/src/goalies/types";

/** "4-0-1 · 2.79 GAA · .917 SV%", degrading gracefully when the sample is empty. */
function statLine(side: GoalieSide): string {
  const l5 = side.lastStarts;
  const rec = `${l5.wins}-${l5.losses}-${l5.otLosses}`;
  if (l5.count === 0 || l5.gaa === null || l5.savePct === null) {
    return "no recent starts";
  }
  const sv = l5.savePct.toFixed(3).replace(/^0/, "");
  const label = l5.count < 5 ? `last ${l5.count}` : "last 5";
  return `${label}: ${rec} · ${l5.gaa.toFixed(2)} GAA · ${sv} SV%`;
}

function meetingLine(lm: LastMeeting): string {
  const ot = lm.periodType && lm.periodType !== "REG" ? ` (${lm.periodType})` : "";
  const [y, m, d] = lm.date.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const when = Number.isFinite(m) ? `${months[m - 1]} ${d}` : lm.date;
  return `Last meeting (${when}): ${lm.awayAbbr} ${lm.awayScore} @ ${lm.homeAbbr} ${lm.homeScore}${ot}`;
}

export function matchupTweet(m: MatchupData): string {
  const when = m.gameTime ? ` · ${m.gameTime}` : "";
  const head = `Confirmed Starters 🥅 Fantasy Hockey${when}`;
  const core = [
    `${m.away.goalie.fullName} (${m.away.goalie.teamAbbr}) — ${statLine(m.away)}`,
    `${m.home.goalie.fullName} (${m.home.goalie.teamAbbr}) — ${statLine(m.home)}`,
  ];

  const withMeeting = m.lastMeeting
    ? [head, "", ...core, "", meetingLine(m.lastMeeting)]
    : [head, "", ...core];

  const text = withMeeting.join("\n");
  if (text.length <= 280) return text;

  // Drop the optional tail before touching the stat lines.
  const trimmed = [head, "", ...core].join("\n");
  return trimmed.length <= 280 ? trimmed : trimmed.slice(0, 280);
}
