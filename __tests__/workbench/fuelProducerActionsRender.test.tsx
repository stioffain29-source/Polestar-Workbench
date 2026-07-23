import { renderToStaticMarkup } from "react-dom/server";

import { ProducerActionsTable } from "../../artifacts/workbench/src/components/ReportPreview";
import { buildFuelProducerBuyerActions } from "../../artifacts/workbench/src/lib/fuelNarratives";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";

// Rendered-markup verification for the Fuel Watch "Market and Operator
// Responses" table: rows built by the REAL builder from a realistic crisis
// week (mirroring live prod titles) must render in the REAL table
// component — buyer supplier-pivot and refiner-margin signals included,
// syndicated pivot rewrites collapsed to one row, involuntary refinery
// fires excluded (not a market or operator RESPONSE).
// The app is owner-gated (no live screenshot), so this is the rendered
// check the standing verification order requires.

const ISSUE_DATE = "2026-07-22";
const OCCURRED = "2026-07-20T12:00:00+00:00";

function mk(id: number, topic: string, title: string): TopicFastFactsIncident {
  return {
    id,
    topic,
    title,
    severity: "moderate",
    occurredAt: OCCURRED,
    sourceUrl: `https://example.test/${id}`,
  };
}

const WEEK: TopicFastFactsIncident[] = [
  mk(1, "fuel", "Russia Turns To India For Gasoline As Refinery Damage Deepens Fuel Crisis"),
  mk(2, "fuel", "Russia seeking extra gasoline from one of its top oil buyers amid fuel crisis"),
  mk(3, "fuel", "US refiner margins hit new records as fuel shortage concerns grow"),
  mk(4, "fuel", "Oil refinery ablaze in Cuba as fuel crisis deepens"),
  mk(5, "shipping", "Two Saudi Oil Tankers Reroute in the Red Sea Toward the Suez Canal"),
];

describe("ProducerActionsTable rendered markup", () => {
  const rows = buildFuelProducerBuyerActions({ issueDate: ISSUE_DATE, incidents: WEEK });
  const html = renderToStaticMarkup(<ProducerActionsTable rows={rows} />);

  it("renders the buyer supplier-pivot row once, sentence-cased (syndicated copy collapsed)", () => {
    expect(html).toContain("Russia turns to India for gasoline");
    expect(html).not.toContain("seeking extra gasoline");
    expect(html).toContain("Buyer action");
  });

  it("renders the refiner-margin market signal but excludes the refinery fire", () => {
    expect(html).toContain("US refiner margins hit new records");
    expect(html).not.toContain("ablaze");
    expect(html).toContain("Market / supply signal");
  });

  it("renders the cross-read routing action with all four columns", () => {
    expect(html).toContain("Two Saudi oil tankers reroute in the Red Sea toward the Suez Canal");
    expect(html).toContain("Infrastructure / routing action");
    for (const col of ["Actor", "Category", "Action", "Operational Read"]) {
      expect(html).toContain(col);
    }
  });

  it("never renders unsupported price follow-through claims", () => {
    expect(html).not.toMatch(/usually firms within days/i);
  });
});
