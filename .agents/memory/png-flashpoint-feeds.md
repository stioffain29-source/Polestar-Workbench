---
name: PNG flashpoint feeds & Pacific crime acceptance
description: Why opening PNG feeds needs a classifier change + when:Nd, and why the recent PNG window is structurally sparse
---

The PNG (and West Papua) country report kept rendering "too thin" — the rolling
7-day window was empty even after the noise items were dropped.

**Country report headline basis is FIXED to the 7-day weekly window — never
widened.** `resolveActiveCountryWindow` (countryReportLayers.ts) always returns
basisDays=7 / `layers.current`; it must NOT fall back to 30/90-day. An empty week
stays an honest empty headline; the 30/90-day buckets are shown ONLY as labelled
context/background sections, never promoted to the active basis.
**Why:** the user is explicit that "30 days is too long for a rolling weekly
report" — a weekly brief must lead with the 7-day window and surface real recent
incidents, not bury them in (or be padded out by) a 30-day window. An earlier
attempt that widened to 30/90 when the week was empty was rejected for exactly
this reason: it re-promoted 30-day as the basis.
**Empty-week honesty pairs with the coverage banner:** `computeCountryCoverageStatus`
is keyed to WEEKLY emptiness (`layers.current.length === 0`), NOT 30-day. A
zero-record week is never asserted as quiet — it renders a graded coverage
warning (no source / unhealthy feed / stale record / healthy-but-silent) and the
prose builder emits its "no relevant incidents… read as a coverage gap, not calm"
branch. So both must stay in lockstep on the 7-day window.

**Source-coverage scoping must be as strict as incident scoping.** The Papua/PNG
pair is a substring trap: the short "papua" token substring-matches "papua new
guinea", so any free-text matcher (e.g. coverage-health source attribution) will
silently pull PNG feeds into the West Papua report. Incidents avoid this via
EXACT token-set membership (`incidentMatchesCountry`); any new code that scopes
sources/feeds to a country must match WHOLE words AND reject competing
super-phrase tokens (`competingSupersetTokens` in countryMatch.ts), or coverage
diagnostics report the wrong country's feed health.
**Why:** a quiet-week coverage warning that reads PNG feed health for a West
Papua report is a false-confidence bug — the exact class of cross-country leak
the countryMatch module header warns about.

**Two structural causes, not a window bug:**

1. The flashpoint `classify()` only accepts FLASHPOINT_REQUIRED protest/unrest
   cues. PNG's dominant security signal is violent CRIME (armed robbery,
   carjacking, raskol gangs, tribal fighting), which carries none of those cues,
   so adding feeds ALONE yielded zero accepted. Fix: a `PACIFIC_CRIME` cue set
   accepted ONLY when the resolved country is Pacific (PNG / West Papua), so the
   global APAC feed set keeps its protest-only discipline (no worldwide
   routine-crime explosion). DENY runs first, so kinetic armed conflict is still
   excluded. Restructured so country resolves BEFORE the allow decision.

2. Google News RSS WITHOUT a `when:Nd` operator returns a relevance-sorted mix
   spanning YEARS. Genuine PNG incidents arrive but their pubdate is 2023–2025,
   so they never land in the report's rolling 7-day window. Constrain PNG feeds
   with `+when:14d` (14d not 7d → scheduler buffer between runs).

**Why:** verified empirically — without when: the crime feed pulled 48 genuine
PNG security incidents (armed robbery Port Moresby, soldier stabbed in Lae,
2Fast Motors robbery) but the newest was ~Dec 2025; with when:14d the public
English feeds carry essentially NO fresh PNG security incident. The thin report
reflects sparse reality, not a bug — be honest about this with the user.

**Junk guard:** the civil-unrest "strike" keyword pulls sports/video "strike"
noise (e.g. a hockey "The Leafs Are Ready To Strike... PNG (vFetqxZnwf) -
Mshal" YouTube upload) that passes BOTH isCountryRelevant (strike=security
signal) AND isForeignDominantContext (no foreign country named). Denied at
ingest via the parenthetical YouTube video-id pattern in FLASHPOINT_DENY.

**Country-report junk must ALSO be dropped in `isCountryRelevant`, NOT only at
ingest / per-topic persisted relevance:** CountryReport.tsx fetches raw
(`includeIrrelevant:true`) and applies its OWN `isCountryRelevant`
(`lib/relevance/src/topicRelevance.ts`) — so per-topic backfill/RELEVANCE_RULE_VERSION
bumps DO NOTHING for the country report, and rows already in the DB bypass any
ingest-only deny. Added there: a YouTube-id drop (test the RAW title — `haystack()`
lowercases away the lower→UPPER case signature) and a COUNTRY_EXPLAINER_NOISE_RE
op-ed/explainer drop gated on `!COUNTRY_HARD_SECURITY_RE` (so "police explain the
robbery investigation" survives). **The aggregator id is 10 chars, not 11** (YouTube
ids are 11 but "vFetqxZnwf" is 10) — the length guard is a 9–14 RANGE with an
internal lower→UPPER transition, floored at 9 so short camelCase like "(iPhone)"
/"(eBay)"/"(macOS)" is never false-dropped. Verified over all live PNG rows: 7
junk dropped (sports finals, FC results, cross-code, IT migration, sorcery-law
explainer, fuel-subsidy PR), 41 genuine security events kept.

