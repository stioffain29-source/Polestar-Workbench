---
name: Country same-story bilingual clustering (raw vs resolved title)
description: Why West Papua country surfaces led with raw Bahasa and how the two same-story clustering sites differ (raw-title vs resolved-title) and were fixed.
---

# Country same-story bilingual clustering

Foreign incident headlines get an English `display_title` from a BOUNDED per-run ingest
translation backfill that lags ~1 day, so the NEWEST copy of a story is the one LEAST
likely to be translated yet. A same-story cluster's representative is "highest severity,
then NEWEST" → country surfaces led with the untranslated Bahasa copy.

**Two same-story clustering surfaces behave differently — this is the crux:**
- **Site 1 — `consolidateCountryStories` (countrySameStory.ts):** page-level, feeds the
  Operational Map (`CountryReportMap`) and country Fast Facts. Clusters on the **RAW**
  title (`displayTitle` is a separate field). Bilingual copies of one story share a
  similar raw Bahasa title → they DO cluster naturally.
- **Site 2 — `clusterSameStory` (pngReportDataset.ts):** the structured brief builder
  (PNG / West Papua / Indonesia / Jakarta Top-3 + buckets). Clusters on the **RESOLVED**
  title (`PngReportItem.title = stripWireCruft(displayTitle || cleanTitle(title))`). So the
  translated English copy and the untranslated Bahasa copy of ONE story DIVERGE and never
  land in the same cluster → BOTH survive and the newest Bahasa one leads (also a
  double-show).

**Fix (two parts):**
1. `readableRepresentativeIndex(cluster, rendersForeign, severityRank, dateMs)` (exported
   from countrySameStory.ts): when `cluster[0]` renders foreign, re-select the NEWEST
   English-rendering member WITHIN the same top severity tier. Never downgrade severity;
   fall back to `cluster[0]` as an honest gap (UntranslatedBadge still flags it). Wired at
   BOTH sites.
2. ADDITIVE cross-language merge in `clusterSameStoryRows`: `SameStoryRow` gained optional
   `rawTitle`; `PngReportItem` gained optional `rawTitle` (set in `toItem` as
   `stripWireCruft(cleanTitle(i.title, i.source))` — raw, NOT display-substituted).
   Two new paths, both inert unless BOTH rows carry `rawTitle`: **PATH 0-raw** (identical
   canonical raw title, ungated like PATH 0) and **PATH 1-raw** (raw-token Jaccard ≥0.5,
   same/adjacent day, placed AFTER the province + compatType gates like PATH 1).

**Why additive, not a clustering-key swap:** countrySameStory PATH 2/3/4 and the fire/
entity keys are ENGLISH-lexicon. Clustering the builder wholesale on raw Bahasa titles
would REGRESS existing merges of two already-English copies. Additive raw paths only ADD
members to clusters (break-on-match) — nothing already merged un-merges, and site 1 (never
sets `rawTitle`) is byte-identical.

**How to apply:** any new country same-story surface must decide which title it clusters
on. If it clusters on the resolved/display title, it needs `rawTitle` threaded through +
the additive raw paths, or bilingual copies double-show and lead foreign. Keep
`readableRepresentativeIndex`'s same-tier + never-downgrade guarantee (downstream
`selectTopStoryClusters` reads `c[0].severityRank`). Residual by-design gaps: differently
worded raw Bahasa headlines from different outlets still won't cluster unless PATH 2/3/4
fires; if the only English sibling is a lower severity tier, Bahasa still leads (honest,
never up-rate).
