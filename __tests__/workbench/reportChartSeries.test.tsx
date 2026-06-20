import { renderToStaticMarkup } from "react-dom/server";

import CargoTrendChart from "../../artifacts/workbench/src/components/CargoTrendChart";
import JetFuelTrajectoryChart from "../../artifacts/workbench/src/components/JetFuelTrajectoryChart";
import {
  buildCargoReportExtras,
  niceCargoCountMax,
  type CargoReportIncident,
  type CargoTrendPoint,
} from "../../artifacts/workbench/src/lib/cargoReportData";
import {
  getFuelJetFuelTrajectory,
  jetFuelBenchmarkLabel,
  type JetFuelPricePoint,
} from "../../artifacts/workbench/src/lib/jetFuelTrajectory";
import { FUEL_MARKET_DATA_SAMPLE } from "../../artifacts/workbench/src/lib/fuelWatchReport";

// Sibling to `sharedReportChartTables.test.tsx` and
// `bespokeReportChartTables.test.tsx`, which guard the TABLE/tile bodies of the
// report previews. Both reuse the jest moduleNameMapper that STUBS the heavy
// chart children (`CargoTrendChart`, `JetFuelTrajectoryChart`) to an inert
// placeholder (jest.config.js). That leaves the data SERIES drawn INSIDE those
// charts — the weekly cargo bars, the jet-fuel price line — completely
// unasserted: a dataset regression that emptied or mis-scaled a series (a
// broken trend builder returning `[]`, a parser dropping its points, an axis
// that no longer covers the data) would ship a hollow or mis-drawn chart while
// every surrounding table/tile test still passed.
//
// This harness imports the REAL chart components by RELATIVE path, which
// bypasses the `^@/components/...$` moduleNameMapper stubs (those only match the
// `@/`-aliased specifier the previews use internally), so the genuine SVG is
// rendered. It then asserts the chart receives and plots the expected series
// from a known fixture — bar/point COUNT, the plotted VALUES (bar heights, line
// path points), and the AXIS RANGE — not just that a heading rendered. Both
// charts are pure-render SVG (no hooks/effects/layout measurement), so
// `renderToStaticMarkup` is an equivalent harness to jsdom and matches the
// sibling suites; the node test environment is left untouched so the stubbed
// suites keep passing.

// ---------------------------------------------------------------------------
// SVG parsing helpers. renderToStaticMarkup turns inline numeric attributes
// into quoted strings and camelCase SVG props into kebab-case
// (fontSize -> font-size, textAnchor -> text-anchor, strokeWidth ->
// stroke-width). These helpers read the data-driven geometry back out of the
// markup so the assertions target the plotted series, not the surrounding
// chrome.
// ---------------------------------------------------------------------------

// CargoTrendChart draws one electric-blue <rect> bar per trend point. Capture
// each bar's y and height (attribute order tolerant) so we can assert the bar
// COUNT and that the heights track the data.
function cargoBars(html: string): Array<{ y: number; height: number }> {
  const re = /<rect [^>]*\by="([\d.]+)"[^>]*\bheight="([\d.]+)"[^>]*fill="#465bff"/g;
  const out: Array<{ y: number; height: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ y: parseFloat(m[1]), height: parseFloat(m[2]) });
  }
  return out;
}

// Both charts render their y-axis tick labels as right-anchored <text>
// (text-anchor="end"); the x-axis labels are middle-anchored. Capture the
// numeric y-axis tick labels so we can assert the axis RANGE covers the data.
function yAxisTickLabels(html: string): number[] {
  const re = /<text [^>]*text-anchor="end"[^>]*>([^<]*)<\/text>/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const n = parseFloat(m[1]);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

// JetFuelTrajectoryChart draws the price series as a single electric-blue
// <path> with one M/L command per observation. Return the count of plotted
// points, or 0 when no trajectory path is present.
function jetPathPointCount(html: string): number {
  const m = html.match(/<path d="([^"]+)" fill="none" stroke="#465bff"/);
  if (!m) return 0;
  return (m[1].match(/[ML]/g) ?? []).length;
}

// ===========================================================================
// CargoTrendChart — the Weekly Cargo Theft Trend bars.
// ===========================================================================

describe("CargoTrendChart plots the weekly trend series", () => {
  // A known fixture with an explicit zero week and a value (5) that forces the
  // axis to round UP via niceCargoCountMax(5) === 8 — so the test also guards
  // the axis SCALING, not just the bar count.
  const trend: CargoTrendPoint[] = [
    { date: "2026-05-04", count: 2 },
    { date: "2026-05-11", count: 5 },
    { date: "2026-05-18", count: 0 },
    { date: "2026-05-25", count: 3 },
  ];

  const html = renderToStaticMarkup(<CargoTrendChart data={trend} />);

  it("draws exactly one bar per trend point", () => {
    expect(cargoBars(html)).toHaveLength(trend.length);
  });

  it("plots bar heights that track the data (tallest = max count, zero week = no bar)", () => {
    const bars = cargoBars(html);
    const tallestIdx = bars.reduce(
      (best, b, i, arr) => (b.height > arr[best].height ? i : best),
      0,
    );
    // index 1 carries the max count (5); index 2 is the zero week.
    expect(tallestIdx).toBe(1);
    expect(bars[2].height).toBe(0);
    // Heights are proportional to counts: 3 (idx 3) plots taller than 2 (idx 0).
    expect(bars[3].height).toBeGreaterThan(bars[0].height);
  });

  it("scales the count axis to niceCargoCountMax of the peak (5 -> 8)", () => {
    const ticks = yAxisTickLabels(html);
    expect(niceCargoCountMax(5)).toBe(8);
    expect(Math.max(...ticks)).toBe(8);
    // The axis baseline starts at zero so a zero week is honestly placed.
    expect(Math.min(...ticks)).toBe(0);
  });

  it("captions the total records and the number of weeks from the series", () => {
    expect(html).toContain("10 records across 4 weeks");
  });

  it("renders an honest empty (null) chart when the series has < 2 points", () => {
    const empty = renderToStaticMarkup(
      <CargoTrendChart data={[{ date: "2026-05-04", count: 1 }]} />,
    );
    expect(empty).toBe("");
    expect(cargoBars(empty)).toHaveLength(0);
  });
});

