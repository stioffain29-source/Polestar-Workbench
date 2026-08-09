import {
  assertFuelReportConsistent,
  buildFuelCanonicalFacts,
  buildFuelCanonicalSections,
  validateFuelReportConsistency,
} from "../../artifacts/workbench/src/lib/fuelCanonicalFacts";
import { buildFuelGulfChokepointWatch } from "../../artifacts/workbench/src/lib/fuelNarratives";
import type { TopicFastFactsIncident } from "../../artifacts/workbench/src/lib/topicFastFacts";

const ISSUE_DATE = "2031-03-31";

function incident(
  id: number,
  country: string,
  date: string,
  severity: string,
  extra: Record<string, unknown> = {},
): TopicFastFactsIncident {
  return {
    id,
    topic: "fuel",
    title: `Fuel shortage disrupts tanker supply near Strait of Hormuz in ${country} ${id}`,
    summary: "Confirmed fuel shortage and tanker disruption.",
    country,
    location: `Terminal ${id} in ${country}`,
    severity,
    occurredAt: `${date}T12:00:00Z`,
    sourceUrl: `https://example.test/${id}`,
    ...extra,
  } as TopicFastFactsIncident;
}

function facts(rows: TopicFastFactsIncident[], change = "+2.0% 7d") {
  return buildFuelCanonicalFacts({
    issueDate: ISSUE_DATE,
    incidents: rows,
    marketCards: [
      { label: "Brent", value: 80, unit: "USD/bbl", change },
      { label: "WTI", value: 75, unit: "USD/bbl", change },
    ],
    watchIndicators: ["allocation cuts"],
  });
}

