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
    expect(sections.regionalHighlights).toContain(leader);
    expect(sections.polestarView).toContain(leader);
    expect(sections.executiveSummary).not.toMatch(/\d+\s+incidents?/i);
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

  it.each(["Low", "Moderate", "High", "Extreme"])('operational severity shapes business-facing sections (%s)', (severity) => {
    const model = facts([incident(1, "Iran", "2031-03-30", severity, {
      title: "Fuel rationing spreads as forecourt queues grow",
      summary: "Confirmed petrol rationing and forecourt shortages.",
    })]);
    const sections = buildFuelCanonicalSections(model);
    expect(sections.operationalRead.toLowerCase()).toMatch(/shortage|rationing|forecourt|availability/);
    expect(sections.polestarView).not.toMatch(/overall severity:/i);
    expect(sections.executiveSummary).not.toMatch(/\d+\s+incidents?/i);
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
    const model = buildFuelCanonicalFacts({
      issueDate: ISSUE_DATE,
      incidents: [potential],
      qualifyingIncidents: [potential],
      marketCards: [
        { label: "Brent", value: 80, unit: "USD/bbl", change: "+2.0% 7d" },
        { label: "WTI", value: 75, unit: "USD/bbl", change: "+2.0% 7d" },
      ],
      watchIndicators: ["allocation cuts"],
    });
    const sections = buildFuelCanonicalSections(model);
    expect(model.currentConditions).toHaveLength(0);
    expect(sections.watchNext).toContain("allocation cuts");
    expect(sections.watchNext).not.toMatch(/^- Potential:/);
    expect(sections.situation.toLowerCase()).toMatch(/market-price|reporting|window/);
  });

  it("the validation gate rejects generated-section attempts to override canonical facts", () => {
    const model = facts([incident(1, "Iran", "2031-03-30", "high")], "-4.0% 7d");
    const sections = buildFuelCanonicalSections(model);
    const bad = {
      ...sections,
      situation: "Current, non-potential evidence covers 99 of the reporting period's 99 qualifying incidents. Iran is the primary pressure point.",
      whatMatters: "What Matters: Iran is the primary pressure point. The report contains 99 qualifying incidents.",
      polestarView: "Polestar View: Beta is the primary pressure point. Brent is rising.",
    };
    const errors = validateFuelReportConsistency(model, bad);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: "situation", sourceField: "incidentCount" }),
      expect.objectContaining({ section: "whatMatters", sourceField: "incidentCount" }),
      expect.objectContaining({ section: "polestarView", sourceField: "marketIndicators.Brent.direction" }),
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
      expect(watch?.read).not.toMatch(/\d+\s+distinct chokepoint incidents?/i);
      expect(watch?.currentItems.length ?? 0).toBeLessThanOrEqual(model.incidentCount);
    }
  });

  it("chokepoint route with extreme severity outranks high-volume country pressure", () => {
    const model = facts([
      incident(1, "Yemen", "2031-03-29", "extreme", {
        title: "Houthi strike hits tanker in Bab el-Mandeb",
        summary: "Extreme severity strike in Bab el-Mandeb corridor.",
      }),
      incident(2, "Yemen", "2031-03-30", "extreme", {
        title: "Second Bab el-Mandeb attack disrupts fuel tanker transit",
        summary: "Another Bab el-Mandeb disruption.",
      }),
      ...Array.from({ length: 8 }, (_, n) =>
        incident(n + 3, "India", `2031-03-${String(28 + (n % 3)).padStart(2, "0")}`, "moderate"),
      ),
    ]);
    expect(model.primaryPressurePoint.label).toMatch(/Bab-el-Mandeb|Yemen/);
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
