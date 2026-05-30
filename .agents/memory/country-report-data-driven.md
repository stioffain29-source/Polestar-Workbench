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

# Country report is ALWAYS weekly; an empty 7-day week is a data-quality signal

The country report headline window is ALWAYS 7-day. `resolveActiveCountryWindow`
no longer promotes to 30/90-day when the week is thin — it returns the 7-day
window unconditionally (`basisDays:7`, `incidents: layers.current`,
`expanded:false`). 30/90-day material renders ONLY as labelled CONTEXT sections,
never as the weekly headline.

**Why:** Promoting a thin week to a 30/90-day headline silently hid the real
signal — that the weekly collection was empty. A zero-record week is itself
information (either genuinely quiet OR a coverage failure), so it must be
surfaced, not papered over with older data. An empty week must NEVER read as
"nothing happened" unless that is health-confirmed.

**Coverage status (`computeCountryCoverageStatus`)** decides what an empty week
means. State is one of `active | genuine-quiet | coverage-problem`:
- window has records → `active`, no banner.
- empty window + no feed attributable to the country, OR any relevant feed
  unhealthy (status in UNHEALTHY_STATUS, `lastSuccess` older than
  FEED_STALE_DAYS=10, or `lastFailure` newer than `lastSuccess`) → `coverage-problem`.
- empty window + feeds healthy/current BUT the newest record on file is itself
  stale (`daysSinceLatest === null || > RECORD_STALE_DAYS=14`) → `coverage-problem`.
  Latest-record staleness MUST flip the STATE, not just append caveat wording —
  healthy-but-silent collection cannot confirm a quiet week.
- only when feeds are healthy/current AND a record exists within RECORD_STALE_DAYS
  → `genuine-quiet` (the single case allowed to state the week as quiet).

**Banner gating:** the on-screen coverage banner is gated on `!isLoading` of the
sources query (NOT `isSuccess`). Gating on `isSuccess` would hide a legitimately
needed warning when the sources query *errors*; gating on `!isLoading` only
suppresses the initial-fetch flash, and a settled-but-errored query still falls
through to the conservative `coverage-problem` banner (sources=[] → no relevant
feed).

**How to apply:** The banner lives inside `.print-report`, so the in-app
"Download PDF" (DOM raster) carries it for free — screen==PDF automatically.
`exportCountryReportPdf.ts` (headless, font-audit path only) takes a `coverage`
field on `CountryPdfExtras` + `drawCoverageBanner` for logic parity; it is not
exercised by the country path at runtime but keep it in sync. Brand: banner uses
POLAR border / ELECTRIC left accent / NAVY title / DUSK body — NO red (reserved
for the Extreme tier only).
