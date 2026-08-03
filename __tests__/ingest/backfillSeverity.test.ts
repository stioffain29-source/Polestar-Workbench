import { nextSeverityForRow, ALL_SEVERITY_TOPICS, type BackfillRow } from "@workspace/ingest";

// Regression coverage for the severity-backfill staleness bug: the heal used
// to filter topic IN (flashpoint, cargo_watch) only, so a classifier fix
// (e.g. wiring FATAL_SIGNAL_RE into the confirmed-killing HIGH branch) would
// never reach a "conflict"/"indonesia_local"/"apac_local" row even though the
// exact same 'auto-scraped:' marker and classifySeverity() call cover it.
// These tests exercise the extracted pure per-row decision directly so the
// fix is provable without a live DB.

function row(over: Partial<BackfillRow> = {}): BackfillRow {
  return {
    title: "KKB attacks road workers, five killed in Papua Highlands",
    summary: null,
    topic: "conflict",
    fatalities: null,
    ...over,
  };
}

describe("ALL_SEVERITY_TOPICS", () => {
  it("covers every topic the backfill must be able to heal, not just flashpoint/cargo_watch", () => {
    // The exact regression: these were previously excluded from the heal's
    // topic scope even though newsTopic.ts writes the same 'auto-scraped:'
    // marker for all of them.
    expect(ALL_SEVERITY_TOPICS).toEqual(
      expect.arrayContaining([
        "flashpoint",
        "cargo_watch",
        "shipping",
        "energy",
        "fertiliser",
        "fuel",
        "conflict",
        "indonesia_local",
        "apac_local",
        "data_centres",
      ]),
    );
    expect(ALL_SEVERITY_TOPICS).toHaveLength(10);
  });
});

describe("nextSeverityForRow", () => {
  it("re-rates a stale-LOW confirmed-killing conflict row to HIGH (the reported bug)", () => {
    // Same headline as the user-reported Papua Highlands item that was
    // stuck at 'low' — topic='conflict' is exactly what was previously
    // excluded from the backfill's topic filter.
    expect(nextSeverityForRow(row({ topic: "conflict" }))).toBe("high");
  });

  it("re-rates the same headline under indonesia_local and apac_local topics too", () => {
    expect(nextSeverityForRow(row({ topic: "indonesia_local" }))).toBe("high");
    expect(nextSeverityForRow(row({ topic: "apac_local" }))).toBe("high");
  });

  it("still floors to at least the fatality-implied tier when text under-rates", () => {
    expect(
      nextSeverityForRow(
        row({
          title: "Incident reported near port facility",
          summary: "Local authorities are investigating.",
          topic: "shipping",
          fatalities: 8,
        }),
      ),
    ).toBe("extreme");
  });

  it("does not fabricate severity above what text + fatality floor support", () => {
    expect(
      nextSeverityForRow(
        row({
          title: "Community meeting held to discuss road maintenance",
          summary: "Residents met with local officials.",
          topic: "conflict",
          fatalities: null,
        }),
      ),
    ).toBe("low");
  });
});
