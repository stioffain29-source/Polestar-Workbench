# Verification: per-incident AI summaries on cargo / energy / fertiliser reports

Task #138 — confirm per-incident AI summaries (not the deterministic
fallback) ship on cargo_watch, energy and fertiliser topic report PDFs,
and that the on-screen preview matches the downloaded PDF.

This is a verification task; no product code was changed.

## Result: PASS (in the running deployment-equivalent environment)

The original task asked to confirm this on the LIVE deployment after the
next republish. There is currently **no deployment** (no production logs
exist yet), so the live URL check cannot be performed until the user
publishes. All other acceptance criteria were verified in the running
environment, which uses the same code and the same OpenAI integration the
deployment runtime will use.

## 1. OpenAI integration is provisioned and reaches production

- `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`
  are present. `isLlmAvailable()`
  (`artifacts/api-server/src/lib/countryProse.ts`) gates on exactly these
  two vars.
- Replit AI integrations auto-provision these into the deployment runtime,
  so no separate production provisioning action is required. After a
  normal republish the feature is live automatically.

## 2. Real AI summaries generate for all three topics

`POST /api/reports/:id/incident-summaries` with real related incidents
returned `available: true`, `model: "gpt-5.4"` (not the
`model: "unavailable"` fallback) for:

- energy (report 8)
- fertiliser (report 10)
- cargo_watch (report 11)

## 3. Summaries appear in the actual downloaded PDF (preview == PDF)

The in-app "Download PDF" rasterises the on-screen `.print-report` DOM, so
screen and PDF are the same render. Each Related Incidents row renders via
the shared `resolveIncidentSummary`
(`artifacts/workbench/src/lib/incidentSummary.ts`), used by both the
preview and the PDF, so they cannot disagree.

Headless browser PDFs (`scripts/exportReportPdfBrowser.mjs`) for the three
topic reports contain full AI prose under each row, e.g.:

- Energy: "Low: Reporting indicates electricity tariffs are likely to rise
  in Pakistan, with potential cost implications for operations."
- Fertiliser: "Low: A reported crash in urea prices in India is presented
  as creating scope for fertiliser sector reforms, with potential policy
  implications rather than immediate access or movement disruption."
- Cargo: "Moderate: Sabangau police attended PT Nexa Prima in Palangka
  Raya to follow up an alleged warehouse theft."

These are model-written sentences, not the deterministic single-line
template — confirming AI summaries (not fallback) ship in the PDF.

## Runbook — final live confirmation after publish

1. Publish the app.
2. Open `https://<prod-domain>/reports/<id>` for a cargo_watch / energy /
   fertiliser report.
3. Confirm each Related Incidents row shows a full-sentence AI summary
   (not a single templated line).
4. Click "Download PDF" and confirm the PDF rows match the preview.
5. If the rows show only the deterministic line, check that the deployment
   has `AI_INTEGRATIONS_OPENAI_*` set; re-run the OpenAI integration setup
   if missing (no other provisioning is needed).
