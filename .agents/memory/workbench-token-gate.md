---
name: Workbench admin-token gate (client/server contract)
description: Why the workbench TokenGate must VALIDATE the operator token, not just store any string, once read endpoints are behind requireAdminToken.
---

The workbench has no user auth; privileged READ endpoints (dashboard overview,
reports, sources) and all WRITES are gated server-side by `requireAdminToken`
(`artifacts/api-server/src/lib/adminAuth.ts`), keyed on the single
`INGEST_ADMIN_TOKEN` secret. The browser client attaches it as
`Authorization: Bearer <token>` via `setAuthTokenGetter`.

Rule: the client `TokenGate` MUST verify a token against the server before
granting access — verify on submit (with the candidate in an explicit header,
NOT the stored getter) AND re-verify any stored token on mount, clearing it and
returning to login on 401. There is a zero-cost probe for this:
`GET /api/admin/check` → 200 `{ok:true}` (gated, no DB work).

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
