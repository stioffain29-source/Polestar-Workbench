// Read-only integration check using the saved report and the same incident
// projection as the API. No authentication bypass or persisted report edits.
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { pool } from "@workspace/db";
import ShippingReportPreview from "../src/components/ShippingReportPreview";
import { resolveReportTitle } from "../src/lib/reportNaming";
import {
  maritimeExecCards,
  maritimeReportChokepointCards,
  maritimeReportMovementTheatres,
} from "../src/lib/maritimeReportView";
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
  const cards = maritimeExecCards(publication.maritimeBoard);
  const movementSamples = maritimeReportMovementTheatres(publication.maritimeBoard);
  const populatedChokepoints = maritimeReportChokepointCards(publication.maritimeBoard);
  const qualityChecks = {
    maritimeCountLabelAccurate: cards.some((card) => card.label === "Confirmed Maritime Incidents · 7d") &&
      !cards.some((card) => card.label.startsWith("Chokepoint Incidents")),
    oneAisSamplePerTheatre: movementSamples.length === new Set(movementSamples.map((row) => row.theatre.toLowerCase())).size,
    aisSamplesNotAfterReportEnd: movementSamples.every((row) => Date.parse(row.dataAsOf) <= publication.maritimeBoard.windowEnd.getTime()),
    noEmptyChokepointHeading: populatedChokepoints.length > 0 || !html.includes("Chokepoint Cards"),
    noEmptyBusinessImpactCard: !cards.some((card) => card.label === "Business Impact Areas" && card.value === "—"),
    incompleteRiskExplicit: publication.completeness.complete ||
      (cards.some((card) => card.value === "Assessment pending") && html.toLowerCase().includes("coverage is incomplete")),
    noUnsupportedAisRatios: !html.includes("AIS-dark") && !html.includes("vs 7-day baseline"),
    incompleteRouteRisksExplicit: publication.completeness.complete ||
      populatedChokepoints.every((card) => card.risk.label === "Assessment pending"),
  };
  if (process.env.ASSERT_QUALITY === "1" && Object.values(qualityChecks).some((passed) => !passed)) {
    throw new Error(`Saved-report quality checks failed: ${JSON.stringify(qualityChecks)}`);
  }
  if (process.env.OUT_HTML) writeFileSync(process.env.OUT_HTML, html);
  console.log(JSON.stringify({
    reportId, issueDate: report.issueDate, draftRenders, pdfAllowed,
    auditIssues: publication.auditIssues,
    fastFacts: publication.fastFacts,
    completeness: publication.completeness,
    cards,
    movementSamples: movementSamples.map((row) => ({
      theatre: row.theatre, dataAsOf: row.dataAsOf, vessels: row.totalVessels,
    })),
    qualityChecks,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());