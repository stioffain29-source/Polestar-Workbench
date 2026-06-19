---
name: ReliefWeb situational-reports context adapter
description: ReliefWeb v2 API quirks (request-validation order, date format, bot-protection 406) for the standalone humanitarian-context source.
---

ReliefWeb (UN OCHA) v2 `/v2/reports` is added TWICE in this repo, for two distinct
jobs — keep them separate:
- **Corroboration** (`reliefweb.ts`) — attaches links to incidents we already scraped.
- **Situational context** (`reliefwebReports.ts`) — pulls STANDALONE humanitarian
  reports into their OWN `reliefweb_reports` table; never incidents, so no count inflates.
Both gate on the same `RELIEFWEB_APPNAME` env (an identifier, not a secret).

**Request is validated BEFORE the appname gate.** A malformed body returns 400/“UnexpectedValueException”
*before* the 403 “appname not approved”. So the request must be well-formed for an
approved appname to ever work. Two traps that each block it independently:

1. **Date format.** `date.created` range filters reject `Date.toISOString()`’s
   millisecond form (`2026-06-12T06:56:11.143Z` → 400 “must be an ISO 8601 date”).
   They accept second-precision with a numeric offset: strip ms and rewrite `Z`→`+00:00`
   (`.replace(/\.\d{3}Z$/, "+00:00")`). `YYYY-MM-DD` alone is also rejected.

2. **User-Agent / bot protection.** ReliefWeb (HDX) sits behind bot protection that
   returns **406 “Blocked due to bot activity.”** for browser-impersonating UAs. This is
   the OPPOSITE of the Google-News feeds (which need a browser UA via shared `fetchFeed`).
   So this adapter must NOT use `BROWSER_UA`/`fetchFeed`; send the appname itself as an
   honest non-browser UA.
   **Why:** with a browser UA the request never reaches the 403 appname gate.

**Egress-IP block is expected (same class as Liveuamap).** Even with the appname UA +
valid date, ReliefWeb still 406s Replit’s datacenter egress IP under load. Brief 403
windows appear then the protection locks onto the IP range. This is environmental, not a
code bug — exactly like the documented liveuamap Cloudflare egress block. An approved
appname + a reachable network (e.g. production egress, or HDX relaxing protection for the
approved appname) is what makes it actually return rows.

**Represented as `pending` while unvalidated, NOT `failing_upstream`.** This source is
BUILT + MERGED but has never returned live rows (403/406, unapproved appname). Surfacing
it as a broken/failing source misrepresents an integration that is simply awaiting
external approval + a prod-network check. The `sourceHealth.ts` recorder takes a
`pending` opt: when `pending && no prior lastSuccessAt`, it records status `pending`
(amber, "Pending approval") instead of escalating the failure streak; the integration
panel (`integrationStatus.ts`) reports Built=yes / Merged=yes / Live data=pending + a
reason. Once a real fetch succeeds, the normal working/failing logic takes over.
**Why:** an optional, fully-built source blocked only on appname approval is "pending",
not "broken" — keep it out of Action Required and the dashboard failing count. The moment
the appname is approved AND prod egress is verified reachable, the first successful ingest
flips it to `working` automatically; no code change needed.

**How to apply:** when "ReliefWeb situational reports empty / failing" — first confirm
it’s 406 (bot/IP) not 400 (request bug). 400 = your body/date is malformed (fix it);
406 = egress-IP/UA bot block (environmental, degrade gracefully). The appname
"polestar-advisory-monitoring" is NOT approved → 403 until approval is granted.
