---
name: Indonesia/Jakarta foreign-subject slop guard
description: Why the Indonesia/Jakarta operating-risk brief floods with FOREIGN events and why the fix is a geography-dominance guard in the country-report path, not isCountryRelevant.
---

# Indonesia / Jakarta foreign-subject slop guard

The Indonesia and Jakarta operating-risk briefs flood with IRRELEVANT FOREIGN
events (foreign earthquakes, an NBA/Knicks riot, a Japan-vs-Sweden match,
Lebanon, a Canada shooting) — all filed `country="Indonesia"`,
`relevance_status="relevant"`.

**Why `isCountryRelevant` does NOT catch it:** that gate decides TOPIC relevance
(is this a security/hazard item). A foreign earthquake is a legitimate hazard
class the `indonesia_local` topic intentionally carries — the defect is
GEOGRAPHY (it happened abroad), not topic. So the editorial/op-ed/sport excludes
in `lib/relevance` are the wrong layer for this.

**Why upstream English excludes miss it:** the foreign subject is only visible in
the ENGLISH translation, delivered as the Incident contract field
**`displayTitle`** (the OpenAPI `Incident` has `displayTitle`, NOT `ln`; `ln` is
a legacy/compat name some local types still use). The STORED title is Bahasa, so
anything keyed on the raw title can't see "Japan" / "New York".

**The fix — a geography-DOMINANCE guard in the country-report path:**
`isForeignSubjectForIndonesia(text)` in `countryMatch.ts`, wired into the
Indonesia path AND Jakarta branch of `CountryReport.tsx`'s `incidents` useMemo
(which feeds Key Developments / charts / fast facts / prose). It drops a record
only when foreign-country cue matches OUTNUMBER Indonesian-place cue matches over
`displayTitle + title + summary`, mirroring the existing PNG/West Papua
`isForeignDominantContext`. Dominance (not blanket-foreign) so a genuine domestic
story that merely NAMES a foreign national survives ("Chinese investor robbed in
Surabaya" — Surabaya anchors it).

**How to apply / extend:**
- Frontend authority (country reports ignore server `relevance_status`) → **NO
  `RELEVANCE_RULE_VERSION` bump**; takes effect at render after a republish,
  cleaning existing prod rows with no re-ingest.
- Guard is scoped to the Indonesia + Jakarta branches ONLY — PNG/Papua routing
  is untouched. Papua place names are DELIBERATELY absent from the local-anchor
  set (Papua records are routed to the West Papua brief upstream).
- Extend `INDO_FOREIGN_SUBJECT_RE` / `INDO_LOCAL_ANCHOR_RE` in lockstep, then
  RE-VALIDATE against live rows (Postgres `regexp_matches` foreign-vs-local
  dominance over `displayTitle+title+summary`) — never expand the token lists
  without a replay; new tokens can silently change the drop-set.
- **Prod dependency:** the guard can only see the foreign subject if prod rows
  have `display_title` populated (the English translation). NULL `display_title`
  → the guard is blind. See `incident-title-translation.md` /
  `title-translation-markers.md` (prod backfill via `INGEST_FORCE_VERSION` bump).
