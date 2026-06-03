---
name: PNG flashpoint feeds & Pacific crime acceptance
description: Why opening PNG feeds needs a classifier change + when:Nd, and why the recent PNG window is structurally sparse
---

The PNG (and West Papua) country report kept rendering "too thin" — the rolling
7-day window was empty even after the noise items were dropped.

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
ingest via the 11-char parenthetical YouTube video-id pattern in FLASHPOINT_DENY.

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

**How to apply:** new PNG/Pacific feeds go in FLASHPOINT_REGIONAL_SOURCES in
`artifacts/api-server/src/lib/migrations.ts` (seeded on boot, reaches prod on
deploy; repairFlashpointSeedUrls updates existing rows' URLs). Any new Google
News feed that must fill a rolling window needs `when:Nd`. CountryReport.tsx
applies isCountryRelevant + isForeignDominantContext + isIndonesianWestPapuaContext
on top of the country token match, so raw-DB rows ≠ rendered rows.
