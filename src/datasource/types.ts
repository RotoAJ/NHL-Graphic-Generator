import type { PlayerDetail, PlayerSearchResult } from "@/src/types";

/**
 * Source-agnostic player data interface. v1 is backed by the public NHL API
 * (see ./nhl.ts). A future RotoWire internal feed can implement this same
 * interface and be swapped in without touching the API routes or UI.
 */
export interface PlayerDataSource {
  search(query: string): Promise<PlayerSearchResult[]>;
  getPlayer(id: string): Promise<PlayerDetail | null>;
}
