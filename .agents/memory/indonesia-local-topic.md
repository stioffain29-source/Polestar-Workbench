---
name: indonesia_local broad-coverage topic
description: Dedicated Bahasa-first news topic feeding the Jakarta + Indonesia COUNTRY reports; how it differs from flashpoint and the non-obvious wiring decisions.
---

# `indonesia_local` broad-coverage topic

A dedicated config-driven `runNewsTopicIngest` topic that fills the **Jakarta
Weekly** (slug `jakarta`) and **Indonesia Weekly** (slug `indonesia`) COUNTRY
reports with broad Bahasa-first local coverage (protest, crime,
flood/fire/quake/haze, transport/aviation/port, government, labour, terrorism).
Flashpoint deliberately stays **unrest-only** — this topic is the everything-else
layer.

**Why it works without touching the reports:** country reports read by COUNTRY
across ALL topics (no topic filter) — they fetch `includeIrrelevant:true` then
filter by `incidentMatchesCountry`. So rows with `country="Indonesia"` flow into
the Indonesia/Jakarta briefs automatically. The structured Indonesia/Jakarta
path (`buildIndonesiaReportDataset`/`buildJakartaReportDataset`) applies **no
extra security gate**, so hazard/fire/haze/labour/terrorism all surface, not just
unrest.

## Non-obvious decisions

- **`category` column is NULL for generic news topics by design.** Structured
  reports derive the category CLIENT-SIDE via `extractStructuredItem` /
  `CATEGORY_RULES` (shared, theatre-agnostic — PNG/WP use the same rulebook).
  Broaden coverage by EXTENDING `CATEGORY_RULES` additively (verify PNG/WP rule
  ORDER is unaffected), never by writing a server category.
- **Source-based confidence is OPT-IN per `NewsTopicConfig`.** Existing topics
  (energy/fertiliser/fuel/shipping) keep the default `low`; only `indonesia_local`
  tiers official/multi-source=high, named-media=medium.
- **No `RELEVANCE_RULE_VERSION` bump.** Rules scoped to a NEW topic don't
  re-evaluate existing rows, so the boot backfill stays off — the highest-risk
  item avoided.
- **Translation markers must carry the family vocab.** Bahasa headlines for the
  new families (protest/hazard/fire/haze/labour/terror/crime/corruption) carried
  none of the old function-word markers (~56% shipped raw). Fix is the standard
  one: add distinctly-Indonesian words to `INDONESIAN_MARKER_WORDS` (see
  `title-translation-markers.md`); coverage measured 44%→88% on live rows.

## Watch: cross-topic country double-count

`flashpoint`(Indonesia) and `indonesia_local`(Indonesia) BOTH carry
`country="Indonesia"`, so both flow into the Indonesia country report. Title-based
dedup collapses identical syndication, but the SAME unrest event captured as an
English flashpoint headline AND a Bahasa indonesia_local headline has different
titles → won't dedup → can double-count. Flashpoint APAC coverage is sparse so
overlap is small today, but a future cross-language event-key dedup may be needed.
