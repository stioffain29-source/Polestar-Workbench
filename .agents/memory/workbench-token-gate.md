---
name: Workbench owner-only auth (Replit Auth) + admin-token contract
description: The workbench is now PRIVATE to the owner via Replit Auth (OIDC); requireOwner gates all data routers; admin token still gates sources mutations. Read order matters; session is cookie-first.
---

CURRENT STATE (decision, supersedes the old "keep it public" note): the
workbench is PRIVATE to the OWNER ONLY via "Sign in with Replit" (Replit Auth,
OIDC+PKCE). The user explicitly asked for this, reversing the earlier public
decision. Shape:

- `authMiddleware` runs before the router and hydrates `req.session`/`req.user`
  from the session cookie. `requireOwner` gates ALL data routers (401 if not
  signed in, 403 if signed in but not the owner).
- Public/ungated routes, mounted BEFORE `requireOwner`: `GET /api/healthz`,
  `GET /api/access` → `{authenticated, allowed}`, the `/api/auth/*`
  login/callback/logout flow, and the pre-existing token-gated
  `POST /api/admin/ingest` + backfill. Keep new public/admin-token-only routes
  ahead of `requireOwner` or they become owner-only too.
- Owner identity: `ensureOwnerClaim(userId)` (advisory-lock, first-login-wins)
  sets `users.is_owner`; an `ALLOWED_USER_IDS` env allowlist overrides the claim.
  `isAllowedUser` / `requireOwner` live in `lib/ownerAccess.ts`.
- **Bearer/cookie collision (the trap):** the api-client sends the admin token as
  `Authorization: Bearer`. `getSessionId` MUST read the cookie FIRST, then fall
  back to Bearer — otherwise the admin token shadows the owner's session and the
  owner is treated as anonymous. The owner edits by being logged in (cookie) AND
  pasting the admin token; both travel together, cookie wins for the session.
- `requireAdminToken` on `sources` mutations is UNCHANGED — those routes now sit
  behind BOTH `requireOwner` and the token, which is fine because the owner is
  always logged in when editing.

Do NOT re-open the app to the public without the user asking. This is also in
`replit.md` user preferences.

**Verification trap (two-layer gate):** privileged mutations (sources, spot
reports, reports) sit behind `requireOwner` THEN `requireAdminToken`. An
anonymous shell curl/probe ALWAYS gets 401 from `requireOwner` FIRST — and both
gates return the IDENTICAL `{"error":"unauthorized"}` body — so you can never
reach/exercise the admin-token gate or do a create+update round-trip from the
shell without an owner OIDC session cookie (browser-only). Verify admin-gate
behaviour via jest/bare-express, NOT curl; a "valid token still 401s" probe is
almost always `requireOwner` blocking, not a wrong token.

**Editor admin-token UX rule:** any page that fires an admin-token-gated
mutation must (a) surface a token-entry field that is NOT hidden on narrow
viewports — the global header `AdminTokenField` is `hidden lg:block`, invisible
below 1024px, so editors need their own always-visible field persisting to
sessionStorage `workbench_admin_token` — and (b) map the response status through
`adminMutationErrorMessage` (401 → wrong/missing token, 503 → token
unconfigured) instead of a generic "Failed to save", or the operator can't tell
an auth failure from a real error. `SpotReportEditor.tsx` follows this; the
global getter in `main.tsx` attaches the stored token as Bearer automatically,
so persisting it is enough (no explicit headers on the orval mutations).

The rest of this file is the older lesson, still useful IF the admin-token gate
is ever changed.

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
