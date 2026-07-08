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

**Parity plumbing.** The Indonesia brief field `upcomingSignals` is gated on
`StructuredTheatreConfig.showUpcomingSignals` (true only on `INDONESIA_REPORT_CONFIG`) —
every other structured theatre stays byte-identical (`[]`). Screen (`PngCountryReportBody`)
and headless PDF (`exportCountryReportPdf`) render the identical section, order, formatter
(`upcomingSignalLine`) and caption; both guard `d.upcomingSignals ?? []` for legacy/
hand-built dataset fixtures.
