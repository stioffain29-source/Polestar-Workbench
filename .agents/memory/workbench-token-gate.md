---
name: Workbench owner-only auth (Replit Auth) + admin-token contract
description: The workbench is now PRIVATE to the owner via Replit Auth (OIDC); requireOwner gates all data routers; admin token still gates most mutations (sources/reports/incidents/etc.) but spot-reports are owner-session-only (token removed per user). Read order matters; session is cookie-first.
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
- `spot-reports` mutations (POST/PATCH/DELETE + export-history) are
  owner-session-only: `requireAdminToken` was REMOVED per explicit user request.
  They are still protected by `requireOwner`. Do NOT re-add the admin-token gate
  to spot reports; the rest of the data routers keep it.

Do NOT re-open the app to the public without the user asking. This is also in
`replit.md` user preferences.

**SESSION LIFETIME (rolling, token-decoupled) — the "logged out mid-work" fix.**
The owner stays signed in via a 30-day ROLLING DB-backed session (the `sid`
cookie + the `sessions` row); `authMiddleware` slides BOTH forward on active use,
throttled to once/hour per sid. Session validity is governed SOLELY by the cookie
+ DB row — never by the OIDC access token.

The OIDC access/refresh tokens are stored on the session but are NOT read for
authorization or any downstream call after login (authz is `requireOwner` →
`users.is_owner` via the session `user.id`). Therefore the access-token refresh in
`authMiddleware` is BEST-EFFORT and NON-FATAL: it must NEVER `clearSession` on a
refresh failure, and concurrent refreshes are deduped per-sid via an in-flight
Promise map.

**Why:** the owner was logged out mid-work ("session has expired"). Cause: the old
middleware tore down the session whenever the ~1h access token expired and refresh
failed. Replit refresh tokens ROTATE (single-use), so the dashboard's many
concurrent requests raced the refresh — the first rotated+succeeded, the rest
failed — and the failure path called `clearSession`. The cookie/DB TTL was
irrelevant because the token teardown fired first.

**How to apply:** never reintroduce a token-expiry → logout path. If a future
feature needs a live access token for a Replit API call, handle a stale token AT
THE CALL SITE; do not log the owner out. Reaches prod only after a republish.

**Verification trap (two-layer gate):** most privileged mutations (sources,
reports, incidents, strikes, countries, cards, baselines, prose, social) sit
behind `requireOwner` THEN `requireAdminToken`. SPOT-REPORTS are the deliberate
EXCEPTION — owner-session-only, the admin-token gate was REMOVED per explicit
user request ("I never asked for this"); do NOT re-add it. An
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
an auth failure from a real error. This applies to the still-token-gated editors
(Sources, Reports, etc.); the global getter in `main.tsx` attaches the stored
token as Bearer automatically, so persisting it is enough (no explicit headers on
the orval mutations). NOTE: `SpotReportEditor.tsx` NO LONGER uses the admin token
— spot-report saves are owner-session-only — so it has no token field; its only
auth-failure mode is a 401 from an expired owner session.

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
