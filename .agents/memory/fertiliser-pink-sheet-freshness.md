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

- **Normal monthly lag is ~50 days** (workbook for month M publishes ~5-6 weeks
  into M+1), so the normal lag MUST stay green. `FERTILISER_STALE_LAG_DAYS = 75`
  = a full extra missed cycle = a genuine freeze.
- Escalation is scoped to `spec.group === "fertiliser"` ONLY. The generic
  `lagDays > 60` WARN log still fires for all groups (incl. the monthly energy
  series, which routinely lags ~62d) but must NOT escalate to "stale".
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
