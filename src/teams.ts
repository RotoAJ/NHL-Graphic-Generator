// The 32 current NHL teams. Abbreviations match the NHL public API and
// the logo asset filenames (assets.nhle.com/logos/nhl/svg/{ABBR}_{light|dark}.svg).

export interface Team {
  abbr: string;
  name: string;
  /** Team nickname for headlines, e.g. "Hurricanes", "Maple Leafs". */
  nickname: string;
  /** Primary brand color, used as an accent behind the logo band. */
  color: string;
}

export const TEAMS: Team[] = [
  { abbr: "ANA", name: "Anaheim Ducks", nickname: "Ducks", color: "#F47A38" },
  { abbr: "BOS", name: "Boston Bruins", nickname: "Bruins", color: "#FFB81C" },
  { abbr: "BUF", name: "Buffalo Sabres", nickname: "Sabres", color: "#003087" },
  { abbr: "CGY", name: "Calgary Flames", nickname: "Flames", color: "#D2001C" },
  { abbr: "CAR", name: "Carolina Hurricanes", nickname: "Hurricanes", color: "#CE1126" },
  { abbr: "CHI", name: "Chicago Blackhawks", nickname: "Blackhawks", color: "#CF0A2C" },
  { abbr: "COL", name: "Colorado Avalanche", nickname: "Avalanche", color: "#6F263D" },
  { abbr: "CBJ", name: "Columbus Blue Jackets", nickname: "Blue Jackets", color: "#002654" },
  { abbr: "DAL", name: "Dallas Stars", nickname: "Stars", color: "#006847" },
  { abbr: "DET", name: "Detroit Red Wings", nickname: "Red Wings", color: "#CE1126" },
  { abbr: "EDM", name: "Edmonton Oilers", nickname: "Oilers", color: "#FF4C00" },
  { abbr: "FLA", name: "Florida Panthers", nickname: "Panthers", color: "#C8102E" },
  { abbr: "LAK", name: "Los Angeles Kings", nickname: "Kings", color: "#A2AAAD" },
  { abbr: "MIN", name: "Minnesota Wild", nickname: "Wild", color: "#154734" },
  { abbr: "MTL", name: "Montreal Canadiens", nickname: "Canadiens", color: "#AF1E2D" },
  { abbr: "NSH", name: "Nashville Predators", nickname: "Predators", color: "#FFB81C" },
  { abbr: "NJD", name: "New Jersey Devils", nickname: "Devils", color: "#CE1126" },
  { abbr: "NYI", name: "New York Islanders", nickname: "Islanders", color: "#00539B" },
  { abbr: "NYR", name: "New York Rangers", nickname: "Rangers", color: "#0038A8" },
  { abbr: "OTT", name: "Ottawa Senators", nickname: "Senators", color: "#C52032" },
  { abbr: "PHI", name: "Philadelphia Flyers", nickname: "Flyers", color: "#F74902" },
  { abbr: "PIT", name: "Pittsburgh Penguins", nickname: "Penguins", color: "#FCB514" },
  { abbr: "SJS", name: "San Jose Sharks", nickname: "Sharks", color: "#006D75" },
  { abbr: "SEA", name: "Seattle Kraken", nickname: "Kraken", color: "#99D9D9" },
  { abbr: "STL", name: "St. Louis Blues", nickname: "Blues", color: "#002F87" },
  { abbr: "TBL", name: "Tampa Bay Lightning", nickname: "Lightning", color: "#002868" },
  { abbr: "TOR", name: "Toronto Maple Leafs", nickname: "Maple Leafs", color: "#00205B" },
  { abbr: "UTA", name: "Utah Mammoth", nickname: "Mammoth", color: "#71AFE5" },
  { abbr: "VAN", name: "Vancouver Canucks", nickname: "Canucks", color: "#00205B" },
  { abbr: "VGK", name: "Vegas Golden Knights", nickname: "Golden Knights", color: "#B4975A" },
  { abbr: "WSH", name: "Washington Capitals", nickname: "Capitals", color: "#C8102E" },
  { abbr: "WPG", name: "Winnipeg Jets", nickname: "Jets", color: "#041E42" },
];

export const TEAM_BY_ABBR: Record<string, Team> = Object.fromEntries(
  TEAMS.map((t) => [t.abbr, t]),
);

export function isKnownTeam(abbr: string | null | undefined): boolean {
  return !!abbr && abbr in TEAM_BY_ABBR;
}
