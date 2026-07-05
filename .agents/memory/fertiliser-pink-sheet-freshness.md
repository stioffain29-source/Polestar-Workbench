---
name: Fertiliser Pink Sheet freshness + stale escalation
description: How the World Bank CMO xlsx URL discovery and the cadence-aware "stale" Source Health escalation for the monthly fertiliser feed work.
---

# Fertiliser Pink Sheet freshness

The monthly fertiliser series (urea/DAP/potash) comes from the World Bank CMO
"Pink Sheet" xlsx. Its download URL is version-stamped (a hash + a vintage id
like `-0050012026`) and rotates, so a pinned fallback silently freezes if the
current URL is not rediscovered each run.

## URL discovery (priceSeries.ts)

- `discoverWorldBankXlsxUrl(log?)` scrapes the CMO landing page, `matchAll`s every
  `CMO-Historical-Data-Monthly.xlsx` href, dedupes, decodes `&amp;`, and prefers
  the **highest vintage year** (`xlsxUrlVintage()` reads the trailing `-…YYYY/`
  id, falling back to any 4-digit year in the path). This picks the freshest
  rotated URL instead of the first match.
- `fetchWorldBankFertiliser(startDate, log?)` tries `[discovered, ...fallbacks]`
  and logs whether the workbook was served from the **discovered current URL** or
  the **PINNED FALLBACK** (the latter means discovery didn't resolve — verify the
  landing-page scrape).

## Cadence-aware staleness escalation (marketSnapshot.ts → sourceHealth.ts)

- Escalation is now PER-SPEC via an optional `Spec.staleLagDays` threshold — set
  ONLY on the monthly series (all `changeMode: "prev"`). The daily/weekly series
  (fuel + Henry Hub) leave it unset and NEVER escalate.
- **Fertiliser** (`FERTILISER_STALE_LAG_DAYS = 75`): normal monthly lag ~50d
  (workbook for month M publishes ~5-6 weeks into M+1), so 75 = a full extra
  missed cycle = a genuine freeze.
- **Monthly energy** eu_gas/coal/electricity (`ENERGY_STALE_LAG_DAYS = 90`):
  these IMF/BLS FRED series publish LATER than the Pink Sheet and routinely lag
  ~60-64d, so 90 sits above that normal cadence — today's normally-lagging data
  stays green, a further missed cycle (~90+) escalates. Verified by dry-run.
- The generic `lagDays > 60` WARN log still fires for all groups (incl. the
  monthly energy series at ~64d) — that WARN is NOT the escalation.
- `staleReason` hint is group-aware: fertiliser points at World Bank CMO
  landing-page discovery, energy points at the FRED series.
- `FeedHealth` now carries `stale?`/`staleReason?`. `recordSourceHealth` has a
  `f.ok && f.stale` branch (before the plain `f.ok` branch) → status `"stale"`,
  `errorMessage = staleReason`, `consecutiveFailures = 0`, `lastSuccessAt = now`,
  telemetry `failureReason = "stale_data"`.

**Why this design:** the feed returns HTTP 200 while frozen, so a fetch-failure
signal never fires — the only tell is the data not advancing. `"stale"` is a real
`SOURCE_STATUSES` value with a badge, an ACTION_PLAYBOOK entry, and is treated as
action-required, so it self-surfaces on Source Health.

**Self-heals:** `effectiveSourceStatus` only auto-recovers `"failing"`, but a
later run whose data has advanced hits the plain `f.ok` branch → `"operational"`,
clearing stale. No manual reset needed.
