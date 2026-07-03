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

## "Priorities This Week" section (was "Business Impact")

The section a client called content-free word-salad was rebuilt: it is now event-led, not
category-template. `watchLine(it)` renders one line per incident = `"<SeverityLabel>: <clean
display headline> (<province>). <category action>"`, and the assembly takes the top-4
`windowItems` sorted by severity-then-recency. The category action comes from `baseAction()`
(shared with the Location Watchlist's `recommendedAction`, which just adds a "Treat as
priority." prefix for High/Extreme).

**Field-name trap:** the dataset array is still called `businessImpact` (and
`businessImpactEmptyNote`) for compatibility, but it now powers the "Priorities This Week"
heading. Do NOT assume the field name reflects the section title. Per-item `it.businessImpact`
is a DIFFERENT thing (the generic per-incident impact phrase) and is still used as the
Related Incidents body fallback — keep computing it in `toItem`.

**Why event-led:** the old version looked up a generic per-category impact template, collapsed
location to "the affected area", then deduped to near-identical generic lines — telling the
reader nothing. Naming the real headline + real location + severity is the whole point; never
revert to category-template impact lines.

## SECOND category-phrasing builder — the "Incident Details" theme paragraphs

`buildCountryIncidentThemes` (artifacts/workbench/src/lib/countryIncidentThemes.ts) is a SEPARATE
deterministic builder behind the "Incident Details" theme sections (its output feeds BOTH the
on-screen `PngCountryReportBody` and the headless `exportCountryReportPdf` from the same expression,
so preview==PDF automatically). It has its OWN category-phrasing map — `categoryNoun()` — distinct
from `pngReportDataset`'s `categoryPhrase()`. **When you fix category word-salad, check BOTH.**

- **`categoryNoun()` replaced `readableCategory()`.** The old fn slash-expanded every `A / B` bucket
  label to "A and B", so a theme's category list read "homicide and violent crime, theft and
  break-in and terrorism and militancy" — an "and … and … and" run. `categoryNoun` takes the FIRST
  slash-segment (+ a small override map) so labels are clean single nouns; the list then has at most
  one "and" (the final conjunction).
- **Each theme paragraph names the single most serious REAL incident** via `leadIncidentSentence`
  (highest `severityRank`, then most recent; `developmentTitle||title`, province in parens if not
  already in the title, "assessed as `<severityLabel>` severity") — turning generic templates into a
  specific account. No fabrication: every field is the incident's own. **The source-safe fire theme
  is the exception — it never gets the lead sentence** (a severity assessment could imply a cause,
  which the fire prose must never do).
