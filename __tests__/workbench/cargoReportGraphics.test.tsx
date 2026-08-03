import { renderToStaticMarkup } from "react-dom/server";

import {
  buildCargoPatternModel,
  type CargoPatternModelInput,
} from "../../artifacts/workbench/src/lib/cargoPatternModel";
import CargoSupplyChainExposure from "../../artifacts/workbench/src/components/CargoSupplyChainExposure";
import CargoPatternDashboard from "../../artifacts/workbench/src/components/CargoPatternDashboard";
import CargoActivityMatrix from "../../artifacts/workbench/src/components/CargoActivityMatrix";
import { SevChip } from "../../artifacts/workbench/src/components/CargoGraphicPrimitives";

// Task: three SHARED graphic components (supply-chain exposure, pattern
// dashboard, weekly activity matrix) render the redesigned Cargo Watch pattern
// report. The same components render on-screen and rasterise into the PDF, so
// these renderToStaticMarkup checks prove they never render an empty section,
// carry the brand palette (A33232 = Extreme only, 1B6B7A = Insignificant only,
// Electric 4655FF), and degrade gracefully on sparse data.

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
  it("renders the six physical stages and never the partitioned-out enforcement box", () => {
    const m = richModel();
    const html = renderToStaticMarkup(
      <CargoSupplyChainExposure stages={m.stages} total={m.totalUnique} />,
    );
    expect(html).toContain("Supply-Chain Exposure");
    // The physical movement stages (everything except the unattributed catch-all)
    // present in fixed order — including the inland waterway stage (spec pt2).
    const physical = m.stages.filter((s) => s.key !== "unattributed");
    expect(physical).toHaveLength(6);
    // Enforcement is partitioned into its OWN panel upstream (spec pt1) and never
    // reaches this graphic as a stage.
    expect(physical.some((s) => s.key === "enforcement")).toBe(false);
    for (const s of physical) expect(html).toContain(s.label);
    // Electric-blue share-bar fill.
    expect(html).toContain("#465bff");
  });

  it("degrades to an all-empty period without throwing", () => {
    const m = buildCargoPatternModel([], { issueDate: ISSUE });
    const html = renderToStaticMarkup(
      <CargoSupplyChainExposure stages={m.stages} total={m.totalUnique} />,
    );
    expect(html).toContain("Supply-Chain Exposure");
    expect(html).toContain("No incidents identified this period.");
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

describe("cargo report graphics — weekly activity matrix", () => {
  it("renders the frequency matrix for a sufficient period", () => {
    const m = richModel();
    expect(m.activity.sufficient).toBe(true);
    const html = renderToStaticMarkup(
      <CargoActivityMatrix activity={m.activity} />,
    );
    expect(html).toContain("Weekly Activity by Pattern");
    // A pattern row label and a week column label are both present.
    expect(html).toContain(m.activity.rows[0].label);
    expect(html).toContain(m.activity.weeks[0].label);
    // Reconciling "Weekly total" row is drawn.
    expect(html).toContain("Weekly total");
    // Frequency shading, not severity: the extreme/insignificant reserved hues
    // never appear in the matrix.
    expect(html).not.toContain("#A33232");
    expect(html).not.toContain("#1B6B7A");
  });

  it("lists incidents in a compact box for a sparse period", () => {
    const one = buildCargoPatternModel(
      [inc({ id: 1, title: "Truck hijacking on the Karak highway in Malaysia", severity: "high" })],
      { issueDate: ISSUE },
    );
    expect(one.activity.sufficient).toBe(false);
    expect(one.activity.total).toBe(1);
    const html = renderToStaticMarkup(
      <CargoActivityMatrix activity={one.activity} />,
    );
    expect(html).toContain("Weekly Activity by Pattern");
    expect(html).toContain("individual incidents are listed below");
  });

  it("shows a no-data note for an empty period", () => {
    const m = buildCargoPatternModel([], { issueDate: ISSUE });
    const html = renderToStaticMarkup(
      <CargoActivityMatrix activity={m.activity} />,
    );
    expect(html).toContain("No cargo incidents were reported this period");
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
    expect(low).toContain("#0b0a3d");
  });
});
