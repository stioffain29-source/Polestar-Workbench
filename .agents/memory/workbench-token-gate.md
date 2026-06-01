---
name: Workbench admin-token gate (client/server contract)
description: Why the workbench TokenGate must VALIDATE the operator token, not just store any string, once read endpoints are behind requireAdminToken.
---

CURRENT STATE (decision): the workbench is intentionally PUBLIC — no login wall,
anyone with the link can view AND edit. A security task once gated the READ
endpoints (dashboard overview, reports, sources) plus most WRITES behind
`requireAdminToken` and added a client login screen; the user explicitly
reverted that ("like before"). Only `POST /api/admin/ingest` and the `sources`
create/update/delete mutations remain token-gated (those predate that task). Do
NOT re-introduce a login gate or token-gate the read/edit routes unless the user
asks. This preference is also recorded in `replit.md`.

The rest of this file is the lesson to apply IF auth is ever re-added.

The gate is keyed on the single `INGEST_ADMIN_TOKEN` secret
(`artifacts/api-server/src/lib/adminAuth.ts`); the browser client attaches it as
`Authorization: Bearer <token>` via `setAuthTokenGetter`.

Rule: a client login gate MUST verify a token against the server before
granting access — verify on submit (with the candidate in an explicit header,
NOT the stored getter) AND re-verify any stored token on mount, clearing it and
returning to login on 401. A zero-cost probe route (e.g. a gated
`GET /api/admin/check` → 200 `{ok:true}`, no DB work) is the right tool.

**Why:** if the gate grants access on any non-empty string (the original bug),
an operator who enters a wrong/stale token gets the full app shell while every
gated read 401s — surfacing as the misleading "Failed to load dashboard
overview. Please check connection." A login wall that doesn't validate is worse
than none: it hides the real cause.

**How to apply:** any time read endpoints get gated, or the token contract
changes, keep client validation in lockstep with the server gate. Status
semantics to handle distinctly: 401 invalid/missing, 503 token unconfigured on
server, network error. Never treat possession of the URL (or a stored string)
as proof of authorization — that's the standing threat-model rule.
