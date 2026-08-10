---
name: Report date timezone projection
description: Comparing a UTC occurredAt instant against a bare report issue date must project to UTC, not the browser's local zone, or eastern viewers get a false stale-prose banner.
---

# Report date / issue-date comparisons must project the instant in UTC

`incidents.occurredAt` / `createdAt` are UTC instants; report **issue dates** are
bare `YYYY-MM-DD` strings. Any *calendar-day* comparison between the two (stale
check, Option-A clamp, issue-date input cap) MUST derive the instant's day with
`utcYmd(d) = d.toISOString().slice(0,10)` (in `reportDataStatus.ts`), NOT
`date-fns format(d,"yyyy-MM-dd")`, which renders in the **browser's local zone**.

**Why:** an evening-UTC record (e.g. `2026-06-20 19:44Z`) rolls forward to the
*next* calendar day for any viewer east of UTC. With `format()` (local) the
report builder read "latest 21 Jun" against a 20 Jun issue date and fired a
FALSE red "Saved prose was stale — newer records exist" banner (and would have
reseeded/overwritten the analyst's saved prose). There were ZERO future-dated
rows — `max(occurred_at)` was 2026-06-20 19:44 UTC in both dev and prod. The
seed already computed `today` in UTC (`new Date().toISOString().slice(0,10)`),
so the **local** projections were the inconsistent ones.

**How to apply:**
- Use `utcYmd` at: the stale-prose guard (`computeStale` in `ReportEditor.tsx`),
  `clampIssueDateToLatestRecord` (`reportWindow.ts`), and the issue-date input
  `max` (`ReportEditor.tsx`). Fixing the clamp fans out automatically to its
  other callers — country reports, fuel (`resolveFuelPeriodEnd`), `cardAutofill`.
- The stale banner display string is derived from the UTC ymd too (so screen
  text matches the comparison). The banner is `no-print`, so there is no
  preview/PDF parity risk.
- **Leave local-zone formatting alone** for pure DISPLAY (the "Data as of" /
  `formatDataAsOfLine` strip, table date cells, chart/timeline bucket keys) — it
  is cosmetic, identical on screen and PDF, and not a cross-comparison.
- **Do NOT touch** `resolveReportWindow` / `filterIncidentsToWindow`
  window-membership — it uses `parseISO` (local midnight) and is a SEPARATE,
  working concern. The clamp fix returns the same value as before for this case,
  so which incidents render is unchanged.

**Window end is end-of-day (2026-08-10 fix):** `filterIncidentsToWindow` used `end = parseISO(issueDate)` = midnight UTC, so anything occurring ON the issue date after 00:00 UTC silently fell outside every report window (same-day advisories vanished from the flashpoint Forecast). Fixed by extending endMs to 23:59:59.999 of the issue date — the window is documented inclusive of the issue date. Don't revert to bare `end.getTime()`.
