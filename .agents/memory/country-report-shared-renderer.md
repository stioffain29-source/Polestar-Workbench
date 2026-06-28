---
name: Country report shared renderer + analyst layout controls
description: One renderer for ALL country reports (PNG/West Papua/Indonesia/Jakarta + every generic country); fixed section order, 6 themed Incident Details, no Maritime Security, analyst-placed map/photo persisted outside the prose cache.
---

# Country report shared renderer (PngCountryReportBody)

`PngCountryReportBody.tsx` is the SINGLE renderer for every country report —
structured theatres AND generic countries — driven by a `PngReportDataset`.

## Fixed section order (all theatres)
Bottom Line Up Front → Top 3 Developments (≤3 tiles) → Incident Details (6 themed
narrative groups) → Current Situation → Operational Impact → Recommended Actions →
Outlook → Polestar View → Reporting Confidence → Disclaimer.

## Incident Details themes (6, FIXED order)
Protest & civil unrest; Crime, theft & robbery; Natural hazards; Governance &
regulatory; Fire & explosion; Other operational disruption. Mapping lives in
`lib/countryIncidentThemes.ts` — `themeForCategory` is an EXHAUSTIVE
`Record<PngCategory, theme>`; adding a new PngCategory forces a theme assignment
there (compile error otherwise). Empty themes render "Not reported this period."
Narrative is COUNT-FREE (brand rule: no "(N records)" in prose).

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
