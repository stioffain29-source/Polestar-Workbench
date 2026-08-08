import {
  buildJakartaCrimeEscalationWatch,
  buildJakartaOperatingPicture,
  buildJakartaRecommendedActions,
} from "@/lib/jakartaBrief";
import { buildJakartaCorridorStatuses } from "@/lib/jakartaCorridors";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";
import type { PngCategory, PngReportItem } from "@/lib/pngReportDataset";

function corridorStatuses(rows: Array<Partial<CountryFastFactsIncident>>) {
  return buildJakartaCorridorStatuses(
    rows.map((row, i) => ({
      id: i + 1,
      topic: "flashpoint",
      title: "Jakarta incident",
      severity: "moderate",
      occurredAt: "2026-08-07T08:00:00.000Z",
      country: "Indonesia",
      location: null,
      ...row,
    })) as CountryFastFactsIncident[],
  ).statuses;
}

function item(overrides: Partial<PngReportItem> = {}): PngReportItem {
  return {
    id: "crime-1",
    title: "Robbery reported near a South Jakarta hotel",
    summary: "Staff should use pre-booked transport after the incident.",
    province: "South Jakarta",
    location: "South Jakarta",
    category: "Armed robbery / hold-up" as PngCategory,
    displayCategory: "Crime",
    businessImpact: "Use booked transport after hours.",
    severity: "moderate",
    severityLabel: "Moderate",
    severityRank: 3,
    reportedDate: new Date("2026-08-07T00:00:00.000Z"),
    incidentDate: null,
    occurredEarlier: false,
    occurredOutOfWindow: false,
    source: "Test Wire",
    url: null,
    confidence: "single-source",
    ...overrides,
  };
}

describe("Jakarta consolidated weekly brief builders", () => {
  it("builds one operating table from real drivers and excludes quiet corridors", () => {
    const statuses = corridorStatuses([
      {
        title: "Protesters rally near Monas and police divert traffic",
        location: "Central Jakarta",
        severity: "high",
      },
      {
        title: "Flooding delays container access roads at Tanjung Priok",
        location: "North Jakarta",
        severity: "moderate",
      },
    ]);

    const picture = buildJakartaOperatingPicture(statuses);
    expect(picture.rows.map((row) => row.area)).toEqual([
      "Central Jakarta government district",
      "North Jakarta & port area",
    ]);
    expect(picture.rows.map((row) => row.driver)).toEqual([
      "Protest",
      "Flooding / heavy rain",
    ]);
    expect(picture.rows.some((row) => row.area === "Main commercial & hotel areas")).toBe(false);
    for (const row of picture.rows) {
      expect(row.impact.trim()).not.toBe("");
      expect(row.action.trim()).not.toBe("");
    }
  });

  it("renders a sparse week honestly without an empty table or action list", () => {
    const statuses = corridorStatuses([]);
    const picture = buildJakartaOperatingPicture(statuses);
    const watch = buildJakartaCrimeEscalationWatch([], statuses);
    const actions = buildJakartaRecommendedActions(statuses, []);

    expect(picture.rows).toEqual([]);
    expect(picture.emptyNote).toContain("No area-specific operational driver");
    expect(watch.crime).toContain("No fresh crime-specific reporting this period");
    expect(watch.escalationTriggers.trim()).not.toBe("");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThanOrEqual(5);
    expect(actions.every((action) => action.trim().length > 0)).toBe(true);
  });

  it("keeps the crime judgment grounded in fresh crime reporting and never emits empty bullets", () => {
    const statuses = corridorStatuses([
      {
        title: "Armed robbery reported near a South Jakarta hotel",
        location: "South Jakarta",
        severity: "moderate",
      },
    ]);
    const watch = buildJakartaCrimeEscalationWatch([item()], statuses);
    const actions = buildJakartaRecommendedActions(statuses, [item()]);

    expect(watch.crime).toContain("not a city-wide deterioration");
    expect(watch.crime).toContain("robbery");
    expect(watch.crime).not.toContain("No fresh crime-specific reporting");
    expect(actions).toHaveLength(new Set(actions.map((action) => action.toLowerCase())).size);
    expect(actions.every((action) => action.trim().length > 0)).toBe(true);
  });
});
