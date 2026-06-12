# PRD — NHL Trade/Signing Graphic Generator

**Owner:** AJ Scholz (RotoWire) · **Author:** Andrew Scholz
**Status:** Draft for build · **Date:** 2026-06-12
**Hard deadline:** Working prototype before **NHL free agency opens July 1, 2026**

---

## 1. Summary

A single-purpose internal web tool that lets a RotoWire content producer generate a
branded **"Old Team → New Team"** social graphic for an NHL player signing or trade in
under a minute. The producer searches for a player, the tool auto-fills the old team and
photo, the producer picks the new team and types the deal details, and the tool renders a
downloadable PNG in RotoWire branding.

This is a deliberate clone of the **smokin-sixteen** baseball tool
(<https://github.com/DevStump/smokin-sixteen>) so the two tools share style, photo
treatment, and codebase conventions. Hockey-only for v1; the layout/engine is built to be
reusable for other sports later.

---

## 2. Goals & Non-Goals

### Goals
- Produce a publish-ready, on-brand NHL deal graphic in **< 1 minute**, no manual design.
- "One in, one out" — generate exactly one graphic at a time. No admin pages, no batch, no DB.
- Match RotoWire branding and the photo/style treatment of smokin-sixteen.
- Build the format to be reusable for other sports after the hockey rollout.

### Non-Goals (explicitly out of scope for v1)
- Auto-posting to Twitter/X — **manual download only** (confirmed with AJ).
- Player stats overlay (prev-year offseason / current-year in-season) — revisit after prototype.
- Sports other than NHL — evaluate after hockey rollout.
- Admin/management pages, multi-graphic batches, scheduling.

---

## 3. Users

**Primary:** A non-technical RotoWire NHL content producer (à la James/Lauren) who posts
deal news to social. Interaction is entirely through browser clicks — **no terminal, no
scripts, no data uploads** (the "No Terminal for James" constraint from smokin-sixteen).

---

## 4. Decisions (confirmed with AJ)

| Decision | Choice |
|---|---|
| **Data source** | **Public NHL API** (`api-web.nhle.com`, `search.d3.nhle.com`) for player search, current team, and headshots. No credentials needed. Built behind a data-source interface so a RotoWire internal feed can be swapped in later. |
| **Output format** | **Square 1080×1080** PNG. |
| **Stack & hosting** | **Mirror smokin-sixteen:** Next.js (App Router) + TypeScript + `@napi-rs/canvas` server-side PNG rendering, deployable to Vercel, single-page UI, login-gated. |
| **Team visuals** | **Logos + abbreviation** for both teams with an arrow (e.g. `LAK → NYI`). Bundle all 32 NHL team logos in `public/`. |

---

## 5. User Flow

1. Producer opens the tool (logs in if hosted).
2. **Searches** for a player by name → picks from a results list.
3. Tool fetches the player's **current team** (old team) and **headshot**, and pre-fills:
   - **Old team** dropdown — auto-populated, but **editable** (see FA edge case).
   - **Player name** and **photo** preview.
4. Producer selects the **New team** from a dropdown (all 32 NHL teams).
5. Producer types **deal details** into a free-form text box (e.g. "3 yr / $21M" or
   "Traded for a 2027 2nd-round pick").
6. Producer clicks **Generate** → live PNG preview appears.
7. Producer clicks **Download** → saves the 1080×1080 PNG for manual posting.

### FA edge case
If the player's current team comes back as **Free Agent** (no NHL club), the old-team
dropdown is **fully editable/selectable** so the producer can set the correct prior team
manually. This is an explicit acceptance test.

---

## 6. Functional Requirements

| # | Requirement | Acceptance criterion |
|---|---|---|
| FR1 | Player search | Typing a name returns matching NHL players to select from. |
| FR2 | Auto-fill old team | On selection, old team + photo populate from the player's NHL data. |
| FR3 | Editable old team | Old-team dropdown is editable; defaults to fetched team, selectable when FA. |
| FR4 | New team select | Dropdown lists all 32 current NHL teams. |
| FR5 | Deal details | Free-form text input rendered onto the graphic. |
| FR6 | Branded render | Output contains player name, photo, old→new team (logos+abbr), and deal details in RotoWire branding. |
| FR7 | Download | Output PNG is downloadable. |

---

## 7. Graphic Specification

- **Canvas:** 1080×1080 PNG, dark background `#0F0F11`.
- **Brand accent:** RotoWire purple `#A020FE`; RW wordmark/symbol present.
- **Typography:** Barlow Condensed (headings) + IBM Plex Mono (labels/details) — bundled fonts.
- **No decorative clutter** — clean editorial aesthetic, consistent with smokin-sixteen.
- **Composition (draft):**
  - Player headshot as the visual anchor.
  - Player name prominent.
  - Old-team logo + abbr → arrow → new-team logo + abbr band.
  - Deal-details line in mono type.
  - Small RotoWire wordmark + a "SIGNING" / "TRADE" tag.

> Exact layout to be finalized during build against a real sample graphic (see Testing).

---

## 8. Technical Design

### Stack
- **Next.js (App Router) + TypeScript**, `bun` package manager, Tailwind for the UI shell.
- **`@napi-rs/canvas`** for server-side PNG generation (avoids browser-screenshot fragility).
- Deploy to **Vercel**; simple login gate (mirror smokin-sixteen `middleware.ts` + `/api/login`).

### Data source (NHL public API) — behind an interface
- **Search:** `GET https://search.d3.nhle.com/api/v1/search/player?culture=en-us&q={query}`
  → player id, name, current team abbr.
- **Player landing:** `GET https://api-web.nhle.com/v1/player/{playerId}/landing`
  → current team, **headshot URL**, position.
- **Headshot:** `headshot` field (e.g. `https://assets.nhle.com/mugs/nhl/{season}/{TEAM}/{id}.png`).
- **Team logos:** bundled in `public/logos/` (32 teams) to avoid runtime dependency / CORS;
  fallback `https://assets.nhle.com/logos/nhl/svg/{TEAM}_dark.svg`.
- Wrap all of the above behind a `PlayerDataSource` interface so a RotoWire feed can replace it later.

### API routes
- `GET /api/search?q=` — proxy + normalize NHL player search.
- `GET /api/player/{id}` — normalized player (name, team, headshot).
- `POST /api/render` — accept {playerId, name, photoUrl, oldTeam, newTeam, dealText, dealType} → return PNG.

### Key files (mirroring smokin-sixteen)
```
app/page.tsx                    single-page UI
app/_components/Generator.tsx   form: search, old/new team, deal text, preview, download
app/api/search/route.ts
app/api/player/[id]/route.ts
app/api/render/route.ts
src/render/index.ts             canvas composition → PNG
src/teams.ts                    32 NHL teams (abbr, name, colors)
src/datasource/nhl.ts           PlayerDataSource impl (NHL API)
src/types.ts
public/fonts/                   Barlow Condensed, IBM Plex Mono
public/logos/                   32 NHL team logos
public/brand/                   RotoWire wordmark + symbol
```

### Asset dependencies (need to confirm/source)
- **RotoWire brand assets** (wordmark + symbol) — reuse from smokin-sixteen `public/`.
- **Fonts** — Barlow Condensed + IBM Plex Mono (open-source, bundle directly).
- **32 NHL team logos** — fetch once into `public/logos/` (script, like `scripts/download-logos.ts`).

---

## 9. Testing & Acceptance

1. **Real-trade sample:** Generate a graphic for a recent real NHL trade; verify layout,
   branding, and that the player **photo renders correctly** at 1080×1080.
2. **FA edge case:** Select a player whose current team is **Free Agent**; confirm the
   old-team dropdown is **editable** and a prior team can be set.
3. **Deal text:** Long/short deal text wraps/truncates gracefully.
4. **All 32 teams** selectable as new team; logos render.
5. **Download** produces a valid PNG.

---

## 10. Milestones

1. **Scaffold** — Next.js app, NHL data-source layer, team list + logos, fonts/brand assets.
2. **UI** — search → select → old/new team → deal text → preview.
3. **Render** — `@napi-rs/canvas` 1080×1080 composition + download.
4. **Polish & test** — real-trade sample, FA edge case, branding review with AJ.
5. **Deploy** — Vercel + login gate. (Target: before July 1, 2026.)

---

## 11. Open Questions / Risks

- **Brand assets:** confirm we can reuse smokin-sixteen's RotoWire wordmark/symbol, or get
  official RW logo files.
- **Logo licensing:** NHL team logos are trademarked; confirm RotoWire's usage is covered
  (same posture as the baseball tool's MLB logos).
- **Headshot for traded players:** NHL headshot may still show the old-team sweater right
  after a trade — acceptable for v1 (matches "old team" context anyway).
- **Stats later:** layout leaves room to add a stats strip in a future iteration.
