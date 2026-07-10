# M1 evidence folder

Artifacts supporting **M1 Audit Pack** sign-off (`docs/M1-audit-pack.md`).

## Evidence method

**Dev-led audit** (no joint live walkthrough required):

- Codebase review + `replit.md` / integration tests
- Unauthenticated production API probes (8 Jul 2026)
- June 2026 workbench audit (`docs/workbench-audit-2026-06-17.md`)
- In-repo headless PDF font audit (`exports/E3-topic-pdf-font-audit.txt`)

Owner signs Appendix C after reviewing classifications in §2.2.

## Contents

| Path | Purpose |
|------|---------|
| `screenshots/routes/05-reports-editor.png` | Production report editor + PDF preview (Jun 2026) |
| `pdfs/E4-country-indonesia.pdf` | Country report sample (headless export) |
| `exports/E3-topic-pdf-font-audit.txt` | Shipping / fuel / flashpoint PDF font audit (PASS) |
| `exports/E3-integration-classification-basis.md` | How §2.2 classifications were derived |
| `logs/` | Reserved (scheduler log not required for M1 sign-off) |

## Production probes already captured

| Check | Result | Date |
|-------|--------|------|
| `GET /api/healthz` | 200 `{"status":"ok"}` | 8 Jul 2026 |
| `GET /api/access` (logged out) | 200 `{"authenticated":false,"allowed":false}` | 8 Jul 2026 |
| `GET /api/incidents` (no session) | 401 | 8 Jul 2026 |
| `POST /api/admin/ingest` (no token) | 401 (token configured) | 8 Jul 2026 |
