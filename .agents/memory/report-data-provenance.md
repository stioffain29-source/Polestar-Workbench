---
name: Report data provenance & PDF parity
description: How "Data as of" provenance, screen==PDF parity, and the stale-prose guard work in the workbench reports.
---

- The in-app "Download PDF" button rasterises the on-screen `.print-report` DOM (`exportElementToPdf`), so screen == in-app PDF is automatic. The jsPDF builders (`exportTopicReportPdf`/`Shipping`/`Flashpoint`/`Country`) are used ONLY by headless scripts.
  **Why:** parity work and any "appears on screen but not PDF" expectation must target the React previews for the user-facing path; the jsPDF builders only matter for headless exports.
  **How to apply:** put shared report UI (e.g. the data-as-of strip) in the React previews AND mirror it in the jsPDF builders via a `pdfChrome` helper when headless output must match.

- Data-status model lives in `reportDataStatus.ts`: `latestRecord` = max(occurredAt), `lastUpdated` = max(createdAt), computed from the loaded incidents — NOT the `sources` table (the cargo scraper never updates `sources.lastSuccessAt`). `createdAt` is absent at the TS type level but present at runtime (server does `select *`).

- Flashpoint reports carry topic `protests` but their incidents are stored under `flashpoint`. Any topic-scoped logic (data-as-of, stale guard) must map `protests` → `flashpoint` or it silently matches zero rows.

- Stale-prose guard (ReportEditor seeding effect): a report window ends on its issue date; if max(occurredAt for the data topic) > issueDate, the editor reseeds prose from a fresh draft and shows a no-print subdued-red warning. Non-destructive — nothing persists until Save.
