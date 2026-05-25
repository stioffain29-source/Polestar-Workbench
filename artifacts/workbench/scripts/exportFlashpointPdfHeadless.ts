import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";

// Stub fetch responses for empty font URLs so ensureRobotoLoaded no-ops
// cleanly when running outside the Vite bundle.
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url || url.startsWith("data:text/javascript")) {
    return new Response(new ArrayBuffer(0), { status: 200 });
  }
  return origFetch(input as RequestInfo, init);
}) as typeof fetch;

const { exportFlashpointReportPdf } = await import("../src/lib/exportFlashpointReportPdf");
type FlashpointReportData = Parameters<typeof exportFlashpointReportPdf>[0];
type FlashpointReportIncident = Parameters<typeof exportFlashpointReportPdf>[1][number];

const REPORT_ID = Number(process.env.REPORT_ID ?? "13");
const API = process.env.API_BASE ?? "http://localhost:80";
const OUT = resolve(process.cwd(), process.env.OUT_PATH ?? "screenshots/flashpoint_report.pdf");

(jsPDF.prototype as unknown as { save: (filename: string) => jsPDF }).save = function (this: jsPDF) {
  const buf = this.output("arraybuffer") as ArrayBuffer;
  writeFileSync(OUT, Buffer.from(buf));
  return this;
};

async function main() {
  const report = await fetch(`${API}/api/reports/${REPORT_ID}`).then((r) => r.json());
  const incidents: FlashpointReportIncident[] = await fetch(`${API}/api/incidents?limit=500`).then((r) => r.json());
  const data: FlashpointReportData = {
    title: report.title,
    topic: report.topic,
    issueDate: report.issueDate,
    author: report.author,
    executiveSummary: report.executiveSummary ?? report.situation,
    situation: report.situation,
    whatHappened: report.whatHappened,
    whatMatters: report.whatMatters,
    implications: report.implications,
    watchNext: report.watchNext,
    polestarView: report.polestarView,
  };
  await exportFlashpointReportPdf(data, incidents, OUT);
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
