import { jsPDF } from "jspdf";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { exportTopicReportPdf } from "../src/lib/exportTopicReportPdf";
import ReportPreview from "../src/components/ReportPreview";
import { TOPIC_LABELS } from "../src/lib/topics";
import { buildFuelWatchReportData } from "../src/lib/fuelWatchReport";
import { resolveFuelEffectiveSections } from "../src/lib/fuelReportConsistency";

declare global {
  interface Window {
    __FUEL_COVERAGE_VERIFY_DATA__: any;
    __runFuelCoverageVerify__: () => Promise<string>;
    __runFuelPdfExportVerify__: () => Promise<string>;
  }
}

window.__runFuelPdfExportVerify__ = async () => {
  const data = window.__FUEL_COVERAGE_VERIFY_DATA__;
  let captured: ArrayBuffer | null = null;
  let saveCalls = 0;
  const capture = function (this: jsPDF) {
    saveCalls++;
    captured = this.output("arraybuffer") as ArrayBuffer;
    return this;
  };
  (jsPDF.prototype as unknown as { save: (fileName: string) => jsPDF }).save =
    capture;
  (
    jsPDF as unknown as { API: { save: (fileName: string) => jsPDF } }
  ).API.save = capture;

  let exportError: string | null = null;
  try {
    await exportTopicReportPdf(
      data.report,
      data.incidents,
      TOPIC_LABELS,
      `fuel-report-${data.report.id}-export-verify.pdf`,
      {
        aiProse: data.actualAiProse,
        hiddenSections: data.hiddenSections,
        sectionOverrides: data.sectionOverrides,
      },
    );
  } catch (error) {
    exportError =
      error instanceof Error
        ? `${error.message}\n${error.stack ?? ""}`
        : String(error);
  }

  let base64 = "";
  if (captured) {
    const bytes = new Uint8Array(captured);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }

  return JSON.stringify({
    saveCalls,
    exportError,
    pdfBytes: captured?.byteLength ?? 0,
    base64,
  });
};

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

