---
name: maritime-movement scrape operations
description: Why the AIS movement commit run looks hung, and how the panel populates per-theatre.
---

# Running the AIS maritime-movement ingest

`pnpm --filter @workspace/scripts run scrape:maritime-movement -- --commit` opens the
aisstream WebSocket, samples for `AIS_COLLECT_SECONDS` (default 60), THEN does the
optional Datalastic vessel-registry lookups INLINE before writing.

**The "it's hung" trap:** the registry pass resolves up to `VESSEL_REGISTRY_MAX_LOOKUPS`
(default 150) vessels at concurrency 5 with an 8s per-lookup timeout — worst case a few
MINUTES after the sample ends. Under nohup the pnpm/tsx stdout is buffered (non-TTY) so the
log shows only the banner until the very end. It is slow, not broken.
**How to apply:** for a fast movement-only run, set `VESSEL_REGISTRY_ENABLED=false` inline —
that skips the Datalastic pass; the bulk/container/LNG-LPG columns stay NULL (honesty
contract) but the row lands in seconds. Give a full commit run a generous timeout (≥5 min).

**Per-theatre population is honest, not all-or-nothing:** the panel lives on the Shipping
monitor (`/topics/shipping`) and the Shipping Watch report. A theatre only gets a row when
the live sample observed traffic there. In practice short samples from the workspace egress
consistently only capture **Singapore Strait** — the other five chokepoints (Hormuz,
Bab el-Mandeb, Red Sea, Gulf of Aden, Malacca) keep reading "Movement data unavailable"
until a sample sees their vessels. That is the no-fabricated-row rule, not a bug.

**Don't chase your own shell:** `pgrep -f maritime-movement` / `pkill -f maritime-movement`
self-match the checking command (the pattern is in its own argv), giving a false "still
running". Use the bracket trick — `ps -eo pid,args | grep '[s]crape-maritime-movement'`.
