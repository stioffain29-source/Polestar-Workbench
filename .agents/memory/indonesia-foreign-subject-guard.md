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
`displayTitle + title` — **NOT** the summary. The summary carries the appended
outlet masthead ("CNN Indonesia", "CNBC Indonesia", "ANTARA") whose "Indonesia"
is a FALSE local anchor that used to defeat the dominance test and leak foreign
accidents. Mirrors the existing PNG/West Papua `isForeignDominantContext`. Dominance (not blanket-foreign) so a genuine domestic
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
  dominance over `displayTitle+title`, NOT summary) — never expand the token
  lists without a replay; new tokens can silently change the drop-set.
- The foreign set now also carries unambiguous foreign ENTITIES / US states seen
  in live slop (`ubisoft`, `assassin's creed`, `missouri`) — a foreign accident
  often names only the company/state, not the country.
- **Add BAHASA foreign spellings + theatre actors/ports, not just the English
  country word.** A Yemen-war row (`country=Indonesia`, `display_title` NULL) with
  the Bahasa title "…Tentara **Yaman** … **Houthi** … Hodeidah" leaked because the
  set had English `yemen` but not Bahasa `yaman`, nor the theatre actor/port
  `houthi`/`hodeidah`. When `display_title` is NULL the guard's ONLY haystack is
  the raw Bahasa title, so English-only country words never match — extend with
  the local-language spelling AND the distinctive proper nouns (group/port/city)
  that stay identical across languages. These are the highest-value tokens because
  they survive the missing-translation case.
- **Local anchors double-count across BOTH languages, so foreign tokens must too.**
  A place named in the English `displayTitle` AND its Bahasa `title` (e.g. "Maluku"
  / "Warga Maluku") counts TWICE on the LOCAL side. An English-only foreign token
  list can therefore only TIE such a row (foreign 2 vs local 2), and the dominance
  test is STRICT `>` so a tie never drops — the row leaks. Adding the Bahasa
  foreign spellings (`belanda`=Netherlands, `jerman`=Germany) makes the foreign
  side count in both languages too, breaking the tie (4 > 2). Confirmed live: every
  belanda/jerman row filed `country=Indonesia` is foreign slop (German shootings/
  wildfires, Netherlands strikes, Morocco-fan riots), so no domestic over-drop.
- KNOWN RESIDUAL: a row whose translated title names NO country or foreign entity
  in any language (bare "Plane crash kills 11" syndicating a foreign crash) is
  indistinguishable from a domestic accident by content, so the guard leaves it.
  Do NOT add a blanket "no local anchor → drop" rule — it over-drops genuine
  domestic stories that omit a place name. Fabricating a foreign tag from zero
  evidence breaches no-fabrication; cross-row event clustering (out of scope)
  would be required.
- **Prod dependency:** the guard can only see the foreign subject if prod rows
  have `display_title` populated (the English translation). NULL `display_title`
  → the guard is blind. See `incident-title-translation.md` /
  `title-translation-markers.md` (prod backfill via `INGEST_FORCE_VERSION` bump).
- **BOTH render paths must feed the guard the SAME haystack (`displayTitle+title`,
  never summary).** The filter is duplicated in `CountryReport.tsx` (live page) AND
  `scripts/countryReportData.ts` (headless PDF/audit). The headless Indonesia branch
  once drifted to include `i.summary`, so the masthead false-anchor leaked back on
  the PDF only and page/PDF disagreed on borderline rows. Any change to one path's
  guard input must be mirrored in the other, or preview≠PDF.
- **REJECTED: the "require a home anchor, drop otherwise" ALLOWLIST.** When a leak
  slips past the dominance/blocklist guards (a foreign CITY the token list omits,
  e.g. "Toronto"), the fix is to ADD the missing place to `INDO_FOREIGN_SUBJECT_RE`
  (and `FOREIGN_SUBJECT_RE` for the generic Thailand/Philippines
  `isForeignSubjectNoHomeAnchor` path) — NOT to require a positive home anchor.
  **Why:** an allowlist was built and MEASURED against live prod (proveGeoGuard.ts):
  it dropped Indonesia 51% / Philippines 47% / Thailand 37% of GENUINE local rows
  (Surabaya corruption, Davao floods, Trat boat) because real local stories often
  carry no listed city token. Gutting genuine rows is a WORSE no-fabrication breach
  than the residual leak. The precision-first token additions cut collateral to
  Indonesia 9.4% / Philippines 4.9% / Thailand 11.1% while dropping all confirmed
  leaks. Do NOT re-attempt the allowlist.
- **Escalation path for a NEW leak:** add the exact foreign token, re-run
  `proveGeoGuard.ts`, confirm collateral stays low. The residual leak class that
  remains BY DESIGN: an overseas story naming ONLY an unlisted foreign place with
  NO country word ("Winnipeg", "Marseille"). Cross-row syndication clustering
  (`foreignSyndicationDropIds`) partially mitigates it when a foreign-attributed
  sibling names the place.
- **Naha/Ryukyu homonym:** `naha` (added for Okinawa) is also Naha, Sangihe Islands,
  North Sulawesi (Naha Airport). Inside `\b…\b` it counts as ONE foreign cue, so a
  genuine Sangihe story survives only if a local anchor ties it (dominance is strict
  `>`, and such stories normally also name Sangihe/Sulawesi). Low probability;
  watch for it if a Sangihe row goes missing.
