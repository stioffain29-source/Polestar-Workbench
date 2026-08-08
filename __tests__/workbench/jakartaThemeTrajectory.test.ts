import { buildJakartaReportDataset } from "@/lib/pngReportDataset";
import { applyJakartaTopThree } from "@/lib/jakartaBrief";
import type { PngSourceIncident } from "@/lib/pngReportDataset";

const now = new Date();
const recent = new Date(now.getTime() - 86_400_000).toISOString();

const incident: PngSourceIncident = {
  id: "jakarta-protest",
  title: "Protesters rally near Monas",
  severity: "high",
  occurredAt: recent,
  country: "Indonesia",
  location: "Central Jakarta",
  summary: "Police diverted traffic near the government district.",
  source: "Test Wire",
};

describe("Jakarta consolidation retires incident-theme trajectory output", () => {
  it("keeps the approved Top 3 transform while omitting the retired Incident Details payload", () => {
    const dataset = buildJakartaReportDataset({
      windowIncidents: [incident],
      previousWindowIncidents: [],
      thirtyDay: [incident],
      ninetyDay: [incident],
      baselineWatchlist: [],
      periodLabel: "2–8 August 2026",
    });

    const transformed = applyJakartaTopThree(dataset.windowItems.slice(0, 1));
    expect(transformed[0]?.developmentTitle).toContain("Central Jakarta");
    expect(dataset.incidentThemesOverride).toBeUndefined();
    expect(dataset.jakartaTacticalBrief?.crimeEscalationWatch.crime).toContain(
      "No fresh crime-specific reporting this period",
    );
  });
});
