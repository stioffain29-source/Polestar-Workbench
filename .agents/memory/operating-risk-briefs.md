---
name: Operating-risk briefs (now EVERY country report)
description: Why country reports render deterministic operating-risk prose (not AI), how the generic builder extends it to all countries, and why the architect's "wasted AI / stale hidden prose / caption count" FAIL is non-actionable.
---

# Operating-risk briefs

The operating-risk brief is now the layout for **EVERY country report**, not
just the two structured weeklies. Two paths feed the SAME `PngCountryReportBody`
renderer + `CountryReportVisuals` block (map leads):
- **Structured theatres** (`pngReportDataset.ts`): Jakarta + Indonesia set
  `StructuredTheatreConfig.proseVariant === "operating-risk"`. **PNG + West
  Papua leave `proseVariant` unset** and keep AI-overlaid section prose.

> **Jakarta has SINCE diverged onto its own bespoke builder.** Do NOT assume
> Jakarta == Indonesia. Jakarta additionally sets `config.jakartaProse` (set ONLY
> on `JAKARTA_REPORT_CONFIG`); when true, `buildStructuredReportDataset` layers
> Jakarta-specific section overrides from `jakartaBrief.ts` ON TOP of the shared
> operating-risk dataset (BLUF/Exec Summary/Outlook/Polestar/Recommended Actions
> + new optional dataset fields `incidentThemesOverride`,
> `operationalImpactOverride`, and per-item `developmentTitle`). The renderer
> prefers those overrides via `?? generic`, so a missing override silently falls
> back — Indonesia/PNG/West Papua are untouched because the flag and the override
> fields are absent for them. Adding a new Jakarta section means: builder in
> `jakartaBrief.ts` + override field on the dataset + a `?? generic` consumer in
> `PngCountryReportBody` + the `jakartaProse` gate, or it regresses other
> theatres or silently no-ops. Builders pinned by `jakartaBrief.test.ts`; the
> renderer-consumes-overrides contract by `jakartaReportRender.test.tsx`. Live
> screenshot is impossible (owner-auth login wall, no dev bypass) so those render
> tests ARE the visual proof. Jakarta map zones scan in numbered-callout DISPLAY
> order, so an airport-specific token (`cengkareng`) loses to the earlier generic
> `west jakarta` district — fixed by an airport-token PRE-PASS (not a reorder, to
> keep the legend numbering), pinned by `jakartaMapZones.test.ts`.
- **Every other (generic) country**: `countryOperatingRiskDataset.ts` builds a
  full `PngReportDataset` straight from raw window incidents and tags it
  `proseVariant: "operating-risk"` (themed Key Developments via the shared
  `@workspace/ingest` classifier; Location Watchlist from incident localities).

So `proseVariant === "operating-risk"` is true for ALL countries EXCEPT PNG +
West Papua, which still use the AI section overlay.

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

## The architect's operating-risk FAIL is non-actionable — do NOT re-litigate

An `evaluate_task` review FAILs operating-risk on two grounds; both were checked
against the code and rejected. Future reviews will likely raise them again.

1. **"Wasted AI spend + stale hidden section prose."** For an operating-risk
   country the `generateProse` effect still fires and `save()` still persists its
   sections. But that one call is ALSO the mechanism for the per-incident card
   summaries that ARE displayed (`incidentSummaries` derives from
   `proseResult.sections`), so it is NOT a wasted call. The section prose it
   returns is (a) never displayed — `pngEffectiveDataset` early-returns the
   deterministic dataset; (b) not analyst-editable — the editor shows only the
   incident-summary fields for operating-risk; (c) **fingerprint-bound** — the
   `editProse` save is rejected server-side on a stale fingerprint, so it can
   never describe an old snapshot. So it is not "stale" and not "hidden prose"
   in any harmful sense.
   **Why not fix:** the only clean removal is an incident-summaries-ONLY server
   mode on the shared prose endpoint, which also serves PNG/West Papua (who NEED
   the section prose). That blast radius makes it a separate follow-up, never an
   in-scope tweak. Gating generation OFF for operating-risk would silently kill
   the card summaries.

2. **"No-count violation: map caption prints `(N records in the window)`."** That
   caption lives in `CountryReportVisuals`, not the brief, and is a chart/figure
   caption — `replit.md` EXPLICITLY allows counts on "Fast Facts stat tiles and
   chart captions". Only narrative paragraphs must stay count-free. Changing it
   would be drift from a documented user preference.

Render-level guard for the no-count rule on the BRIEF: `PngCountryReportBody`
itself is count-free (every `.length` is a conditional, never printed) — pinned
by `__tests__/workbench/countryOperatingRiskRender.test.tsx` (section order +
"Business impact:" + no count in the rendered narrative).

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
