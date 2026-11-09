// Pick `n` players from a ranked list while keeping the set varied (positions and teams).
import type { PlayerWeek, PosGroup } from "@/src/fantasy/types";

/**
 * Diversity caps per set of 3.
 *
 * Goalies are capped at 1: save-volume scoring means goalies structurally
 * out-earn skaters over a week, so an uncapped list reliably returned two
 * goalies in the top three (observed with real 2025-26 data). One goalie keeps
 * the post readable as a skater story.
 */
export const MAX_PER_GROUP: Record<PosGroup, number> = { F: 2, D: 2, G: 1 };
export const PICK = 3;

/**
 * Take `n` players, allowing at most `maxPerGroup` from any position group.
 * If the cap makes `n` unreachable it relaxes rather than returning short --
 * we'd rather post 3 forwards than 2 players, and the caller is warned.
 */
export function pickWithDiversity(
  candidates: PlayerWeek[],
  n = PICK,
  caps: Record<PosGroup, number> = MAX_PER_GROUP,
  maxPerTeam = 2,
): { picked: PlayerWeek[]; relaxed: boolean; relaxedTeam: boolean } {
  const posCount: Record<PosGroup, number> = { F: 0, D: 0, G: 0 };
  const teamCount = new Map<string, number>();
  const picked: PlayerWeek[] = [];

  const take = (c: PlayerWeek) => {
    picked.push(c);
    posCount[c.posGroup]++;
    teamCount.set(c.teamAbbr, (teamCount.get(c.teamAbbr) ?? 0) + 1);
  };

  // Strict: honour both the position and team caps.
  for (const c of candidates) {
    if (picked.length === n) break;
    if (posCount[c.posGroup] >= caps[c.posGroup]) continue;
    if ((teamCount.get(c.teamAbbr) ?? 0) >= maxPerTeam) continue;
    take(c);
  }

  let relaxedTeam = false;
  let relaxed = false;

  // Relax the TEAM cap first -- two players from one club reads better than two
  // goalies or an unfilled slot.
  if (picked.length < n) {
    for (const c of candidates) {
      if (picked.length === n) break;
      if (picked.includes(c)) continue;
      if (posCount[c.posGroup] >= caps[c.posGroup]) continue;
      relaxedTeam = true;
      take(c);
    }
  }

  // Then relax positions, still keeping goalies last so the one-goalie rule is
  // never silently undone.
  if (picked.length < n) {
    relaxed = true;
    for (const pass of [0, 1] as const) {
      for (const c of candidates) {
        if (picked.length === n) break;
        if (picked.includes(c)) continue;
        if (pass === 0 && c.posGroup === "G") continue;
        take(c);
      }
      if (picked.length === n) break;
    }
  }

  return { picked, relaxed, relaxedTeam };
}