window.__runFuelCoverageVerify__ = async () => {
  const data = window.__FUEL_COVERAGE_VERIFY_DATA__;
  const host = document.createElement("div");
  host.id = "fuel-coverage-verify-host";
  document.body.append(host);
  createRoot(host).render(
    createElement(ReportPreview, {
      report: data.report,
      incidents: data.incidents,
      aiProse: data.actualAiProse,
      hiddenSections: data.hiddenSections,
      sectionOverrides: data.sectionOverrides,
    }),
  );
  await document.fonts.ready;
  for (let i = 0; i < 35; i++) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }

  const print = host.querySelector<HTMLElement>(".print-report");
  if (!print) throw new Error("Fuel preview did not render .print-report");
  const previewText = print.innerText || print.textContent || "";
  const coverage = host.querySelector<HTMLElement>(
    "[data-fuel-coverage-summary]",
  );
  const coverageText = coverage?.innerText || coverage?.textContent || "";
  const relatedSection = [...host.querySelectorAll<HTMLElement>(".report-section")].find(
    (section) =>
      normalized(section.querySelector("h2")?.textContent ?? "") ===
      "related incidents",
  );
  const relatedVisible =
    relatedSection !== undefined &&
    getComputedStyle(relatedSection).display !== "none" &&
    getComputedStyle(relatedSection).visibility !== "hidden" &&
    relatedSection.getAttribute("aria-hidden") !== "true";
  const relatedRows = relatedSection
    ? [...relatedSection.querySelectorAll("tbody tr")].map((row) =>
        normalized(row.textContent ?? ""),
      )
    : [];
  const expectedCoverageTokens = [
    data.expected.coverage.reportingPeriod.start,
    data.expected.coverage.reportingPeriod.end,
    String(data.expected.coverage.totalDistinctDevelopments),
    String(data.expected.coverage.activeCountries),
    ...Object.entries(data.expected.coverage.severityDistribution).flatMap(
      ([label, count]) => [label, String(count)],
    ),
    ...data.expected.coverage.dailyTrend.flatMap((day: { label: string; count: number }) => [
      day.label,
      String(day.count),
    ]),
    ...data.expected.coverage.affectedCountries.flatMap(
      (country: { country: string; count: number }) => [
        country.country,
        String(country.count),
      ],
    ),
  ];
  const normalizedCoverage = normalized(coverageText);
  const missingCoverageTokens = expectedCoverageTokens.filter(
    (token: string) => !normalizedCoverage.includes(normalized(token)),
  );
  const expectedTitles = data.expected.relatedTitles.map((title: string) =>
    normalized(title),
  );
  const relatedTitlesFound = expectedTitles.map((title: string) =>
    relatedRows.some((row) => row.includes(title)),
  );
  const canonicalKeys = [
    "executiveSummary",
    "situation",
    "whatHappened",
    "whatMatters",
    "implications",
    "watchNext",
    "polestarView",
  ] as const;
  const aiPreviewAiSectionsFound = canonicalKeys.filter(
    (key) =>
      typeof data.actualAiProse[key] === "string" &&
      normalized(previewText).includes(
        normalized(data.actualAiProse[key]).slice(0, 100),
      ),
  );
  const aiPreviewMissingSections = canonicalKeys.filter(
    (key) => !aiPreviewAiSectionsFound.includes(key),
  );
  const canonicalTextMissingKeys = canonicalKeys.filter(
    (key) =>
      data.expected.canonicalSections[key] &&
      !normalized(previewText).includes(
        normalized(data.expected.canonicalSections[key]),
      ),
  );
  const actualPreviewGateIssues = [
    ...host.querySelectorAll<HTMLElement>(
      '[data-fuel-validation-blocked="true"] li',
    ),
  ].map((item) => item.innerText || item.textContent || "");

  // Exercise the actual stored report fields as a direct analyst tier. These
  // are production values, not synthetic invalid prose. The editor's actual
  // stale-draft path clears them before rendering; this host records what the
  // direct saved-field path would do without replacing the text.
  const analystHost = document.createElement("div");
  analystHost.id = "fuel-analyst-override-verify-host";
  document.body.append(analystHost);
  createRoot(analystHost).render(
    createElement(ReportPreview, {
      report: {
        ...data.storedReport,
      },
      incidents: data.incidents,
      aiProse: null,
      hiddenSections: data.hiddenSections,
      sectionOverrides: data.sectionOverrides,
    }),
  );
  await document.fonts.ready;
  for (let i = 0; i < 35; i++) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }
  const analystPreviewBlocked =
    analystHost.querySelector('[data-fuel-validation-blocked="true"]') !==
    null;
  const analystPreviewGateIssues = [
    ...analystHost.querySelectorAll<HTMLElement>(
      '[data-fuel-validation-blocked="true"] li',
    ),
  ].map((item) => item.innerText || item.textContent || "");

  let captured: ArrayBuffer | null = null;
  let saveCalls = 0;
  const capture = function (this: jsPDF) {
    saveCalls++;
    captured = this.output("arraybuffer") as ArrayBuffer;
    return this;
  };
  (jsPDF.prototype as unknown as { save: (fileName: string) => jsPDF }).save =
    capture;
  (
    jsPDF as unknown as { API: { save: (fileName: string) => jsPDF } }
  ).API.save = capture;

  let exportError: string | null = null;
  try {
    await exportTopicReportPdf(
      data.report,
      data.incidents,
      TOPIC_LABELS,
      "fuel-report-23-coverage-verify.pdf",
      {
        aiProse: data.actualAiProse,
        hiddenSections: data.hiddenSections,
        sectionOverrides: data.sectionOverrides,
      },
    );
  } catch (error) {
    exportError = error instanceof Error ? error.message : String(error);
  }
  let analystExportError: string | null = null;
  let analystSaveCalls = saveCalls;
  try {
    await exportTopicReportPdf(
      data.storedReport,
      data.incidents,
      TOPIC_LABELS,
      "fuel-report-23-invalid-analyst-verify.pdf",
      {
        aiProse: null,
        hiddenSections: data.hiddenSections,
        sectionOverrides: data.sectionOverrides,
      },
    );
  } catch (error) {
    analystExportError = error instanceof Error ? error.message : String(error);
  }
  analystSaveCalls = saveCalls - analystSaveCalls;

  // This is the same cleared-report call made by ReportEditor's Fuel prefill.
  // It must resolve from generated AI-or-canonical text, never from an AI
  // string copied into report fields.
  const prefillFuelData = buildFuelWatchReportData(
    { issueDate: data.report.issueDate, hardNumbers: data.report.hardNumbers },
    data.incidents,
  );
  const prefillResolved = resolveFuelEffectiveSections({
    report: {},
    aiProse: data.actualAiProse,
    fuelData: prefillFuelData,
  });
  const prefillMatchesCanonical = canonicalKeys.every(
    (key) =>
      prefillResolved[key] ===
      prefillFuelData.narrativeData.canonicalSections[key],
  );
  const prefillMatchesActualResolved = canonicalKeys.every(
    (key) => prefillResolved[key] === data.expected.prefillResolved[key],
  );
  analystHost.remove();

  let base64 = "";
  if (captured) {
    const bytes = new Uint8Array(captured);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }

  return JSON.stringify({
    blocked:
      host.querySelector('[data-fuel-validation-blocked="true"]') !== null,
    previewLength: previewText.length,
    coverageFound: coverage !== null,
    coverageMissingTokens: missingCoverageTokens,
    relatedVisible,
    relatedRowCount: relatedRows.length,
    relatedTitlesFound,
    aiPreviewBlocked:
      host.querySelector('[data-fuel-validation-blocked="true"]') !== null,
    aiPreviewAiSectionsFound,
    aiPreviewMissingSections,
    canonicalTextMissingKeys,
    actualPreviewGateIssues,
    analystPreviewBlocked,
    analystPreviewGateIssues,
    analystExportError,
    analystSaveCalls,
    prefillMatchesCanonical,
    prefillMatchesActualResolved,
    saveCalls,
    exportError,
    pdfBytes: captured?.byteLength ?? 0,
    base64,
  });
};