// RotoWire injury feed, keyed by RotoWire player id.
//
// The feed's player Id IS the rankings file's Stats ID (confirmed against
// existing rows), so injuries match by id directly -- no name matching, which is
// what the skill had to do and the main reason it carried an alias map.
//
//   <Player Id="2556"> ... <Injury Type="Calf" Status="IR" Detail="" Side=""
//                                  ReturnDate="2026-12-03"></Injury> ...
import { parseDate, type InjuryEntry } from "@/src/rankings/engine";

const RW = "https://api.rotowire.com/Hockey/NHL";

/** The feed normally carries ~100-175 entries. Far fewer means a bad read. */
const MIN_ENTRIES = 30;

export function parseInjuries(xml: string): Map<string, InjuryEntry> {
  const out = new Map<string, InjuryEntry>();
  for (const seg of xml.split('<Player Id="').slice(1)) {
    const id = (seg.match(/^(\d+)"/) ?? [])[1];
    const tag = (seg.match(/<Injury\b([^>]*)>/) ?? [])[1];
    if (!id || tag === undefined) continue;
    const attr = (name: string): string => {
      const m = tag.match(new RegExp(`${name}="([^"]*)"`));
      return m ? m[1].trim() : "";
    };
    out.set(id, { type: attr("Type"), status: attr("Status"), returnDate: parseDate(attr("ReturnDate")) });
  }
  return out;
}

export async function fetchInjuries(): Promise<{ map: Map<string, InjuryEntry>; count: number }> {
  const key = process.env.ROTOWIRE_API_KEY;
  if (!key) throw new Error("ROTOWIRE_API_KEY is not set.");
  const res = await fetch(`${RW}/Injuries.php?key=${encodeURIComponent(key)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`RotoWire injury feed returned HTTP ${res.status}`);
  const map = parseInjuries(await res.text());
  // A short or empty read would make EVERY stored injury look recovered and wipe
  // them all out, so a run is refused rather than built on it.
  if (map.size < MIN_ENTRIES) {
    throw new Error(
      `The injury feed returned only ${map.size} entries (expected 100+). Refusing to build a run: ` +
        `a short read would clear every injury on file.`,
    );
  }
  return { map, count: map.size };
}
