import { renderToStaticMarkup } from "react-dom/server";

import {
  buildCargoPatternModel,
  type CargoPatternModelInput,
} from "../../artifacts/workbench/src/lib/cargoPatternModel";
import CargoSupplyChainExposure from "../../artifacts/workbench/src/components/CargoSupplyChainExposure";
import CargoPatternDashboard from "../../artifacts/workbench/src/components/CargoPatternDashboard";
import CargoIncidentTimeline from "../../artifacts/workbench/src/components/CargoIncidentTimeline";
import CargoPriorityMatrix from "../../artifacts/workbench/src/components/CargoPriorityMatrix";
import { SevChip } from "../../artifacts/workbench/src/components/CargoGraphicPrimitives";

// Task: four SHARED graphic components (supply-chain exposure, pattern
// dashboard, incident timeline, priority matrix) render the redesigned Cargo
// Watch pattern report. The same components render on-screen and rasterise into
// the PDF, so these renderToStaticMarkup checks prove they never render an
// empty section, carry the brand palette (A33232 = Extreme only, 1B6B7A =
// Insignificant only, Electric 4655FF), and degrade gracefully on sparse data.

const ISSUE = "2026-06-28";

function inc(p: Partial<CargoPatternModelInput>): CargoPatternModelInput {
  return {
    title: "",
    summary: "",
    occurredAt: "2026-06-24",
    topic: "cargo_watch",
    severity: "moderate",
    country: "Malaysia",
    ...p,
  };
}

// Rich, multi-pattern period (mirrors the model test's dashboard fixture) so
// patterns exist and the matrix is sufficient.
function richModel() {
  // Distinct titles that reliably classify into two multi-incident categories
  // (Truck hijacking, Warehouse theft) plus a singleton, so pattern cards and a
  // sufficient matrix both materialise.
  const rows: CargoPatternModelInput[] = [
    inc({ id: 1, title: "Truck hijacking on the Karak highway in Malaysia", severity: "high", occurredAt: "2026-06-24" }),
    inc({ id: 2, title: "Armed men hijack a cargo truck near Johor Bahru, Malaysia", severity: "moderate", occurredAt: "2026-06-22" }),
    inc({ id: 3, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate", country: "Indonesia", occurredAt: "2026-06-23" }),
    inc({ id: 4, title: "Thieves loot a bonded warehouse in Surabaya, Indonesia", severity: "low", country: "Indonesia", occurredAt: "2026-06-21" }),
    inc({ id: 5, title: "Robbers board a ship at Singapore anchorage", severity: "low", country: "Singapore", occurredAt: "2026-06-20" }),
  ];
  return buildCargoPatternModel(rows, { issueDate: ISSUE });
}

describe("cargo report graphics — supply-chain exposure", () => {
  it("renders the six stages with counts and the brand fill colour", () => {
    const m = richModel();
    const html = renderToStaticMarkup(
      <CargoSupplyChainExposure stages={m.stages} total={m.totalUnique} />,
    );
    expect(html).toContain("Supply-Chain Exposure");
    // All six stages present in fixed order.
    for (const s of m.stages) expect(html).toContain(s.label);
    // Electric-blue share-bar fill.
    expect(html).toContain("#4655FF");
  });

  it("degrades to an all-empty period without throwing", () => {
    const m = buildCargoPatternModel([], { issueDate: ISSUE });
    const html = renderToStaticMarkup(
      <CargoSupplyChainExposure stages={m.stages} total={m.totalUnique} />,
    );
    expect(html).toContain("Supply-Chain Exposure");
    expect(html).toContain("No incidents this period");
  });
});

describe("cargo report graphics — pattern dashboard", () => {
  it("renders dominant pattern cards", () => {
    const m = richModel();
    expect(m.patterns.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(
      <CargoPatternDashboard patterns={m.patterns} />,
    );
    expect(html).toContain("Operational Patterns");
    expect(html).toContain(m.patterns[0].name);
    expect(html).toContain("Watch:");
  });

  it("shows an explicit note when no pattern is distinct", () => {
    const html = renderToStaticMarkup(<CargoPatternDashboard patterns={[]} />);
    expect(html).toContain("No single category rose to a distinct operational");
  });
});

describe("cargo report graphics — incident timeline", () => {
  it("plots category lanes for a populated period", () => {
    const m = richModel();
    const html = renderToStaticMarkup(
      <CargoIncidentTimeline timeline={m.timeline} />,
    );
    expect(html).toContain("Incident Timeline");
    // At least one lane label rendered.
    expect(html).toContain(m.timeline.lanes[0].label);
  });

  it("shows a no-data note for an empty period", () => {
    const m = buildCargoPatternModel([], { issueDate: ISSUE });
    const html = renderToStaticMarkup(
      <CargoIncidentTimeline timeline={m.timeline} />,
    );
    expect(html).toContain("No incidents to plot this period");
  });
});

describe("cargo report graphics — priority matrix", () => {
  it("renders the four quadrants and a numbered legend when sufficient", () => {
    const m = richModel();
    expect(m.matrix.sufficient).toBe(true);
    const html = renderToStaticMarkup(<CargoPriorityMatrix matrix={m.matrix} />);
    expect(html).toContain("Priority Action");
    expect(html).toContain("Monitor");
    expect(html).toContain("Emerging Concern");
    expect(html).toContain("Persistent Exposure");
    // Legend maps a point to its pattern name.
    expect(html).toContain(m.matrix.points[0].name);
  });

  it("explains an insufficient period instead of an empty plot", () => {
    const one = buildCargoPatternModel(
      [inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high" })],
      { issueDate: ISSUE },
    );
    expect(one.matrix.sufficient).toBe(false);
    const html = renderToStaticMarkup(<CargoPriorityMatrix matrix={one.matrix} />);
    expect(html).toContain("Insufficient distinct patterns");
  });
});

describe("cargo report graphics — severity palette", () => {
  it("reserves A33232 for Extreme and 1B6B7A for Insignificant, dark label on Low", () => {
    expect(renderToStaticMarkup(<SevChip severityKey="extreme" />)).toContain(
      "#A33232",
    );
    expect(
      renderToStaticMarkup(<SevChip severityKey="insignificant" />),
    ).toContain("#1B6B7A");
    // Low tier keeps a dark navy label for contrast on the light-green fill.
    const low = renderToStaticMarkup(<SevChip severityKey="low" />);
    expect(low).toContain("#6FB872");
    expect(low).toContain("#0B0B3D");
  });
});
