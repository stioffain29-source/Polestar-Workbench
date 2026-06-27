---
name: base64 data URLs in JSON request bodies
description: Why embedding images/files as base64 data URLs in a JSON body needs both a raised express body limit AND explicit route-level size/count/content-type caps.
---

# base64 data URLs in JSON request bodies

When a feature ships user images/files inline as base64 **data URLs** inside a JSON
request body (e.g. spot-report `photos`), two independent guards are BOTH required:

1. **Raise the body-parser limit.** `express.json()` defaults to a 100 KB body limit,
   so a single resized JPEG data URL will commonly 413 BEFORE reaching the route — the
   handler never runs, validation never fires, and it looks like a silent save failure.
   Raise it deliberately (this repo: `express.json({ limit: "32mb" })` +
   matching `urlencoded`).

2. **Add explicit caps in the route.** Raising the body limit alone lets arbitrarily
   large / non-image payloads into the jsonb column and into DOM/PDF rasterisation.
   Validate in the handler (after the Zod parse): max count, max per-item encoded bytes,
   max total bytes, and a `data:image/...;base64,` content-type allowlist → 400 on
   violation. Mirror the SAME ceilings in the client so the UI rejects before the round
   trip (toast), keeping client and server numbers in step.

**Why:** the Zod/OpenAPI contract validates SHAPE, not size, and the body-parser limit
sits UPSTREAM of the route, so neither one alone covers this. A reviewer caught this as
the one blocker on an otherwise-correct photos feature.

**How to apply:** any new "attach an image/file" feature that base64-embeds into JSON —
bump the body limit once at the app level, and add count/size/content-type caps in the
owning route + a matching client guard. (Object storage is the alternative when payloads
get large; inline data URLs are fine for small, capped report imagery.)
