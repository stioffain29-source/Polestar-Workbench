# Phase 1 — Baseline audit

**Status:** Deliverables prepared · live prod run pending (`PROD_DATABASE_URL` required)

This folder contains the Phase 1 outputs for the [Ingestion & Report Quality plan](../ingestion-report-quality-plan.md).

| Section | Deliverable | Status |
| --- | --- | --- |
| 1.1 Ingestion health check | [1.1-ingestion-health-check.md](./1.1-ingestion-health-check.md) | Checklist + SQL ready |
| 1.2 Slop audit samples | [1.2-slop-audit-samples.md](./1.2-slop-audit-samples.md) · **[ingestion-audit-kept-vs-dropped.md / .docx](./ingestion-audit-kept-vs-dropped.md)** | Catalog + stakeholder deliverables |
| 1.3 Report logic maps | [1.3-report-logic-maps.md](./1.3-report-logic-maps.md) | Complete (code-traced) |
| 1.4 Stakeholder examples | [1.4-stakeholder-examples.md](./1.4-stakeholder-examples.md) | Template for Steve |

## Run live audit (prod)

Production: https://document-asset-manager-stioffain29.replit.app/

**Option A — refresh snapshot from prod API** (requires logged-in session cookie):

```bash
# DevTools → Application → Cookies → copy connect.sid
PROD_API_URL=https://document-asset-manager-stioffain29.replit.app \
PROD_SESSION_COOKIE="connect.sid=..." \
pnpm --filter workbench run audit:fetch-prod
```

**Option B — export from prod DB** (if `PROD_DATABASE_URL` available):

```bash
PROD_DATABASE_URL="..." pnpm --filter workbench run audit:export-snapshot
```

**Generate report (MD + DOCX):**

```bash
ISSUE=2026-05-31 pnpm --filter workbench run audit:ingestion-report
# Or without pnpm install: npx tsx artifacts/workbench/scripts/generateIngestionAuditReport.ts
```

## Run against dev (sanity check)

```bash
DATABASE_URL="..." pnpm --filter workbench exec tsx scripts/exportProdIncidentsSnapshot.ts
DATABASE_URL="..." pnpm --filter workbench exec tsx scripts/runPhase1SlopAudit.ts
```

## Sign-off criteria (Phase 1 complete)

- [ ] 1.1: Prod scheduler confirmed running; Source Health reviewed; secrets verified
- [ ] 1.2: `output/slop-audit-samples.generated.md` reviewed with ~20–30 examples per high-priority topic
- [ ] 1.3: Logic maps agreed; selector divergence points documented
- [ ] 1.4: Steve's 3–5 examples tagged and mapped to pipeline stages
- [ ] **Phase 2:** [Prioritised fix backlog](../phase-2-fix-plan/phase-2-prioritised-fix-backlog.md) agreed with Steve
