// Read-only integration check using the saved report and the same incident
// projection as the API. No authentication bypass or persisted report edits.
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { pool } from "@workspace/db";
import ShippingReportPreview from "../src/components/ShippingReportPreview";
import { resolveReportTitle } from "../src/lib/reportNaming";
import {
  finalizeShippingPublication,
  assertShippingPublication,
} from "../src/lib/shippingPublication";
import { buildHeadlessReportData, type HeadlessReportRow } from "./headlessReportData";
import { fetchTopicReport, fetchTopicIncidents, fetchMaritimeMovement } from "./topicReportData";

async function main() {
  // The headless asset loader transpiles JSX with the classic runtime.
  Object.assign(globalThis, { React });
  const reportId = Number(process.env.REPORT_ID ?? "12");
  const saved = await fetchTopicReport(reportId) as HeadlessReportRow;
  const report = buildHeadlessReportData(saved, process.env.ISSUE_DATE);
  const incidents = await fetchTopicIncidents() as Parameters<typeof finalizeShippingPublication>[0]["incidents"];
  const movement = await fetchMaritimeMovement(undefined, 200) as Parameters<typeof finalizeShippingPublication>[0]["movement"];
  const sectionOverrides = report.sectionOverrides as Parameters<typeof finalizeShippingPublication>[0]["sectionOverrides"];
  const options = {
    report, incidents, movement, sectionOverrides,
    hiddenSections: sectionOverrides?.hiddenSections,
  };
  const publication = finalizeShippingPublication(options);
  const html = renderToStaticMarkup(createElement(ShippingReportPreview, options as never));
  const draftRenders = html.includes("Maritime Intelligence") &&
    html.includes(resolveReportTitle("shipping", String(report.title))) &&
    !html.includes("Shipping Watch cannot be rendered");
  if (!draftRenders) throw new Error("Saved Shipping report did not render its draft body.");
  let pdfAllowed = true;
  try { assertShippingPublication(publication); } catch { pdfAllowed = false; }
  if (process.env.OUT_HTML) writeFileSync(process.env.OUT_HTML, html);
  console.log(JSON.stringify({
    reportId, issueDate: report.issueDate, draftRenders, pdfAllowed,
    auditIssues: publication.auditIssues,
    fastFacts: publication.fastFacts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());