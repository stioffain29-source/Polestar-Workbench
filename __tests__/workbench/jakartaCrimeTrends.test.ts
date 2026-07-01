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
      "Open-source reporting this period featured",
    );
  });

  it("crime-present branch: reports the period's crime signal from crime-theme items", () => {
    const trends = buildJakartaCrimeTrends([
      item({
        category: "Theft / break-in" as PngCategory,
        title: "Pickpocketing reported near Thamrin",
      }),
    ]);
    expect(trends.reportedThisPeriod).toContain(
      "Open-source reporting this period featured",
    );
    expect(trends.reportedThisPeriod).toContain("partial signal");
    expect(trends.reportedThisPeriod).not.toContain(
      "No fresh crime-specific reporting",
    );
  });
});
