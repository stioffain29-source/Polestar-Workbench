import {
  buildFuelCanonicalFacts,
  type FuelCanonicalFacts,
} from "../../artifacts/workbench/src/lib/fuelCanonicalFacts";
import {
  buildFuelCoverageSummary,
  type FuelCoverageSummary,
} from "../../artifacts/workbench/src/lib/fuelCoverage";
import { selectRelatedIncidents } from "../../artifacts/workbench/src/lib/relatedIncidents";
import { makeSectionGate, topicSectionKeys } from "../../artifacts/workbench/src/lib/topicSectionOverrides";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";

const ISSUE_DATE = "2031-04-07";

function incident(
  id: number,
  title: string,
  country: string,
  occurredAt: string,
  severity = "moderate",
  sourceUrl = `https://example.test/fuel/${id}`,
): TopicFastFactsIncident {
  return {
    id,
    topic: "fuel",
    title,
    summary: `${title} was reported in ${country}.`,
    severity,
    occurredAt,
    country,
    location: country,
    source: "Example News",
    sourceUrl,
  };
}

function canonicalFacts(): FuelCanonicalFacts {
  const records = [
    incident(1, "Fuel shortage in Iran", "Iran", "2031-04-01", "high"),
    incident(2, "Refinery disruption in Iran", "Iran", "2031-04-02", "moderate"),
    incident(3, "Depot fire in Oman", "Oman", "2031-04-02", "high"),
    incident(4, "Supply interruption in Qatar", "Qatar", "2031-04-05", "low"),
    incident(5, "Fuel price increase in Bahrain", "Bahrain", "2031-04-05", "moderate"),
    incident(6, "Transport disruption in Kuwait", "Kuwait", "2031-04-05", "moderate"),
    incident(7, "Fuel shortage after protest in Iraq", "Iraq", "2031-04-06", "high"),
    incident(8, "Fuel shortage in Jordan", "Jordan", "2031-04-07", "extreme"),
    // Same evidence family as row 1: same title, date and source URL.
    incident(9, "Fuel shortage in Iran", "Iran", "2031-04-01", "high", "https://example.test/fuel/1"),
    // Outside the weekly window; it must not enter canonical facts or coverage.
    incident(10, "Fuel shortage in Saudi Arabia", "Saudi Arabia", "2031-03-20", "high"),
  ];

  return buildFuelCanonicalFacts({
    issueDate: ISSUE_DATE,
    incidents: records,
    qualifyingIncidents: records,
    marketCards: [],
    window: { start: "2031-04-01", end: ISSUE_DATE },
  });
}

describe("Fuel Watch reporting-period coverage", () => {
  it("does not let a null maritime semantic field erase Fuel geography", () => {
    const facts = buildFuelCanonicalFacts({
      issueDate: "2026-09-13",
      incidents: [],
      qualifyingIncidents: [
        {
          id: 901,
          topic: "fuel",
          title: "Russia restricts aircraft refuelling at 26 airports",
          summary: "Fuel access restrictions remain in force in Russia.",
          country: "Russia",
          location: null,
          maritimeSemantic: null,
          severity: "moderate",
          occurredAt: "2026-09-11T09:18:00.000Z",
        },
      ],
      marketCards: [],
      window: { start: "2026-09-07", end: "2026-09-13" },
    });

    const coverage = buildFuelCoverageSummary(facts);
    expect(coverage.affectedCountries).toEqual([
      expect.objectContaining({ country: "Russia", count: 1 }),
    ]);
    expect(
      coverage.affectedCountries.some((row) => row.country === "Unattributed"),
    ).toBe(false);
  });

  it("registers Related Incidents in Fuel editor controls and honors its hide gate", () => {
    expect(topicSectionKeys("fuel")).toEqual(
      expect.arrayContaining([{ key: "related-incidents", label: "Related Incidents" }]),
    );
    expect(makeSectionGate(["related-incidents"])("related-incidents")).toBe(false);
    expect(makeSectionGate([])("related-incidents")).toBe(true);
  });

  it("counts canonical developments after date scope and evidence-family dedupe", () => {
    const facts = canonicalFacts();
    const coverage: FuelCoverageSummary = buildFuelCoverageSummary(facts);

    expect(facts.qualifyingIncidents).toHaveLength(8);
    expect(coverage.totalDistinctDevelopments).toBe(8);
    expect(coverage.dailyTrend.reduce((sum, day) => sum + day.count, 0)).toBe(8);
    expect(coverage.dailyTrend).toHaveLength(7);
    expect(coverage.dailyTrend.find((day) => day.date === "2031-04-04")?.count).toBe(0);
    expect(coverage.dailyTrend.map((day) => day.date)).not.toContain("2031-03-20");
    expect(coverage.severityDistribution.Extreme).toBe(1);
    expect(coverage.severityDistribution.High).toBe(3);
    expect(coverage.severityDistribution.Moderate).toBe(3);
    expect(coverage.severityDistribution.Low).toBe(1);
  });

  it("sorts all affected countries by count and retains each country's severity profile", () => {
    const coverage = buildFuelCoverageSummary(canonicalFacts());

    expect(coverage.activeCountries).toBe(7);
    expect(coverage.affectedCountries[0]).toEqual(
      expect.objectContaining({
        country: "Iran",
        count: 2,
        highestSeverity: "High",
      }),
    );
    expect(coverage.affectedCountries.map((row) => row.country)).toContain("Jordan");
    expect(coverage.affectedCountries.find((row) => row.country === "Jordan")?.highestSeverity).toBe("Extreme");
  });

  it("shows unassigned developments explicitly without counting them as active countries", () => {
    const known = canonicalFacts().qualifyingIncidents.map((record) => record.raw);
    const unassigned = [
      "Refinery fire",
      "Pipeline explosion",
      "Depot outage",
      "Fuel spill",
      "Terminal shutdown",
      "Supply blockade",
    ].map((title, index) => ({
      ...incident(100 + index, title, "", `2031-04-0${index + 1}`, "moderate"),
      country: null,
      location: null,
    }));
    const facts = buildFuelCanonicalFacts({
      issueDate: ISSUE_DATE,
      incidents: [...known, ...unassigned],
      qualifyingIncidents: [...known, ...unassigned],
      marketCards: [],
      window: { start: "2031-04-01", end: ISSUE_DATE },
    });
    const coverage = buildFuelCoverageSummary(facts);
    const listedDevelopments = coverage.affectedCountries.reduce((sum, row) => sum + row.count, 0);

    expect(coverage.affectedCountries.find((row) => row.country === "Unattributed")?.count).toBe(6);
    expect(coverage.activeCountries).toBe(7);
    expect(listedDevelopments).toBe(coverage.totalDistinctDevelopments);
  });

  it("allows eight qualifying Fuel rows through the shared selector", () => {
    const facts = canonicalFacts();
    const rows = selectRelatedIncidents(
      facts.qualifyingIncidents.map((record) => ({
        ...record.raw,
        id: record.raw.id ?? record.id,
      })),
      "fuel",
    );

    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8]));
  });
});