---
name: Reported Upcoming Activity (advance-warning) surface
description: The one detection authority for forward-looking protest signals shared by the monitor, flashpoint report, and Indonesia brief, and its precision/parity rules.
---

`artifacts/workbench/src/lib/upcomingSignals.ts` is the SINGLE authority that turns an
incident whose text ANNOUNCES a future protest/strike/march into a "Reported Upcoming
Activity" row. Three surfaces consume it and MUST NOT drift: the Protests monitor panel,
the weekly Flashpoint report (Forecast + Watch Next), and the Indonesia country brief
(Outlook). Empty is normal (STRICT no-fabrication — an unreported march is not surfaced).

**No fabricated dates.** Free-text event dates (EN/Bahasa) are not reliably extractable,
so every surface shows the ANNOUNCEMENT date only (`announcedAt` = report timestamp),
never a guessed calendar date; captions say so explicitly.

**7-day announcement window (was 14).** `buildUpcomingSignalRows` default is now 7 days;
the monitor passes `windowDays: 7` and the Indonesia brief follows the default. **Why:** an
announcement older than a week almost always describes an event that has already happened, so
under an "Upcoming Activity" heading a 14-day window read as all-stale/passed dates. **How to
apply:** keep it short; do NOT widen back to 14. The caption must NOT say "over the next 14
days" (implies future events); it describes reporting "in the past week".

**Bahasa parity rule.** Any surface feeding the authority must pass the TRANSLATED title
first (`displayTitle ?? title`) — English detection cues never fire on raw Bahasa
headlines. A surface that feeds raw `title` silently misses Indonesian announcements the
brief surfaces. **Why:** the monitor once fed raw `i.title` while the brief fed
`displayTitle`, so the two disagreed on Indonesian marches.

**Precision-first detection.** A signal qualifies only via a self-sufficient strong cue
(`FUTURE_STRONG_RE`) OR a bare temporal cue (`next week`, `on friday`) bound to a protest
object. **Do NOT re-add bare `strike on|rally on|march on`** to `FUTURE_STRONG_RE` — they
false-positive on kinetic strikes ("drone strike on convoy") and market moves ("shares
rally on rate-cut hopes"); genuinely scheduled marches still pass via temporal+object.
Past-event and sports/diplomacy-homonym vetoes drop completed events and "team-mates
rally".

**Natural-hazard veto (first check in `hasUpcomingSignal`).** Geological/meteorological
bulletins leak in two ways: "volcanic UNREST" hits `PROTEST_OBJECT_RE`'s `unrest` token,
and "typhoon WILL STRIKE" hits `FUTURE_STRONG_RE`'s `will strike`; an announcement
day-of-week ("on Monday") then supplies the temporal cue. `NATURAL_HAZARD_RE`
(volcano/seismic/eruption/quake/tremor/typhoon/cyclone/flooding/etc.) vetoes such text
UNLESS `PROTEST_ACTION_RE` also fires. **Why:** a Taal Volcano seismic bulletin appeared
in the monitor's Reported Upcoming Activity list. **How to apply:** `PROTEST_ACTION_RE`
deliberately EXCLUDES the bare words `unrest` and `strike` (the exact homonyms), so a real
hazard-triggered protest ("march over flooding response failures") is kept while pure
geology/weather is dropped. `magnitude` is scoped to `magnitude[- ]?\d` so figurative
"magnitude" doesn't false-veto. This is a frontend display detector — recomputes at
render, NO `RELEVANCE_RULE_VERSION` bump.

**Retrospective/commemoration false-positive gates (precision-first).** Two classes of
PAST item leaked into the "Reported Upcoming Activity" section of country briefs: (a) a civic
anniversary CEREMONY ("attends 103rd anniversary of …") qualified because `FUTURE_STRONG_RE`
had a bare `anniversary (of|…)` alternative — narrowed to `anniversary (protest|march|rally)`
so only an announced anniversary PROTEST fires, not a commemoration; (b) a completed vigil
("Hundreds gathered … on Monday … for a candlelight vigil") qualified via the temporal+object
path ("on Monday" + `vigil`) because `PAST_EVENT_RE` didn't catch `gathered` — added it.
**Why:** an "Upcoming Activity" heading must never show a past/commemorative event. **How to
apply:** `gathered` is past-tense only (won't touch "gathering"/"to gather"); prefer adding
past-tense verbs to `PAST_EVENT_RE` over loosening the future cues. Frontend display detector —
NO `RELEVANCE_RULE_VERSION` bump. Also: the headless country loader
(`scripts/countryReportData.ts`) must mirror the page's `isForeignSubjectNoHomeAnchor` filter
(same arg order, gated `!png&&!papua&&!indonesia&&!jakarta`) or headless PDFs render foreign
mis-tagged items the on-screen page already drops.

**Parity plumbing.** The Indonesia brief field `upcomingSignals` is gated on
`StructuredTheatreConfig.showUpcomingSignals` (true only on `INDONESIA_REPORT_CONFIG`) —
every other structured theatre stays byte-identical (`[]`). Screen (`PngCountryReportBody`)
and headless PDF (`exportCountryReportPdf`) render the identical section, order, formatter
(`upcomingSignalLine`) and caption; both guard `d.upcomingSignals ?? []` for legacy/
hand-built dataset fixtures.
