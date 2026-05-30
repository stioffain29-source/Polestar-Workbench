---
name: Country report narrative is data-driven, never stored
description: Why PNG (and all) country-report narrative sections render from live window prose, plus the West Papua mis-tag guard and its cross-border exception
---

# Country report narrative sections are auto-only

All narrative sections of a country report (Situation, What Happened, What
Matters, Implications) render from window-aware drafted prose computed from the
live 7-day dataset. They are **not** editable and **not** persisted; the save
path only writes `name` + `region` (plus the separate Country Baseline block).

**Why:** Persisted `overview` / `trend_summary` / `implications` rows went stale
and implied fresh weekly activity even when the 7-day window had zero records.
Only PNG + Papua ever had stored values and both were stale.

**Display-ignore is NOT enough — clear at the DB source.** Making the frontend
render from live prose only fixed dev. Production kept showing the stale text
because the live `country_reports` rows still held the legacy prose and an older
/ cached deployed bundle still rendered the stored columns. Code-only deploy did
NOT fix prod. The durable fix is two-layered:
1. A startup data migration in `runDataMigrations` (api-server `migrations.ts`,
   step 0) that wipes `overview/trend_summary/implications` to '' for any
   non-empty row. Idempotent, runs on every boot/deploy, fixes prod on publish
   regardless of frontend build/cache. Consistent with the file's existing
   startup data migrations (severity vocab, fertiliser).
2. `PATCH /countries/:slug` strips these three fields from the update body so
   they can never be reintroduced (guard against empty `.set()` after stripping).

**How to apply:** Never reintroduce an editable/stored path for these four
sections. If a field is shown from live data, do not also write it AND clear any
legacy stored copy at the DB source — display-ignoring stale data leaves it
live for older/cached clients.

# West Papua mis-tag guard (PNG report)

Some Indonesian West Papua items carry a stray "Papua New Guinea" country tag
(e.g. RNZ `pacific_west-papua` stories). The PNG report applies a content-aware
guard (`isIndonesianWestPapuaContext`) that drops a record when its text matches
West-Papua markers and has no genuine PNG marker.

**Cross-border exception:** Records whose structured `country` tag explicitly
spans both groups (e.g. "West Papua; Papua New Guinea", "Papua Barat; Papua New
Guinea") are genuinely cross-border and must be kept. `isCrossBorderPapuaPng()`
checks the country tokens against both `COUNTRY_GROUPS["papua new guinea"]` and
`COUNTRY_GROUPS["papua"]`; the content guard only runs when this is false.

**Gotcha:** The cross-border check is only as good as `COUNTRY_GROUPS["papua"]`.
That list must include every structured alias that can appear in a tag — English
and Indonesian (`west papua` AND `papua barat`, plus the province pairs). If
`WEST_PAPUA_CONTEXT_RE` knows an alias the group list doesn't, a real
cross-border record using that alias gets over-stripped.

# Per-country operational overrides vs the generic template

`draftCountryReportProse` ends with a GENERIC template and a chain of per-country
override blocks (each `if (isX) { ...; return; }`). Low-volume, restricted-reporting
countries (PNG, Indonesian Papua) MUST have their own override or they fall through
to bland placeholder prose ("X sits in {region}… coverage gap… journey-management
discipline"). The trigger is a thin/empty **7-day** window: these countries routinely
report 0 records in 7 days (Papua 7d=0, 30d≈39, 90d≈102), which lands them in the
generic zero-state branch even though the baseline + 30/90-day layers are rich.

**Why:** The complaint "Papua reads generic" was NOT a baseline/matching bug — both
were correct. It was the missing override. PNG had one; Papua didn't.

**How to apply:** Add the override AFTER any earlier early-returning block so the
name regex can't collide (the `isPNG` block returns before `isPapua` is tested, so
`/\bpapua\b/i` is safe — it never sees "Papua New Guinea"). The override must (a) be
honest when 7d=0 ("No relevant incidents were recorded in the 7-day window"), never
implying an active week, and (b) explicitly defer the standing pattern to the 30/90-day
context sections (rendered separately by the component from the same country-filtered
dataset). Cards and prose already share one `incidents` array filtered by
`incidentMatchesCountry`, so they stay aligned automatically.

# Active reporting window fallback (never an empty headline)

`resolveActiveCountryWindow(layers, issueDate)` picks the *active* window so a
country report never shows an empty headline when recent data exists: 7-day if it
has any record, else 30-day if it has ≥3, else 90-day if anything is on file, else
an honest empty 7-day. It returns `basisDays/basisLabel/basisShort/incidents/
expanded/periodLabel/periodShortLabel`.

**The rule:** EVERY data-bearing surface must read the *same* active window —
Fast Facts, map, severity/type charts, related-incidents table, cover reporting
period, the on-screen note banner, AND the drafted prose. `computeCountryFastFacts`
and `draftCountryReportProse` both take optional `windowIncidents`/`basisDays`; the
prose's `total>0` branches must label the window via `basisShort` (e.g. "the 30-day
window holds…"), while `total===0` branches keep "7-day" (they only fire when the
window is genuinely empty = basis 7).

**Why:** Papua's 7-day window is routinely empty (30d≈39, 90d≈102). Reading the
empty 7-day everywhere produced a blank report even though rich recent context
existed. Fall back, but never lie about which window the numbers came from.

**How to apply:** When adding any new section/caption to the country report or its
headless PDF builder, source it from `active.incidents` and label it with
`active.basisShort`/`basisLabel`. The in-app "Download PDF" rasterises the DOM so
screen==PDF for free, but `exportCountryReportPdf.ts` (headless, font-audit only)
must independently call `resolveActiveCountryWindow` and thread `basisShort` into
its map/plotted captions and exec-summary fallback, or those static strings say
"weekly window" during a 30/90-day fallback.
