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
