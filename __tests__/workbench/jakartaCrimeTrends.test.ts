import { buildJakartaCrimeEscalationWatch } from "@/lib/jakartaBrief";
import { buildJakartaCorridorStatuses } from "@/lib/jakartaCorridors";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import type { PngCategory, PngReportItem } from "@/lib/pngReportDataset";

function item(category: PngCategory, title: string, province: string | null): PngReportItem {
  return {
    id: title,
    title,
    summary: "",
    province,
    location: province,
    category,
    displayCategory: "Crime",
    businessImpact: "",
    severity: "moderate",
    severityLabel: "Moderate",
    severityRank: 3,
    reportedDate: new Date("2026-08-07T00:00:00.000Z"),
    incidentDate: null,
    occurredEarlier: false,
    occurredOutOfWindow: false,
    source: "Test",
    url: null,
    confidence: "single-source",
  };
}

function statuses() {
  return buildJakartaCorridorStatuses([
    {
      id: 1,
      topic: "flashpoint",
      title: "Robbery reported at a South Jakarta hotel",
      severity: "moderate",
      occurredAt: "2026-08-07T00:00:00.000Z",
      location: "South Jakarta",
    },
  ] as CountryFastFactsIncident[]).statuses;
}

describe("Jakarta Crime & Escalation Watch", () => {
  it("uses the approved quiet-week crime wording without fabricating an event", () => {
    const watch = buildJakartaCrimeEscalationWatch([], statuses());
    expect(watch.crime).toContain("No fresh crime-specific reporting this period");
    expect(watch.crime).toContain("standing pattern continues to apply");
  });

  it("keeps a fresh crime read tied to the actual category and place", () => {
    const watch = buildJakartaCrimeEscalationWatch(
      [item("Armed robbery / hold-up", "Robbery reported at a South Jakarta hotel", "South Jakarta")],
      statuses(),
    );
    expect(watch.crime).toContain("robbery");
    expect(watch.crime).toContain("South Jakarta");
    expect(watch.crime).toContain("hotel");
    expect(watch.escalationTriggers.trim()).not.toBe("");
  });
});
