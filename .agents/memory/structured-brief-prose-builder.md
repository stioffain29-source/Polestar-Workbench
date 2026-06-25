---
name: Structured country-brief prose builder
description: The one shared deterministic prose builder behind PNG/West Papua/Indonesia/Jakarta briefs and its category-phrasing + grammar invariants.
---

# Structured country-brief deterministic prose builder

`buildStructuredReportDataset` (artifacts/workbench/src/lib/pngReportDataset.ts) is the
SINGLE deterministic prose builder behind ALL four structured country briefs: PNG, West
Papua, Indonesia, Jakarta (each is a thin wrapper passing its own *_REPORT_CONFIG). A fix
to one structured brief's prose applies to all four — there is no per-theatre prose copy.

It is the FALLBACK. For structured briefs the server LLM (countryProse.ts, variant "png")
only supplies Executive Summary + Outlook; every other section is owned by this builder.
When OpenAI is unconfigured OR no cached `country_report_prose` row matches, the client
renders this builder verbatim. So in dev (no AI key, no cached row) what you see IS this
builder — a stale-looking on-screen brief usually means the dev server/HMR hasn't reloaded
or you're looking at un-republished production, NOT a cache.

## Invariants (a client complained when these were violated)

- **Never splice a raw `IncidentCategory` bucket label into prose.** Labels like
  `civil unrest / protest` or `Other security` read as word salad. Route EVERY prose site
  (executive summary, BLUF, what-changed, location-watchlist "why", outlook, Polestar View)
  through `categoryPhrase()` / the `CATEGORY_PHRASE` map, which maps each of the ~21 labels
  to a natural lowercase noun phrase (e.g. "Other security" -> "other security-relevant
  incidents"). Adding a new category means adding its phrase here too.
- **Keep raw lowercased labels for COMPARISON only** (`leadCat` vs `prevTopCat` week-on-week
  delta). Only the displayed phrase is humanised; the comparison keys stay raw.
- **Subject-verb agreement trap:** a category phrase can be singular or plural ("fires",
  "theft and break-ins", "other security-relevant incidents"). Never write `... is ${phrase}`
  (gives "concern is fires"). Use verbs that agree either way — "reporting centres on
  ${phrase}", "${Phrase} featured ...", "with ${phrase} ... leading the reporting".
- **Banned jargon** the client called out: "operating tempo", "standing baseline",
  "reads this period as". Use plain wording ("standing risks remain relevant", "from a high
  baseline").
- House rules still apply: British English, no incident COUNTS in prose, no fabrication.
