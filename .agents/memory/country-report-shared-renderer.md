---
name: Country report shared renderer + analyst layout controls
description: One renderer for ALL country reports (PNG/West Papua/Indonesia/Jakarta + every generic country); fixed section order, PRESENT-ONLY themed Incident Details (absent themes are omitted, never "Not reported"), no Maritime Security, analyst-placed map/photo persisted outside the prose cache.
---

# Country report shared renderer (PngCountryReportBody)

`PngCountryReportBody.tsx` is the SINGLE renderer for every country report —
structured theatres AND generic countries — driven by a `PngReportDataset`.

## Fixed section order (all theatres)
Bottom Line Up Front → Top 3 Developments (≤3 tiles) → Incident Details (PRESENT-ONLY,
MEANINGFUL themed paragraphs) → Current Situation (≤2 paras) → Operational Impact (≤5
bullets) → Recommended Actions → Outlook (1 para + ≤3 escalation indicators) → Polestar
View. The body CLOSES on Polestar View; the Disclaimer is PAGE-appended by
`CountryReport.tsx` below the body, never emitted by the body itself.
**Reporting Confidence and Customer Relevance were REMOVED from the country brief** in the
wall-of-text trim. Their dataset fields (`reportingConfidence`, `customerRelevance`,
`whatMattersBullets`) are still computed/typed in `pngReportDataset.ts` but are NO LONGER
RENDERED — left in place deliberately to avoid a fixture cascade; do not re-render them
without the user asking.

## Incident Details themes (PRESENT-ONLY + MEANINGFUL, one paragraph each)
`buildCountryIncidentThemes` (`lib/countryIncidentThemes.ts`) emits a group ONLY for
themes present in `incidentDetailsItems` this window AND meaningful — a theme is kept only
if it recurs (≥2 items) OR reaches Moderate severity+ (worstSeverityIndex≥2); single
Low/Insignificant themes are dropped. Absent themes are OMITTED, never padded with "Not
reported this period." (the old always-on six-theme scaffold was removed). Each kept theme
now renders as ONE short, count-free analytical `paragraph` (the legacy four-part What
happened / Where / Why / What-affected fields still exist internally but are NOT rendered).
`themeForCategory` stays an EXHAUSTIVE `Record<PngCategory, theme>` (adding a PngCategory
forces a theme assignment, compile error otherwise). `incidentDetailsItems` is windowItems
MINUS the Top-3 cluster members. Narrative is COUNT-FREE (brand rule: no "(N records)" in
prose). Severity is described adjectivally ("High-severity reporting featured") — house
style, NOT a tier-label substitution.
**No-fabrication empty note:** when no meaningful theme forms, the section distinguishes
three cases — empty window → `emptyLocationFallback`; window had items but NO leftover
(all promoted to Top 3) → "No further incident reporting beyond the developments…";
leftover existed but failed the meaningfulness gate → "Remaining reporting … was limited
to isolated, lower-severity incidents that did not warrant separate detail." Never claim
"no further reporting" when sub-threshold leftover items actually exist.

## Per-theatre gating — additions to the shared renderer are DANGEROUS
`PngCountryReportBody.tsx` + `exportCountryReportPdf.ts` render PNG, West Papua,
Indonesia AND Jakarta from the same code. Any per-incident / expansive addition
(e.g. the compact per-item "place + honest date" cards under each Incident
Details theme) MUST be gated to a specific theatre, or high-volume theatres blow
up. **Why:** rendering per-item cards unconditionally took Indonesia's weekly
brief to ~361 pages (West Papua ~15) while PNG stayed ~6 — the font gate PASSED
at 361 pages because it only checks fonts, not length. **How to apply:** the
per-item cards are switched on by a config flag `perIncidentDetailCards` set ONLY
on `PNG_REPORT_CONFIG`, surfaced on the dataset as `showPerIncidentCards`, and
both consumers read `d.showPerIncidentCards ? (g.items ?? []) : []`. Keep West
Papua / Indonesia / Jakarta paragraph-only (inert). `buildCountryIncidentThemes`
still populates `items` for every theatre — the gate lives in the consumers, not
the builder.

## Maritime Security REMOVED from country reports
Country reports no longer render the ICC/IMB maritime-security block or its
fetch. **Why:** scope decision for the country brief. TOPIC (shipping) reports
KEEP maritime security — do not strip it there.

## Analyst layout controls (durable, OUTSIDE the prose cache)
`map_placement` (text), `photo_placement` (text), `report_photos` (jsonb,
`CountryReportPhoto[] = {dataUrl,caption?,source?,credit?,context?}`) persist on
the country_reports row.
**Why:** they must NEVER be folded into the AI-prose fingerprint cache, or
changing layout would regenerate (and bill) the narrative. They ride the normal
PATCH update, seeded/cancelled with the draft, not the prose generate flow.
**How to apply:** map has 7 placements — 5 inline slots in the renderer
(after-bluf/after-top3/after-incident-details/before-outlook/before-polestar)
plus `none` and `end` (end handled in CountryReport.tsx just above the analytics
block). Photo has 6 — 4 inline slots (after-bluf/after-top3/inside-incident-
details/before-polestar) plus `none` and `cover` (cover handled on the cover page
in CountryReport.tsx). The map node is `CountryReportMap`; the photo node is a
static-DOM `CountryReportPhotoBlock` (img+figcaption) so it rasterises into the
in-app PDF (screen==PDF). Photo uploads are JPEG-resized (maxDim 1600) and total
payload is byte-capped before the PATCH to stay under express.json limit.
