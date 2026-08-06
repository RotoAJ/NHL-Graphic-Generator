# PRD — RotoWire NHL Social Hub (Phase 2)

**Owner:** AJ Scholz · **Author:** Andrew Scholz
**Status:** Draft for approval — no code written yet
**Date:** 2026-08-06 · **Target:** in place before the 2026-27 season opens (early Oct 2026)

---

## 1. Summary

Expand the existing deployment at <https://nhl-graphic-generator.vercel.app/> from a
single-purpose tool into an **NHL social media hub**: one URL, a shared top nav, and a
growing set of independent tools.

**Phase 2 adds one new tool:** an automated **Goalie Matchup** graphic that fires when both
starting goaltenders for a game are confirmed, showing each goalie's last-5-starts line and
the result of the teams' last meeting — styled like the existing generator, RotoWire logo
included — then posts to X.

**Hard constraint:** the existing trade/signing generator is **not modified**. It keeps its
current URL (`/`), its renderer, and its API routes exactly as they are.

---

## 2. Goals & Non-Goals

### Goals
- Turn the current single-tool app into a **multi-tool hub** with shared navigation, so future
  social tools drop in without touching existing ones.
- Ship a **goalie matchup graphic** generator that works **manually today** (offseason, no live
  feed) and **automatically in-season**.
- Auto-detect confirmed starters and **queue a tweet for one-click approval** (full auto later).
- Build and validate the entire stats pipeline **now**, against completed 2025-26 data.

### Non-Goals
- **No changes to the trade/signing generator** (explicit requirement).
- No admin/user management, no multi-account posting, no analytics dashboard.
- Not migrating to a database in Phase 2 (see §8 — the queue needs storage; scoped as a decision).
- No non-NHL sports.

---

## 3. Confirmed Decisions

