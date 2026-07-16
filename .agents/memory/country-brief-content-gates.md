---
name: Country/city brief content-quality gates
description: Three removal/merge gates that keep generic country & city briefs from leading with stale, out-of-country, or duplicate items — and how to verify them under owner-gating.
---

These are the recurring ways a rebuilt country/city brief (PNG, West Papua, Indonesia, Thailand, Philippines, Jakarta) leads with junk. All fixes are removal- or merge-only (no fabrication) and need NO `RELEVANCE_RULE_VERSION` bump — country-report defects are fixed on the display/dataset side, not the ingest relevance rules.

## 1. Retrospective / anniversary reflection pieces
A look-back article ("28 years since the Biak massacre, conflict escalates") is never a CURRENT development, yet it carries the historical event's high stored severity, so the severity-gated development-wire filter can't drop it and it wrongly leads the Top 3.
**Rule:** drop it from EVERY narrative surface via a retrospective predicate applied to the window (and previous window) in the shared dataset builder.
**Why:** severity gate can't catch it; it must go from Top 3, Exec Summary, BLUF, Outlook and location sections alike.
**How to apply:** gate on digit-anchored phrasing ("N years since/after/ago/on", "decades since/later", "on this day", "in memoriam", "lest we forget"). NEVER match a bare "anniversary" — a protest or ceremony held ON an anniversary date is a genuine current event and must stay. Keep the drop non-emptying (fall back to unfiltered if it would empty the window, or the "no fresh reporting" branch falsely trips).

## 2. Out-of-country geography on generic briefs (Thailand / Philippines)
The generic-brief foreign-subject guard drops a record whose title names a foreign subject with no home anchor — but it only fires if that neighbour is listed in `FOREIGN_SUBJECT_RE`.
**Why:** South Asian neighbours were missing, so a "51 dead in Bangladesh landslides" wire tagged Thailand slipped through and led the brief.
**How to apply:** keep South Asian + regional neighbours (Bangladesh/Dhaka, Nepal/Kathmandu, Sri Lanka/Colombo, Bhutan, Maldives, …) in `FOREIGN_SUBJECT_RE`. The guard is safe: it only fires with NO resolved local `location` AND no home-anchor token, so a local story that merely mentions the neighbour still stays. The guard is gated to generic briefs (`!isPng && !isPapua && !isJakarta && !isIndonesia`); the bespoke theatres use their own geography-dominance guards.

## 3. Same-event duplicates that sit just under the Jaccard floor
A named event re-reported across outlets ("Twenty-seven locked-up from second 'Sambio massacre' arrest" vs "TWENTY-SEVEN ARRESTED AND CHARGED OVER SAMBIO MASSACRE") shares a distinctive proper noun but lands at Jaccard ~0.44 — below the 0.5 PATH-1 floor — and the differing spellings/roles mean no shared strong entity, so it shows twice.
**Rule:** a merge path keyed on a shared DISTINCTIVE place/incident-name token (≥5 chars, not generic clash/geography vocabulary) + Jaccard ≥ 0.35 + same/adjacent day, evaluated BEFORE the compatible-type gate (a massacre vs the arrests over it are coded differently but are one story).
**Why:** conservative clustering under-merges named events; the ≥5-char token requirement stops short place stems ("enga") anchoring, and the 0.35 floor + tight day window stops formulaic tribal-clash headlines over-merging (the standing over-merge hazard for PNG).

## Verifying under owner-gating
The briefs are owner-gated (no live screenshots) AND the workbench has no Jest/vitest runner. Verify a brief-content fix by running the UPDATED predicates against the REAL offending titles pulled from the prod-replica DB (query `incidents` by title ILIKE), plus negative controls that must be UNAFFECTED — via a throwaway `tsx --import ./scripts/registerLoader.mjs` script. Do NOT claim done on fixtures or typecheck alone; that was the prior credibility failure.
