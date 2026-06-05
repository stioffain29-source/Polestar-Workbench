---
name: Topic monitor date-range toggles
description: How the per-page date-range window is wired into the topic monitors and which metrics must stay all-time.
---

# Topic monitor date-range toggles

Shared scaffold lives in `src/lib/dateRange.ts` (RangeKey, RANGE_DAYS, RANGE_LABEL, RANGE_NOTE) + `src/components/RangeToggle.tsx`. Default range is the widest (`2y`) so first load ≈ the prior all-data view; narrowing is opt-in.

**Window predicate has NO lower bound** — `differenceInDays(now, occurred) <= windowDays` — mirroring the existing last7/last30 style, so the widest default never hides a (possibly future-dated) record the old all-time view showed.

**Rule: fixed-period captions must read the ALL-TIME set, not the windowed set.** Topic/Protests keep `total`, the 7-day change, latest incident, and highest-severity-total as all-time anchors; only the range-scoped surfaces read `inWindow`.

**Why:** Shipping deliberately windows its whole `enriched` set (the plan said KPIs/charts/chokepoint/vessel/table window automatically, labels become "Last {range}"). But its Fast-Facts caption "X in the past 7 days · Y in the past 30 days" is a FIXED period — those `last7`/`last30` must come from the all-time `enrichedAll`, or a 24h/7d selection caps "past 30 days" at the narrower window and the caption lies.

**How to apply:** any new windowed monitor — if a label names a concrete period (7d/30d) that differs from the selected range, compute it from the pre-window set; everything labelled "Last {range}" reads the windowed set. CargoWatch.tsx and Strikes.tsx already had their own toggles and are unrelated to this scaffold.
