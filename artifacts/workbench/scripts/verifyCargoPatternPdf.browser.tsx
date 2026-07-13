// Browser entry for the Cargo Watch pattern-report PDF verification harness.
//
// esbuild-bundled and injected into a real Chromium page by
// verifyCargoPatternPdf.ts so the full in-app export path runs:
//   exportTopicReportPdf (cargo_watch branch) -> embedReactChartInPdf ->
//   html2canvas over the four SHARED pattern graphics (supply-chain exposure,
//   pattern dashboard, incident timeline, priority matrix) + CargoTrendChart +
//   CargoChoroplethStatic, then drawCargoAppendix.
//
// The four graphics only rasterise inside a real DOM (embedReactChartInPdf
// no-ops when `document` is undefined), so this real-Chromium harness — not a
// tsx headless run — is the authoritative check that the redesigned report
// renders its pattern graphics and paginates its appendix.
//
// Reads window.__VERIFY_DATA__ (report + incidents), runs the export, and
// returns the produced PDF as base64 (jsPDF.save is patched to resolve instead
// of triggering a browser download).
import { jsPDF } from "jspdf";
import { exportTopicReportPdf } from "../src/lib/exportTopicReportPdf";
import { TOPIC_LABELS } from "../src/lib/topics";

interface VerifyData {
  report: {
    title: string;
    topic: string;
    issueDate: string;
    author?: string | null;
    executiveSummary?: string | null;
    situation?: string | null;
    whatHappened?: string | null;
    whatMatters?: string | null;
    implications?: string | null;
    watchNext?: string | null;
    polestarView?: string | null;
    hardNumbers?: unknown;
  };
  incidents: unknown[];
}

declare global {
  interface Window {
    __VERIFY_DATA__: VerifyData;
    __runVerify__: () => Promise<string>;
  }
}

window.__runVerify__ = async function runVerify(): Promise<string> {
  let captured: ArrayBuffer | null = null;
  let saveCalls = 0;
  // jsPDF copies its API methods onto EACH instance at construction time, so a
  // prototype patch never fires. Patch jsPDF.API.save (the template every new
  // instance is built from) so the export captures bytes instead of downloading.
  const capture = function (this: jsPDF) {
    saveCalls++;
    captured = this.output("arraybuffer") as ArrayBuffer;
    return this;
  };
  (jsPDF.prototype as unknown as { save: (f: string) => jsPDF }).save = capture;
  (jsPDF as unknown as { API: { save: (f: string) => jsPDF } }).API.save =
    capture;

  const { report, incidents } = window.__VERIFY_DATA__;
  let err: string | null = null;
  try {
    await exportTopicReportPdf(
      report as Parameters<typeof exportTopicReportPdf>[0],
      incidents as Parameters<typeof exportTopicReportPdf>[1],
      TOPIC_LABELS,
      "cargo_pattern_verify.pdf",
      {},
    );
  } catch (e) {
    err = (e as Error)?.stack || String(e);
  }

  let base64 = "";
  if (captured) {
    const bytes = new Uint8Array(captured as ArrayBuffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    base64 = btoa(bin);
  }
  return JSON.stringify({ saveCalls, err, base64 });
};
