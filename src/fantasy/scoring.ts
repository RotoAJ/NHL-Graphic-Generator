import type { PlayerWeek, PosGroup } from "@/src/fantasy/types";

/**
 * Fantasy scoring weights.
 *
 * PLACEHOLDER VALUES. These should be replaced by the real category weights from
 * Yahoo league 67213's settings once OAuth is wired up (see PRD §5) -- that is the
 * whole reason we read the league. Until then these are a defensible standard
 * points-league approximation, kept in one place so the swap is a single edit.
 */
export const SKATER_WEIGHTS = {
  goals: 3,
  assists: 2,
  sog: 0.4,
  blocks: 0.4,
  hits: 0.3,
  ppGoals: 0.5,
  plusMinus: 0.3,
} as const;

export const GOALIE_WEIGHTS = {
  wins: 4,
  saves: 0.3,
  goalsAgainst: -1.5,
  shutouts: 3,
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
    p.sog * s.sog +
    p.blocks * s.blocks +
    p.hits * s.hits +
    p.ppGoals * s.ppGoals +
    p.plusMinus * s.plusMinus
  );
}
