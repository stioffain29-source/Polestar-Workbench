// Headless PDF exporter used to produce real Roboto-embedded PDFs for font
// auditing. Routes to the same per-topic exporter the browser uses, so the
// output is byte-equivalent in terms of font registration.
//
// Usage:
//   REPORT_ID=13 TOPIC=flashpoint OUT_PATH=/abs/out.pdf tsx --import ./scripts/registerLoader.mjs scripts/exportReportPdfHeadless.ts
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { jsPDF } from "jspdf";

// Patch fetch to read file:// URLs from disk. The loader rewrites .ttf?url
// imports to file:// URLs that point at the real Roboto TTFs in node_modules,
// and pdfFonts.ts then fetches them — so we must serve those bytes here.
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url && url.startsWith("file://")) {
    const path = fileURLToPath(url);
    const buf = readFileSync(path);
    // Return a Response with the raw bytes so pdfFonts' `await res.arrayBuffer()`
    // gets the exact TTF content.
    return new Response(buf, {
      status: 200,
      headers: { "content-type": "font/ttf" },
    });
  }
  if (!url || url.startsWith("data:text/javascript")) {
    return new Response(new ArrayBuffer(0), { status: 200 });
  }
  return origFetch(input as RequestInfo, init);
}) as typeof fetch;

const REPORT_ID = Number(process.env.REPORT_ID ?? "13");
const TOPIC = (process.env.TOPIC ?? "flashpoint").toLowerCase();
const OUT = resolvePath(process.cwd(), process.env.OUT_PATH ?? `screenshots/${TOPIC}_report.pdf`);

// Intercept pdf.save() across every exporter and divert to writeFileSync.
(jsPDF.prototype as unknown as { save: (filename: string) => jsPDF }).save = function (this: jsPDF) {
  const buf = this.output("arraybuffer") as ArrayBuffer;
  writeFileSync(OUT, Buffer.from(buf));
  return this;
};

interface AnyReport {
  title: string;
  topic: string;
  issueDate: string;
  author: string;
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
  hardNumbers?: unknown;
}

async function main() {
  // Country briefs read directly from Postgres below and never touch the
  // owner-gated `/api` report/incidents endpoints, so skip those HTTP fetches.
  if (TOPIC === "country") {
    // Structured country brief (PNG / West Papua / Indonesia). Reads incidents,
    // baseline and ReliefWeb situational reports DIRECTLY from Postgres (the
    // private `/api` surface is owner-gated and cannot authenticate headlessly)
    // and applies the same country filter as the on-screen report, so the
    // headless PDF exercises every structured-brief `pdf.text` path for the
    // font audit. Slug via COUNTRY_SLUG (default papua-new-guinea).
    const slug = (process.env.COUNTRY_SLUG ?? "papua-new-guinea").toLowerCase();
    const { exportCountryReportPdf } = await import("../src/lib/exportCountryReportPdf");
    const { fetchCountryReportData } = await import("./countryReportData");
    const {
      country,
      incidents: countryIncidents,
      extras,
    } = await fetchCountryReportData(slug);
    await exportCountryReportPdf(country, countryIncidents, {}, OUT, extras);
    console.log(
      `Country ${country.name}: ${countryIncidents.length} matched incidents, ` +
        `${extras.situationalReports?.length ?? 0} situational reports, ` +
        `baseline ${extras.baseline ? "present" : "absent"}`,
    );
    console.log(`Wrote ${OUT}`);
    return;
  }

  // Topic briefs read report + incidents DIRECTLY from Postgres (the private
  // `/api` surface is owner-gated and cannot authenticate headlessly), applying
  // the SAME relevance gate + corroboration attachment the API does, so the
  // headless PDF exercises every topic `pdf.text` path for the font audit.
  const { fetchTopicReport, fetchTopicIncidents, fetchMaritimeMovement } =
    await import("./topicReportData");
  const report = (await fetchTopicReport(REPORT_ID)) as AnyReport;
  const incidents = (await fetchTopicIncidents()) as unknown[];
  // Optional ISSUE_DATE override so a headless export can reproduce the SAME
  // reporting window the in-editor preview renders. The editor advances a draft
  // to today and clamps to the latest record, so a verification run that wants
  // numeric parity with the on-screen board passes the editor's effective date.
  const issueDateOverride = process.env.ISSUE_DATE?.trim();
  const data = {
    title: report.title,
    topic: report.topic,
    issueDate: issueDateOverride || report.issueDate,
    author: report.author,
    executiveSummary: report.executiveSummary ?? report.situation,
    situation: report.situation,
    whatHappened: report.whatHappened,
    whatMatters: report.whatMatters,
    implications: report.implications,
    watchNext: report.watchNext,
    polestarView: report.polestarView,
    hardNumbers: report.hardNumbers,
  };

  if (TOPIC === "shipping") {
    const { exportShippingReportPdf } = await import("../src/lib/exportShippingReportPdf");
    const { buildGatewayFlow, RED_SEA_GATEWAYS } = await import(
      "../src/lib/maritimeDirectionalFlow"
    );
    // Load live movement so the headless PDF faithfully reproduces the in-app
    // shipping export. The Maritime Intelligence board reads the global movement
    // pool (latest snapshot per theatre), so keep the broad load for it.
    const movement = (await fetchMaritimeMovement(undefined, 200).catch(
      () => [],
    )) as Parameters<typeof exportShippingReportPdf>[3];
    // The directional-flow panel reads PER-GATEWAY histories with the SAME params
    // the monitor + report editor use (theatre-scoped, limit 40) so the headless
    // PDF cannot diverge from the verified on-screen surfaces in a populated DB.
    const fetchGatewayRows = async (theatre: string) =>
      (await fetchMaritimeMovement(theatre, 40).catch(() => [])) as Parameters<
        typeof buildGatewayFlow
      >[0];
    const [babRows, suezRows] = await Promise.all([
      fetchGatewayRows(RED_SEA_GATEWAYS[0].theatre),
      fetchGatewayRows(RED_SEA_GATEWAYS[1].theatre),
    ]);
    const redSeaFlow = [
      buildGatewayFlow(
        babRows,
        RED_SEA_GATEWAYS[0].theatre,
        RED_SEA_GATEWAYS[0].gate,
      ),
      buildGatewayFlow(
        suezRows,
        RED_SEA_GATEWAYS[1].theatre,
        RED_SEA_GATEWAYS[1].gate,
      ),
    ];
    await exportShippingReportPdf(
      data as Parameters<typeof exportShippingReportPdf>[0],
      incidents as Parameters<typeof exportShippingReportPdf>[1],
      OUT,
      movement ?? [],
      [],
      {},
      redSeaFlow,
    );
  } else if (TOPIC === "flashpoint" || TOPIC === "protests") {
    const { exportFlashpointReportPdf } = await import("../src/lib/exportFlashpointReportPdf");
    await exportFlashpointReportPdf(data as Parameters<typeof exportFlashpointReportPdf>[0], incidents as Parameters<typeof exportFlashpointReportPdf>[1], OUT);
  } else {
    const { exportTopicReportPdf } = await import("../src/lib/exportTopicReportPdf");
    const { TOPIC_LABELS } = await import("../src/lib/topics");
    await exportTopicReportPdf(
      data as Parameters<typeof exportTopicReportPdf>[0],
      incidents as Parameters<typeof exportTopicReportPdf>[1],
      TOPIC_LABELS,
      OUT,
      { allowMissingMarketData: true },
    );
  }
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
