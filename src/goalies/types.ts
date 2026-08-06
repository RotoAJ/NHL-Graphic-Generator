// Domain types for the goalie matchup tool.

/** A goalie option for the pickers / a resolved starter. */
export interface GoalieRef {
  id: string;
  fullName: string;
  teamAbbr: string;
  headshotUrl: string | null;
}

/** Aggregate line over a goalie's most recent starts. */
export interface LastStarts {
  /** How many starts the numbers actually cover (may be < 5 early in a season). */
  count: number;
  wins: number;
  losses: number;
  otLosses: number;
  /** Goals-against average, e.g. 2.84. Null when count === 0. */
  gaa: number | null;
  /** Save percentage 0-1, e.g. 0.899. Null when count === 0. */
  savePct: number | null;
  /** Season the stats came from, e.g. 20252026. */
  season: number | null;
  /** True when we had to fall back to a previous season for the sample. */
  fromPriorSeason: boolean;
}

/** A goalie's line in one specific game. */
export interface GameLine {
  decision: string | null;
  saves: number;
  shotsAgainst: number;
}

/** The most recent completed meeting between two clubs. */
export interface LastMeeting {
  gameId: number;
  date: string;
  awayAbbr: string;
  awayScore: number;
  homeAbbr: string;
  homeScore: number;
  /** REG | OT | SO */
  periodType: string;
  season: number;
  fromPriorSeason: boolean;
}

/** Everything the matchup renderer needs. */
export interface MatchupData {
  away: GoalieSide;
  home: GoalieSide;
  lastMeeting: LastMeeting | null;
  /** Free-form game time label, e.g. "7:00 PM ET". */
  gameTime: string | null;
}

export interface GoalieSide {
  goalie: GoalieRef;
  lastStarts: LastStarts;
  /** The goalie's line in the last meeting, if they played in it. */
  lastMeetingLine: GameLine | null;
}
