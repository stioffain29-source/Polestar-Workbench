import { renderToStaticMarkup } from "react-dom/server";

import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";
import { FUEL_MARKET_DATA_SAMPLE } from "../../artifacts/workbench/src/lib/fuelWatchReport";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";

// Sibling to `bespokeReportChartTables.test.tsx` (which guards the chart/table
// BODIES of the four BESPOKE previews) and to `reportFastFactsTiles.test.tsx`
// (which guards the Fast Facts TILES of the SHARED `ReportPreview` used by the
// standard topic / cargo_watch / fuel reports). Neither asserts the data-driven
// TABLE BODIES the shared `ReportPreview` builds: the Related Incidents table
// (topic + cargo), the cargo Country Risk Breakdown table, the fuel Producer &
// Buyer Actions table, and the fuel market-price tile VALUES. A dataset
// regression that yielded empty rows there (e.g. a broken `selectRelatedIncidents`
// / `buildCargoCountryBreakdown` / `buildFuelProducerBuyerActions` returning
// `[]`, or a market-tile value formatter dropping its number) would still pass
// the tile test and ship a report with hollow tables.
//
// This test feeds the shared `ReportPreview` a small representative incident set
// per topic and asserts the table BODIES carry real rows — incident titles,
// per-country cells, action-row actors, and formatted price values — not just
// the section headings. It reuses the jest moduleNameMapper chart/map/asset
// stubs (jest.config.js); the chart children (CargoTrendChart,
// JetFuelTrajectoryChart) are stubbed, so this test deliberately targets the
// TABLE/tile bodies the previews render directly. renderToStaticMarkup is
// enough — no DOM or layout engine is needed.

const report = {
  id: 1,
  title: "Test Report",
  issueDate: "2026-06-15",
};

// ---------------------------------------------------------------------------
// Generic topic report (energy) — the Related Incidents table. With three
// in-window energy incidents (below the strong-row floor) the weak-fallback
// keeps them all, so every title should render as a table row body.
// ---------------------------------------------------------------------------

describe("ReportPreview (topic) Related Incidents table", () => {
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

  it("renders the Related Incidents section", () => {
    expect(html).toContain("Related Incidents");
  });

  it("renders the table body with real incident titles, not just a heading", () => {
    expect(html).toContain("Power grid blackout disrupts Jakarta");
    expect(html).toContain("Substation fire causes rolling blackout in Manila");
    expect(html).toContain("Gas shortage triggers power rationing in Indonesia");
  });

  it("renders the per-row date and source cells from the dataset", () => {
    expect(html).toContain("14 Jun 2026");
    expect(html).toContain("Source: Test Source");
  });
});

// ---------------------------------------------------------------------------
// Cargo Watch report — the Country Risk Breakdown table (CargoCountryTable)
// AND the Related Incidents table. Both feed off the same in-scope cargo
// window. The two titles classify strong (Truck hijack / Container theft) so
// neither is hard-excluded from the cargo Related Incidents table.
// ---------------------------------------------------------------------------

describe("ReportPreview (cargo) Country Risk Breakdown & Related Incidents tables", () => {
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

  it("renders the Country Risk Breakdown section", () => {
    expect(html).toContain("Country Risk Breakdown");
  });

  it("renders Country Risk Breakdown rows with attributed-country cells", () => {
    expect(html).toContain("Indonesia");
    expect(html).toContain("Singapore");
    // The per-country count subline confirms the row body is built from the
    // dataset, not an empty placeholder.
    expect(html).toMatch(/1 record\b/);
  });

  it("renders the Related Incidents table body with real cargo titles", () => {
    expect(html).toContain("Cargo truck hijacked near Jakarta warehouse");
    expect(html).toContain("Electronics container stolen from Singapore depot");
  });
});

// ---------------------------------------------------------------------------
// Fuel Watch report — the market-price Fast Facts tile VALUES (rendered from
// hardNumbers via FastFactsGrid) AND the Producer & Buyer Actions table. The
// tiles sibling test only checks the price LABELS exist; here we assert the
// formatted numeric values render, and that classified action rows appear.
// FUEL_MARKET_DATA_SAMPLE's latest market date is 2026-05-15, so the fuel
// report renders anchored to that close; the action incidents sit inside the
// window ending on it.
// ---------------------------------------------------------------------------

describe("ReportPreview (fuel) market tiles & Producer/Buyer Actions table", () => {
  const incidents: TopicFastFactsIncident[] = [
    {
      id: "fu1",
      topic: "fuel",
      title: "Saudi Aramco refinery outage halts crude supply and lifts fuel prices",
      severity: "moderate",
      occurredAt: "2026-05-14T00:00:00.000Z",
      country: "Saudi Arabia",
      summary: "An outage at a major refinery curbed regional fuel supply.",
      source: "Test Source",
    },
    {
      id: "fu2",
      topic: "fuel",
      title: "Indonesia government cuts fuel subsidy, raising pump diesel prices",
      severity: "high",
      occurredAt: "2026-05-13T00:00:00.000Z",
      country: "Indonesia",
      summary: "The ministry trimmed the diesel subsidy.",
      source: "Test Source",
    },
  ];

  const html = renderToStaticMarkup(
    <ReportPreview
      report={{ ...report, topic: "fuel", hardNumbers: FUEL_MARKET_DATA_SAMPLE }}
      incidents={incidents}
    />,
  );

  it("renders the market-price tile VALUES, not just their labels", () => {
    // formatFuelCardValue: 109.26 -> toFixed(1) (>=100), 2.41 -> toFixed(3) (<10).
    expect(html).toContain("109.3 USD/bbl");
    expect(html).toContain("101.0 USD/bbl");
    expect(html).toContain("2.410 USD/gal");
  });

  it("renders the Market and Operator Responses table", () => {
    expect(html).toContain("Market and Operator Responses");
  });

  it("renders action-table rows with classified actors and the action text", () => {
    expect(html).toContain("Saudi Aramco");
    expect(html).toContain("Refinery or terminal disruption curtailed regional product output");
    expect(html).toContain(
      "Indonesia government cuts fuel subsidy, raising pump diesel prices",
    );
  });

  it("does not show the missing-required fail-closed banner", () => {
    expect(html).not.toContain("missing required market data");
  });
});
