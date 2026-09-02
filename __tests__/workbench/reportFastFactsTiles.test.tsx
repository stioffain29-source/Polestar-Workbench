import { renderToStaticMarkup } from "react-dom/server";

import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";
import { FUEL_MARKET_DATA_SAMPLE } from "../../artifacts/workbench/src/lib/fuelWatchReport";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";

// Sibling to `pdfPageBreakMarkers.test.tsx`. That test guards the STRUCTURAL
// markers the PDF exporter needs (cover page, prose-flow, row markers) — but it
// renders every preview with an EMPTY incident set, so it would still pass if a
// regression silently dropped the Fast Facts / stat-tile CONTENT analysts read
// first (e.g. a broken `computePreviewFastFacts` / `computeTopicFastFacts`
// call rendering a hollow grid). This test feeds each report preview a small
// representative incident set and asserts the expected Fast Facts tiles render
// WITH real values, not just their labels.
//
// Reuses the jest moduleNameMapper chart/map/asset stubs (jest.config.js) so it
// needs no DOM or layout engine — renderToStaticMarkup is enough to see the
// label/value text the grid emits.

// renderToStaticMarkup emits no whitespace between adjacent elements, so the
// value <div> immediately follows the label <div>. Capture the value rendered
// directly under a given Fast Facts label.
function tileValue(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(
    new RegExp(`>${escaped}</div><div[^>]*>([^<]*)</div>`),
  );
  return m ? m[1] : null;
}

function hasTile(html: string, label: string): boolean {
  return html.includes(`>${label}</div>`);
}

const report = {
  id: 1,
  title: "Test Report",
  issueDate: "2026-06-15",
};

// ---------------------------------------------------------------------------
// Generic topic report (energy) — six computeTopicFastFacts tiles.
// ---------------------------------------------------------------------------

describe("ReportPreview (topic) Fast Facts tiles", () => {
  const incidents: TopicFastFactsIncident[] = [
    {
      id: "e1",
      topic: "energy",
      title: "Power grid blackout disrupts Jakarta",
      severity: "high",
      occurredAt: "2026-06-14T00:00:00.000Z",
      country: "Indonesia",
      summary: "A power outage hit the capital.",
      source: "Test Source",
    },
    {
      id: "e2",
      topic: "energy",
      title: "Substation fire causes rolling blackout in Manila",
      severity: "moderate",
      occurredAt: "2026-06-12T00:00:00.000Z",
      country: "Philippines",
      summary: "Rolling blackouts followed a substation failure.",
      source: "Test Source",
    },
    {
      id: "e3",
      topic: "energy",
      title: "Gas shortage triggers power rationing in Indonesia",
      severity: "low",
      occurredAt: "2026-06-10T00:00:00.000Z",
      country: "Indonesia",
      summary: "Energy rationing introduced amid a gas shortage.",
      source: "Test Source",
    },
  ];

  const html = renderToStaticMarkup(
    <ReportPreview report={{ ...report, topic: "energy" }} incidents={incidents} />,
  );

  it("emits the six standard Fast Facts tile labels", () => {
    for (const label of [
      "Reporting Period",
      "Total Records",
      "Highest Severity",
      "Top Issue Type",
      "Most Affected Country",
      "Latest Incident",
    ]) {
      expect(hasTile(html, label)).toBe(true);
    }
  });

  it("fills Total Records with the in-window count, not a placeholder", () => {
    expect(tileValue(html, "Total Records")).toBe("3");
  });

  it("derives Highest Severity from the incident set", () => {
    expect(tileValue(html, "Highest Severity")).toBe("High");
  });

  it("derives Most Affected Country from attributed countries", () => {
    expect(tileValue(html, "Most Affected Country")).toBe("Indonesia");
  });

  it("derives Latest Incident from the newest in-window record", () => {
    expect(tileValue(html, "Latest Incident")).toBe("14 Jun 2026");
  });
});

// ---------------------------------------------------------------------------
// Cargo Watch report — the six standard tiles PLUS the two cargo extras.
// ---------------------------------------------------------------------------

describe("ReportPreview (cargo) Fast Facts tiles", () => {
  const incidents: TopicFastFactsIncident[] = [
    {
      id: "c1",
      topic: "cargo_watch",
      title: "Cargo truck hijacked near Jakarta warehouse",
      severity: "high",
      occurredAt: "2026-06-10T00:00:00.000Z",
      country: "Indonesia",
      summary: "Armed men hijacked a freight truck.",
      source: "Test Source",
    },
    {
      id: "c2",
      topic: "cargo_watch",
      title: "Electronics container stolen from Singapore depot",
      severity: "moderate",
      occurredAt: "2026-05-28T00:00:00.000Z",
      country: "Singapore",
      summary: "Thieves stole a container of electronics.",
      source: "Test Source",
    },
  ];

  const html = renderToStaticMarkup(
    <ReportPreview report={{ ...report, topic: "cargo_watch" }} incidents={incidents} />,
  );

  it("emits the six standard Fast Facts tiles", () => {
    for (const label of [
      "Reporting Period",
      "Total Incidents",
      "Highest Severity",
      "Top Issue Type",
      "Most Affected Country",
      "Latest Incident",
    ]) {
      expect(hasTile(html, label)).toBe(true);
    }
  });

  it("emits the cargo-specific extra tiles", () => {
    expect(hasTile(html, "Est. Cargo Loss (USD)")).toBe(true);
    expect(hasTile(html, "Most Stolen Commodity")).toBe(true);
  });

  it("counts both in-scope cargo records", () => {
    expect(tileValue(html, "Total Incidents")).toBe("2");
  });

  it("derives Latest Incident from the newest in-scope cargo record", () => {
    expect(tileValue(html, "Latest Incident")).toBe("10 Jun 2026");
  });
});

// ---------------------------------------------------------------------------
// Fuel Watch report — Fast Facts is built from market data (hardNumbers),
// never incident counts. With the canonical sample payload the grid must
// carry the Brent / WTI / Jet fuel tiles and NOT the fail-closed banner.
// ---------------------------------------------------------------------------

describe("ReportPreview (fuel) Fast Facts tiles", () => {
  const html = renderToStaticMarkup(
    <ReportPreview
      report={{ ...report, topic: "fuel", hardNumbers: FUEL_MARKET_DATA_SAMPLE }}
      incidents={[]}
    />,
  );

  it("emits the market-data Fast Facts tiles", () => {
    expect(hasTile(html, "Brent crude")).toBe(true);
    expect(hasTile(html, "WTI crude")).toBe(true);
    expect(hasTile(html, "Jet fuel")).toBe(true);
  });

  it("does not show the missing-required fail-closed banner", () => {
    expect(html).not.toContain("missing required market data");
  });
});
