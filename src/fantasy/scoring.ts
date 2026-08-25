import type { PlayerWeek, PosGroup } from "@/src/fantasy/types";

/**
 * Fantasy scoring weights — standard Yahoo NHL points league, supplied by AJ.
 *
 * Note there is deliberately NO hits category: an earlier placeholder scored
 * hits, which inflated grinders relative to how this league actually scores.
 *
 * PPP is power-play POINTS (goals + assists), not power-play goals. Box scores
 * only expose powerPlayGoals, so PPP starts as an approximation and is refined
 * from per-player game logs for the shortlist (see nhl.ts refinePowerPlayPoints).
 */
export const SKATER_WEIGHTS = {
  goals: 6,
  assists: 4,
  plusMinus: 2,
  ppPoints: 2,
  sog: 0.9,
  blocks: 1,
} as const;

export const GOALIE_WEIGHTS = {
  wins: 5,
  goalsAgainst: -3,
  saves: 0.6,
  shutouts: 5,
} as const;

export function positionGroup(position: string): PosGroup {
  const p = position.toUpperCase();
  if (p === "G") return "G";
  if (p === "D") return "D";
  return "F"; // C, L, R, LW, RW
}

/** Human-readable position for the card. */
export function positionLabel(position: string): string {
  switch (position.toUpperCase()) {
    case "C":
      return "CENTER";
    case "L":
    case "LW":
      return "LEFT WING";
    case "R":
    case "RW":
      return "RIGHT WING";
    case "D":
      return "DEFENSEMAN";
    case "G":
      return "GOALTENDER";
    default:
      return position.toUpperCase();
  }
}

/** Fantasy points for one aggregated window. */
export function fantasyPoints(p: Omit<PlayerWeek, "fantasyPoints">): number {
  if (p.posGroup === "G") {
    const g = GOALIE_WEIGHTS;
    return (
      p.wins * g.wins +
      p.saves * g.saves +
      p.goalsAgainst * g.goalsAgainst +
      p.shutouts * g.shutouts
    );
  }
  const s = SKATER_WEIGHTS;
  return (
    p.goals * s.goals +
    p.assists * s.assists +
    p.plusMinus * s.plusMinus +
    p.ppPoints * s.ppPoints +
    p.sog * s.sog +
    p.blocks * s.blocks
  );
}
