// RotoWire NHL news feed (News.php).
//
// Background: RotoWire's backend permanently loses Updates from a day once that
// day settles into the past -- a day that comes back incomplete stays
// incomplete, and no query trick recovers it afterwards. The only defence is to
// capture items while they are still "today". That was being done by an hourly
// Claude task writing a JSON file to Google Drive; this module does the same
// capture as plain code so it costs nothing to run as often as we like.
//
// Two feed quirks that matter:
//   - Items are bucketed by PACIFIC calendar day, not a rolling 24 hours, so a
//     single bare fetch misses anything that lands on the other side of the
//     Pacific midnight boundary. Always fetch today's and yesterday's buckets.
//   - `Id` on <Update> is an ATTRIBUTE, and is monotonically increasing and
//     gapless in the real underlying data -- which is what makes Id continuity
//     a reliable tripwire for the data-loss bug.
const BASE = "https://api.rotowire.com/Hockey/NHL";

export interface NewsUpdate {
  id: number;
  dateTime: string;
  priority: number | null;
  headline: string;
  notes: string;
  analysis: string;
  playerId: string | null;
  playerName: string | null;
  position: string | null;
  leagueLevel: string | null;
  injuryStatus: string | null;
  injuryType: string | null;
  teamCode: string | null;
}

export type FeedReason = "ok" | "no-key" | "http-error" | "fetch-error" | "empty-parse";

export interface FeedResult {
  updates: NewsUpdate[];
  available: boolean;
  reason: FeedReason;
  detail?: string;
}

/** YYYY-MM-DD in US Pacific, which is the timezone the feed buckets by. */
export function pacificDate(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m && m[1] !== "" ? m[1] : null;
}

/** Pull a child element's text, unwrapping CDATA. */
function text(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return "";
  return m[1]
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

export function parseUpdates(xml: string): NewsUpdate[] {
  const blocks = xml.match(/<Update\b[^>]*>[\s\S]*?<\/Update>/g) ?? [];
  const out: NewsUpdate[] = [];
  for (const b of blocks) {
    const openTag = b.match(/<Update\b[^>]*>/)?.[0] ?? "";
    const id = Number(attr(openTag, "Id"));
    if (!Number.isFinite(id) || id <= 0) continue;

    const playerBlock = b.match(/<Player\b[^>]*>[\s\S]*?<\/Player>/)?.[0] ?? "";
    const playerTag = playerBlock.match(/<Player\b[^>]*>/)?.[0] ?? "";
    const first = text(playerBlock, "FirstName");
    const last = text(playerBlock, "LastName");
    const injuryTag = playerBlock.match(/<Injury\b[^>]*>/)?.[0] ?? "";
    const teamTag = b.match(/<Team\b[^>]*>/)?.[0] ?? "";

    const priority = Number(text(b, "Priority"));
    out.push({
      id,
      dateTime: text(b, "DateTime"),
      priority: Number.isFinite(priority) ? priority : null,
      headline: text(b, "Headline"),
      notes: text(b, "Notes"),
      analysis: text(b, "Analysis"),
      playerId: attr(playerTag, "Id"),
      playerName: `${first} ${last}`.trim() || null,
      position: text(playerBlock, "Position") || null,
      leagueLevel: text(playerBlock, "LeagueLevel") || null,
      injuryStatus: attr(injuryTag, "Status"),
      injuryType: attr(injuryTag, "Type"),
      teamCode: attr(teamTag, "Code"),
    });
  }
  return out;
}

/** Fetch one Pacific-date bucket. Omit `date` for the bare "today" call. */
export async function fetchNews(date?: string): Promise<FeedResult> {
  const key = process.env.ROTOWIRE_API_KEY;
  if (!key) return { updates: [], available: false, reason: "no-key" };

  const url =
    `${BASE}/News.php?key=${encodeURIComponent(key)}` +
    (date ? `&date=${date}` : "") +
    // Cache-bust: a stale cached response is one of the few recoverable
    // failure modes, and this capture is the only chance to get the data.
    `&_ts=${Date.now()}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/xml,text/xml,*/*" },
      cache: "no-store",
    });
    if (!res.ok) {
      return { updates: [], available: false, reason: "http-error", detail: `HTTP ${res.status}` };
    }
    const xml = await res.text();
    const updates = parseUpdates(xml);
    if (!updates.length && !/<Updates?\b|<NHL\b|<Feed\b/i.test(xml)) {
      return { updates: [], available: false, reason: "empty-parse", detail: `${xml.length} bytes` };
    }
    return { updates, available: true, reason: "ok" };
  } catch (e) {
    return { updates: [], available: false, reason: "fetch-error", detail: (e as Error).message };
  }
}

/**
 * Today's and yesterday's Pacific buckets, merged and de-duplicated by Id.
 * Both are needed because the feed buckets by Pacific calendar day.
 */
export async function fetchRecentNews(): Promise<{
  updates: NewsUpdate[];
  buckets: Array<{ date: string; count: number; reason: FeedReason }>;
}> {
  const dates = [pacificDate(0), pacificDate(-1)];
  const byId = new Map<number, NewsUpdate>();
  const buckets: Array<{ date: string; count: number; reason: FeedReason }> = [];

  for (const d of dates) {
    const r = await fetchNews(d);
    buckets.push({ date: d, count: r.updates.length, reason: r.reason });
    for (const u of r.updates) if (!byId.has(u.id)) byId.set(u.id, u);
  }

  return {
    updates: [...byId.values()].sort((a, b) => a.id - b.id),
    buckets,
  };
}
