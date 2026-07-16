---
name: Country/city brief — foreign-location shield + preparedness-drill guards
description: Two display-side country-brief guards — a resolved location shields a foreign record only when itself non-foreign, and preparedness drills/exercises are non-events dropped before theme-building.
---

# Country/city brief foreign-location shield + preparedness-drill guards

Both fixes are DISPLAY-SIDE only (country/city briefs ignore server
`relevance_status`), wired into BOTH render paths — `CountryReport.tsx` (live
page) AND `scripts/countryReportData.ts` (headless PDF/audit) — so **NO
`RELEVANCE_RULE_VERSION` bump**. They take effect at render.

## A resolved `location` shields a foreign record ONLY when the location is non-foreign

`isForeignSubjectNoHomeAnchor(title, displayTitle, location, country)` drops a
record when its TITLE positively names a foreign subject AND it has no home
anchor. A set `location` was treated as an automatic home anchor (geocoder only
fills a place *inside* the report country).

**Why that was wrong:** the geocoder can MIS-RESOLVE a foreign city onto a record
carrying a stray country tag — e.g. a Pacific-typhoon story "Taiwan prepares for
heavy rain as Typhoon Bavi approaches" filed `country=Thailand`,
`location=Taipei`. Treating Taipei as a home anchor shielded a purely foreign
record and it surfaced as the Thailand brief's HIGH lead.

**The rule:** a set location counts as a home anchor only when it is NOT itself
foreign — `const loc=(location??"").trim(); if (loc && !FOREIGN_SUBJECT_RE.test(loc)) return false;`.
Strictly narrower than "drop anything with a foreign location": the title gate
must ALSO fire, so a domestic-titled record mis-geocoded to a foreign city is
still kept (title has no foreign subject). A genuine domestic location (Bangkok,
Phuket) still shields — FOREIGN_SUBJECT_RE deliberately carries NO Thai/Philippine
tokens, and `\buk\b` is word-bounded so "Bangkok"/"Phuket" cannot false-match.

**Residual, correct-by-design:** a record with a genuine domestic location whose
title merely names a foreign *destination* (e.g. "More flights to Taipei and
Shanghai cancelled…", location=Bangkok) is KEPT as a low-tier item — flights from
Bangkok are legitimately Thai aviation disruption. It is not the lead; do not
over-drop it.

## Preparedness drills / exercises / simulations are non-events → drop before theme-building

A drill's hazard word ("active shooter", "fire", "earthquake") drives severity,
so an "active shooter drill" surfaced as the "most serious reported" incident
though nothing happened. `isPreparednessDrill(text)` drops it at the TOP of both
filters (before any theme/lead is built).

- Match = a hazard/security cue IMMEDIATELY adjacent (0–3 sep chars) to
  `drill|exercise|simulation`. Adjacency is deliberate: "oil **drilling** rig
  explosion" and a bare "military **exercise**" (no hazard cue before it) are
  KEPT. "Bomb threat simulation" does NOT match (word "threat" between cue and
  noun) — real records are adjacent ("fire drill", "earthquake drill").
- **Casualty/violence VETO** (`kill/dead/injured/shot/shooting/explosion…`): a
  real attack that merely mentions a drill is kept. No-fabrication: the guard only
  removes non-events, never invents or up-rates.

## Both-paths parity is mandatory

Every country-brief display filter is duplicated in `CountryReport.tsx` and
`scripts/countryReportData.ts`. Change one → mirror the other, or preview≠PDF.
Owner-gated app → verify via headless PDF text extraction (render from Postgres,
`pdftotext -layout`, grep the offending strings + the "most serious reported"
lead), never live screenshots.
