// "Featured in the last 2 weeks" history.
//
// Behind an interface so Vercel Postgres can replace the dev store (PRD milestone 5)
// without touching selection.
//
// NOTE: the JSON-file store is DEV ONLY. Vercel's filesystem is ephemeral, so on a
// deployed instance this will not persist between invocations -- that is exactly why
// the PRD calls for Postgres. The interface is identical, so the swap is contained.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FeaturedRecord, ThreadType } from "@/src/fantasy/types";

export const RECENCY_DAYS = 14;

export interface FeaturedStore {
  readonly name: string;
  readonly persistent: boolean;
  /** Player ids featured within the last `days` days. */
  recentIds(days: number): Promise<Set<string>>;
  add(records: FeaturedRecord[]): Promise<void>;
  all(): Promise<FeaturedRecord[]>;
}

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "featured.json");

async function readAll(): Promise<FeaturedRecord[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as FeaturedRecord[];
  } catch {
    return [];
  }
}

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export const fileStore: FeaturedStore = {
  name: "file",
  persistent: false,
  async recentIds(days) {
    const cutoff = daysAgoISO(days);
    const rows = await readAll();
    return new Set(rows.filter((r) => r.featuredOn > cutoff).map((r) => r.playerId));
  },
  async add(records) {
    if (!records.length) return;
    const rows = await readAll();
    rows.push(...records);
    await mkdir(DIR, { recursive: true });
    await writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
  },
  async all() {
    return readAll();
  },
};

export function getFeaturedStore(): FeaturedStore {
  // Postgres implementation lands in milestone 5; until then, dev file store.
  return fileStore;
}

export function makeRecord(
  playerId: string,
  playerName: string,
  position: string,
  threadType: ThreadType,
): FeaturedRecord {
  return {
    playerId,
    playerName,
    position,
    threadType,
    featuredOn: new Date().toISOString().slice(0, 10),
  };
}
