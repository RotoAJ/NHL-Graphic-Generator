// RotoWire injury feed -> set of unavailable players.
//
// Requires ROTOWIRE_API_KEY. Without it the filter is skipped (and the caller
// surfaces a warning) rather than failing the whole run.

const BASE = "https://api.rotowire.com/Hockey/NHL";

/** Statuses that make a player unusable for a "go add him" post.
 *  DAY-TO-DAY is deliberately allowed through -- those players often suit up. */
const UNAVAILABLE = new Set(["OUT", "IR", "IR-LT"]);

export interface InjuryInfo {
  /** Normalized "first last" keys of unavailable players. */
  unavailable: Set<string>;
  /** Normalized keys of day-to-day players (eligible, but worth flagging). */
  dayToDay: Set<string>;
  available: boolean;
}

export function normalizeName(first: string, last: string): string {
  return `${first} ${last}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/gi, "")
    .toLowerCase()
    .trim();
}

/**
 * Tolerant regex parse. The feed is flat and simple
 * (`<Player Id><FirstName><LastName><Position><Injury Status=…>`), so this avoids
 * adding an XML dependency. If the shape ever changes we return an empty set and
 * report unavailable rather than silently filtering nobody.
 */
export async function getInjuries(): Promise<InjuryInfo> {
  const key = process.env.ROTOWIRE_API_KEY;
  const empty: InjuryInfo = {
    unavailable: new Set(),
    dayToDay: new Set(),
    available: false,
  };
  if (!key) return empty;

  let xml: string;
  try {
    const res = await fetch(`${BASE}/Injuries.php?key=${encodeURIComponent(key)}`, {
      next: { revalidate: 1800 },
    });
    if (!res.ok) return empty;
    xml = await res.text();
  } catch {
    return empty;
  }

  const unavailable = new Set<string>();
  const dayToDay = new Set<string>();
  // Split on player records, then read the fields within each.
  for (const chunk of xml.split("<Player ").slice(1)) {
    const first = /<FirstName>([^<]*)<\/FirstName>/.exec(chunk)?.[1] ?? "";
    const last = /<LastName>([^<]*)<\/LastName>/.exec(chunk)?.[1] ?? "";
    const status = /<Injury[^>]*Status="([^"]*)"/.exec(chunk)?.[1] ?? "";
    if (!last) continue;
    const key2 = normalizeName(first, last);
    if (UNAVAILABLE.has(status.toUpperCase())) unavailable.add(key2);
    else if (status.toUpperCase() === "DAY-TO-DAY") dayToDay.add(key2);
  }
  return { unavailable, dayToDay, available: unavailable.size > 0 || dayToDay.size > 0 };
}
