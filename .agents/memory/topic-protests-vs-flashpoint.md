---
name: protests vs flashpoint topic split
description: Why the "Protests & Civil Unrest" monitor showed frozen data while the scraper ran fine, and how the monitor is wired to the live topic.
---

# "Protests & Civil Unrest" monitor vs the flashpoint scraper

The incidents table has TWO civil-unrest topics with identical report branding
(`reportNaming.ts` CANONICAL_TOPIC maps both `flashpoint` and `protests` to the same
"Flashpoint — Activism, Protests & Civil Unrest" product):

- `flashpoint` — the LIVE topic the scraper writes (`lib/ingest/src/flashpoint.ts` hardcodes
  `topic='flashpoint'`). This is where fresh ingested data lands.
- `protests` — a legacy/manual one-time static snapshot. NOTHING scrapes it.

The topic monitor page (`artifacts/workbench/src/pages/Topic.tsx`, URL `/topics/protests`)
queried the raw `protests` topic, so it stayed frozen at the snapshot date even though the
scraper was producing fresh protest data under `flashpoint`. The reports / data-status layer
already mapped `protests`→`flashpoint`; only the monitor page was inconsistent.

**Rule:** the user-facing "Protests & Civil Unrest" view must read the `flashpoint` topic, not
`protests`. Topic.tsx resolves the `protests` slug to the `flashpoint` data topic (keeping the
"Protests & Civil Unrest" label). If a similar "view shows stale data but the scraper runs
fine" report appears, check whether the page is querying a legacy topic id that no feed writes.

**Why:** two redundant topic ids for the same product; the scraper standardised on
`flashpoint` and `protests` became a dead snapshot.

## Legacy `protests` seed stranded real West Papua conflict ("nothing from Freeport")

The dead `protests` bucket isn't just stale — a curated seed (`analyst_notes LIKE
'legacy:db:regional_incidents%'`) filed genuine West Papua **armed-conflict** events
(TPNPB ambushes, the Tembagapura mining-area shooting, firefights, IED finds) under it
alongside real protests. Because the protests bucket is *scored under the flashpoint
public-order rule*, every armed-conflict row was marked irrelevant and hidden
everywhere — the visible symptom was "seeing nothing from the Freeport mining area."

**Fix pattern (marker-gated boot heal in `runDataMigrations`):** re-home each
Papua-province legacy-protests row to the topic whose relevance rule actually keeps it —
evaluate `conflict` first, else `flashpoint`, persisting the engine verdict. Leave rows
neither rule keeps on the inert `protests` bucket (don't mis-file petty crime/labour
under a live topic just to drain the bucket).

**Gotchas worth remembering:**
- A topic-mismatch is invisible to the relevance engine: `evaluateIncidentRelevance`
  takes no `country` field and scores against whatever topic rule you pass. Mis-topiced
  rows get scored under the *wrong* rule and silently dropped. Always re-rate when you
  re-home.
- **Summaries matter for the verdict.** Title-only simulation under-counts: e.g. "Five
  civilians killed in Indonesian military operation at Kali Kabur" is dropped on title
  alone but kept once its summary is included. Simulate with the full row, not the title.
- The conflict rule requires an explicit kinetic/armed-actor phrase, so genuinely-severe
  but consequence-worded rows ("Renewed armed activity in Nduga **displaces villagers**",
  "**Shots fired** near Timika perimeter road") still drop — that's a relevance-rule gap,
  a separate (riskier, version-bumped, collision-prone) change, NOT part of the re-home.
- The global `protests` bucket is large (hundreds of rows across regions); this heal is
  deliberately scoped to Papua provinces only. The rest is a latent follow-up.
