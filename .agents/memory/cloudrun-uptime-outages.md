---
name: Cloud Run uptime-monitor outages & API health endpoints
description: How to read a deployment "outage" alert for this app (Cloud Run autoscale) and the health-endpoint behaviour of the api-server.
---

# Cloud Run uptime outages & health endpoints

## Diagnosing an uptime-monitor "outage" alert

When the user reports a deployment outage (e.g. "X% uptime, one outage period"):

1. The deployment is **Cloud Run autoscale** (`deploymentTarget = "cloudrun"` in
   `.replit`). It can scale toward zero and recycle instances.
2. Pull `fetch_deployment_logs` around the reported time (convert the user's
   timezone → UTC; SGT = UTC+8). Scan the whole day for real fault signatures
   (unhandled/uncaught/OOM/heap/exited/killed/SIGKILL/SIGTERM/ECONN/ETIMEDOUT).
3. If there is **no crash/error/restart** and the same `pid` is alive on both
   sides of the gap, the "outage" is a **transient Cloud Run blip** (instance
   transition / cold-start-after-idle / network), NOT an application bug.
   Telltale: the app's own health-probe log line has one missing entry (a gap in
   an otherwise steady cadence) but the process answered probes before & after.
4. Cold starts take ~10s to "Server listening" (module/import load); during that
   window the platform returns 500 for the upstream until it's ready. Boot work
   (migrations, ingest, fuel-price top-up ~20s) already runs AFTER `listen()`, so
   it does NOT delay readiness — don't "fix" that ordering.

**Definitive mitigation** (deployment setting, user-controlled, costs more):
set **min instances = 1** (or a Reserved VM deployment) so it never scales to
zero → no cold-start outages. Code can't eliminate Cloud Run infra transients.

## api-server health endpoints

- `/api/healthz` is the configured startup/deploy probe (`[services.production.
  health.startup] path = "/api/healthz"` in `artifacts/api-server/.replit-artifact/
  artifact.toml`).
- The bare `/api` mount root ALSO returns 200 `{status:"ok"}` (added in
  `routes/health.ts` via a shared `sendOk` on both `/` and `/healthz`).
  **Why:** external uptime monitors hit the base `/api`; before this it fell
  through to the catch-all 404 — "reachable" but not a clean health signal, and
  any monitor requiring 2xx would flag every check.
- **How to apply:** tell the user to point their uptime monitor at `/api` or
  `/api/healthz`, and that any api-server code change only reaches prod after a
  **republish**.
