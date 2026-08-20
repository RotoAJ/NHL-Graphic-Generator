# PRD — Fantasy Hockey Analytics Tool (Hub Tab #2)

**Owner:** AJ Scholz · **Author:** Andrew Scholz
**Status:** Draft for approval · **Date:** 2026-08-19
**Target:** ready before the 2026-27 season opens (early Oct 2026)

---

## 1. Summary

A third tool in the RotoWire NHL Social Hub that generates two ready-to-post X threads each
week — **"Three Stars of the Week"** and **"Sleepers to Grab"** — each backed by illustrated
trading-card graphics for the selected players. Output is copy/paste plus downloadable images,
delivered to Slack for review.

**No X API needed** — this tool produces text and images for a human to post, so unlike the
goalie matchup tool it is not blocked on X credentials.

---

## 2. Confirmed Decisions

| Decision | Choice |
|---|---|
| **Ownership source** | Yahoo **global `percent_owned`** via the official API (OAuth2) |
| **Card art** | **Split layout, full-bleed action photo** in the new RotoWire brand palette (§6) — modelled on the @NHLFantasy reference AJ supplied |
| **Slack** | **Deliver threads + cards to Slack for review** |
| **Diversity rule** | **Max 2 players per position group** (F / D / G) per set of 3 |
| **UI** | React via Next.js App Router, one client component |
| **Card rendering** | Server-side `@napi-rs/canvas` (already in the project) |
| **Persistence** | **Vercel Postgres (Neon)** — real table, real date query |

---

## 3. Corrections to the Original Spec

These are deliberate departures from the brief, each for a concrete reason:

