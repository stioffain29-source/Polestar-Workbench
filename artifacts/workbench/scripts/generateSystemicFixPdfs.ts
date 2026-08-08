// Generates the two local verification PDFs for the systemic report-engine fix.
// The Fuel brief uses preserved 4 May 2026 source rows; Jakarta uses a compact
// current-period fixture that exercises the fatality-over-contained-fire rank.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { jsPDF } from "jspdf";

const OUT_FUEL = "/home/user/workspace/fuel-watch-systemic-fix.pdf";
const OUT_JAKARTA = "/home/user/workspace/jakarta-systemic-fix.pdf";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("file://")) {
    return new Response(readFileSync(fileURLToPath(url)), {
      status: 200,
      headers: { "content-type": "font/ttf" },
    });
  }
  if (url.startsWith("data:text/javascript")) return new Response(new ArrayBuffer(0), { status: 200 });
  return originalFetch(input as RequestInfo, init);
}) as typeof fetch;

(jsPDF.prototype as unknown as { save: (filename: string) => jsPDF }).save = function (this: jsPDF, filename: string) {
  const path = filename.includes("jakarta") ? OUT_JAKARTA : OUT_FUEL;
  writeFileSync(path, Buffer.from(this.output("arraybuffer") as ArrayBuffer));
  return this;
};

const { exportTopicReportPdf } = await import("../src/lib/exportTopicReportPdf");
const { exportCountryReportPdf } = await import("../src/lib/exportCountryReportPdf");
const { TOPIC_LABELS } = await import("../src/lib/topics");

const raw = JSON.parse(
  readFileSync(join(import.meta.dirname, ".prod-incidents.json"), "utf8"),
) as { fuel: Array<Record<string, unknown>>; shipping: Array<Record<string, unknown>> };
const mapTopicRow = (r: Record<string, unknown>) => ({
  id: String(r.id),
  title: String(r.title ?? ""),
  topic: String(r.topic),
  severity: String(r.severity ?? "low"),
  occurredAt: String(r.occurred_at),
  country: r.country == null ? null : String(r.country),
  location: r.location == null ? null : String(r.location),
  summary: r.summary == null ? null : String(r.summary),
  source: r.source == null ? null : String(r.source),
  sourceUrl: r.source_url == null ? null : String(r.source_url),
});
const fuelRows = [...raw.fuel, ...raw.shipping]
  .filter((r) => String(r.occurred_at).slice(0, 10) <= "2026-05-04")
  .map(mapTopicRow);

await exportTopicReportPdf(
  {
    title: "Fuel Watch",
    topic: "fuel",
    issueDate: "2026-05-04",
    executiveSummary: "Fuel operations were shaped by confirmed maritime disruption and associated supply-risk reporting. This regenerated brief applies the shared location, significance and incident-matching rules.",
    situation: "The reporting window contains several genuine route-security events alongside market commentary. The watch now separates concrete incidents from economic knock-on coverage.",
    whatMatters: "Confirmed disruptions and persistent route risk require contingency checks for fuel movement and supplier exposure.",
    implications: "Validate route options and local stock resilience before altering travel or distribution plans.",
    watchNext: "Watch for verified attacks, closures, diversions and formal operating notices.",
    polestarView: "The immediate judgement is operational: direct disruption, not market commentary, should determine the incident lead.",
    hardNumbers: {
      prices: [
        { label: "Brent", value: 111.12, unit: "USD/bbl", asOf: "2026-05-04", source: "Fixture market data" },
        { label: "WTI", value: 104.0, unit: "USD/bbl", asOf: "2026-05-04", source: "Fixture market data" },
        { label: "Jet Fuel", value: 3.1, unit: "USD/gal", asOf: "2026-05-02", source: "Fixture market data" },
      ],
      supply: [{ label: "Route status", value: "Disrupted", asOf: "2026-05-04", source: "Incident reporting" }],
      jetFuelTrajectory: {
        benchmark: "US Gulf Coast kerosene",
        unit: "USD/gal",
        points: [
          { date: "2026-04-20", value: 2.7 },
          { date: "2026-05-02", value: 3.1 },
        ],
      },
    },
  },
  fuelRows,
  TOPIC_LABELS,
  OUT_FUEL,
  { allowMissingMarketData: true },
);

const recent = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const jakartaRows = [
  {
    id: "fatal-violence",
    topic: "flashpoint",
    title: "Armed attackers killed two workers at a Jakarta site",
    summary: "Police continue to search for the assailants; staff movement near the affected area should remain controlled.",
    severity: "high",
    occurredAt: recent(2),
    country: "Indonesia",
    location: "South Jakarta",
    source: "Fixture reporting",
  },
  {
    id: "contained-fire",
    topic: "flashpoint",
    title: "Warehouse fire contained in North Jakarta",
    summary: "The blaze was extinguished and access restored after a short disruption.",
    severity: "moderate",
    occurredAt: recent(1),
    country: "Indonesia",
    location: "North Jakarta",
    source: "Fixture reporting",
  },
  {
    id: "protest",
    topic: "flashpoint",
    title: "Protest march causes temporary access restrictions near parliament",
    summary: "Police managed traffic diversions around the central government district.",
    severity: "moderate",
    occurredAt: recent(3),
    country: "Indonesia",
    location: "Central Jakarta",
    source: "Fixture reporting",
  },
];

await exportCountryReportPdf(
  {
    name: "Jakarta",
    region: "Southeast Asia",
    overview: "Current operational security picture for Jakarta.",
    trendSummary: "Mixed security and access reporting.",
    implications: "Keep movement and site measures proportionate to the verified incident picture.",
  },
  jakartaRows,
  {},
  OUT_JAKARTA,
);

console.log(`Wrote ${OUT_FUEL}`);
console.log(`Wrote ${OUT_JAKARTA}`);
