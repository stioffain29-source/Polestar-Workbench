---
name: Operating-risk structured briefs (Indonesia / Jakarta)
description: Why the Indonesia/Jakarta weekly briefs render deterministic prose (not AI), and how Papua is kept out of the national Indonesia report.
---

# Operating-risk structured briefs

Two structured weekly reports — **Jakarta Security Watch** (`jakarta`) and
**Indonesia Operating Risk Watch** (`indonesia`) — are a business-language
*quality variant* of the shared structured-brief builder, gated by
`StructuredTheatreConfig.proseVariant === "operating-risk"` (set ONLY on the
Indonesia + Jakarta configs in `pngReportDataset.ts`). PNG + West Papua leave
`proseVariant` unset and keep their original behaviour.

## Deterministic prose is authoritative — never overlaid by AI

`CountryReport.tsx` sends `variant: "png"` to the AI prose engine for EVERY
structured theatre, and `pngEffectiveDataset` normally overlays the AI narrative
(`bluf`, `executiveSummary`, `whatChanged`, `outlook`, `polestarView`) on top of
the deterministic dataset. For operating-risk briefs that overlay is short-
circuited: `pngEffectiveDataset` early-returns the deterministic `pngDataset`
when `proseVariant === "operating-risk"`.

**Why:** the spec gives exact deterministic templates (4-question BLUF, themed
Exec Summary, week-over-week "What Changed", Outlook, strongest Polestar View)
under a STRICT no-fabrication mandate. The generic AI prompt is not
operating-risk-aware and could fabricate, so it must not win. In dev there is no
AI key so the deterministic prose shows anyway; the bug only bites PRODUCTION
(AI configured) — verify there, not just locally.

**How to apply:** any new prose section for these briefs goes in
`operatingRiskProse.ts` (pure, no counts, British English) and is wired through
the deterministic dataset, NOT the AI prompt. Per-incident AI summaries are a
SEPARATE `incidentSummaries` useMemo passed straight to `PngCountryReportBody`,
so they still populate cards and are unaffected by the overlay gate. Editing-mode
narrative fields still exist in the editor but no longer drive the operating-risk
preview/PDF — left as-is per "do not change the report editor".

## Papua exclusion from the national Indonesia report — TITLE ONLY

The national Indonesia report routes Papua-theatre reporting out (it has its own
West Papua brief). `isIndonesianPapuaTheatreContext(text)` in `countryMatch.ts`:
PNG_CONTEXT_RE exempts Papua New Guinea; otherwise matches `\bpapuan?s?\b`
(adjective form included) OR `PAPUA_STRICT_LOCAL_RE`. Wired into the Indonesia
incidents useMemo reading `i.title` ONLY.

**Why:** summary/source fields carry an appended masthead, and the national
outlet "Sabang Merauke NEWS" embeds the Papua city "Merauke" — matching on those
fields false-drops genuine national stories. Title-only avoids it. Sorong is a
Southwest Papua city, so a "theft in Sorong" title is correctly routed out (not
a false drop).
