import {
  canonicalTitleKey,
  dedupeMonitorRows,
} from "../../artifacts/workbench/src/lib/monitorDedupe";

describe("canonicalTitleKey", () => {
  it("strips a trailing ' - Source' masthead and normalises", () => {
    expect(canonicalTitleKey("Tanker attacked off Yemen - Reuters")).toBe(
      "tanker attacked off yemen",
    );
    expect(canonicalTitleKey("Tanker attacked off Yemen | gCaptain")).toBe(
      "tanker attacked off yemen",
    );
  });

  it("collapses two syndicated copies to the same key", () => {
    expect(canonicalTitleKey("Port blast halts operations - AP")).toBe(
      canonicalTitleKey("Port blast halts operations - The Straits Times"),
    );
  });

  it("does not treat in-word hyphens as a masthead boundary", () => {
    expect(canonicalTitleKey("Iran-backed militia attacks ship")).toBe(
      "iran backed militia attacks ship",
    );
    expect(canonicalTitleKey("COVID-19 disrupts ports")).toBe("covid 19 disrupts ports");
  });

  it("keeps distinct headlines distinct", () => {
    expect(canonicalTitleKey("Tanker seized near Hormuz")).not.toBe(
      canonicalTitleKey("Bulk carrier grounded off Malacca"),
    );
  });

  it("does NOT strip a lowercase dash-subtitle (not a masthead)", () => {
    expect(canonicalTitleKey("Port blast halts operations - evacuation ordered")).not.toBe(
      canonicalTitleKey("Port blast halts operations - cause disputed"),
    );
    expect(canonicalTitleKey("Port blast halts operations - evacuation ordered")).toBe(
      "port blast halts operations evacuation ordered",
    );
  });

  it("strips a bare-domain source suffix", () => {
    expect(canonicalTitleKey("Warehouse theft probe widens - beritaimn.com")).toBe(
      "warehouse theft probe widens",
    );
  });

  it("strips an all-caps and a multi-word capitalised masthead alike", () => {
    expect(canonicalTitleKey("Port blast halts operations - AP")).toBe(
      canonicalTitleKey("Port blast halts operations - The Straits Times"),
    );
  });
});

type Row = { title: string; date: Date; severity: string; scope?: string };

const row = (title: string, severity: string, day: string, scope?: string): Row => ({
  title,
  severity,
  date: new Date(`2026-06-${day}T00:00:00Z`),
  scope,
});

describe("dedupeMonitorRows", () => {
  it("collapses identical canonical titles to one", () => {
    const out = dedupeMonitorRows([
      row("Port blast halts operations - AP", "high", "10"),
      row("Port blast halts operations - Reuters", "high", "11"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps the higher-severity copy", () => {
    const out = dedupeMonitorRows([
      row("Port blast halts operations - AP", "low", "12"),
      row("Port blast halts operations - Reuters", "high", "10"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("high");
  });

  it("breaks severity ties by newest date", () => {
    const out = dedupeMonitorRows([
      row("Port blast halts operations - AP", "high", "10"),
      row("Port blast halts operations - Reuters", "high", "15"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].date.getUTCDate()).toBe(15);
  });

  it("never merges distinct stories that share keywords", () => {
    const out = dedupeMonitorRows([
      row("Fuel shortage hits Jakarta depots", "moderate", "10"),
      row("Fuel shortage eases in Manila ports", "low", "11"),
    ]);
    expect(out).toHaveLength(2);
  });

  it("honours the rank tiebreak before severity", () => {
    const out = dedupeMonitorRows(
      [
        row("Cargo truck hijacked on highway - AP", "high", "10", "country_review"),
        row("Cargo truck hijacked on highway - Reuters", "low", "11", "in_scope"),
      ],
      (r) => (r.scope === "in_scope" ? 2 : r.scope === "country_review" ? 1 : 0),
    );
    expect(out).toHaveLength(1);
    expect(out[0].scope).toBe("in_scope");
  });

  it("keeps unkeyable (empty-title) rows separate", () => {
    const out = dedupeMonitorRows([
      row("", "low", "10"),
      row("", "low", "11"),
    ]);
    expect(out).toHaveLength(2);
  });
});
