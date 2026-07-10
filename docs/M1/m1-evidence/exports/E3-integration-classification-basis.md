# Integration classification basis (dev audit, 8 Jul 2026)

Classifications in M1 Audit Pack §2.2 are derived from:

1. **Code + ops docs** — `replit.md`, `.agents/memory/*`
2. **June 2026 workbench audit** — `docs/workbench-audit-2026-06-17.md` (secret inventory)
3. **Unauthenticated production probes** — `POST /api/admin/ingest` without token → **401** (token configured; changed since June audit when token was absent)
4. **Integration status contract tests** — `__tests__/api-server/integrationStatus.test.ts`

Owner can override any row during M2 if production secrets have changed since this audit.
