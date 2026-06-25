---
name: Report AI analytical narrative (all topics + structured briefs)
description: Every report type carries an AI-written analytical narrative with the deterministic template as a labelled fallback; how the topic-prose system and the no-count guard fit together.
---

# Report AI narrative system

Every report type now renders a genuine AI-written analytical narrative
(themes/drivers/operational meaning); incidents are supporting detail. The
deterministic template stays as the LABELLED fallback (shown when
`available:false`), never silently.

## Two parallel prose systems, deliberately NOT merged

- **Topic reports** (shipping/conflict/fuel/cargo_watch/energy/fertiliser/
  flashpoint/protests/strikes) use their OWN `report_prose_cache` table +
  `reportProse.ts` lib + `POST /reports/:id/prose` route, keyed by **report id**.
- **Structured country briefs** (PNG / West Papua etc.) extend the EXISTING
  `png` variant of the country-prose system, NOT a new table.
- **Why:** the architect decided topic prose must not be folded into
  `country_report_prose` — different keying (report id vs country) and different
  section contract. Keep them separate.
- The two prompt-version constants are independent: `REPORT_PROSE_PROMPT_VERSION`
  (topic) vs `PROSE_PROMPT_VERSION` (country/png). Bump the one whose
  prompt/section contract changed; bumping one must not invalidate the other.

## Fingerprint must hash the EXACT rendered incident set

Cache fingerprint hashes prompt-version + id + title + topic + issueDate +
basis/variant + the exact canonical/capped incident payload (all rendered
fields) the prompt sends. Ground prose on the SAME related-incident set the
preview/PDF renders, or the fingerprint bypasses cache (wallet-DoS) or goes
stale. Mirrors the country-prose fingerprint rule.

## No-count rule: defense-in-depth at the parse choke point

HARD constraint (replit.md): report PROSE must never carry parenthetical record/
incident counts like "(2 records)" or "(12 of 30 incidents)". The prompts
forbid it, AND `stripProseCountAnnotations(text)` (exported from
`countryProse.ts`) strips it post-generation at the parse choke points:
`coerceStr`/`coerceList` in countryProse (covers png + generic country +
per-incident summaries via mapIncidentSummaries) and `coerceStr`/`coerceJoined`
in reportProse (covers all topic sections).

- Regex removes ONLY parentheticals containing BOTH a digit AND a count noun
  (records/incidents/reports/events/cases/entries/articles/items/data points),
  so years "(2023)" and place names "(West Papua)" survive.
- Newlines are preserved (bullet lists keep line breaks); only intra-line
  spacing is tidied.
- **Known gap:** it does NOT catch spelled-out / non-parenthetical counts
  ("three incidents", "2 incidents occurred") — prompts forbid those. Add a
  second sanitiser layer only if the user wants an absolute count ban.

## Fuel parity is MANUAL, not free

Fuel's in-app "Download PDF" uses the jsPDF `exportTopicReportPdf` builder, NOT
the DOM-rasterise path — so screen==PDF is NOT automatic for fuel. To keep
preview==PDF you must, in BOTH `ReportPreview.tsx` and `exportTopicReportPdf.ts`,
feed `resolveSimpleProse(edit, aiProse?.implications/watchNext, "")` INTO
`buildFuelWatchReportData` and render from `fuelData.narrativeData.implications/
watchNext` identically. `topUpFuelBullets` folds the resolved analyst/AI value
first, then tops up generic defaults. If you wire AI prose on only one side the
two diverge silently.

**How to apply:** any new topic added to the AI-narrative path must thread its
grounding set + prompt voice through reportProse, and wire effective prose
(manual edit → cached AI → deterministic draft) identically into preview AND the
matching export path; verify preview==PDF per topic.
