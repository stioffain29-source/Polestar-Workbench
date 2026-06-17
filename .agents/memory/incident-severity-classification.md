---
name: Incident severity classification
description: How ingested flashpoint/cargo_watch incidents get their five-tier severity, and why a backfill exists.
---

Severity is rated from incident text (title+summary), not hardcoded. The scrapers used to
write `severity: "low"` for every row, collapsing the Severity Distribution chart to one bar.

- `classifySeverity(title, summary, topic)` in `lib/ingest/src/severity.ts` is the single source
  of truth, used by BOTH scrapers and the backfill. Tiers scanned highest-first; strongest signal wins.
- **Extreme is reserved** for fatal / mass-casualty / emergency-rule language only — this is the
  brand rule (subdued red `#A33232` marks Extreme only), so do not loosen the EXTREME regexes.
- cargo_watch has a moderate *floor* for a completed theft (stolen/robbery/burglary); pilferage/
  attempted/recovered drops to low. flashpoint defaults to low (peaceful/planned protest);
  forward-looking threats/plans/advisories → insignificant.

**Why a backfill exists:** scraper dedupe never re-touches existing rows, so fixing the scraper
alone leaves historical auto-scraped rows stuck at low. `runSeverityBackfill` reclassifies EXISTING
rows scoped to `analyst_notes LIKE 'auto-scraped:%'` (never overwrites analyst-entered severities).
It lives in the lib (not just the CLI script `scripts backfill:severity`) for the same reason as the
scrapers: the workspace only sees a read-only prod replica, so prod must be re-rated from the
deployment runtime which owns the writable DB.

**How to apply:** if you change the classifier signals, re-run `pnpm --filter @workspace/scripts run
backfill:severity -- --commit` on dev, and run the equivalent in the deployment to fix prod.

## Reaction / advocacy headline guard

A headline LED by an advocacy/statement verb ("<group> demands ban … seeks justice for six slain
Nagas") is a REACTION to a prior event — its casualty words ("slain", "killing") are references, not
a fresh attack — so it must NOT trigger the reserved Extreme/High tiers. `isReactionLed(title)` /
`REACTION_LEAD_RE` (title-lead anchored, {0,4} words; EXCLUDES protest/rally/clash, which can BE the
violent event) gates the shared Extreme, shared High, and conflict armed-clash High **only for
topic ∈ {flashpoint, conflict}**. Other topics (shipping/cargo/fuel/…) keep escalation on purpose: a
reaction-framed deadly maritime attack is often the ONLY record of a real kinetic event.

## Healing existing rows after a CLASSIFIER change — surgical migration, NOT the full backfill

**Why:** wiring `runSeverityBackfill` into `runIngestOnce` (or broadening its scope to re-rate the
whole auto-scraped table) re-applies the GDELT **fatality floor** (`severityFromFatalities`) and
historical classifier drift to ~every row — a dry-run flipped 217 rows and *increased* Extreme by
~59. That is off-scope drift for a targeted "stop over-rating X" bug and risks new complaints.
**How to apply:** heal existing rows with a marker-gated boot migration in `migrations.ts` that is
(a) auto-scraped only, (b) current High/Extreme only, (c) gated on the exact change (e.g.
`isReactionLed`), (d) **downgrade-only** (`SEVERITY_RANK[next] < stored`), and (e) STILL applies the
fatality floor (`next = floor ? maxSeverity(text, floor) : text`) so a confirmed-fatality row is
never downgraded. Fix the migration BODY (don't bump the marker key) when prod hasn't run it yet —
prod runs each marker once, and an uncorrected earlier body would execute first there.
