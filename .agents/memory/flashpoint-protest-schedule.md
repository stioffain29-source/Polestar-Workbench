---
name: Flashpoint protest schedule
description: Durable boundaries for collecting and rendering planned protest events in Flashpoint reports.
---

Planned protests, demonstrations, rallies, marches, strikes and similar actions belong in a dedicated forward-event dataset. Never insert them into incidents or derive the schedule only from completed-incident rows.

**Why:** Incident reporting windows answer what happened. A protest schedule answers what is planned in the next seven days. Reusing incident dates caused upcoming events to disappear and risked inflating incident counts.

**How to apply:** Keep event date separate from source publication date; filter schedule membership by event date and source currency independently. Show Confirmed/Planned chronologically, route Possible to a clearly labelled watchlist, and exclude or mark Cancelled/Postponed. Persist a successful search-completion timestamp separately from event rows so an empty query cannot falsely claim that a dedicated search completed. Preview, editor and PDF must consume one shared schedule model. Never invent attendance or missing event details.

Include events on the report issue date when operational posture is already in force. Source-backed measures such as deployed police belong in the schedule description even though the planned protest still stays out of occurred-incident counts.

**Why:** a Manila mobilisation dated on the issue date disappeared from headless verification, taking a documented 17,000-person police deployment with it, while a major Jakarta event later in the same horizon was omitted because the verifier exported without the schedule model.

**How to apply:** the Flashpoint issue-date horizon starts on the issue date, not the next day. Every real preview/PDF verifier must load the production forward-event response and pass the shared schedule model into the exporter.

Forward assessment must apply city operating context. Tokyo demonstrations are normally orderly, so an event becomes material through high turnout or demonstrated route/access effects, not the gathering alone. Bangkok’s established assembly areas imply local site/route effects unless turnout or spillover reaches major roads or rail.

**Why:** Generic “scheduled gathering” prose overstated routine Tokyo and Bangkok mobilisation and produced weak business-risk analysis.

**How to apply:** Calibrate Watch Next and fallback prose by city. Never infer broad city disruption from incident volume, a capital-city venue or a declared assembly point.