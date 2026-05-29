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
Only PNG + Papua ever had stored values and both were stale. Driving every
section from the live dataset keeps on-screen report, captured PDF, and dev/prod
in agreement regardless of legacy stored text (publishing deploys code, not
data, so prod is fixed on deploy even though old rows remain).

**How to apply:** Never reintroduce an editable/stored path for these four
sections. If a section must reflect the window, derive it from the prose builder,
not a DB column. Keep display and persistence semantics consistent — if a field
is shown from live data, do not also write it.

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
