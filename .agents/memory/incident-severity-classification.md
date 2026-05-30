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
