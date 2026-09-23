---
name: Country brief forward watch + one actions model
description: Why a forward-looking country-brief table must never print an announcement date as an event date, and why every country brief takes the same engine-built Recommended Actions.
---

## Announcement date is not the event date

The shared upcoming-signal authority that feeds forward-looking country-brief
content returns the date the announcement was **reported**. It does not parse
the date of the announced activity, and often no such date exists in the text.

**Rule:** a forward table column headed "Date" must carry either a date the
reporting actually states, or an explicit "Announced <date>" / "Date not
stated" label. Pass the announcement date in its own field; never map it into
the event-date field.

**Why:** presenting a publication date as a scheduled event date is a
fabricated fact in a report an analyst signs off. It also silently reorders the
table, since sorting then ranks by when a story ran rather than when the
activity falls.

**How to apply:** whenever a new forward-looking surface is fed from announced
activity. Classify each forward item's category from its own text with the
shared engine classifier as well — an unclassified item collapses every row
into one generic exposure domain, so the "why it matters" and "watch" lines
stop matching their subject.

## One Recommended Actions model for every brief

Recommended Actions in a country brief come from the engine's evidence-built
groups for **all** theatres, including the operating-risk variant.

**Why:** the operating-risk variant used to render a separate flat list built
outside the engine. That list bypassed the publication gate (banned action
wording, dynamic-per-week requirement) and repeated the same templated sentence
once per region in the same report.

**How to apply:** if a variant needs different actions, generate them through
the engine so the gate sees exactly what publishes. Check `section_overrides`
for saved analyst edits under a retired key before removing a render path.
