import { groupByMonth } from "@/lib/protestsAnalysis";

// The Protests monitor's incident table is chunked by calendar month so the
// main view stays short: the most recent month renders in full and every
// earlier month collapses into an expandable archive box. `groupByMonth` is the
// pure engine behind that. These tests lock its contract: newest month first,
// stable order within a month, valid keys/labels, and NaN-date resilience.

function row(iso: string, id: string) {
  return { id, occurredDate: new Date(iso) };
}

describe("groupByMonth", () => {
  it("buckets by calendar month, newest month first", () => {
    const groups = groupByMonth([
      row("2026-07-06T09:00:00.000Z", "a"),
      row("2026-07-01T09:00:00.000Z", "b"),
      row("2026-06-20T09:00:00.000Z", "c"),
      row("2026-05-02T09:00:00.000Z", "d"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-07", "2026-06", "2026-05"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["c"]);
    expect(groups[2].rows.map((r) => r.id)).toEqual(["d"]);
  });

  it("produces a human month/year label", () => {
    const [g] = groupByMonth([row("2026-07-06T09:00:00.000Z", "a")]);
    expect(g.label).toBe("July 2026");
  });

  it("preserves incoming row order within a month", () => {
    const groups = groupByMonth([
      row("2026-07-06T09:00:00.000Z", "first"),
      row("2026-07-03T09:00:00.000Z", "second"),
      row("2026-07-09T09:00:00.000Z", "third"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["first", "second", "third"]);
  });

  it("skips records with an unparseable date", () => {
    const groups = groupByMonth([
      row("2026-07-06T09:00:00.000Z", "good"),
      { id: "bad", occurredDate: new Date(NaN) },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["good"]);
  });

  it("returns an empty array for no rows", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});