**Syndicated-rehash trap:** an aggregator (e.g. Digital Journal) re-runs a
months/years-old event with a FRESH pubdate ("...15 killed in riots", a re-run
of the Jan-2024 Port Moresby riots). It passes isCountryRelevant, so the
clamp anchors the 7-day window to the fake-fresh date → empty current week,
genuine cluster buried. Fix is ANCHOR-ONLY, never hide from display, never
fabricate: an "event signature" = contiguous 3-word title phrases carrying a
number or casualty word (killed/dead/wounded...); if a candidate shares one
with a row >=45d older it is a rehash. Primary guard is at INGEST
(`lib/ingest/src/flashpoint.ts`, rejects before insert — durable because prod
DB holds the originals, which carry source_url so they're already in the
existing-rows dedupe set); a softer copy (`dropSyndicatedRehashes`, >=30d) runs
in the frontend clamp set only (CountryReport.tsx) for rehashes whose original
is inside the 90-day fetch. Also: `buildCountryLayers` window-end must be
`endOfDay(issueDate)` not bare midnight, or the anchor-day records (wall-clock
times like 08:00) the clamp just landed on get re-excluded → empty again.

**Rehash guard FALSE-POSITIVE (the "report is thin / no raskol" complaint):**
the ingest rehash test originally had only a LOWER age bound (>=45d) and a
SINGLE shared digit+casualty trigram — no upper bound, no title check. A genuine
NEW extreme incident (PNG "vows crackdown after 15 killed in riots", Jun-2026,
EXTREME) was permanently dropped at ingest because a DISTINCT Jan-2024 PNG event
("declares state of emergency after 15 killed in riots") shared the generic
trigram "15 killed in" — a coincidental casualty-count collision 29 months apart,
NOT a recycle. PNG has recurring capital riots with similar tolls, so this class
of collision is structural, not rare. Fix (`lib/ingest/src/flashpoint.ts`): a
rehash now requires ALL of (1) shared digit+casualty trigram, (2) prior aged
BETWEEN 45d and ~18mo (`REHASH_MAX_AGE_MS` 548d — older = distinct recurring
event), and (3) title Jaccard >= 0.6 (`REHASH_MIN_TITLE_SIMILARITY`, tokens after
stripping " - Source") so two different events sharing only a number are not
collapsed. **Why:** a rehash false positive PERMANENTLY drops a real record at
ingest — exactly the silent data-loss the trigram comment warned about. The two
distinct riot headlines score Jaccard ~0.57 (< 0.6) AND are 29mo apart, so both
new guards independently rescue the real story; a true recycle (near-identical
headline, weeks-months apart) still trips all three. Verified: after the fix the
Jun-2026 riots story inserts (rehashSkipped 0) and leads the PNG weekly window.

**Kinetic deny MUST be split global vs non-Pacific (West Papua insurgency is
IN scope by user decision):** a single kinetic DENY that runs before country
resolution silently strips West Papua / PNG insurgent violence (TPNPB/OPM
ambush, gun battle, "insurgents/separatists kill", "rebels ambush troops"),
which the user explicitly wants included. Fix: two sets — `KINETIC_DENY_GLOBAL`
(foreign signatures: drone/missile/air strike, artillery/shelling, IED,
car/suicide bomb, jihadist/terror attack, quadcopter → denied for EVERY
country, runs in FLASHPOINT_DENY before country resolution) and
`KINETIC_DENY_NONPACIFIC` (gunmen/militants/insurgents kill-or-attack, ambush,
gun battle, armed-group raid, wanted commander → applied ONLY when resolved
country is NOT Pacific). `classify()` must resolve country FIRST, compute
`isPacific` (PNG / West Papua / both), THEN apply KINETIC_DENY_NONPACIFIC only
if `!isPacific`. So Myanmar/Mindanao kinetic stays denied, foreign kinetic
(airstrike) is denied even if mis-tagged Pacific, but West Papua small-arms
insurgency passes. `WP_INSURGENCY` regex + bare "papua" + (Indonesian-military |
insurgency cue) lets resolvePapuaPng tag insurgent headlines West Papua without
an explicit province token. Order matters — REGRESSION RISK is re-introducing a
deny that fires before country resolution.

**False-positive cues that the loosened PACIFIC_CRIME let in (now guarded):**
bare "attack"/"clash"/"violence" pulled rugby/debate/awareness items, so
PACIFIC_CRIME keeps ONLY qualified cues (police raid, raid, wanted <person>,
mob <act>, kill(ed/ings/s), rebels/separatists/insurgency, deadly/armed/violent
clash). Sports DENY needed: rugby league/grand final/NRL/Kumuls/ladder
leaders/national football stadium; scoreline "\d-\d victory|win|..."; "run riot
over <team>" (bare "run riot" intentionally NOT denied — real unrest). Sports
cues usually live in the SUMMARY not the title, so deny must test title+summary.

**when:Nd query-SIZE lesson:** large grouped Google-News queries (many
OR-ed place×term clauses) silently DROP the `when:14d` operator → years-old
mix returns. Keep PNG feeds as place-anchored smaller queries
(Lae/Morobe/Taraka/Port Moresby/Mount Hagen/Madang × terms) so when:14d sticks.

**How to apply:** new PNG/Pacific feeds go in FLASHPOINT_REGIONAL_SOURCES in
`artifacts/api-server/src/lib/migrations.ts` (seeded on boot, reaches prod on
deploy; repairFlashpointSeedUrls updates existing rows' URLs). Any new Google
News feed that must fill a rolling window needs `when:Nd`. CountryReport.tsx
applies isCountryRelevant + isForeignDominantContext + isIndonesianWestPapuaContext
on top of the country token match, so raw-DB rows ≠ rendered rows.
