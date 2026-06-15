# RotoWire NHL Graphic Generator

Generate a branded **"Old Team → New Team"** social graphic for an NHL signing or trade in
under a minute. Search a player, confirm the old team (editable for Free Agents), pick the
new team, type the deal details, and download a 1080×1080 PNG.

Built to mirror the [smokin-sixteen](https://github.com/DevStump/smokin-sixteen) baseball
tool: **Next.js + TypeScript** with **server-side PNG rendering via `@napi-rs/canvas`**.
See [PRD.md](./PRD.md) for full scope and decisions.

## Prerequisites

- **Node.js 18.18+** (or 20+). Not currently installed on this machine — get it from
  <https://nodejs.org> or `winget install OpenJS.NodeJS.LTS`, then reopen the terminal.

## Setup

```powershell
npm install
npm run download-logos    # fetch 32 NHL team logos -> public/logos/
npm run download-fonts    # fetch Barlow Condensed + IBM Plex Mono -> public/fonts/
```

Optionally drop the RotoWire wordmark into `public/brand/` (see that folder's README).
The app still renders without logos/fonts/wordmark — it falls back to text and color blocks.

## Run

```powershell
npm run dev
```

Open <http://localhost:3000>.

## How it works

- **Data:** public NHL API — `search.d3.nhle.com` for player search and
  `api-web.nhle.com/v1/player/{id}/landing` for current team + headshot. All access is
  behind the `PlayerDataSource` interface (`src/datasource/`) so a RotoWire internal feed
  can be swapped in later without touching the UI or render code.
- **Render:** `src/render/poster.ts` composes a 1080×1350 portrait "poster" PNG with
  `@napi-rs/canvas` — full-bleed action shot (falls back to a feathered headshot), team-color
  gradient theming, a big team-colored headline (`TRADED` / `SIGNED`), corner team logos, and
  the RotoWire logo at the bottom.
- **Routes:** `GET /api/search`, `GET /api/player/[id]`, `POST /api/render-poster`.

## Project layout

```
app/
  page.tsx                  single-page UI
  _components/Generator.tsx  search + form + photo toggle + preview + download
  api/search/route.ts
  api/player/[id]/route.ts
  api/render-poster/route.ts
src/
  types.ts                  shared domain types
  teams.ts                  32 NHL teams (abbr, name, nickname, color)
  datasource/types.ts       PlayerDataSource interface
  datasource/nhl.ts         NHL public API implementation
  render/poster.ts          canvas composition -> 1080x1350 PNG
  render/fonts.ts           font registration
scripts/
  download-logos.ts
  download-fonts.ts
public/{logos,fonts,brand}/  bundled assets
```

## Deploy (later)

Designed for Vercel. Set `APP_PASSWORD` for a simple shared-password gate (gate wiring is
left as a follow-up — see PRD milestone 5).

## Out of scope (v1)

Auto-posting to X, player stats overlay, and non-NHL sports — see the PRD.