| Decision | Choice |
|---|---|
| **Navigation** | Shared top nav + routes. Generator stays at `/`; new tool at `/goalie-matchup`. |
| **Post approval** | **Review queue first.** Cron detects + renders into an in-app queue; a human clicks Post. Flip to full auto after a proving period. |
| **Dimensions** | **1600×900 landscape** (16:9) — displays uncropped in the X timeline. |
| **Stats layout** | Aggregate last-5-starts line per goalie + footer with the last meeting (date, final score, and each goalie's line from that game if they played). |
| **Trigger timing** | Post as soon as **both** starters are confirmed (poll on game days). |
| **Goalie photos** | **Feathered headshots** (reuse the treatment already built) — consistent for every goalie including call-ups. |
| **Tweet copy** | Matchup + stats, **no handles/hashtags**. Template kept easily editable in code. |

---

## 4. Architecture

### 4.1 Navigation (additive only)

```
app/
  layout.tsx          + shared <SiteNav> (only file touched that the generator shares)
  page.tsx              UNCHANGED — trade/signing generator stays at /
  _components/
    SiteNav.tsx       + NEW tab bar
    Generator.tsx       UNCHANGED
  goalie-matchup/
    page.tsx          + NEW tool UI
```

The existing generator's component, renderer (`src/render/poster.ts`), and routes
(`/api/search`, `/api/player/[id]/`, `/api/render-poster`) are **untouched**. The only shared
file that changes is `layout.tsx`, to render the nav above whatever page is active. Keeping
the generator at `/` means every existing bookmark and link still works.

### 4.2 New modules (all net-new files)

```
src/goalies/
  grid.ts              GoalieGrid XML fetch + parse -> normalized matchups
  stats.ts             last-5-starts + head-to-head from the NHL API
  resolve.ts           goalie name -> NHL player id (team-scoped)
  fixtures/
    goalie-grid.sample.xml   hand-authored in-season payload for offseason dev
src/render/
  matchup.ts           NEW 1600x900 renderer (separate from poster.ts)
src/x/
  client.ts            X API posting (OAuth 1.0a media upload + tweet create)
app/api/
  goalie-matchup/route.ts    render a matchup graphic (manual + preview)
  goalie-grid/route.ts       normalized feed passthrough (supports ?mock=1)
  cron/goalie-check/route.ts secured poller: detect confirmations -> queue
  queue/route.ts             list / approve / dismiss queued posts
```

---

## 5. Data Sources (verified 2026-08-06)

### 5.1 RotoWire Projected Goalies — the trigger *only* ✅ SCHEMA CONFIRMED

Two endpoints exist; **use the direct one** because it accepts a date:

| Endpoint | Auth | Dates |
|---|---|---|
| `api/proxy?feed=GoalieGrid` (Azure proxy) | none | **today only** — ignores date params |
| `api.rotowire.com/Hockey/NHL/ProjectedGoalies.php` | `key=…` | **any date** via `date=MMDDYYYY` |

Verified structure (2026-03-15):
```xml
<Schedule><Date>2026-03-15</Date><Games>
  <Game Id="36716">
    <Date>2026-03-15 00:00:00</Date>
    <Teams>
      <Team IsHome="0" Id="26" Code="STL"><Name>St. Louis Blues</Name>
        <StartingGoalie Designation="CONFIRMED" Id="3851">
          <Firstname>Jordan</Firstname><Lastname>Binnington</Lastname>
          <StatsGlobalId>607980</StatsGlobalId><SportsDataId>f997…</SportsDataId>
        </StartingGoalie>
      </Team>
      <Team IsHome="1" Id="2" Code="WPG">…</Team>
    </Teams>
  </Game>
</Games></Schedule>
```

Sampled 9 dates across 2025-26 (79 games, 158 goalie slots):
- **`Designation` was `CONFIRMED` in 100% of historical rows**, and no team slot ever lacked a
  `StartingGoalie`. Since the live vocabulary for a *probable* starter still can't be observed,
  the design **whitelists `CONFIRMED`** and treats every other value as not-ready. That is safe
  without knowing the full vocabulary — an unknown status can never trigger a post.
- **No NHL player id.** The feed carries RotoWire `Id`, `StatsGlobalId`, and `SportsDataId` only —
  so name→NHL-id resolution is mandatory (§5.3).
- **No game start time** (`Date` is always `00:00:00`). Puck drop for the tweet copy must come
  from the NHL schedule (`startTimeUTC`).

#### ⚠️ Team codes differ from the NHL's — 8 of 32
Mapping extracted from the feed's own `<Name>` values (not guessed):

| RotoWire | NHL | | RotoWire | NHL |
|---|---|---|---|---|
| `CLM` | CBJ | | `SAN` | SJS |
| `LAS` | **VGK** | | `TAM` | TBL |
| `LOS` | **LAK** | | `WAS` | WSH |
| `MON` | MTL | | `NAS` | NSH |

The other 24 match. **`LAS` is Vegas, not Los Angeles** — a naive mapper reads "LAS" as Los
Angeles and silently swaps two teams' logos. This lives in one reviewed constant.

### 5.2 NHL API — all stats (works today, works from Vercel)

| Need | Endpoint | Verified fields |
|---|---|---|
| Last 5 starts | `/v1/player/{id}/game-log/{season}/2` | `gamesStarted`, `decision` (W/L/O), `shotsAgainst`, `goalsAgainst`, `savePctg`, `toi`, `gameDate`, `opponentAbbrev`, `gameId` |
| Head-to-head | `/v1/club-schedule-season/{TEAM}/{season}` | `awayTeam.score`, `homeTeam.score`, `abbrev`, `gameDate`, `gameOutcome.lastPeriodType` (REG/OT/SO) |
| Headshots | player landing `headshot` | already in use by the existing tool |

Completed games use `gameState: "OFF"` (not `FINAL`) — filter on `["OFF","FINAL"]`.

> **This is the key de-risking finding:** only the *trigger* is blocked by the offseason. The
> entire stats + rendering pipeline can be built and verified today against real 2025-26 data.

### 5.3 Goalie name → NHL player id (**club-stats must be primary**)
The feed has no NHL id, so we resolve by name **scoped to the team** in the game — only 2-3
candidates, so it's near-unambiguous.

**Proven pitfall:** `/v1/roster/WPG/20252026` returned **only Hellebuyck**, while
`/v1/club-stats/WPG/20252026/2` returned **all three** goalies (Hellebuyck, Comrie, Milic).
Resolving Eric Comrie failed against the roster and succeeded against club-stats. This is the
same failure mode as the Brett Berard search bug: **roster snapshots are incomplete; club-stats
is comprehensive.**

Resolution order: **club-stats → roster (supplement) → exact first+last → last-name-only**, with
accent/case normalization. If a name still doesn't resolve, the matchup is **skipped and logged** —
never posted with a wrong photo.

### 5.4 End-to-end validation (already run against real data)
Binnington vs. Comrie, 2026-03-15 — every field the graphic needs, computed from live endpoints:

```
Jordan Binnington (STL) 8476412   L5: 2-3-0 | 2.84 GAA | .899 SV%   last meeting: did not play
Eric Comrie      (WPG) 8477480   L5: 4-1-0 | 2.20 GAA | .914 SV%   last meeting: W, 22/23 saves
LAST MEETING: 2026-01-20 — STL 1 @ WPG 3 (REG)
```

Because the feed serves **any historical date**, the automation can be **backtested against real
game nights** all offseason — including the confirm-detection path, not just the renderer.

---

## 6. Graphic Specification

- **Canvas:** 1600×900 PNG. Visual language inherited from the poster style: team-color
  gradient, Barlow Condensed / IBM Plex Mono, RotoWire logo, coral/white accents.
- **Layout:**
  - Header: `CONFIRMED STARTERS` + game time.
  - Left / right: each goalie — feathered headshot, name, team logo + abbreviation.
  - Center: `VS` divider.
  - Under each goalie: **last 5 starts** — record (W-L-OTL), GAA, SV%.
  - Footer: **last meeting** — date, final score (with OT/SO), plus each goalie's line from
    that game if they played.
  - RotoWire logo bottom-center (same asset as the current tool).

### Stat definitions (exact)
- **Last 5 starts:** game log filtered to `gamesStarted === 1`, newest 5.
  - Record = tally of `decision` W / L / O
  - GAA = total `goalsAgainst` ÷ total TOI minutes × 60 (TOI is a `"60:00"` string — parsed)
  - SV% = (Σ`shotsAgainst` − Σ`goalsAgainst`) ÷ Σ`shotsAgainst`
- **Last meeting:** most recent completed game between the two clubs; the goalies' lines are
  pulled from their own game logs by matching `gameId` (no extra endpoint needed).

### Edge cases (must be handled, not crash)
| Case | Behavior |
|---|---|
| Fewer than 5 starts this season (season opener) | Label honestly (`LAST 2 STARTS`) or fall back to prior season, marked as such |
| Goalie with zero NHL games (call-up/rookie) | Show `NHL DEBUT`, suppress the stat line |
| Teams haven't met yet this season | Fall back to last season's meeting, labeled — or omit the footer |
| Missing headshot | Team-color silhouette placeholder |
| Name can't be resolved to an NHL id | Skip the matchup, log it; never post a wrong photo |

---

## 7. Automation Flow

```
cron (game days)
  -> GET GoalieGrid XML
  -> parse games; find those where BOTH goalies are confirmed
  -> skip any already processed (dedupe by gameId)
  -> resolve goalie ids -> fetch L5 + H2H -> render 1600x900 PNG
  -> write to REVIEW QUEUE  (Phase 2a)
  -> human clicks "Post"    -> upload media + create tweet
  (Phase 2b: flip a flag to post automatically, keeping the kill switch)
```

**Tweet copy template** (editable in one place):
```
Confirmed starters — {AWAY} @ {HOME}, {TIME} ET
{Goalie A}: {W-L-O}, {GAA} GAA, {SV%} SV% (L5)
{Goalie B}: {W-L-O}, {GAA} GAA, {SV%} SV% (L5)
```

### Scheduling constraint (needs your decision)
Vercel's documented limits: **Hobby = 1 cron/day**; a `*/10 * * * *` expression **fails at
deploy time**. Per-minute scheduling requires **Pro**. Options:
1. **Vercel Pro** (~$20/mo) — cleanest, native, per-minute crons.
2. **GitHub Actions scheduled workflow** (free, ~5-min granularity) hitting a secured endpoint —
   no Vercel upgrade needed. *Recommended if you'd rather not add a subscription.*
3. External pinger (cron-job.org / Upstash QStash free tier).

### Queue storage (needs your decision)
A review queue must survive between the cron run and your approval click, and Vercel functions
are stateless. Options: **Vercel KV / Upstash Redis** (free tier, ~10 lines of code, recommended),
Vercel Postgres, or a stateless fallback where the cron posts to Slack and the UI re-renders
on demand.

---

## 8. Offseason Development Strategy

The feed is empty until October, so:

1. **Manual mode is a real feature, not just a test harness.** `/goalie-matchup` lets you pick
   two goalies + teams and render a graphic by hand. Useful in-season for one-offs, and it makes
   the tool fully demoable today.
2. **Replay real game nights** — the direct endpoint serves **any date**, so instead of a
   hand-authored mock we point the whole chain at a real date (`date=03152026`) and exercise
   parse → resolve → stats → render → queue against genuine data. A `?date=` override on the
   cron/preview routes makes this a first-class dev affordance, and doubles as a debugging tool
   in-season.
3. **Backtest correctness** — verify computed L5/GAA/SV% against known box scores (§5.4 already
   validated one matchup). Worth spot-checking ~10 more across different dates.
4. **Cached fixtures for tests** — save a few fetched payloads to disk so unit tests don't hit the
   network or burn API calls. Real data, no live dependency.
5. **Preseason dry run** — late September, run with auto-post OFF and watch the queue fill with
   real games to confirm the schema and status vocabulary before anything goes public.

---

## 9. What I Need From You

### A. X (Twitter) account access
**Do not paste any secret into this chat.** Create the app yourself and enter the values
directly into Vercel's environment-variable UI. I'll write the code against the variable names
and never need to see them.

1. **Which handle posts?** Confirm the exact account (existing RotoWire NHL account or a new one).
2. **A developer app on that account**, at <https://developer.x.com>:
   - App permissions set to **Read and Write**
   - Generate **OAuth 1.0a** credentials *while logged in as the posting account* (required for
     the media-upload step):
     - `X_API_KEY` (consumer key)
     - `X_API_SECRET` (consumer secret)
     - `X_ACCESS_TOKEN`
     - `X_ACCESS_TOKEN_SECRET`
3. **Billing.** As of **Feb 6, 2026** X removed the free tier for new developers and moved to
   **pay-per-usage credits** — programmatic posting is now a paid action, and a payment method
   must exist on the developer account. Volume is now measurable: the sampled dates averaged
   **~8.8 games/night**, and a full season is **1,312 games**. Covering every game ≈ **1,312
   posts/season**, which at the ~$0.015/post rate is roughly **$20/season** — cheap, but confirm
   who owns the billing account. (Verify the current rate in the developer console; avoid links in
   the tweet body, which are priced far higher.)
4. **Who approves posts** — anyone with the link, or should I wire the `APP_PASSWORD` gate
   (already stubbed in `.env.example`, never finished) before this goes live? **My recommendation:
   wire the gate before auto-posting exists**, so a public URL can't trigger tweets.

### B. RotoWire API key handling — ~~schema~~ ✅ RESOLVED, but the key needs care
The schema question is fully answered (§5.1). One security item remains:

The key `r42fu0a4t38e48612jp0` was shared in chat and appears in a URL. Because this repo is on
GitHub, it **must not be committed**. Plan:
- Store as `ROTOWIRE_API_KEY` in Vercel env vars (you paste it, same as the X credentials).
- Server-side only — never referenced from client code, so it can't leak to the browser.
- Add it to `.env.example` as a **name only**, no value.
- **Please confirm whether this key should be rotated**, given it's been pasted into a chat
  transcript. If RotoWire can issue a fresh one for this app, that's the cleaner path.

### C. One residual unknown (low risk, self-resolving)
The `Designation` value for a *probable/expected* starter can't be observed until games are live —
every historical row reads `CONFIRMED`. Mitigated by whitelisting `CONFIRMED` (§5.1), so the worst
case is a missed post, never a wrong one. The September preseason dry run will reveal the full
vocabulary.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| ~~GoalieGrid schema unknown~~ | **Resolved** — schema confirmed and documented (§5.1) |
| RotoWire team codes ≠ NHL codes (`LAS`=VGK) | Mapping derived from feed's own team names, in one reviewed constant (§5.1) |
| API key committed to a public repo | Env var only, server-side, name-only in `.env.example`; rotation recommended (§9.B) |
| Goalie name → id mismatch | club-stats-primary resolver (roster alone **provably misses goalies**); skip + log rather than post wrong (§5.3) |
| Probable-starter designation unknown | Whitelist `CONFIRMED` → worst case is a missed post, never a wrong one |
| Vercel Hobby cron limit | GitHub Actions scheduler, or Pro (§7) |
| X API now paid + credential-gated | Confirm billing owner early; queue-only mode works without X access at all |
| A wrong graphic posts publicly | Review queue at launch; kill switch; auth gate on the approve endpoint |
| Feed says "confirmed" then the starter changes | Dedupe by gameId, and consider a "scratched" follow-up check before auto-post |
| Stats wrong at season open (small samples) | Explicit edge-case rules in §6 |

---

## 11. Milestones

1. **Hub shell** — shared nav, `/goalie-matchup` route. Generator untouched. *(small)*
2. **Stats engine** — L5 + H2H from the NHL API, verified against real 2025-26 box scores.
3. **Matchup renderer** — 1600×900 graphic, all edge cases.
4. **Manual tool** — pick goalies/teams, preview, download. Usable today.
5. **Feed layer** — XML parse, `?mock=1` fixtures, normalized matchups.
6. **Queue + cron** — secured poller, dedupe, review UI with one-click post.
7. **X integration** — media upload + tweet create; dry-run first.
8. **Preseason dry run** (late Sept) — real feed, auto-post OFF; lock the schema.
9. **Go live** — enable posting; optionally flip to full auto after a proving period.

Milestones 1-4 are fully deliverable now and don't depend on anything from the data team.

---

## 12. Open Questions

1. Cron host: **GitHub Actions** (free) or **Vercel Pro**? (§7)
2. Queue storage: **Upstash/Vercel KV** (recommended) or Slack-notify + on-demand render? (§7)
3. Wire the `APP_PASSWORD` gate before posting goes live? (recommended yes)
4. Coverage scope: every game every night, or only selected games?
5. Does the same graphic style need an Instagram-friendly crop later, or is X the only target?
