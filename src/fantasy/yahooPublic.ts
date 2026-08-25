// Yahoo public read-only Fantasy endpoints -- league-wide "% rostered".
//
// This is the primary ownership source. It needs NO OAuth, no developer app and
// no approval: `pub-api-ro.fantasysports.yahoo.com` serves percent_owned openly.
// (AJ found this host; it makes the whole OAuth path optional.)
//
// The game key changes every season, so it is fetched at runtime rather than
// hardcoded -- a fixed key would silently break each October.

const HOST = "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 21600 }, // 6h
  });
  if (!res.ok) throw new Error(`Yahoo public API ${res.status} for ${url}`);
  return res.json();
}

/** Walk the nested payload collecting every value under `want`. */
function collect(node: unknown, want: string, out: unknown[] = []): unknown[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const v of node) collect(v, want, out);
    return out;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === want) out.push(v);
    collect(v, want, out);
  }
  return out;
}

let cachedGameKey: { key: string; at: number } | null = null;
const GAME_KEY_TTL = 24 * 60 * 60 * 1000;

/** Current NHL game key (e.g. "477" for the 2026-27 season). */
export async function getGameKey(): Promise<string> {
  if (cachedGameKey && Date.now() - cachedGameKey.at < GAME_KEY_TTL) {
    return cachedGameKey.key;
  }
  const data = await getJson(`${HOST}/game/nhl?format=json_f`);
  const key = collect(data, "game_key").find(
    (k): k is string => typeof k === "string" && /^\d+$/.test(k),
  );
  if (!key) throw new Error("Could not determine the current NHL game key");
  cachedGameKey = { key, at: Date.now() };
  return key;
}

/** "Brandon Brink" -> "b brink"; "B. Brink" -> "b brink" */
export function initialKey(name: string): string {
  const clean = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\./g, "")
    .replace(/[^A-Za-z\s'-]/g, "")
    .toLowerCase()
    .trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return clean;
  return `${parts[0][0]} ${parts.slice(1).join(" ")}`;
}

let cache: { at: number; map: Map<string, number> } | null = null;
const TTL = 6 * 60 * 60 * 1000;
const PAGE = 25;

/**
 * name-key -> percent owned, walking pages ordered by season rank so the most
 * fantasy-relevant players are covered first. Stops early once a page adds
 * nothing new (Yahoo's sorted list is finite).
 */
export async function fetchOwnershipByName(maxPlayers = 800): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < TTL) return cache.map;

  const gameKey = await getGameKey();
  const map = new Map<string, number>();

  for (let start = 0; start < maxPlayers; start += PAGE) {
    const url =
      `${HOST}/games;game_keys=${gameKey}/players;position=ALL;start=${start};` +
      `count=${PAGE};sort=rank_season/percent_owned?format=json_f`;
    let data: unknown;
    try {
      data = await getJson(url);
    } catch {
      break; // stop paging rather than failing the whole run
    }
    let added = 0;
    for (const p of collect(data, "player")) {
      const name = collect(p, "full").find((v): v is string => typeof v === "string");
      const raw = collect(p, "percent_owned")[0];
      const value =
        raw && typeof raw === "object"
          ? Number((raw as { value?: unknown }).value)
          : Number(raw);
      if (!name || !Number.isFinite(value)) continue;
      const key = initialKey(name);
      if (!map.has(key)) {
        map.set(key, value);
        added++;
      }
    }
    if (added === 0) break;
  }

  if (!map.size) throw new Error("Yahoo public ownership returned no usable rows");
  cache = { at: Date.now(), map };
  return map;
}
