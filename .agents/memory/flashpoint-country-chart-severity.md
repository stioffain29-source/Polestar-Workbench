---
name: Flashpoint report country chart — incidents + severity colour
description: Why the flashpoint report's country bar chart is labelled "Incidents" (not "Records") and colour-coded by highest severity.
---

# Flashpoint report "Incidents by Country" chart

The flashpoint REPORT country bar chart is built from the `enriched` set
(`selectFlashpointUsable` → already title-deduped + weak-noise-stripped), so it
counts DISTINCT INCIDENTS, not raw feed records. Label reads **"Incidents by
Country"** ("(Top 12)" when ≥12), matching the honest count. Fast Facts tile is
**"Incidents In Window"**.

Each country bar is COLOURED by that country's HIGHEST severity tier (`SEV_HEX`
ramp), with an italic caption: "Bar length shows incident count; colour shows the
highest severity reported in each country."

**Why:** the owner objected that "the number of reports does not reflect the
severity of the situation" — a low-count / high-severity theatre must not read as
minor just because it has few rows. Encoding severity as bar colour fixes that
without inflating counts. Do NOT revert the bars to a flat Electric-Blue.

**How to apply:**
- Colour is derived from stored `r.severity` over the SAME set/keying as the
  count (trimmed `r.country`, identical to `countriesOf`) → count and colour can
  never disagree. Unknown/blank severity ranks 0 → neutral Electric-Blue fallback
  (`#465bff`), never a severity tier. This is no-fabrication safe (no up-rating).
- `SEV_HEX` is a LOCAL copy in `flashpointReportDataset.ts` that mirrors
  `pdfChrome` `SEV_COLOR` (extreme `#A33232`, high `#C0392B`, moderate `#E67E22`,
  low `#6FB872`, insignificant `#1B6B7A`). Kept local ON PURPOSE so jest/tsx
  callers don't drag jsPDF/`@assets` in via pdfChrome. Change the ramp in BOTH in
  lockstep. (`#A33232` = Extreme only, `#1B6B7A` = Insignificant only.)
- Preview (`FlashpointReportPreview.tsx`) and PDF (`exportFlashpointReportPdf.ts`
  `drawHorizontalBarChart`) both honour per-row `r.color` and must stay in parity:
  same heading, same "(Top 12)" `≥12` threshold, same caption, AND both suppress
  the caption in the empty-rows state (PDF `captionH=0`; preview caption gated on
  `ds.countryRows.length > 0`).
