---
name: Flashpoint protest schedule
description: Durable boundaries for collecting and rendering planned protest events in Flashpoint reports.
---

Planned protests, demonstrations, rallies, marches, strikes and similar actions belong in a dedicated forward-event dataset. Never insert them into incidents or derive the schedule only from completed-incident rows.

**Why:** Incident reporting windows answer what happened. A protest schedule answers what is planned in the next seven days. Reusing incident dates caused upcoming events to disappear and risked inflating incident counts.

**How to apply:** Keep event date separate from source publication date; filter schedule membership by event date and source currency independently. Show Confirmed/Planned chronologically, route Possible to a clearly labelled watchlist, and exclude or mark Cancelled/Postponed. Persist a successful search-completion timestamp separately from event rows so an empty query cannot falsely claim that a dedicated search completed. Preview, editor and PDF must consume one shared schedule model. Never invent attendance or missing event details.