describe("Fuel Watch canonical facts parameterized properties", () => {
  it.each([
    ["+4.0% 7d", "rising"],
    ["-4.0% 7d", "falling"],
    ["0.0% 7d", "unchanged"],
    ["+0.3% 7d", "broadly stable"],
    ["-0.3% 7d", "broadly stable"],
  ])("maps %s to %s without fixed market values", (change, expected) => {
    expect(facts([], change).marketIndicators[0].direction).toBe(expected);
  });

  it.each([
    ["Iran", "Saudi Arabia"],
    ["Saudi Arabia", "Iran"],
    ["Oman", "UAE"],
  ])("changing the leading country updates every analytical section (%s)", (leader, other) => {
    const model = facts([
      incident(1, leader, "2031-03-29", "high"),
      incident(2, leader, "2031-03-30", "moderate"),
      incident(3, other, "2031-03-31", "low"),
    ]);
    const sections = buildFuelCanonicalSections(model);
    expect(model.primaryPressurePoint.label).toBe(leader);
    for (const section of [sections.executiveSummary, sections.situation, sections.regionalHighlights, sections.whatMatters, sections.polestarView]) {
      expect(section).toContain(leader);
    }
    expect(validateFuelReportConsistency(model, sections)).toEqual([]);
  });

  it("quantity and date changes reconcile counts and distinct days for randomized inputs", () => {
    // Deterministic pseudo-random generation makes this a property test that
    // varies quantities and days without tying behaviour to a live dataset.
    let seed = 17;
    const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let run = 0; run < 24; run++) {
      const count = 1 + Math.floor(random() * 12);
      const rows = Array.from({ length: count }, (_, n) => incident(
        n + 1,
        ["Iran", "Saudi Arabia", "Oman", "UAE"][Math.floor(random() * 4)],
        `2031-03-${String(25 + Math.floor(random() * 6)).padStart(2, "0")}`,
        ["low", "moderate", "high"][Math.floor(random() * 3)],
      ));
      const model = facts(rows);
      expect(model.incidentCount).toBe(rows.length);
      expect(model.distinctIncidentDates.length).toBe(new Set(rows.map((r) => r.occurredAt.slice(0, 10))).size);
      expect(Object.values(model.severityDistribution).reduce((a, b) => a + b, 0)).toBe(rows.length);
      expect(model.countries.reduce((a, b) => a + b.count, 0)).toBe(rows.length);
    }
  });

  it.each(["Low", "Moderate", "High", "Extreme"])('changing severity to %s updates every core section', (severity) => {
    const model = facts([incident(1, "Iran", "2031-03-30", severity)]);
    const sections = buildFuelCanonicalSections(model);
    for (const section of [sections.executiveSummary, sections.situation, sections.regionalHighlights, sections.whatMatters, sections.polestarView]) {
      expect(section).toContain(`Overall severity: ${severity}`);
    }
  });

  it("location changes do not alter actor, operator, or asset entity fields", () => {
    const base = incident(1, "Iran", "2031-03-30", "high", {
      actor: "Actor A", vesselOperator: "Operator A", vesselFlag: "Flag A", vesselOwner: "Owner A",
    });
    const moved = { ...base, location: "Different physical terminal" };
    const a = facts([base]).qualifyingIncidents[0];
    const b = facts([moved]).qualifyingIncidents[0];
    expect(b.physicalLocation).not.toBe(a.physicalLocation);
    expect(b.entities).toEqual(a.entities);
  });

  it("claimant changes do not change vessel flag or physical location", () => {
    const base = incident(1, "Iran", "2031-03-30", "high", { claimant: "Claimant A", vesselFlag: "Flag A" });
    const changed = { ...base, claimant: "Claimant B" } as unknown as TopicFastFactsIncident;
    const a = facts([base]).qualifyingIncidents[0];
    const b = facts([changed]).qualifyingIncidents[0];
    expect(b.entities.claimant).toBe("Claimant B");
    expect(b.entities.vesselFlag).toBe(a.entities.vesselFlag);
    expect(b.physicalLocation).toBe(a.physicalLocation);
  });

  it("potential conditions remain Watch Next until qualifying current evidence exists", () => {
    const potential = incident(1, "Iran", "2031-03-30", "moderate", {
      title: "Fuel allocation cuts may be introduced", summary: "Potential allocation cuts if disruption worsens.",
    });
    const model = facts([potential]);
    const sections = buildFuelCanonicalSections(model);
    expect(model.currentConditions).toHaveLength(0);
    expect(sections.watchNext).toContain("Potential: allocation cuts");
    expect(sections.situation).toContain(
      `Current, non-potential evidence covers 0 of the reporting period's ${model.incidentCount} qualifying incidents`,
    );
  });

  it("the validation gate rejects generated-section attempts to override canonical facts", () => {
    const model = facts([incident(1, "Iran", "2031-03-30", "high")], "-4.0% 7d");
    const sections = buildFuelCanonicalSections(model);
    const bad = { ...sections, situation: "Current, non-potential evidence covers 99 of the reporting period's 99 qualifying incidents. Iran is the primary pressure point. Overall severity: High.", whatMatters: "What Matters: Iran is the primary pressure point. The report contains 99 qualifying incidents. Overall severity: High.", polestarView: "Polestar View: Beta is the primary pressure point. Overall severity: Low. Brent is rising." };
    const errors = validateFuelReportConsistency(model, bad);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: "polestarView", canonicalValue: "Iran", sourceField: "primaryPressurePoint.label" }),
      expect.objectContaining({ section: "polestarView", canonicalValue: "High", sourceField: "overallSeverity" }),
      expect.objectContaining({ section: "polestarView", canonicalValue: "falling", sourceField: "marketIndicators.Brent.direction" }),
      expect.objectContaining({ section: "whatMatters", canonicalValue: "1", sourceField: "incidentCount" }),
      expect.objectContaining({ section: "situation", canonicalValue: "1", sourceField: "currentConditions" }),
    ]));
  });

  it("keeps Chokepoint Watch counts bounded by canonical incidentCount across randomized datasets", () => {
    let seed = 71;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let run = 0; run < 24; run++) {
      const count = 1 + Math.floor(random() * 16);
      const rows = Array.from({ length: count }, (_, n) => {
        const row = incident(
          n + 1,
          ["Iran", "Saudi Arabia", "Oman", "UAE"][Math.floor(random() * 4)],
          `2031-03-${String(25 + Math.floor(random() * 6)).padStart(2, "0")}`,
          ["low", "moderate", "high"][Math.floor(random() * 3)],
        );
        return n === 0 || random() > 0.45
          ? row
          : { ...row, title: `Fuel shortage disrupts a local terminal in ${row.country} ${n}` };
      });
      const model = facts(rows);
      const watch = buildFuelGulfChokepointWatch({
        issueDate: ISSUE_DATE,
        incidents: [],
        qualifyingIncidents: model.qualifyingIncidents,
      });
      const statedCount = watch?.read.match(/(\d+)\s+distinct chokepoint incidents?/i)?.[1];
      if (statedCount !== undefined) expect(Number(statedCount)).toBeLessThanOrEqual(model.incidentCount);
      expect(watch?.currentItems.length ?? 0).toBeLessThanOrEqual(model.incidentCount);
    }
  });

  it("reports and throws a specific error when Chokepoint Watch exceeds the canonical total", () => {
    const model = facts([incident(1, "Iran", "2031-03-30", "high")]);
    const sections = {
      ...buildFuelCanonicalSections(model),
      gulfAndHormuzChokepointWatch:
        "99 distinct chokepoint incidents were logged across 1 separate day in the window.",
    };
    expect(validateFuelReportConsistency(model, sections)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        section: "Gulf and Hormuz Chokepoint Watch",
        conflictingStatement: "99 distinct chokepoint incidents",
        canonicalValue: "<= 1",
        sourceField: "incidentCount",
      }),
    ]));
    expect(() => assertFuelReportConsistent(model, sections)).toThrow(
      "Gulf and Hormuz Chokepoint Watch: 99 distinct chokepoint incidents | canonical=<= 1 | field=incidentCount",
    );
  });
});
