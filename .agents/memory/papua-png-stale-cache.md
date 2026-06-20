---
name: Papua-shows-PNG is usually a stale prose cache
description: Diagnosing the recurring "West Papua brief reads as Papua New Guinea" complaint before touching the country-match guards
---

A "this is Papua not Papua New Guinea" complaint (West Papua brief whose AI prose
describes Bougainville / Toroama / ABG / East New Britain / Port Moresby / Enga) is
almost always a STALE `country_report_prose` cache, NOT a live filter leak.

**Why:** the country-match layer already blocks pure-PNG rows from the West Papua
(`papua`) report by EXACT token membership — "papua new guinea" is not in the papua
token group, so a pure-PNG-tagged incident can never enter the papua set. Only a
genuine cross-border tag ("West Papua; Papua New Guinea") survives (kept in both
reports by design). So the live incident set feeding the papua prose is clean.
The PNG text comes from an OLD cache row generated before the guards existed; the
prose only regenerates when the window's data fingerprint changes, so a contaminated
pre-guard row lingers until the next data change forces a regen.

**How to apply:** before editing `countryMatch.ts` guards, verify reality first —
(1) query the CURRENT `country_report_prose` row for the slug (dev is writable; prod
is the read-only replica via `executeSql(environment:"production")`); if its
`generated_at` is recent and the exec summary is correct West Papua content, the bug
is already self-healed and the user is seeing a stale browser/page view — tell them to
hard-refresh. (2) Query the papua-group incident set (exact token match) and confirm
no Bougainville/Toroama/Port-Moresby rows are actually present. The screenshot's PNG
text usually matches the CURRENT `papua-new-guinea` row verbatim — proof it's the old
papua cache holding PNG content, not a new leak. To force-invalidate every lingering
pre-guard cache app-wide, bump `PROSE_PROMPT_VERSION` (it is hashed into the
fingerprint) and republish — every report then regenerates fresh on next load.
