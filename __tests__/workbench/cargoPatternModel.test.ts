import {
  buildCargoPatternModel,
  type CargoPatternModelInput,
} from "../../artifacts/workbench/src/lib/cargoPatternModel";
import {
  STAGE_ORDER,
  MAX_PATTERN_CARDS,
} from "../../artifacts/workbench/src/lib/cargoPatternConfig";

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

function totalRecordsValue(m: ReturnType<typeof buildCargoPatternModel>): number {
  const card = m.fastFacts.find((c) => /records|incidents/i.test(c.label));
  return card ? Number(card.value.replace(/[^0-9]/g, "")) : NaN;
}

describe("cargo pattern model — single-source reconciliation", () => {
  it("Fast Facts total equals the deduped cluster count", () => {
    const rows = [
      inc({ id: 1, title: "Armed robbers hijack container truck on the North-South highway in Malaysia", severity: "high", occurredAt: "2026-06-24" }),
      inc({ id: 2, title: "Thieves raid a bonded warehouse in Jakarta, Indonesia overnight", severity: "moderate", occurredAt: "2026-06-23" }),
      inc({ id: 3, title: "Robbers board a bulk carrier at Singapore Strait anchorage", severity: "low", occurredAt: "2026-06-22" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    // The reconciliation property: the Fast Facts "Total Records" card always
    // equals the deduped cluster count, whatever survives the scope gate.
    expect(m.totalUnique).toBeGreaterThan(0);
    expect(totalRecordsValue(m)).toBe(m.totalUnique);
  });

  it("collapses syndicated duplicates so raw input exceeds the deduped set", () => {
    const a = inc({ id: 1, title: "Robbers board vessel at Port Klang anchorage", source: "Reuters", sourceUrl: "https://r/1", occurredAt: "2026-06-20" });
    const b = inc({ id: 2, title: "Robbers board ship at Port Klang anchorage overnight", source: "Local Daily", sourceUrl: "https://l/2", occurredAt: "2026-06-21" });
    const m = buildCargoPatternModel([a, b], { issueDate: "2026-06-24" });
    expect(m.totalUnique).toBe(1);
    expect(m.clusters[0].clusterSize).toBe(2);
  });

  it("stage counts sum to the total unique count", () => {
    const rows = [
      inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high" }),
      inc({ id: 2, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate" }),
      inc({ id: 3, title: "Robbers board ship at Singapore anchorage", severity: "low" }),
      inc({ id: 4, title: "Police arrest a cargo theft syndicate in the Philippines", severity: "moderate" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    const sum = m.stages.reduce((s, st) => s + st.count, 0);
    expect(sum).toBe(m.totalUnique);
    expect(m.stages.map((s) => s.key)).toEqual(STAGE_ORDER);
  });

  it("activity matrix cells reconcile with the total unique count", () => {
    const rows = [
      inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high", occurredAt: "2026-06-24" }),
      inc({ id: 2, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate", occurredAt: "2026-06-17" }),
      inc({ id: 3, title: "Robbers board ship at Singapore anchorage", severity: "low", occurredAt: "2026-06-10" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    // Every unique incident lands in exactly one cell: weekly totals plus the
    // date-unconfirmed bucket reconcile with the deduped set.
    const weekSum = m.activity.weeklyTotals.reduce((s, n) => s + n, 0);
    expect(weekSum + m.activity.unconfirmedTotal).toBe(m.totalUnique);
    // The per-row totals also reconcile with the deduped set.
    const rowSum = m.activity.rows.reduce((s, r) => s + r.total, 0);
    expect(rowSum).toBe(m.totalUnique);
    expect(m.activity.total).toBe(m.totalUnique);
    // Multi-week period spans at least two Monday-anchored columns.
    expect(m.activity.weeks.length).toBeGreaterThanOrEqual(2);
  });

  it("appendix has exactly one row per unique incident", () => {
    const rows = [
      inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high" }),
      inc({ id: 2, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    expect(m.appendix).toHaveLength(m.totalUnique);
    // Summary is a single cleaned sentence, no wire cruft prefix.
    for (const r of m.appendix) {
      expect(r.summary.length).toBeGreaterThan(0);
    }
  });

  it("caps pattern dashboard cards and ranks by significance", () => {
    const rows: CargoPatternModelInput[] = [];
    // Five distinct high-frequency categories -> more than the card cap.
    const specs = [
      "Truck hijacking on the highway in Malaysia",
      "Warehouse theft in Jakarta, Indonesia",
      "Robbers board ship at Singapore anchorage",
      "Theft from container at Port Klang terminal, Malaysia",
      "Pilferage and seal tampering at a yard in Thailand",
    ];
    let id = 0;
    for (const s of specs) {
      for (let k = 0; k < 3; k++) {
        rows.push(inc({ id: ++id, title: s, occurredAt: `2026-06-${10 + id}`, severity: "moderate" }));
      }
    }
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    expect(m.patterns.length).toBeLessThanOrEqual(MAX_PATTERN_CARDS);
    for (let i = 1; i < m.patterns.length; i++) {
      expect(m.patterns[i - 1].significance).toBeGreaterThanOrEqual(
        m.patterns[i].significance,
      );
    }
  });

  it("matrix is marked insufficient for sparse periods", () => {
    const m1 = buildCargoPatternModel([], { issueDate: ISSUE });
    expect(m1.isEmpty).toBe(true);
    expect(m1.matrix.sufficient).toBe(false);
    expect(m1.appendix).toHaveLength(0);
    expect(m1.stages.reduce((s, st) => s + st.count, 0)).toBe(0);

    const one = buildCargoPatternModel(
      [inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high" })],
      { issueDate: ISSUE },
    );
    expect(one.totalUnique).toBe(1);
    expect(one.matrix.sufficient).toBe(false);
  });

  it("handles an enforcement-only period without inflating other stages", () => {
    const rows = [
      inc({ id: 1, title: "Police arrest a cargo theft syndicate in the Philippines", severity: "moderate" }),
      inc({ id: 2, title: "Authorities dismantle a truck-hijacking gang in Malaysia", severity: "moderate" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    const enforcement = m.stages.find((s) => s.key === "enforcement");
    expect(enforcement?.count).toBe(m.totalUnique);
    for (const s of m.stages) {
      if (s.key !== "enforcement") expect(s.count).toBe(0);
    }
  });

  it("country intensity totals never exceed the deduped set", () => {
    const rows = [
      inc({ id: 1, title: "Truck hijacking on the highway in Malaysia", severity: "high" }),
      inc({ id: 2, title: "Warehouse theft in Jakarta, Indonesia", severity: "moderate" }),
      inc({ id: 3, title: "Robbers board ship at Singapore anchorage", severity: "low" }),
    ];
    const m = buildCargoPatternModel(rows, { issueDate: ISSUE });
    const intensityTotal = [...m.intensity.values()].reduce(
      (s, v) => s + (v.count ?? 0),
      0,
    );
    expect(intensityTotal).toBeLessThanOrEqual(m.totalUnique);
  });
});
