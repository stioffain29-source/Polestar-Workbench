---
name: Country report dual-severity Fast Facts
description: Why country briefs show BOTH a weekly and a standing-risk severity, and the Extreme brand-colour rule that goes with it.
---

# Country report shows two severities, not one

Country Report Fast Facts render TWO severity cards side by side:
- **Severity This Week** — highest severity across the rolling 7-day window.
- **Standing Risk** — highest severity across the relevance-filtered 90-day
  bucket (`layers.ninetyDay`, same source as the watchlist `WORST (90D)` column).

**Why:** the headline basis is fixed to the 7-day window by an earlier explicit
decision. On an active theatre (e.g. Indonesian West Papua) a quiet week then made
the brief read "Low / 2 records" even though the standing picture is Extreme —
the user called that "nonsense / lies". The standing card keeps the persistent
risk visible without widening the weekly window. User picked this "show both"
option over "lead with standing risk" or "keep 7-day only".

**How to apply:** the two-severity layout in `computeCountryFastFacts` only
triggers when the caller passes `standingIncidents`; both callers
(`CountryReport.tsx`, `exportCountryReportPdf.ts`) pass `layers.ninetyDay`.
Omitting it falls back to the original single "Highest Severity" card, so the
function stays backward compatible. Preview and PDF both consume `facts.cards`
directly, so any card change stays in parity automatically.

# Extreme severity colour must be #A33232

`SEV_COLOR.extreme` was `#800000` (maroon) in both `CountryReport.tsx` and
`pdfChrome.ts` — a deviation from the brand spec, which reserves subdued red
**#A33232** for Extreme only. Aligned both to `#A33232`.

**Why:** the user is strict about the brand palette; an off-spec Extreme red is
treated as a defect. **How to apply:** any new severity chip/strip pulls from
these `SEV_COLOR` maps — never hard-code an Extreme colour.
