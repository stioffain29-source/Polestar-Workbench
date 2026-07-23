---
name: 32 MB non-chunked response cap
description: Prod dashboard all-zero with 200s = large JSON killed by Google Frontend's 32 MB non-chunked cap; compression middleware is the guard
---

**Rule:** Any api-server JSON response can silently die in production once it exceeds 32 MB raw, because Google Frontend (Cloud Run) hard-kills responses that carry a Content-Length (non-chunked) over 32 MB. The server still logs 200; the browser gets a truncated body; `JSON.parse` throws; React Query's `data = []` default renders every widget zero. Nothing is stale — it is a transport failure that looks like a data failure.

**Why:** July 2026 prod outage — the dashboard's `/api/incidents?days=365` fetch grew past 32 MB (37 MB prod / 44 MB dev) as the incidents table grew daily. Owner saw all-zero KPIs/monitors ("all my reports gone stale") while Source Health and Reports (small payloads) rendered fine and prod logs showed only 200s with 2–4 s response times.

**Fix in place:** `compression()` middleware in `app.ts` — compressible responses become gzip/brotli AND `Transfer-Encoding: chunked`, which both shrinks the wire ~4x and exempts them from the 32 MB cap entirely. Do not remove it.

**How to apply / diagnose:**
- All-zero UI + 200s in prod logs + big responseTimes → measure the payload first: `SELECT pg_size_pretty(sum(octet_length(row_to_json(i)::text))) FROM ...` on the prod replica.
- A client that omits `Accept-Encoding` still gets the raw Content-Length body and can be truncated again — browsers always send gzip, but keep this in mind for curl/scripts (`--compressed`).
- Residual unbounded growth: `res.json` still materializes the full multi-MB string server-side and the browser parses it all; the durable fix for the dashboard is per-topic counts (`/incidents/by-topic`) + a small recent list instead of the 1-year full fetch.
- End-to-end verification trick for the owner-gated API: sessions are unsigned DB rows — INSERT a short-lived row in dev `sessions` with `{"user":{"id":"owner-e2e",...}}` and curl with `Cookie: sid=...`, then DELETE it.
