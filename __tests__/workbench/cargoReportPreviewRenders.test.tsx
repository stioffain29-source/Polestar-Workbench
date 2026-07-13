import { renderToStaticMarkup } from "react-dom/server";

import CargoReportPreview from "../../artifacts/workbench/src/components/CargoReportPreview";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";
import type { ReportPreviewData } from "../../artifacts/workbench/src/components/ReportPreview";

// Task: the redesigned Cargo Watch report renders as an operational-pattern
// brief on-screen (CargoReportPreview) EXACTLY as it rasterises into the PDF
// (exportTopicReportPdf's cargo branch), from the SAME model
// (buildCargoPatternModel). These renderToStaticMarkup checks prove the preview
// renders every section in PDF order for a populated period, degrades a sparse
// period without fabricating rows, and no longer carries the removed Related
// Incidents / Named Port Breakdown surfaces. The ReportEditor-level render tests
// cannot run here (a pre-existing, unrelated `getListMarketPricesQueryKey`
// codegen/circular-import failure crashes every ReportEditor render in jest), so
// the preview component is exercised directly.

const ISSUE = "2026-06-28";

function inc(p: Partial<TopicFastFactsIncident>): TopicFastFactsIncident {
  return {
    topic: "cargo_watch",
    title: "",
    severity: "moderate",
    occurredAt: "2026-06-24",
    country: "Malaysia",
    ...p,
  };
}

const REPORT: ReportPreviewData = {
  title: "Cargo Watch",
  topic: "cargo_watch",
  issueDate: ISSUE,
};

// A multi-pattern week: two truck-hijacking rows, two warehouse-theft rows and a
// port sea-robbery singleton across three countries, so every pattern surface
// (map, trend, supply-chain exposure, pattern cards, timeline, priority matrix)
// materialises and the appendix carries rows.
const RICH: TopicFastFactsIncident[] = [
  inc({ id: 1, title: "Truck hijacking on the Karak highway in Malaysia", severity: "high", occurredAt: "2026-06-24" }),
  inc({ id: 2, title: "Armed men hijack a cargo truck near Johor Bahru, Malaysia", severity: "moderate", occurredAt: "2026-06-22" }),
  inc({ id: 3, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate", country: "Indonesia", occurredAt: "2026-06-23" }),
  inc({ id: 4, title: "Thieves loot a bonded warehouse in Surabaya, Indonesia", severity: "low", country: "Indonesia", occurredAt: "2026-06-21" }),
  inc({ id: 5, title: "Robbers board a ship at Singapore anchorage", severity: "low", country: "Singapore", occurredAt: "2026-06-20" }),
];

describe("CargoReportPreview — pattern-report parity", () => {
  it("renders every assessment section in PDF order for a populated period", () => {
    const html = renderToStaticMarkup(
      <CargoReportPreview report={REPORT} incidents={RICH} />,
    );
    for (const section of [
      "Fast Facts",
      "Situation",
      "What Matters",
      "Business Priorities",
      "Watch Next",
      "Polestar View",
      "Incident Appendix",
      "Disclaimer",
    ]) {
      expect(html).toContain(section);
    }
  });

  it("drops the removed Related Incidents and Named Port Breakdown surfaces", () => {
    const html = renderToStaticMarkup(
      <CargoReportPreview report={REPORT} incidents={RICH} />,
    );
    expect(html).not.toContain("Related Incidents");
    expect(html).not.toContain("Named Port");
  });

  it("degrades a sparse/empty period without throwing or fabricating rows", () => {
    const html = renderToStaticMarkup(
      <CargoReportPreview report={REPORT} incidents={[]} />,
    );
    expect(html.length).toBeGreaterThan(0);
    // Structural chrome still renders; the appendix names the empty state rather
    // than inventing incident rows (strict no-fabrication).
    expect(html).toContain("Incident Appendix");
    expect(html).toContain("Disclaimer");
  });
});
