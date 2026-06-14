---
name: Reports publish-status data reality
description: How the reports/spot/country tables actually carry publication state — needed for any feature touching "published" status, dates, or country/region.
---

# Reports publish-status data reality

Observed in both dev and prod report data (a data-state fact, not visible in the schema):

- The `reports` table effectively never uses `status='published'` — every row sits at `draft` (occasionally `review`). A `WHERE status='published'` filter renders **empty**. Treat each report's **`issueDate` as the de-facto publication date**, and surface `status` only as a badge.
- `reports.country_slug` is unused in practice (NULL on every row). Do **not** rely on it to populate country/region UI.
- The country/region dimensions live in the **other report products**: `country_reports` (has `name` + free-text `region`, but only `createdAt`, no status/issue date) and `spot_reports` (`reportDate` + `country` + `category` + `status` of draft|final). To give a cross-product feature real country/region/type data, unify all three.

**Why:** A publication-calendar feature that keyed off `status='published'` or `country_slug` would have shipped blank. The Publication Calendar (`artifacts/workbench/src/lib/publicationCalendar.ts` + `pages/PublicationCalendar.tsx`) deliberately uses `issueDate`/`reportDate`/`createdAt` as the per-product publish date and pulls country/region from country+spot reports.

**How to apply:** Any future work involving report "publication", recency, scheduling, or country/region filtering should anchor on `issueDate` (not the status flag) and source country/region from country/spot reports, unless the user has since started actually flipping reports to `published` / tagging `country_slug`.
