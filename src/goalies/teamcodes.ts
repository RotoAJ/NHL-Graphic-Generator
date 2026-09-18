// RotoWire team codes -> NHL API team abbreviations.
//
// Derived from the ProjectedGoalies feed's own <Name> values (not guessed):
// 8 of 32 differ from the NHL's abbreviations. The dangerous one is LAS, which
// is VEGAS (Las Vegas), not Los Angeles -- LOS is the LA Kings. Reading LAS as
// Los Angeles silently swaps two teams' logos and stats.
export const ROTOWIRE_TO_NHL: Record<string, string> = {
  ANA: "ANA",
  BOS: "BOS",
  BUF: "BUF",
  CAR: "CAR",
  CGY: "CGY",
  CHI: "CHI",
  CLM: "CBJ", // Columbus Blue Jackets
  COL: "COL",
  DAL: "DAL",
  DET: "DET",
  EDM: "EDM",
  FLA: "FLA",
  LAS: "VGK", // Vegas Golden Knights -- NOT Los Angeles
  LOS: "LAK", // Los Angeles Kings
  MIN: "MIN",
  MON: "MTL", // Montreal Canadiens
  NAS: "NSH", // Nashville Predators
  NJD: "NJD",
  NYI: "NYI",
  NYR: "NYR",
  OTT: "OTT",
  PHI: "PHI",
  PIT: "PIT",
  SAN: "SJS", // San Jose Sharks
  SEA: "SEA",
  STL: "STL",
  TAM: "TBL", // Tampa Bay Lightning
  TOR: "TOR",
  UTA: "UTA",
  VAN: "VAN",
  WAS: "WSH", // Washington Capitals
  WPG: "WPG",
};

/** Translate a RotoWire team code to an NHL abbreviation (null if unknown). */
export function toNhlAbbr(rotowireCode: string): string | null {
  return ROTOWIRE_TO_NHL[rotowireCode.trim().toUpperCase()] ?? null;
}
