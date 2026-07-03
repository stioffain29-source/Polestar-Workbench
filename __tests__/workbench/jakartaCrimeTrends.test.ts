import { buildJakartaCrimeTrends } from "@/lib/jakartaBrief";
import type { PngReportItem, PngCategory } from "@/lib/pngReportDataset";

// Minimal PngReportItem factory — only the fields the crime-trends builder reads
// (category, and the title/location fed to presentAreas) need to be meaningful.
function item(overrides: Partial<PngReportItem> = {}): PngReportItem {
  return {
    id: "1",
    title: "Test incident",
    summary: "",
    province: null,
    location: null,
    category: "Theft / break-in" as PngCategory,
    displayCategory: "Crime",
    businessImpact: "",
    severity: "moderate",
    severityLabel: "Moderate",
    severityRank: 3,
    reportedDate: new Date("2026-06-01T00:00:00Z"),
    incidentDate: null,
    occurredEarlier: false,
    source: "Test",
    url: null,
    confidence: "single-source",
    ...overrides,
  };
}

describe("buildJakartaCrimeTrends", () => {
  it("always surfaces the curated standing profile and business-impact table", () => {
    const trends = buildJakartaCrimeTrends([]);
    expect(typeof trends.standingPattern).toBe("string");
    expect(trends.standingPattern.length).toBeGreaterThan(0);
    expect(trends.standingPattern).toContain("opportunistic and property crime");
    expect(Array.isArray(trends.businessImpact)).toBe(true);
    expect(trends.businessImpact.length).toBeGreaterThan(0);
    for (const row of trends.businessImpact) {
      expect(row.context.length).toBeGreaterThan(0);
      expect(row.exposure.length).toBeGreaterThan(0);
      expect(row.precaution.length).toBeGreaterThan(0);
    }
  });

  it("standing exposure rows are keyed to named operating contexts", () => {
    const trends = buildJakartaCrimeTrends([]);
    const contexts = trends.businessImpact.map((r) => r.context).join(" | ");
    // Each durable row must tie crime to a named business activity/location, not
    // a generic crime label.
    expect(contexts).toContain("Staff movement");
    expect(contexts).toContain("Hotels and client meetings");
    expect(contexts).toContain("Airport transfers");
    expect(contexts).toContain("Port access and logistics");
    expect(contexts).toContain("Cross-city logistics routes");
  });

  it("no-crime branch: falls back to the standing pattern without inventing crime", () => {
    // A non-crime item (protest) must NOT trigger the this-period crime read.
    const trends = buildJakartaCrimeTrends([
      item({ category: "Civil unrest / protest" as PngCategory }),
    ]);
    expect(trends.reportedThisPeriod).toContain(
      "No fresh crime-specific reporting",
    );
    expect(trends.trendRead).toContain("standing pattern");
    expect(trends.reportedThisPeriod).not.toContain(
      "This period's open-source reporting featured",
    );
  });

  it("crime-present branch: leads with the period's reported crime and names the real incident", () => {
    const trends = buildJakartaCrimeTrends([
      item({
        category: "Theft / break-in" as PngCategory,
        title: "Pickpocketing reported near Thamrin",
      }),
    ]);
    expect(trends.reportedThisPeriod).toContain(
      "This period's open-source reporting featured",
    );
    expect(trends.reportedThisPeriod).toContain("theft");
    // The read must name the ACTUAL worst incident, not a generic essay.
    expect(trends.reportedThisPeriod).toContain(
      "The most serious reported was Pickpocketing reported near Thamrin",
    );
    expect(trends.reportedThisPeriod).toContain("assessed as Moderate severity");
    expect(trends.reportedThisPeriod).toContain("For business,");
    expect(trends.reportedThisPeriod).toContain("partial signal");
    // The old curated central-district boilerplate must never reappear.
    expect(trends.reportedThisPeriod).not.toContain("SCBD");
    expect(trends.reportedThisPeriod).not.toContain(
      "No fresh crime-specific reporting",
    );
  });

  it("names a setting (e.g. a transport hub) only when the reporting actually carries one", () => {
    const withHub = buildJakartaCrimeTrends([
      item({
        category: "Robbery / hold-up" as PngCategory,
        title: "Robbery reported at a bus terminal",
      }),
    ]);
    // "terminal" in the source text -> "transport hubs" surfaces from data.
    expect(withHub.reportedThisPeriod).toContain("transport hubs");

    const withoutHub = buildJakartaCrimeTrends([
      item({
        category: "Theft / break-in" as PngCategory,
        title: "Pickpocketing reported near Thamrin",
      }),
    ]);
    // No hub in the source text -> the read must NOT invent one.
    expect(withoutHub.reportedThisPeriod).not.toContain("transport hubs");
  });

  it("violent crime names the actual incident, not a curated-district consequence", () => {
    const trends = buildJakartaCrimeTrends([
      item({
        category: "Homicide / violent crime" as PngCategory,
        title: "Stabbing in a late-night brawl reported in South Jakarta",
      }),
    ]);
    expect(trends.reportedThisPeriod).toContain("For business,");
    expect(trends.reportedThisPeriod).toContain(
      "The most serious reported was Stabbing in a late-night brawl reported in South Jakarta",
    );
    expect(trends.reportedThisPeriod).not.toContain("SCBD");
    expect(trends.reportedThisPeriod).not.toContain("Tanjung Priok");
  });
});
