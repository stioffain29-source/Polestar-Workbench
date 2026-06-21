---
name: Severity-tier color ramp duplication
description: Where the 5-tier severity color ramp is duplicated and the per-tier text-color special-cases that must be kept in sync across screen and PDF.
---

# Severity-tier color ramp is duplicated across many files

The 5-tier severity color ramp (Insignificant/Low/Moderate/High/Extreme) is **not** centralized — it is copy-pasted as a per-file map (`RATING_COLORS`, `SEV_COLOR`, `CARD_RATING_COLORS`, `MARITIME_RISK_COLOR`, etc.) across at least these surfaces:
`topics.ts`, `shippingReportDataset.ts`, `pdfChrome.ts`, `spotReport.ts`, `cardTemplates.ts`, `CountryReport.tsx`, `PngCountryReportBody.tsx`, `CountryReportMap.tsx`, `maritimeIntelligence.ts`.

**Why:** Changing one tier's color (e.g. Insignificant grey → petrol blue #1B6B7A) means editing ALL of them in lockstep — preview, PDF chrome, dashboard, map markers, cards, country/maritime ramps. Miss one and screen!=PDF or a stray old color survives on one surface.

**How to apply:**
- When a tier color changes, grep the OLD hex repo-wide and triage every hit: severity ramp (must change) vs. no-data KPI accent fallback (`?? "#B8C2CC"`) vs. arbitrary entry in a non-severity CHART CATEGORY palette (CargoWatch/Strikes/shippingAnalysis/maritimeSecurity) — the latter two are intentionally LEFT.
- Per-tier TEXT color is a SEPARATE concern from the background ramp. When a tier background goes dark, also flip its text to white in BOTH the screen maps (`RATING_TEXT_COLORS`, `CARD_RATING_TEXT_COLORS` → `#FFFFFF`) AND any PDF exporter that special-cases that tier's chip text. `exportTopicReportPdf.ts` had a hidden `sk === "insignificant" ? DUSK : WHITE` chip-text ternary that broke contrast/parity until set to white — PDF builders can carry their own per-tier text overrides that the screen `severityBadgeStyle` does not.
- Brand rule: subdued red `#A33232` is Extreme-only; petrol blue `#1B6B7A` is Insignificant-only. Never reuse either on another tier.
