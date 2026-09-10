import {
  MARITIME_SEMANTIC_VERSION,
  countryFromPhysicalEvidence,
  hasValidatedCommercialTarget,
  isValidatedMaritimeIncident,
  maritimeEventRequiresCommercialTarget,
  validateMaritimeSemanticContract,
  type MaritimeSemanticEvidence,
} from "../../lib/relevance/src/maritimeSemantic";
import {
  maritimeContentFingerprint,
  maritimeEvidenceSnapshotMatches,
  type MaritimeIncidentSnapshot,
} from "../../lib/ingest/src/backfillMaritimeSemantic";

const SOURCE =
  "A tanker was attacked off Muscat in the Gulf of Oman. " +
  "The operator reported a two-day delay.";

function evidence(
  overrides: Partial<MaritimeSemanticEvidence> = {},
): MaritimeSemanticEvidence {
  return {
    version: MARITIME_SEMANTIC_VERSION,
    verdict: "valid",
    reason: "source reports a discrete event",
    eventOccurred: true,
    eventClass: "commercial_attack",
    commercialTargetValidated: true,
    commercialTarget: "vessel",
    commercialTargetName: "tanker",
    commercialTargetEvidence: "A tanker was attacked",
    physicalLocation: "off Muscat",
    physicalLocationEvidence: "off Muscat",
    country: "Oman",
    coastalState: "Oman",
    routeRelationship: {
      kind: "direct_passage",
      routeName: "Gulf of Oman",
      evidence: "Gulf of Oman",
    },
    routingConsequence: {
      status: "none",
      claim: null,
      evidenceQuote: null,
      confidence: 0,
      kind: "none",
      description: null,
      evidence: null,
    },
    commercialConsequence: {
      status: "confirmed",
      claim: "The operator reported a two-day delay",
      evidenceQuote: "The operator reported a two-day delay",
      confidence: 0.8,
    },
    geopolitical: { relevant: false, claim: null, evidenceQuote: null },
    eventDate: "2026-06-18",
    developmentKey: "maritime:attack:tanker:muscat:2026-06-18",
    severity: "high",
    severityJustification: "A tanker was attacked",
    severityEvidenceQuote: "A tanker was attacked",
    confidence: {
      event: 0.9,
      classification: 0.9,
      commercialTarget: 0.95,
      geography: 0.8,
      routeRelationship: 0.8,
      consequence: 0.8,
      date: 0.8,
    },
    contradictions: [],
    sourceQuotes: [
      { quote: "A tanker was attacked off Muscat", claim: "commercial attack" },
      {
        quote: "The operator reported a two-day delay",
        claim: "commercial consequence",
      },
    ],
    evidence: ["A tanker was attacked off Muscat"],
    ...overrides,
  };
}

