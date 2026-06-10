---
name: incidents days window cap
description: /incidents (and /incidents/by-topic, /strikes) `days` param is hard-capped at 365 and there is no all-time count API
---

The `/incidents` list, `/incidents/by-topic`, and `/strikes` query `days` param is
validated `min(1).max(365)` (`listIncidentsQueryDaysMax` in generated `lib/api-zod`).
Sending `days > 365` returns HTTP 400 `{error}`, not data.

**Why it matters:** when windowing a page that offers a 2y range (the topic monitors'
shared `RANGE_KEYS` includes `2y` = 730), passing `RANGE_DAYS["2y"]` straight to the
hook silently 400s. Restrict the toggle to a `<=365d` key subset (see Timeline's
`TIMELINE_RANGES`, Map's `MAP_RANGES`) or keep that range reading the all-time set.

**Also:** the incidents table holds records older than 1y (static imports back to 2006;
~874 of ~4587 rows in dev are >365d old). So any page switched from an unbounded
`useListIncidents({})` to `useListIncidents({ days })` LOSES those old rows and any
all-time "Total" count it showed becomes last-year-scoped. There is no all-time count
endpoint — `/incidents/by-topic` also caps at 365 — so a true all-time total needs an
API change (raise the cap or add a count route) + spec codegen.
