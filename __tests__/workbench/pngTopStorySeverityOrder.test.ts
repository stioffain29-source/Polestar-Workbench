import {
  selectTopStoryClusters,
  type PngReportItem,
} from "@/lib/pngReportDataset";

const base = Date.parse("2026-08-03T08:00:00.000Z");

// Compact PngReportItem factory: only the fields relevant to display-order
// ranking are varied; the rest carry inert defaults.
function pngItem(over: Partial<PngReportItem> & { id: string; title: string }): PngReportItem {
  return {
    summary: "",
    developmentTitle: undefined,
    province: null,
    location: null,
    category: "crime_violence" as PngReportItem["category"],
    displayCategory: "Crime & violence",
    businessImpact: "",
    severity: "moderate",
    severityLabel: "Moderate",
    severityRank: 3,
    reportedDate: new Date(base),
    incidentDate: new Date(base),
    occurredEarlier: false,
    source: "Test Wire",
    url: null,
    confidence: "reported",
    ...over,
  };
}

// Regression: a Low-severity story that happens to match several
// analyst-value keyword signals (evacuation + transport-impact language) must
// never display ABOVE a High-severity story with no such signals. Selection
// may still pick the Low item into the Top 3 on operational merit, but the
// FINAL DISPLAY ORDER must be severity-first, value-as-tiebreak-only.
describe("selectTopStoryClusters — severity-first display order", () => {
  it("never displays a Low-severity item above a High-severity item", () => {
    const lowButValueHeavy = [
      pngItem({
        id: "low-1",
        title: "Deep South police station attacked, school closed",
        summary: "Residents evacuated as flights were suspended and the airport closed after the attack.",
        severity: "low",
        severityLabel: "Low",
        severityRank: 2,
        incidentDate: new Date(base + 60 * 60 * 1000), // most recent
      }),
    ];
    const highA = [
      pngItem({
        id: "high-1",
        title: "Gunmen clash with security forces in southern province",
        severity: "high",
        severityLabel: "High",
        severityRank: 4,
        incidentDate: new Date(base - 24 * 60 * 60 * 1000),
      }),
    ];
    const highB = [
      pngItem({
        id: "high-2",
        title: "Bomb attack wounds several near provincial market",
        severity: "high",
        severityLabel: "High",
        severityRank: 4,
        incidentDate: new Date(base - 25 * 60 * 60 * 1000),
      }),
    ];

    const { top } = selectTopStoryClusters([lowButValueHeavy, highA, highB], {
      jakarta: false,
    });

    expect(top).toHaveLength(3);
    const severityOrder = top.map((c) => c[0]!.severityRank);
    // Every High (rank 4) must appear before the Low (rank 2) — the ranks
    // must be non-increasing across the displayed list.
    for (let i = 1; i < severityOrder.length; i++) {
      expect(severityOrder[i]).toBeLessThanOrEqual(severityOrder[i - 1]!);
    }
    expect(top[top.length - 1]![0]!.id).toBe("low-1");
  });

  it("still uses analyst value to order stories within the same severity tier", () => {
    const highLowValue = [
      pngItem({
        id: "high-plain",
        title: "Assault reported in provincial town",
        severity: "high",
        severityLabel: "High",
        severityRank: 4,
        incidentDate: new Date(base - 24 * 60 * 60 * 1000),
      }),
    ];
    const highHighValue = [
      pngItem({
        id: "high-evac",
        title: "Mass evacuation ordered after deadly attack shuts down provincial airport",
        summary: "Fatalities reported as residents were evacuated and flights suspended.",
        severity: "high",
        severityLabel: "High",
        severityRank: 4,
        incidentDate: new Date(base - 25 * 60 * 60 * 1000),
      }),
    ];

    const { top } = selectTopStoryClusters([highLowValue, highHighValue], {
      jakarta: false,
    });

    expect(top[0]![0]!.id).toBe("high-evac");
  });
});