1. **"Ownership < 50%" cannot come from league 67213.** In a single league a player is rostered
   or not — there is no 30% state. We use Yahoo's **league-wide `percent_owned`** instead.
   League 67213 is still used, but for a different purpose (see #3).
2. **No scraping.** Yahoo has a documented NHL API; scraping violates their ToS and breaks on
   markup changes. We use OAuth2 against the official API.
3. **Stats come from the NHL API, not Yahoo.** Yahoo has no clean "last 7 days" range for NHL
   players, and the NHL API is free, needs no OAuth, and is already proven from Vercel. **Yahoo is
   reduced to a single field (`percent_owned`) plus league 67213's scoring settings**, which we
   read once so fantasy points are computed with *your league's* weights rather than a guess.
4. **Sports-Reference is dropped.** No public API and its ToS forbids scraping. The NHL API
   supplies both headshots and action shots; ESPN can be added later as an optional supplement.
5. **Headshots, not action shots, for the cards.** Verified during prototyping: action-shot
   composition varies wildly (McDavid's is a goal scene with the player small and off-centre),
   which is unusable for uniform cards. Headshots are consistently framed, and the stylization
   pass is what supplies the illustrated feel.
6. **Score formula normalized.** `(points × 0.7) + ((50 − ownership) × 0.3)` mixes raw scales —
   fantasy points span roughly 0-40 while `(50 − ownership)` spans 0-50, so ownership silently
   carries more than 30% of the weight. Both terms are normalized to 0-100 first, preserving the
   70/30 intent. A config flag can restore the literal formula.

---

## 4. Architecture

All net-new; the two existing tools are untouched.

```
app/fantasy/page.tsx                  tool UI (new tab)
app/_components/FantasyTool.tsx       generate, preview, copy threads, download cards
app/api/fantasy/generate/route.ts     selection + card rendering + thread text
app/api/fantasy/featured/route.ts     featured-history read/write
app/api/fantasy/slack/route.ts        push threads + cards to Slack
src/fantasy/
  yahoo.ts        OAuth2 client; percent_owned; league scoring settings
  production.ts   last-7-days G/A/FP from the NHL API
  injuries.ts     RotoWire Injuries.php (active/inactive filter)
  select.ts       scoring, diversity weighting, recency filter
  threads.ts      X thread templates
  db.ts           featured_players persistence
  types.ts
src/render/
  card.ts         trading-card renderer
  stylize.ts      posterize + duotone + halftone pass
```

Adding the tab is one row in `SiteNav.tsx`'s `TOOLS` array.

---

## 5. Data Sources (all verified 2026-08-19)

| Need | Source | Status |
|---|---|---|
| Last-7-days G / A / TOI / saves | NHL API `/v1/player/{id}/game-log/{season}/2` | ✅ proven |
| Player universe + teams | NHL API club-stats + roster (club-stats primary) | ✅ proven |
| Headshots | NHL API `headshot` | ✅ proven |
| Injuries / inactive | RotoWire `Hockey/NHL/Injuries.php` | ✅ **live data now** |
| Player news (optional thread colour) | RotoWire `Hockey/NHL/News.php` | ✅ **live data now** |
| Ownership % | Yahoo Fantasy API `percent_owned` | ⛔ needs OAuth (§9) |
| League scoring weights | Yahoo league `67213` settings | ⛔ needs OAuth (§9) |

**Not available anywhere:** season-long projections or rankings (RotoWire's
`Projections.php` / `Rankings.php` / `Stats.php` all 404). Everything season-long must be derived.

> Reminder from the goalie build: NHL roster endpoints **drop players who moved mid-season**.
> Always use `club-stats` as the primary player source.

---

## 6. Card Design — **APPROVED** (see `output/card-F-star.png`, `output/card-F-sleeper.png`)

**1200×1500** portrait (4:5), modelled on the @NHLFantasy reference. Split composition:

**Left column (~50%) — strictly brand, never team-tinted:**
- Team logo tile, top-left
- Player first/last name **stacked**, heavy condensed caps, drop shadow
- Position beneath
- Coral label ("LAST 7 DAYS / FANTASY POINTS")
- **One huge coral hero number** — the fantasy-points total
- **Coral filled band**, white text: `{G}G {A}A · {GP} GP`
- Secondary line: `{own}% ROSTERED` (sleepers) or the thread name (stars)
- RotoWire logo bottom-left

**Right column (~50%) — full-bleed action photo**, cover-cropped with an upward bias so heads
stay in frame, graded toward brand navy (multiply + navy wash) so bright white ice doesn't
overpower the card, with a dark falloff at the split so the text column separates.

### Brand palette — sampled directly from the new logo file, not guessed
| Token | Value | Use |
|---|---|---|
| Coral | **`#F22E45`** | labels, hero number, band, split rule |
| Navy | **`#002248`** | bottom of the column gradient |
| Navy mid / deep | `#001C3C` / `#0A1220` | gradient body, photo falloff |
| White | `#FFFFFF` | names, band text, secondary line |

**Deliberate choice:** the info column is *not* tinted per team. Coral clashes badly with red
teams (DET, CGY, CAR); team identity comes through the logo tile and the photo instead. This also
keeps every card visually consistent as a set.

### Photo strategy
1. **NHL action shot** (`actionshots/1296x729/{nhlId}.jpg`) — primary; suits the full-bleed panel.
2. **ESPN transparent cutout** (`a.espncdn.com/i/headshots/nhl/players/full/{espnId}.png`) —
   fallback, composited over a navy panel. Requires name→ESPN-id matching (~2,672 athletes).
3. **NHL headshot** — last resort.

> Rejected during prototyping, recorded so we don't revisit: a **posterized/illustrated cutout**
> (`card-B2-illustrated.png`) looked good in isolation but cannot fill a tall full-bleed panel —
> a head-and-shoulders cutout leaves the face stranded at the bottom (`card-D-nhlfantasy.png`).
> A 3-level "ink" treatment (`card-C-ink.png`) destroyed the likeness.

---

## 7. Selection Algorithm

**Shared pool:** every player with ≥1 game in the trailing 7 days.
**Fantasy points:** computed from NHL stat lines using league 67213's scoring weights.

### A. Three Stars of the Week
1. Rank pool by fantasy points → take **top 15**.
2. Drop anyone **injured/inactive** (RotoWire injuries).
3. Drop anyone **featured in the last 14 days** (database).
4. Apply **diversity: max 2 per position group** (F / D / G).
5. Return **3**.

### B. Sleepers to Grab
1. Same pool, filtered to **`percent_owned` < 50%**.
2. Score = `normalize(fantasyPoints) × 0.7 + normalize(50 − percent_owned) × 0.3`.
3. Same injury + recency + diversity filters.
4. Return **3**, ownership % shown on each card.

### Edge cases
| Case | Behaviour |
|---|---|
| Fewer than 3 survive the filters | Return what qualifies, surface a warning in the UI — never pad with an injured or repeat player |
| Diversity rule can't be met | Relax to "max 2" best-effort and flag it, rather than failing |
| Ownership unavailable (Yahoo down / preseason) | Sleepers section degrades to a clearly-labelled proxy metric; stars section unaffected |
| Tie in score | Break by fantasy points, then fewer games played (more efficient) |

---

## 8. Threads, Persistence, Slack

### Thread format (templates editable in one file)
```
Three Stars of the Week 🌟
1. {Name} ({POS} — {TEAM}) — {G}G {A}A in {N} games
2. …
3. …
```
Sleepers add `— {own}% owned`. Text is plain (no auto-posting), with a copy button per thread.

### Postgres schema
```sql
CREATE TABLE featured_players (
  id          SERIAL PRIMARY KEY,
  player_id   TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position    TEXT NOT NULL,
  thread_type TEXT NOT NULL,          -- 'stars' | 'sleepers'
  featured_on DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX ON featured_players (featured_on);
```
Recency filter: `SELECT player_id FROM featured_players WHERE featured_on > CURRENT_DATE - 14`.
Rows are written only when a set is **confirmed/posted**, not on every preview — otherwise
experimenting would burn players out of eligibility.

### Slack
A server route posts both threads plus the six card images to a channel via **incoming webhook**
(simplest) or bot token (needed for image uploads — see §9). Same review-first posture as the
goalie tool.

---

## 9. What I Need From You

**Never paste secrets in chat** — add them directly to Vercel's environment variables.

| Variable | For | Notes |
|---|---|---|
| `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` | ownership + league settings | Create an app at developer.yahoo.com with Fantasy Sports **read** scope |
| `YAHOO_REFRESH_TOKEN` | keeping access alive | From a one-time OAuth consent as a user in league 67213. I'll build a local helper route to capture it |
| `SLACK_BOT_TOKEN` (+ channel id) | posting cards | A **bot token** is required to upload images; a plain webhook can post text only |
| `POSTGRES_URL` | featured history | Auto-set when you create Vercel Postgres on the project |
| `ROTOWIRE_API_KEY` | injuries / news | Still outstanding from the goalie work; rotation recommended |

**Also needed:** confirmation of the **Yahoo game key** for 2026-27 (league keys look like
`{game_key}.l.67213`), and whether the league already exists for the new season.

---

## 10. Offseason Strategy

No last-7-days stats and no ownership exist in August. Approach:

1. **Replay real 7-day windows** from the NHL API (e.g. 2026-03-08 → 2026-03-15) — real goals and
   assists, so selection and card output are genuinely verifiable now.
2. **Ownership fixture** behind an interface, swapped for Yahoo when credentials land. Same
   pattern as the goalie tool's `PlayerDataSource`.
3. **Injuries/news are live today**, so those filters can be tested for real immediately.
4. **Preseason dry run** in late September against live data before the first real post.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Yahoo OAuth refresh tokens expiring | Store refresh token; fail loudly and degrade sleepers to the proxy metric rather than posting wrong data |
| Yahoo rate limits | Fetch ownership once per run, cache per day |
| Stylization unflattering on some players | Tunable constants; preview every card before posting; headshots keep framing uniform |
| Same players dominating weekly | 14-day exclusion + diversity rule; history table is auditable |
| Fantasy-point weights wrong | Read them from league 67213 rather than guessing |
| Postgres cold starts on Vercel | Trivial query volume; acceptable |

---

## 12. Milestones

1. **Production engine** — last-7-days G/A/FP from the NHL API, verified against real box scores.
2. **Card renderer** — stylized portrait + frame; iterate on the look with real players.
3. **Selection engine** — scoring, injuries filter, diversity, recency (ownership via fixture).
4. **UI + threads** — generate, preview 6 cards, copy both threads, download images.
5. **Postgres** — featured history read/write, wired to a "confirm set" action.
6. **Yahoo integration** — OAuth helper, `percent_owned`, league scoring settings.
7. **Slack delivery** — threads + card images to a channel.
8. **Preseason dry run** → go live.

**Milestones 1-4 need nothing from you** and are fully verifiable today.
