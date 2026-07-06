import { renderToStaticMarkup } from "react-dom/server";

import {
  MarketPricesReportSection,
  MarketPricesReportGrid,
  MARKET_PRICES_REPORT_EMPTY_TEXT,
} from "../../artifacts/workbench/src/components/MarketPrices";
import type { MarketPrice } from "@workspace/api-client-react";

// Task: the Energy Watch report gained a "Market Prices" section that must
// render the SAME four commodity cards on the on-screen preview
// (MarketPricesReportSection) AND in the exported PDF (MarketPricesReportGrid).
// Both surfaces render the one shared card grid, so this test proves parity:
// the preview section wraps the exact grid the PDF rasterises, and both carry
// each card's label, value+unit, period change, and "As of ... · source"
// provenance. It also guards the explicit empty-feed "no data" state so an
// empty feed can never silently drop the section or fabricate numbers.

const ROWS: MarketPrice[] = [
  {
    group: "energy",
    key: "electricity_us",
    label: "Electricity US City Avg",
    value: 0.187,
    unit: "USD/kWh",
    change: "+1.2% m/m",
    asOf: "2026-06-30",
    source: "US BLS",
    benchmark: "Average price, per kWh",
    trajectory: [
      { date: "2026-04-30", value: 0.181 },
      { date: "2026-05-31", value: 0.184 },
      { date: "2026-06-30", value: 0.187 },
    ],
  },
  {
    group: "energy",
    key: "natgas_europe",
    label: "Natural Gas Europe",
    value: 34.21,
    unit: "USD/MMBtu",
    change: null,
    asOf: "2026-06-30",
    source: "World Bank",
    benchmark: "TTF benchmark",
    trajectory: null,
  },
];

describe("Energy Watch Market Prices report section", () => {
  it("preview section wraps the same grid the PDF rasterises", () => {
    const section = renderToStaticMarkup(<MarketPricesReportSection rows={ROWS} />);
    const grid = renderToStaticMarkup(<MarketPricesReportGrid rows={ROWS} />);
    expect(section).toContain(grid);
  });

  it("renders every card with label, value+unit, change and provenance", () => {
    const html = renderToStaticMarkup(<MarketPricesReportGrid rows={ROWS} />);
    expect(html).toContain("Electricity US City Avg");
    expect(html).toContain("Natural Gas Europe");
    expect(html).toContain("0.187");
    expect(html).toContain("USD/kWh");
    expect(html).toContain("34.21");
    expect(html).toContain("USD/MMBtu");
    expect(html).toContain("+1.2% m/m");
    // A row with no prior period must say so, never invent a change.
    expect(html).toContain("no prior observation");
    // Provenance line present for both rows.
    expect(html).toContain("US BLS");
    expect(html).toContain("World Bank");
  });

  it("draws a trajectory only when the row carries multiple points", () => {
    const html = renderToStaticMarkup(<MarketPricesReportGrid rows={ROWS} />);
    // One <svg> for the electricity row (3 points); the natgas row (null) draws none.
    const svgCount = (html.match(/<svg/g) ?? []).length;
    expect(svgCount).toBe(1);
  });

  it("shows an explicit no-data state for an empty feed, never fabricated numbers", () => {
    const html = renderToStaticMarkup(<MarketPricesReportSection rows={[]} />);
    expect(html).toContain(MARKET_PRICES_REPORT_EMPTY_TEXT);
    expect(html).not.toContain("<svg");
  });
});
