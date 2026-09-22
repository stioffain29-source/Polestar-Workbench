---
name: 24h map review queue clearing
description: Why dismissing a map marker must clear every folded member id, and why cleared markers leave the 24h view.
---

The 24h map view is a review queue: markers dismissed by the analyst are hidden there (longer ranges always show everything, with an explicit toggle to bring reviewed markers back).

**Why:** same-event rows are folded into one marker and the representative is re-chosen on every poll (highest severity, then newest). Remembering only the representative's id let an already-reviewed development reappear as new the moment a fresher member joined its cluster, and merely silencing the pulse left every reviewed incident on the map for another day, so the day's intake buried the unreviewed items the view exists to expose.

**How to apply:** the dedupe pass returns the member ids of every folded source row; dismissal records the marker id plus each member id. Hiding needs an exemption for the marker whose popup is currently open, or clicking a marker unmounts it mid-click and shuts the popup it just opened.
