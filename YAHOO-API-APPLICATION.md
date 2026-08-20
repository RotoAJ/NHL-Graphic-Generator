# Yahoo Fantasy Sports API — access application

Apply at **<https://sports.yahoo.com/developer/access/>** using the Yahoo account that is a
member of league **67213**.

> Yahoo warns that *"incomplete or insufficiently detailed submissions cannot be evaluated and
> will be closed without further correspondence."* The answers below are deliberately specific
> for that reason. Copy them into the matching fields; adjust anything that misstates your intent.

---

## Field: What product are you building?

> RotoWire is a fantasy sports content and analysis publisher. We are building an internal
> editorial tool that helps our NHL staff produce weekly social media posts for RotoWire's
> hockey audience.
>
> The tool assembles two recurring weekly features — a "Three Stars of the Week" post
> highlighting the best fantasy performers of the past seven days, and a "Sleepers to Grab"
> post highlighting productive players who are widely available in fantasy leagues. It pulls
> player performance from the public NHL statistics API, renders branded graphics, and outputs
> post-ready text for a RotoWire editor to review and publish manually. Nothing is posted
> automatically.

## Field: What Yahoo Fantasy Sports data do you require?

> A single data point: **`percent_owned`** (league-wide roster percentage) for NHL players.
>
> We use it only to identify which productive players are *under-rostered*, which is the entire
> premise of the "Sleepers to Grab" feature. Without it we cannot distinguish a widely-rostered
> star from a genuine waiver-wire add.
>
> Specifically we would call:
> `GET /fantasy/v2/league/{league_key}/players;sort=AR;out=percent_owned`
>
> We also need `GET /fantasy/v2/users;use_login=1/games;game_codes=nhl/leagues` once per
> session to resolve the current season's league key, since Yahoo game keys change each year.
>
> We do **not** need rosters, transactions, matchups, draft data, private league details, or any
> other user's information. **Read access only** — we have no need for write access.

## Field: Intended user base

> **Internal / single-league use.** Access would be authorised by one Yahoo account (an employee
> who is a member of league 67213) and used solely by RotoWire's NHL editorial staff — currently
> fewer than five people.
>
> The Yahoo data is never redisplayed as a standalone product, resold, or exposed through a public
> API. The only thing our audience ever sees is an editor-approved social post that may reference
> a roster percentage as context (e.g. "22% rostered"), with Yahoo as the stated source if you
> prefer attribution.

## Field: Estimated number of users

> **Small.** Fewer than five internal users. Expected request volume is very low: roughly one
> batch of requests per week (about 25 paginated calls), cached for six hours. Well under any
> reasonable rate limit.

## Field: Client ID (optional)

> Provide the Client ID from the Yahoo app you already created (Yahoo Developer Network →
> your app → **App ID / Client ID**). This links the approval to the existing app so the Fantasy
> Sports permission can be enabled on it.

---

## Extra detail worth including if there's a free-text box

> **Technical summary**
> - Platform: Next.js application hosted on Vercel, server-side only.
> - Auth: OAuth 2.0 authorization-code flow. The refresh token is stored server-side in a
>   private Postgres database and never exposed to a browser or client.
> - Scope requested: `fspt-r` (read).
> - Caching: ownership responses cached 6 hours to minimise calls.
> - Data retention: we store no Yahoo player data beyond the cached ownership percentages;
>   nothing is persisted to a public location.
> - Attribution: happy to credit Yahoo Fantasy as the source of roster percentages.

---

## After approval

1. Yahoo enables the **Fantasy Sports** permission for your account/app.
2. Edit your app at <https://developer.yahoo.com/apps/> and tick **Fantasy Sports → Read**.
3. Confirm the redirect URI is exactly:
   `https://nhl-graphic-generator.vercel.app/api/yahoo/callback`
4. Add `YAHOO_CLIENT_ID` and `YAHOO_CLIENT_SECRET` to Vercel (Production + Preview), then redeploy.
5. Visit `https://nhl-graphic-generator.vercel.app/api/yahoo/auth` once and click **Agree**.
6. Check `https://nhl-graphic-generator.vercel.app/api/yahoo/status` — it should report
   `connected: true`, the discovered league key, and a sample of real percentages.

The code is already written and deployed, so nothing further is needed on our side. The Sleepers
feature switches itself on the moment `/api/yahoo/status` reports a real provider.

## If approval does not arrive before the season

Three Stars runs regardless. Sleepers stays withheld rather than publishing invented numbers.
The fallback discussed — ranking players by how far they are outperforming their own season
baseline — can be built at any point as an honest substitute that needs no Yahoo access.