describe("maritime semantic contract", () => {
  it("keeps military/naval shipping context out of direct incident admission", () => {
    const context = evidence({
      eventClass: "naval_activity",
      commercialTargetValidated: false,
      commercialTarget: "none",
      commercialTargetEvidence: null,
      commercialTargetName: null,
      commercialConsequence: {
        status: "none",
        claim: null,
        evidenceQuote: null,
        confidence: 0,
      },
      severity: null,
      severityJustification: null,
      severityEvidenceQuote: null,
    });
    expect(validateMaritimeSemanticContract(context, SOURCE).valid).toBe(true);
    expect(isValidatedMaritimeIncident(context)).toBe(false);
  });

  it("requires a confirmed commercial target for attacks, seizures and piracy", () => {
    const attack = evidence({
      commercialTargetValidated: false,
      commercialTarget: "unknown",
      commercialTargetEvidence: null,
    });
    expect(validateMaritimeSemanticContract(attack, SOURCE).valid).toBe(false);
    expect(isValidatedMaritimeIncident(attack)).toBe(false);
    expect(
      validateMaritimeSemanticContract({
        ...attack,
        eventClass: "commercial_seizure",
        commercialTargetValidated: true,
        commercialTarget: "vessel",
        commercialTargetEvidence: "A tanker was attacked",
      }, SOURCE).valid,
    ).toBe(true);
  });

  it("shares the commercial-target admission rule across all commercial event classes", () => {
    for (const eventClass of [
      "commercial_attack",
      "commercial_seizure",
      "piracy_or_armed_robbery",
      "port_disruption",
    ] as const) {
      const missingTarget = evidence({
        eventClass,
        commercialTargetValidated: false,
        commercialTarget: "unknown",
        commercialTargetEvidence: null,
      });
      expect(maritimeEventRequiresCommercialTarget(eventClass)).toBe(true);
      expect(hasValidatedCommercialTarget(missingTarget)).toBe(false);
      expect(validateMaritimeSemanticContract(missingTarget, SOURCE).valid).toBe(false);
      expect(isValidatedMaritimeIncident(missingTarget)).toBe(false);
    }

    const militaryContext = evidence({
      eventClass: "naval_activity",
      commercialTargetValidated: false,
      commercialTarget: "none",
      commercialTargetEvidence: null,
    });
    expect(maritimeEventRequiresCommercialTarget("naval_activity")).toBe(false);
    expect(validateMaritimeSemanticContract(militaryContext, SOURCE).valid).toBe(true);
  });

  it("allows known events with unknown geography and never infers country", () => {
    const unknownGeo = evidence({
      physicalLocation: null,
      physicalLocationEvidence: null,
      country: null,
      coastalState: null,
      routeRelationship: {
        kind: "indirect",
        routeName: "Red Sea",
        evidence: "Gulf of Oman",
      },
    });
    expect(validateMaritimeSemanticContract(unknownGeo, SOURCE).valid).toBe(true);
    expect(countryFromPhysicalEvidence(unknownGeo)).toBeNull();
    expect(isValidatedMaritimeIncident(unknownGeo)).toBe(true);
  });

  it("rejects fabricated consequence/severity quotes that are absent from source", () => {
    const bad = evidence({
      commercialConsequence: {
        status: "confirmed",
        claim: "Insurance premiums doubled",
        evidenceQuote: "Insurance premiums doubled",
        confidence: 0.9,
      },
    });
    const checked = validateMaritimeSemanticContract(bad, SOURCE);
    expect(checked.valid).toBe(false);
    expect(checked.failures.join(" ")).toMatch(/not grounded/);
  });

  it("rejects a fabricated route relationship evidence string", () => {
    const checked = validateMaritimeSemanticContract(
      evidence({
        routeRelationship: {
          kind: "direct_passage",
          routeName: "Gulf of Oman",
          evidence: "The vessel passed through the Strait of Hormuz",
        },
      }),
      SOURCE,
    );
    expect(checked.valid).toBe(false);
    expect(checked.failures).toContain("route evidence is not grounded in source text");
  });

  it("invalidates a post-validation projection on text- or date-only edits", () => {
    const row: MaritimeIncidentSnapshot = {
      id: 7,
      topic: "shipping",
      title: "Tanker attacked off Muscat",
      summary: "Operator reports delay",
      source: "Wire",
      sourceUrl: "https://example.test/7",
      country: "Unknown",
      location: "Strait of Oman",
      occurredAt: new Date("2026-06-18T00:00:00.000Z"),
      incidentDate: null,
    };
    const changed = { ...row, summary: "Operator reports two-day delay" };
    expect(maritimeContentFingerprint(row)).not.toBe(
      maritimeContentFingerprint(changed),
    );
    expect(maritimeContentFingerprint(row)).not.toBe(
      maritimeContentFingerprint({
        ...row,
        occurredAt: new Date("2026-06-19T00:00:00.000Z"),
      }),
    );
    expect(maritimeContentFingerprint(row)).not.toBe(
      maritimeContentFingerprint({
        ...row,
        incidentDate: new Date("2026-06-19T00:00:00.000Z"),
      }),
    );
    expect(maritimeEvidenceSnapshotMatches(row, row)).toBe(true);
    expect(maritimeEvidenceSnapshotMatches(row, changed)).toBe(false);
    expect(
      maritimeEvidenceSnapshotMatches(row, {
        ...row,
        occurredAt: new Date("2026-06-19T00:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      maritimeEvidenceSnapshotMatches(row, {
        ...row,
        incidentDate: new Date("2026-06-19T00:00:00.000Z"),
      }),
    ).toBe(false);
  });
});