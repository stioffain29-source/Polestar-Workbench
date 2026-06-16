---
name: Topic monitor screenshots as all-zero mid-load
description: Why a large topic monitor page can screenshot as 0/empty when it is actually fine
---

A topic monitor page (e.g. Shipping) can screenshot with every Fast Fact / Key Metric reading `0` and the chokepoint status reading "No activity" even though the API and DB are full.

**Cause:** these pages default `incidents = []` from `useListIncidents(...)` and render the stat cards immediately — the cards are NOT gated behind `isLoading`. A large topic (Shipping ≈ 2k+ rows, multi-MB JSON) takes long enough to fetch that an early screenshot catches the empty-default window. A post-restart forced boot-ingest (`forceVersion` bump) adds extra load/CPU and widens that window.

**How to apply:** before concluding a monitor is broken, re-screenshot after the data has loaded (and after any boot-ingest in the api-server logs finishes). Confirm the API itself by curling `/api/incidents?topic=<t>` — if it returns rows, the page is fine and you just caught the loading state. Don't "fix" it by editing the shared selector/scope logic.
