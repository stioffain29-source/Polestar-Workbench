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
      expect(row.pattern.length).toBeGreaterThan(0);
      expect(row.businessImpact.length).toBeGreaterThan(0);
      expect(row.precaution.length).toBeGreaterThan(0);
    }
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

  it("crime-present branch: leads with the period's reported crime and its business consequence", () => {
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
    // Property crime must surface its concrete business consequence, not a
    // generic standing essay.
    expect(trends.reportedThisPeriod).toContain("For business,");
    expect(trends.reportedThisPeriod).toContain("property loss");
    expect(trends.reportedThisPeriod).toContain("partial signal");
    expect(trends.reportedThisPeriod).not.toContain(
      "No fresh crime-specific reporting",
    );
  });

  it("violent crime adds a distinct violence consequence clause", () => {
    const trends = buildJakartaCrimeTrends([
      item({
        category: "Homicide / violent crime" as PngCategory,
        title: "Stabbing in a late-night brawl reported in South Jakarta",
      }),
    ]);
    expect(trends.reportedThisPeriod).toContain("For business,");
    expect(trends.reportedThisPeriod).toContain("risk of violence");
  });
});
