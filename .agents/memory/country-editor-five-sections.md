---
name: Country brief 5-section model + in-preview editing
description: Merged 8→5 canonical country/city brief sections and moved editing into the preview; parity + normalization rules.
---

Owner ruling (11 Aug 2026): country/city briefs use FIVE canonical section keys —
`bottom-line`, `top-3`, `current-situation`, `actions-outlook`, `polestar-view`
(Fast Facts cards kept, not a keyed section). Operational Impact / Recommended
Actions / Outlook (+escalation indicators, upcoming signals) render as STRAND
labels under one "Actions & Outlook" section.

**Rules:**
- `normalizeHiddenSections()` in `countrySectionOverrides.ts` maps legacy persisted
  keys (incident-details→current-situation; operational-impact/recommended-actions/
  outlook→actions-outlook) and drops unknowns. Any reader of saved
  `hiddenSections` must run it (body normalizes internally; CountryReport seeds
  + cancel-reset also do).
- Parity: `renderStructuredBrief` (headless jsPDF audit path) must mirror
  PngCountryReportBody's INCLUSION GATES exactly — sections/strands with no
  content are OMITTED, no headless-only "Not populated." fallbacks (only BLUF
  keeps one). A code-review round caught this drifting once; the guard is
  `structuredBriefEmptyPdf.test.ts` (asserts retired standalone headings never
  reappear + no empty sections).
- In-preview editing: body takes `editUi` prop (sectionChrome hide/show per
  section incl. hidden stubs; inline prose editors replacing
  bluf/executiveSummary/outlook/polestarView). Editors use the fuel prefill
  pattern: box shows exactly the rendered text; restoring the engine default
  stores "" so auto prose keeps flowing. Prose editors gated OFF for
  operating-risk variants (deterministic prose, no analyst prose fields).
- PDF safety: `editUi` only passed while `editing`, PDF download disabled while
  editing, chrome is `.no-print` — three independent layers keep edit chrome
  out of exports.
- Old setup panels live in one collapsed `<details className="no-print">`
  "Report setup & advanced" drawer; the section-visibility checkbox panel was
  deleted (in-preview Hide/Show replaces it). What Changed stays in the drawer
  (it has no rendered block of its own).
- Jakarta: Area Situation gates on `current-situation`, Recommended Actions on
  `actions-outlook`; section TITLES unchanged so `auditJakartaPdf.ts`
  CANONICAL_SECTIONS still passes.

**Why:** owner wanted fewer panels and edit-from-preview; parity is enforced by
headless audits, so any body/exporter gate change must land in both files.
**How to apply:** adding/hiding/reordering a country-brief section = touch
COUNTRY_SECTION_KEYS + body gates + renderStructuredBrief gates + the empty-PDF
guard test in lockstep.
