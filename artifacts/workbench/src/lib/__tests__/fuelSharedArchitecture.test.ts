import {
  buildFuelCanonicalFacts,
  buildFuelCanonicalSections,
  buildFuelEvidenceLedger,
} from "../fuelCanonicalFacts";
import { auditFinalReportEvidence } from "../finalReportEvidenceAudit";
import { finalizeFuelPublication } from "../fuelWatchReport";
import type { TopicFastFactsIncident } from "../topicFastFacts";

const ISSUE = "2026-08-05";
function incident(id: number, title: string, over: Partial<TopicFastFactsIncident> = {}): TopicFastFactsIncident {
  return {
    id,
    topic: "fuel",
    title,
    summary: "A depot outage interrupted diesel deliveries in Port Alpha.",
    country: "Exampleland",
    location: "Port Alpha",
    severity: "moderate",
    occurredAt: "2026-08-03T10:00:00Z",
    source: `Source ${id}`,
    ...over,
  };
}

describe("Fuel shared publication architecture", () => {
  it("clusters syndicated and follow-on coverage with bounded family weight", () => {
    const first = incident(1, "Depot outage interrupts diesel deliveries at Port Alpha");
    const syndicated = incident(2, "Diesel deliveries interrupted after Port Alpha depot outage");
    const followOn = incident(3, "Update: Port Alpha depot outage interrupts diesel deliveries") as TopicFastFactsIncident & { coverageType: string };
    followOn.coverageType = "follow-on";
    const ledger = buildFuelEvidenceLedger([first, syndicated, followOn]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].members.map((member) => member.kind).sort()).toEqual(
      ["canonical", "follow-on", "syndicated"].sort(),
    );
    expect(ledger[0].weight).toBeGreaterThan(1);
    expect(ledger[0].weight).toBeLessThanOrEqual(1.75);
  });

  it("chooses a non-Potential family representative over a higher-scoring Potential row", () => {
    const reported = incident(11, "Port Alpha depot outage interrupts diesel deliveries", {
      severity: "low",
      evidenceStatus: "Reported",
    } as Partial<TopicFastFactsIncident> & { evidenceStatus: string });
    const potential = incident(12, "Port Alpha depot outage interrupts diesel deliveries", {
      severity: "extreme",
      evidenceStatus: "Potential",
    } as Partial<TopicFastFactsIncident> & { evidenceStatus: string });
    const ledger = buildFuelEvidenceLedger([potential, reported]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].canonicalRecord.id).toBe(11);
  });

  it("excludes out-of-window incidents and treats stale market observations as context", () => {
    const facts = buildFuelCanonicalFacts({
      issueDate: ISSUE,
      incidents: [
        incident(1, "Current depot outage"),
        incident(2, "Old depot outage", { occurredAt: "2026-07-20T10:00:00Z" }),
      ],
      marketCards: [{
        label: "Brent crude",
        value: 80,
        unit: "USD/bbl",
        asOf: "2026-07-20",
        change: "-2% 7d",
      }],
    });
    expect(facts.qualifyingIncidents.map((row) => row.id)).toEqual(["1"]);
    expect(facts.marketIndicators[0]).toMatchObject({
      temporalStatus: "lagged",
      comparisonScope: "undated-reference",
      referenceDate: null,
    });
    const currentUndatedFacts = buildFuelCanonicalFacts({
      issueDate: ISSUE,
      incidents: [incident(1, "Current depot outage")],
      marketCards: [{
        label: "Brent crude",
        value: 104.61,
        unit: "USD/bbl",
        asOf: "2026-08-05",
        change: "+8.7% 7d",
      }],
    });
    expect(buildFuelCanonicalSections(currentUndatedFacts).marketRead).toContain(
      "no dated reference was provided",
    );
    expect(buildFuelCanonicalSections(currentUndatedFacts).marketRead).not.toContain(
      "a undated reference with no date",
    );
  });

  it("rejects taxonomy leakage, untyped watches and unsupported deterministic causation", () => {
    const issues = auditFinalReportEvidence({
      topic: "fuel",
      issueDate: ISSUE,
      window: { start: "2026-07-30", end: ISSUE },
      evidence: [{
        id: 1,
        title: "Depot outage",
        summary: "A depot outage was reported.",
        occurredAt: "2026-08-03",
        supportedClaims: [],
      }],
      sections: {
        situation: "The dataset shows the outage forced shortages.",
        watchNext: "Monitor an unrelated refinery restart.",
      },
      validatedForwardIndicators: [],
      typedReferences: [{
        id: "development-1",
        type: "development",
        text: "Depot outage",
        evidenceId: 1,
      }],
    });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "BACKEND_CONFIDENCE_LEAK",
      "UNSUPPORTED_CAUSAL_CLAIM",
      "WATCH_NEXT_UNGROUNDED",
    ]));
  });

  it("returns byte-equivalent final section inputs for repeated preview/PDF finalization", () => {
    const report = { issueDate: ISSUE, hardNumbers: { prices: [] } };
    const incidents = [incident(1, "Depot outage interrupts diesel deliveries at Port Alpha")];
    const preview = finalizeFuelPublication({ report, incidents });
    const pdf = finalizeFuelPublication({ report, incidents });
    expect(JSON.stringify(preview.effectiveSections)).toBe(JSON.stringify(pdf.effectiveSections));
    expect(JSON.stringify(preview.canonicalFacts)).toBe(JSON.stringify(pdf.canonicalFacts));
  });

  it("does not promote evergreen Watch Next defaults into validated evidence", () => {
    const report = { issueDate: ISSUE, hardNumbers: { prices: [] } };
    const result = finalizeFuelPublication({
      report,
      incidents: [incident(1, "Depot outage interrupts diesel deliveries at Port Alpha")],
    });

    expect(result.canonicalFacts.watchIndicators).toEqual([
      result.canonicalFacts.judgement.trigger,
    ]);
    expect(result.effectiveSections.watchNext).not.toMatch(
      /subsidy or levy decisions|refinery outages or force-majeure|tanker and route disruption/i,
    );
    expect(result.effectiveSections.watchNext).not.toMatch(
      /Follow-up confirmation for/i,
    );
    expect(result.effectiveSections.watchNext).toMatch(/^[A-Z]/);
  });

  it("keeps potential-only themes out of current deterministic sections", () => {
    const report = { issueDate: ISSUE, hardNumbers: { prices: [] } };
    const result = finalizeFuelPublication({
      report,
      incidents: [
        incident(1, "Depot outage interrupts diesel deliveries at Port Alpha"),
        incident(2, "Potential ship-fuel shortage in India", {
          country: "India",
          summary: "A possible shortage may affect ship fuel.",
        }),
      ],
    });
    expect(result.effectiveSections.whatHappened).not.toMatch(/India|ship-fuel shortage/i);
    expect(result.effectiveSections.watchNext).not.toMatch(/India|ship-fuel shortage/i);
    expect(result.canonicalFacts.generationBasisFingerprint).toBeTruthy();
  });

  it("changes Fuel generation basis when the canonical selected evidence changes", () => {
    const first = finalizeFuelPublication({
      report: { issueDate: ISSUE, hardNumbers: { prices: [] } },
      incidents: [incident(1, "Depot outage interrupts diesel deliveries at Port Alpha")],
    });
    const second = finalizeFuelPublication({
      report: { issueDate: ISSUE, hardNumbers: { prices: [] } },
      incidents: [
        incident(1, "Depot outage interrupts diesel deliveries at Port Alpha"),
        incident(9, "Refinery shutdown affects product supply at Port Alpha"),
      ],
    });
    expect(first.reportData.generationBasisFingerprint).not.toBe(
      second.reportData.generationBasisFingerprint,
    );
  });
});