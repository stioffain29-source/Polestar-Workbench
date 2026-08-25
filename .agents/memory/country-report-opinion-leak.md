---
name: Country report op-ed / debate leak
description: Country reports are double-gated by persisted relevance and isCountryRelevant; foreign-language op-eds require raw-title client exclusions too.
---

# Country report op-ed / debate leak

A country report is double-gated: the API first admits only rows explicitly
persisted as relevant, then `isCountryRelevant` applies the stricter
country-security predicate. It must never fetch `includeIrrelevant`.

**Why:** the owner clarified that incident focus is product-wide. A topic verdict
cannot be bypassed merely because the country aggregate has an additional scope
classifier. `isCountryRelevant` remains necessary to reject topic-relevant but
country-security-irrelevant material; it is defense-in-depth, not sole authority.
Changes to the persisted engine require a relevance-version bump/backfill;
frontend-only country exclusions do not.

**Second trap:** `isCountryRelevant`'s editorial excludes (explainer/op-ed) are
ENGLISH-keyword based, but the relevance `haystack` carries the record's RAW,
UNTRANSLATED title+summary (the English `display_title` is NOT in the haystack).
So a Bahasa Indonesia op-ed ("...Pembangunan untuk Siapa?" = "development for
whom?") sails past English-only excludes. Add bilingual cues.

**How to apply:** for "for whose benefit" rhetorical-question advocacy op-eds,
`COUNTRY_OPINION_DEBATE_RE` matches both `for whom` and Bahasa `untuk siapa` /
`who benefits`, gated on `!COUNTRY_HARD_SECURITY_RE` so a genuine violent event
framed as a question still survives. Validate any new exclude by replaying the
real raw title+summary AND a few genuine incidents (ambush, armed clash, riot
arrests) before shipping. A historical-atrocity reference ("Biak massacre" cited
as collective memory) is NOT a current incident — "massacre" is intentionally
absent from the hard-security set.

**Non-incident classes beyond op-eds (governance/diplomatic/blotter):** the
aggregate also leaks NON-events that aren't editorials — delegation arrivals /
state visits, "council supports the police" endorsements, "law-and-order
capacity" development features, and single-suspect crime-blotter / policing
PROCESS items. Each has its own exclude in `isCountryRelevant`, guarded TWO
ways: diary / PR / agency-support drop only when there is NO SOFT signal
(`COUNTRY_SECURITY_SIGNAL_RE`); capacity / blotter drop only when there is NO
HARD signal (`COUNTRY_HARD_SECURITY_RE`), so "police apprehend armed-robbery
suspect" and a kidnap/hostage rescue survive. **"police" / "security forces" are
deliberately NOT soft-signal words** — otherwise every support item rescues
itself. Keep blotter excludes SUSPECT-anchored (`apprehend…suspect` /
`suspect…rescued|held captive`), never a bare "rescued by police" (that would
drop a real hostage rescue). A client-only country-gate edit needs no relevance
version bump; a persisted-engine change does.

**Sports leak past bare-noun gate:** `COUNTRY_SPORTS_NOISE_RE` originally matched
only explicit sport NOUNS (soccer/tournament/league). A match write-up that
carries none of them still leaks — "Tactical analysis Japan vs Sweden: clash of
Asian discipline and Scandinavian physicality" classified as Civil unrest /
protest (the word "clash"/team-vs framing), HIGH severity, generic impact line.
**Fix:** extend the gate with match-report IDIOMS (tactical analysis/preview,
semi-final/quarter-final, kick-off, matchday, man of the match, goalkeeper,
starting XI) AND Bahasa sport vocab (timnas, liga, piala, pertandingan, laga
persahabatan, adu penalti, kiper, gelandang, wasit, babak penyisihan/grup) —
the briefs read RAW Bahasa headlines. Still gated on `!COUNTRY_HARD_SECURITY_RE`
so a venue incident ("bomb at the stadium", "fans riot, police arrest 40")
survives; "clash" is deliberately NOT a hard-security rescue word. Frontend
authority → no version bump, takes effect at render after a republish (cleans
existing prod rows, no re-ingest). Avoid bare homonyms (no plain `vs`/`lineup`/
`striker`/`penyerang`/`pelatih` — they collide with land-dispute "villagers vs
firm", "cabinet line-up", crime "penyerang menikam", "pelatih militer").

**Acronym-rescue trap (culture / peace / music / mourning classes):**
`COUNTRY_HARD_SECURITY_RE` COUNTS the bare armed-group acronyms (`tpnpb`, `opm`),
so any exclude gated on `!HARD_SECURITY` is silently rescued the moment a noise
piece merely NAMES the group — which is exactly how a cultural op-ed, a "path of
peace" surrender story, and a TPNPB mourning notice leaked. **Fix:** gate these
new drop guards on a SEPARATE rescue set (`COUNTRY_CONCRETE_INCIDENT_RE` /
`COUNTRY_FRESH_ATTACK_RE`) that OMITS the acronyms AND actor nouns AND bare
"armed" (a surrender piece says "armed group laid down weapons"). Mourning /
obituary drops use the FRESH-attack set (no death words — an obituary inherently
names a death). Watch homonyms when enumerating incident verbs: `protest\w*`
matches Bahasa `protestan` (the Protestant faith), `stab\w*` matches
`stable/stability`, bare `march` is the calendar month — enumerate suffixes /
qualify instead. **"OPM" is also a music homonym** (Original Pilipino Music) →
an entertainment-feature drop (album/festival/orchestral/headline). Verify by
replaying the REAL live rows through the actual `isCountryRelevant`.
