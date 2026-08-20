// Domain types for the Fantasy Hockey tool.

export type PosGroup = "F" | "D" | "G";
export type ThreadType = "stars" | "sleepers";

/** Raw aggregated production over the trailing window, keyed by NHL player id. */
export interface PlayerWeek {
  playerId: string;
  /** Abbreviated name from the box score, e.g. "B. Brink" (finalists get full names). */
  shortName: string;
  position: string;
  posGroup: PosGroup;
  teamAbbr: string;
  games: number;
  goals: number;
  assists: number;
  points: number;
  sog: number;
  hits: number;
  blocks: number;
  ppGoals: number;
  plusMinus: number;
  // goalie
  wins: number;
  saves: number;
  goalsAgainst: number;
  shutouts: number;
  toiSeconds: number;
  /** Computed fantasy points for the window. */
  fantasyPoints: number;
}

/** A finalist, enriched with the details the card needs. */
export interface Finalist extends PlayerWeek {
  firstName: string;
  lastName: string;
  fullName: string;
  positionLabel: string;
  headshotUrl: string | null;
  actionShotUrl: string | null;
  /** League-wide roster percentage, when available. */
  ownership: number | null;
}

export interface SelectionResult {
  stars: Finalist[];
  sleepers: Finalist[];
  /** Non-fatal problems worth surfacing in the UI. */
  warnings: string[];
  window: { from: string; to: string };
}

/** A previously featured player, for the recency filter. */
export interface FeaturedRecord {
  playerId: string;
  playerName: string;
  position: string;
  threadType: ThreadType;
  featuredOn: string;
}
