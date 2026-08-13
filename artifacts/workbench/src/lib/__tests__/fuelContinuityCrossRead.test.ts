/**
 * Fuel qualifying-set cross-read: shipping-topic kinetic chokepoint events and
 * energy-topic fuel-to-power continuity failures qualify into Fuel Watch,
 * bounded, syndication-collapsed and precision-gated — and the report's
 * consistency gate stays green when they do (reportFacts must count the SAME
 * universe as canonicalFacts).
 */
import { filterFuelContinuityCrossRead } from "../fuelNarratives";
import { buildFuelWatchReportData } from "../fuelWatchReport";
import type { TopicFastFactsIncident } from "../topicFastFacts";

const ISSUE = "2026-08-13";
let seq = 0;
function inc(over: Partial<TopicFastFactsIncident> & { title: string; topic: string }): TopicFastFactsIncident {
  seq += 1;
  return {
    id: String(seq),
    occurredAt: "2026-08-12T08:00:00+00:00",
    summary: null,
    severity: "high",
    country: "Yemen",
    location: null,
    source: "Test Wire",
    sourceUrl: `https://example.com/${seq}`,
    ...over,
  } as TopicFastFactsIncident;
}

describe("filterFuelContinuityCrossRead", () => {
  it("admits a kinetic chokepoint shipping event and a load-shedding energy event", () => {
    const rows = [
      inc({ topic: "shipping", title: "Houthi missile attack strikes container ship in Gulf of Oman off Pakistan", country: "Pakistan" }),
      inc({ topic: "energy", title: "Gas shortage intensifies load shedding in Chittagong", country: "Bangladesh", severity: "moderate" }),
    ];
    const out = filterFuelContinuityCrossRead(rows, ISSUE, []);
    expect(out.map((i) => i.topic).sort()).toEqual(["energy", "shipping"]);
  });

  it("rejects shipping rows without a chokepoint or without a kinetic verb", () => {
    const rows = [
      inc({ topic: "shipping", title: "Missile strike reported on cargo vessel near Durban" }), // kinetic, no chokepoint
      inc({ topic: "shipping", title: "Freight rates through the Strait of Hormuz tick higher" }), // chokepoint, no kinetic
    ];
    expect(filterFuelContinuityCrossRead(rows, ISSUE, [])).toHaveLength(0);
  });

  it("rejects ordinary grid outages and service-guide explainers", () => {
    const rows = [
      inc({ topic: "energy", title: "Storm damage causes power cuts across the region" }),
      inc({ topic: "energy", title: "High EB bill? Power cut? Here's your complete guide to TNPDCL services and load-shedding" }),
    ];
    expect(filterFuelContinuityCrossRead(rows, ISSUE, [])).toHaveLength(0);
  });

  it("collapses syndicated rewrites of the same chokepoint strike to one row", () => {
    const rows = [
      inc({ topic: "shipping", title: "Three Killed in Houthi Missile Strike Near Bab al-Mandab" }),
      inc({ topic: "shipping", title: "Houthi missile strike near Bab el-Mandeb kills three crew" }),
      inc({ topic: "shipping", title: "Death toll rises after Houthi missile attack in Bab el-Mandeb strait" }),
    ];
    expect(filterFuelContinuityCrossRead(rows, ISSUE, [])).toHaveLength(1);
  });

  it("does not double-count a story the fuel window already carries", () => {
    const fuelRow = inc({ topic: "fuel", title: "Houthi missile strike on tanker near Bab el-Mandeb disrupts fuel shipments" });
    const rows = [
      inc({ topic: "shipping", title: "Houthi missile strike hits tanker near Bab el-Mandeb" }),
    ];
    expect(filterFuelContinuityCrossRead(rows, ISSUE, [fuelRow])).toHaveLength(0);
  });
});

describe("cross-read rows keep the consistency gate green", () => {
  it("a report whose only window events are cross-read admits validates cleanly", () => {
    const rows = [
      inc({ topic: "shipping", title: "Houthi missile attack strikes container ship in Gulf of Oman off Pakistan", country: "Pakistan" }),
      inc({ topic: "energy", title: "Gas shortage intensifies load shedding in Chittagong", country: "Bangladesh", severity: "moderate", occurredAt: "2026-08-11T08:00:00+00:00" }),
    ];
    const data = buildFuelWatchReportData(
      { issueDate: ISSUE, hardNumbers: null } as never,
      rows as never,
    );
    expect(data.canonicalFacts.incidentCount).toBe(2);
    expect(data.validation.consistencyErrors).toEqual([]);
    // reportFacts (AI FIXED FACTS + gate authority) counts the same universe.
    expect(data.reportFacts.incidentCount).toBe(2);
    expect(data.reportFacts.distinctDates).toHaveLength(2);
  });
});
