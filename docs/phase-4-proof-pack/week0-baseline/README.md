# Week 0 baseline manifest

**Captured:** 2026-09-07T03:33:13.843Z
**Issue date:** 2026-05-31

| Step | Status | Detail |
| --- | --- | --- |
| 0.1 | skipped | Using existing snapshot at C:\Users\nhangto\Documents\Polestar-Workbench-stoff\artifacts\workbench\scripts\.prod-incidents.json |
| 0.2 | done | Funnel written → C:\Users\nhangto\Documents\Polestar-Workbench-stoff\docs\phase-4-proof-pack\week0-baseline\flashpoint-funnel-2026-05-31.txt (final set = 14) |
| 0.3 | done | Parity written → C:\Users\nhangto\Documents\Polestar-Workbench-stoff\docs\phase-4-proof-pack\week0-baseline\flashpoint-parity-2026-05-31.txt (OK) |
| 0.4 | blocked | Set PROD_DATABASE_URL or DATABASE_URL for headless PDF export |
| 0.5 | done | Phase 2 DOCX regenerated → docs/phase-2-fix-plan/phase-2-prioritised-fix-backlog.docx |
| 0.6 | skipped | Log Steve PDFs in docs/phase-1-baseline-audit/1.4-stakeholder-examples.md when received |

## Next actions

- Add PROD_DATABASE_URL to .env.local (Neon/Replit Postgres connection string), OR
- Add PROD_SESSION_COOKIE from logged-in Replit browser (DevTools → Cookies → connect.sid)
- Re-run: pnpm --filter workbench run baseline:week0