describe("CargoTrendChart plots a series built by the real trend selector", () => {
  // End-to-end: incidents -> buildCargoReportExtras (buildWeeklyTrend) -> chart.
  // Two incidents in the week of 2026-06-01 and one in the week of 2026-06-15,
  // with an empty intervening week kept at zero -> a 3-week contiguous series.
  const incidents: CargoReportIncident[] = [
    {
      title: "Cargo truck hijacked near Jakarta warehouse",
      summary: "Armed men hijacked a freight truck.",
      source: "Test Source",
      country: "Indonesia",
      occurredAt: "2026-06-02T00:00:00.000Z",
    },
    {
      title: "Container of electronics stolen from a Jakarta depot",
      summary: "Thieves stole a container of electronics.",
      source: "Test Source",
      country: "Indonesia",
      occurredAt: "2026-06-03T00:00:00.000Z",
    },
    {
      title: "Freight lorry robbed on a Singapore expressway",
      summary: "A cargo lorry was robbed in transit.",
      source: "Test Source",
      country: "Singapore",
      occurredAt: "2026-06-16T00:00:00.000Z",
    },
  ];

  const extras = buildCargoReportExtras(incidents);
  const html = renderToStaticMarkup(<CargoTrendChart data={extras.trend} />);

  it("the selector yields a contiguous weekly series the chart can plot", () => {
    // Mon 01 Jun, Mon 08 Jun (empty), Mon 15 Jun.
    expect(extras.trend.map((p) => p.count)).toEqual([2, 0, 1]);
  });

  it("draws one bar per derived week and captions the real totals", () => {
    expect(cargoBars(html)).toHaveLength(3);
    expect(html).toContain("3 records across 3 weeks");
  });
});

// ===========================================================================
// JetFuelTrajectoryChart — the jet-fuel price line.
// ===========================================================================

describe("JetFuelTrajectoryChart plots the price series", () => {
  const series: JetFuelPricePoint[] = [
    { date: "2026-04-17", value: 2.18, unit: "USD/gal" },
    { date: "2026-04-24", value: 2.27, unit: "USD/gal" },
    { date: "2026-05-01", value: 2.39, unit: "USD/gal" },
    { date: "2026-05-08", value: 2.34, unit: "USD/gal" },
    { date: "2026-05-15", value: 2.41, unit: "USD/gal" },
  ];

  const html = renderToStaticMarkup(
    <JetFuelTrajectoryChart data={series} benchmarkLabel="U.S. Gulf Coast jet fuel" />,
  );

  it("plots one line point per observation", () => {
    expect(jetPathPointCount(html)).toBe(series.length);
  });

  it("scales the y-axis to cover the full value range", () => {
    const ticks = yAxisTickLabels(html);
    expect(ticks.length).toBeGreaterThan(0);
    const minValue = Math.min(...series.map((p) => p.value));
    const maxValue = Math.max(...series.map((p) => p.value));
    // The axis envelope must bracket every plotted value, or points fall off
    // the chart. The component pads the range by 15% on each side.
    expect(Math.min(...ticks)).toBeLessThanOrEqual(minValue);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(maxValue);
  });

  it("captions the latest plotted value and the observation count", () => {
    expect(html).toContain("2.41");
    expect(html).toContain("5 observations");
    expect(html).toContain("U.S. Gulf Coast jet fuel");
  });

  it("renders the honest empty-state card when the series has < 2 points", () => {
    const empty = renderToStaticMarkup(
      <JetFuelTrajectoryChart data={[{ date: "2026-05-15", value: 2.41 }]} />,
    );
    expect(empty).toContain(
      "Jet fuel trajectory data is not available for this reporting cycle.",
    );
    expect(jetPathPointCount(empty)).toBe(0);
  });
});

describe("JetFuelTrajectoryChart plots a series parsed from real hardNumbers", () => {
  // End-to-end: report.hardNumbers -> getFuelJetFuelTrajectory (parser) -> chart.
  const series = getFuelJetFuelTrajectory(FUEL_MARKET_DATA_SAMPLE);
  const benchmark = jetFuelBenchmarkLabel(FUEL_MARKET_DATA_SAMPLE);
  const html = renderToStaticMarkup(
    <JetFuelTrajectoryChart data={series} benchmarkLabel={benchmark} />,
  );

  it("the parser yields the sample's trajectory points", () => {
    expect(series).not.toBeNull();
    expect(series).toHaveLength(FUEL_MARKET_DATA_SAMPLE.jetFuelTrajectory.points.length);
  });

  it("plots every parsed point and labels the parsed benchmark", () => {
    expect(jetPathPointCount(html)).toBe(
      FUEL_MARKET_DATA_SAMPLE.jetFuelTrajectory.points.length,
    );
    expect(html).toContain("U.S. Gulf Coast kerosene-type jet fuel");
  });
});
