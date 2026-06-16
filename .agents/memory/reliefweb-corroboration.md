---
name: ReliefWeb (UN OCHA) corroboration appname gate
description: Why the ReliefWeb corroboration pass can return zero links despite correct code — the v2 appname-approval requirement.
---

# ReliefWeb corroboration needs an APPROVED appname (v2)

The incident-corroboration pass (`lib/ingest/src/reliefweb.ts`, `runReliefWebCorroboration`) cross-checks scraped incidents against UN OCHA ReliefWeb and attaches official corroborating links. The code is complete and degrades gracefully, but it produces **zero links until an approved appname is configured**.

**Why:** ReliefWeb decommissioned the v1 API on 1 Nov 2025 (v1 now 410 Gone) and the v2 API rejects any unregistered appname with `403 AccessDeniedHttpException "You are not using an approved appname"`. The old assumption ("free API, just pass any constant appname") is no longer true. An approved appname must be requested from ReliefWeb via their form (https://apidoc.reliefweb.int/parameters#appname) — they review and email one back. It is an identifier, not a secret.

**How to apply:**
- The appname is read from `process.env.RELIEFWEB_APPNAME` (falls back to an unapproved placeholder that always 403s). Set `RELIEFWEB_APPNAME` (shared env) to the approved value; corroborations then appear on the next ingest cycle and back-match older incidents over runs.
- 403 is treated as a non-transient fetch error: the pass records ReliefWeb as a FAILING source on Source Health and the ingest cycle continues (corroboration stage is in its own try/catch). `GET /api/incidents*` always returns `corroborations: []` so the UI just shows no badge.
- Diagnosing: a quick `curl -X POST 'https://api.reliefweb.int/v2/reports?appname=<x>' -d '{"limit":1}'` returns the 403 appname error when `<x>` is unapproved. The v2 POST body is unchanged from v1 (`filter.conditions` + `fields.include` + `sort` + `limit`), so once the appname is approved no body changes are needed.
- The endpoint string in the module is already v2; do NOT revert to v1.
