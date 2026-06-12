// Shared domain types for the NHL graphic generator.

export type DealType = "TRADE" | "SIGNING";

/** A normalized player search result (source-agnostic). */
export interface PlayerSearchResult {
  id: string;
  fullName: string;
  /** Current NHL team abbreviation, or null if Free Agent / unsigned. */
  teamAbbr: string | null;
  /** Last known team abbreviation (useful when teamAbbr is null). */
  lastTeamAbbr: string | null;
  positionCode: string | null;
}

/** Full normalized player detail used to pre-fill the form. */
export interface PlayerDetail {
  id: string;
  fullName: string;
  /** Current team abbr, or null if the player is a Free Agent. */
  teamAbbr: string | null;
  positionCode: string | null;
  /** Absolute URL to the player headshot. */
  headshotUrl: string | null;
}

/** A player coming back in a trade return. */
export interface ReturnPlayer {
  name: string;
  headshotUrl: string | null;
}

/** Payload posted to /api/render. */
export interface RenderRequest {
  playerName: string;
  headshotUrl: string | null;
  oldTeamAbbr: string;
  newTeamAbbr: string;
  dealText: string;
  dealType: DealType;
  /** Optional players in the return (trades only). Capped at 3. */
  returnPlayers?: ReturnPlayer[];
}
