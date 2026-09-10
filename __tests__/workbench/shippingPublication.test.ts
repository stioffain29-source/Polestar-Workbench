import {
  assertShippingPublication,
  finalizeShippingPublication,
  type ShippingPublicationOptions,
} from "../../artifacts/workbench/src/lib/shippingPublication";
import type { ShippingReportIncident } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import { buildShippingReportDataset } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import { buildShippingCoverage } from "../../artifacts/workbench/src/lib/shippingCoverage";
import { draftTopicReportProse } from "../../artifacts/workbench/src/lib/draftReportProse";
import { MARITIME_SEMANTIC_VERSION } from "@workspace/relevance";
import { semanticIncident } from "./maritimeSemanticTestHelpers";

const ISSUE_DATE = "2026-06-15";

function semantic(overrides: Record<string, unknown> = {}): any {
  const sourceQuote = "Tanker was attacked at Bab el-Mandeb in Yemen.";
  return {
    version: MARITIME_SEMANTIC_VERSION,
    verdict: "valid",
    reason: "Source describes a confirmed maritime event.",
    eventOccurred: true,
    eventClass: "commercial_attack",
    commercialTargetValidated: true,
    commercialTarget: "vessel",
    commercialTargetName: "Tanker",
    commercialTargetEvidence: "Tanker was attacked",
    physicalLocation: "Bab el-Mandeb",
    physicalLocationEvidence: "at Bab el-Mandeb",
    country: "Yemen",
    coastalState: "Yemen",
    routeRelationship: {
      kind: "direct_passage",
      routeName: "Bab el-Mandeb",
      evidence: "at Bab el-Mandeb",
    },
    routingConsequence: {
      status: "none",
      claim: null,
      evidenceQuote: null,
      confidence: 0.4,
      kind: "none",
      description: null,
      evidence: null,
    },
    commercialConsequence: {
      status: "none",
      claim: null,
      evidenceQuote: null,
      confidence: 0.4,
    },
    geopolitical: { relevant: false, claim: null, evidenceQuote: null },
    eventDate: "2026-06-14",
    developmentKey: "dev-attack-1",
    severity: "high",
    severityJustification: "The source describes an attack on a tanker.",
    severityEvidenceQuote: "Tanker was attacked",
    confidence: {
      event: 0.95,
      classification: 0.95,
      commercialTarget: 0.95,
      geography: 0.95,
      routeRelationship: 0.95,
      consequence: 0.8,
      date: 0.95,
    },
    contradictions: [],
    sourceQuotes: [{ quote: sourceQuote, claim: "Tanker attack at Bab el-Mandeb." }],
    evidence: [sourceQuote],
    ...overrides,
  };
}

function incident(
  id: number,
  overrides: Partial<ShippingReportIncident> = {},
): ShippingReportIncident {
  return {
    id,
    topic: "shipping",
    title: "Tanker attacked at Bab el-Mandeb",
    summary: "Tanker was attacked at Bab el-Mandeb in Yemen.",
    source: "Maritime Desk",
    sourceUrl: `https://example.test/${id}`,
    country: "Yemen",
    location: "Bab el-Mandeb",
    severity: "high",
    occurredAt: "2026-06-14T08:00:00.000Z",
    maritimeSemantic: semantic(),
    ...overrides,
  };
}

function validOptions(
  overrides: Partial<ShippingPublicationOptions> = {},
): ShippingPublicationOptions {
  return {
    topic: "shipping",
    issueDate: ISSUE_DATE,
    incidents: [incident(1)],
    ...overrides,
  };
}

describe("Shipping publication final boundary", () => {
  it("accepts one valid semantic report for both preview/PDF consumers", () => {
    const publication = finalizeShippingPublication(validOptions());

    expect(publication.auditIssues).toEqual([]);
    expect(publication.dataset.canonicalIncidents).toHaveLength(1);
    expect(publication.tables.vessel).toHaveLength(1);
    expect(publication.fastFacts.find((fact) => fact.label === "Confirmed Incidents")?.value).toBe("1");
    expect(publication.prose.executiveSummary).toContain("overall maritime risk");
    expect(
      Object.values(publication.prose).join("\n"),
    ).not.toMatch(/\b(canonical|source[- ]grounded|semantic evidence|AIS movement|movement as evidence|validated incident|validated maritime|newly validated|route context|incident totals|shown separately|operational tables)\b/i);
    expect(publication.incidentSummaries["1"]).toBeUndefined();
    expect(() => assertShippingPublication(publication)).not.toThrow();
  });

  it("counts raw in-window validation coverage before canonical filtering", () => {
    const validated = incident(1, {
      severity: "high",
      maritimeValidation: {
        status: "validated",
        version: MARITIME_SEMANTIC_VERSION,
      },
    });
    const pending = incident(2, {
      severity: "extreme",
      maritimeValidation: { status: "pending", version: MARITIME_SEMANTIC_VERSION },
    });
    const rejected = incident(3, {
      maritimeSemantic: semantic({ verdict: "invalid" }),
      maritimeValidation: {
        status: "rejected",
        version: MARITIME_SEMANTIC_VERSION,
      },
    });
    const missing = incident(4, {
      maritimeSemantic: semantic({ eventDate: "2026-06-15" }),
    });
    const outside = incident(5, {
      occurredAt: "2026-05-01T08:00:00.000Z",
      maritimeSemantic: semantic({ eventDate: "2026-05-01" }),
      maritimeValidation: { status: "pending" },
    });

    const coverage = buildShippingCoverage(
      [validated, pending, rejected, missing, outside],
      "shipping",
      ISSUE_DATE,
    );
    expect(coverage).toMatchObject({
      status: "incomplete",
      complete: false,
      sourceRows: 4,
      validated: 1,
      rejected: 1,
      pending: 2,
      assessmentLabel: "Assessment pending",
    });
    expect(coverage.disclosure).toBe(
      "Coverage is incomplete: 2 of 4 source reports are still under review. Overall maritime risk assessment is pending.",
    );
  });

  it("holds overall risk at Assessment pending while retaining confirmed severity", () => {
    const publication = finalizeShippingPublication(validOptions({
      incidents: [
        incident(1, {
          severity: "high",
          maritimeValidation: {
            status: "validated",
            version: MARITIME_SEMANTIC_VERSION,
          },
        }),
        incident(2, {
          severity: "extreme",
          maritimeValidation: {
            status: "pending",
            version: MARITIME_SEMANTIC_VERSION,
          },
        }),
      ],
    }));

    expect(publication.completeness).toMatchObject({
      status: "incomplete",
      validated: 1,
      pending: 1,
      rejected: 0,
    });
    expect(publication.maritimeBoard.risk.label).toBe("Assessment pending");
    expect(publication.maritimeBoard.overallRisk.label).toBe("Assessment pending");
    expect(publication.maritimeBoard.highestIndividualSeverity).toBe("high");
    expect(publication.prose.executiveSummary).toContain("coverage is incomplete");
    expect(publication.prose.executiveSummary).toContain("highest individual incident severity is High");
    expect(publication.prose.executiveSummary).not.toMatch(/overall maritime risk as High/i);
  });

  it("preserves an analyst risk edit and flags its contradiction with pending coverage", () => {
    const saved = "Overall maritime risk is High. Review the reported route.";
    const publication = finalizeShippingPublication(validOptions({
      incidents: [incident(1, {
        maritimeValidation: { status: "pending", version: MARITIME_SEMANTIC_VERSION },
      })],
      report: { executiveSummary: saved },
    }));

    expect(publication.prose.executiveSummary).toBe(saved);
    expect(publication.auditIssues.map((item) => item.code)).toContain(
      "RISK_CONTRADICTION",
    );
  });

  it("does not let generated AI prose restore a definitive risk during incomplete coverage", () => {
    const publication = finalizeShippingPublication(validOptions({
      incidents: [incident(1, {
        maritimeValidation: { status: "pending", version: MARITIME_SEMANTIC_VERSION },
      })],
      aiProse: {
        executiveSummary: "Overall maritime risk is High.",
        whatMatters: "High risk requires immediate action.",
        implications: "High risk will increase insurance costs.",
        watchNext: "Monitor High risk.",
        polestarView: "Overall maritime risk is High.",
      },
    }));

    expect(publication.prose.executiveSummary).toContain("assessment is pending");
    expect(publication.prose.executiveSummary).not.toContain("risk is High");
    expect(publication.prose.polestarView).not.toContain("risk is High");
  });

  it("holds an inconsistent semantic chokepoint event out of every published surface", () => {
    const publication = finalizeShippingPublication(validOptions({
      incidents: [incident(79181, {
        maritimeSemantic: semantic({
          eventClass: "chokepoint_disruption",
          routeRelationship: { kind: "none", routeName: null, evidence: null },
          physicalLocation: "Strait of Hormuz",
          physicalLocationEvidence: "at Strait of Hormuz",
        }),
        maritimeValidation: {
          status: "validated",
          version: MARITIME_SEMANTIC_VERSION,
        },
      })],
    }));

    expect(publication.dataset.canonicalIncidents).toHaveLength(0);
    expect(publication.maritimeBoard.confirmedIncidents).toHaveLength(0);
    expect(publication.maritimeBoard.risk.label).toBe("Assessment pending");
    expect(publication.auditIssues.map((item) => item.code)).not.toContain(
      "ROUTE_RELATIONSHIP_CONTRADICTION",
    );
  });

  it("keeps generated commercial-impact prose reader-facing and auditable", () => {
    const row = incident(8, {
      maritimeSemantic: semantic({
        commercialConsequence: {
          status: "confirmed",
          claim: "Insurance premiums rose",
          evidenceQuote: "Insurance premiums rose",
          confidence: 0.9,
        },
      }),
      maritimeValidation: {
        status: "validated",
        version: MARITIME_SEMANTIC_VERSION,
      },
    });
    const generated = buildShippingReportDataset([row], "shipping", ISSUE_DATE)
      .commercialImpactRead;
    expect(generated).not.toMatch(/canonical|structured|evidence/i);
    expect(generated).toContain("commercial consequence");

    const publication = finalizeShippingPublication(validOptions({
      incidents: [row],
      report: { commercialImpactRead: generated },
    }));
    expect(publication.auditIssues.map((item) => item.code)).not.toContain(
      "UNSUPPORTED_PROSE_ASSERTION",
    );
  });

  it("does not assign a chokepoint from a title mention when another row owns the route", () => {
    const titleOnly = incident(9, {
      title: "Attack report mentions Strait of Hormuz",
      maritimeSemantic: semantic({
        developmentKey: "title-only-route",
        physicalLocation: "Yemen",
        physicalLocationEvidence: "off Yemen",
        routeRelationship: { kind: "none", routeName: null, evidence: null },
      }),
      maritimeValidation: {
        status: "validated",
        version: MARITIME_SEMANTIC_VERSION,
      },
    });
    const routeOwner = incident(10, {
      maritimeSemantic: semantic({
        developmentKey: "route-owner",
      }),
      maritimeValidation: {
        status: "validated",
        version: MARITIME_SEMANTIC_VERSION,
      },
    });
    const publication = finalizeShippingPublication(validOptions({
      incidents: [titleOnly, routeOwner],
    }));

    expect(publication.dataset.canonicalIncidents).toHaveLength(2);
    expect(publication.auditIssues.map((item) => item.code)).not.toContain(
      "ROUTE_RELATIONSHIP_CONTRADICTION",
    );
    expect(publication.dataset.chokepointRows.some((row) => row.count > 0)).toBe(
      true,
    );
  });

  it("keeps a same-day event with unknown physical geography aligned across board and prose", () => {
    const unknownGeography = incident(3, {
      occurredAt: "2026-06-15T08:00:00.000Z",
      location: "Strait of Hormuz",
      maritimeSemantic: semantic({
        eventDate: null,
        physicalLocation: null,
        physicalLocationEvidence: null,
        country: null,
        coastalState: null,
        routeRelationship: { kind: "none", routeName: null, evidence: null },
      }),
      maritimeValidation: {
        status: "validated",
        version: MARITIME_SEMANTIC_VERSION,
      },
    });
    const publication = finalizeShippingPublication(
      validOptions({
        incidents: [unknownGeography],
        issueDate: ISSUE_DATE,
      }),
    );

    expect(publication.dataset.canonicalIncidents).toHaveLength(1);
    expect(publication.maritimeBoard.confirmedIncidents).toHaveLength(1);
    expect(publication.auditIssues).toEqual([]);
    expect(publication.prose.executiveSummary).not.toContain("Strait of Hormuz");
    expect(publication.prose.whatMatters).not.toContain("Strait of Hormuz");
    expect(() => assertShippingPublication(publication)).not.toThrow();
  });

  it("excludes malformed semantic events instead of keyword-admitting them", () => {
    const malformed = incident(2, {
      maritimeSemantic: semantic({ version: "maritime-semantic-v1", eventClass: "commercial_attack" }),
    });
    const publication = finalizeShippingPublication(validOptions({ incidents: [malformed] }));

    expect(publication.auditIssues).toEqual([]);
    expect(publication.dataset.canonicalIncidents).toHaveLength(0);
    expect(publication.tables.vessel).toHaveLength(0);
    expect(publication.maritimeBoard.risk.label).toBe("Assessment pending");
  });

  it("rejects analyst edits that contradict overall risk, severity, counts, country, or route", () => {
    const publication = finalizeShippingPublication(
      validOptions({
        report: {
          executiveSummary: "Overall maritime risk is Low in Oman.",
          whatHappened: "A tanker attack occurred through Suez Canal.",
          whatMatters: "The highest individual incident severity is Low, so the route is safe.",
          implications: "Monitor the incident.",
          watchNext: "Monitor the incident.",
          polestarView: "Overall maritime risk is Low.",
        },
      }),
    );
    const codes = publication.auditIssues.map((issue) => issue.code);

    expect(codes).toEqual(expect.arrayContaining([
      "RISK_CONTRADICTION",
      "HIGHEST_SEVERITY_CONTRADICTION",
      "UNSUPPORTED_LOCATION_ASSERTION",
      "UNSUPPORTED_PROSE_ASSERTION",
    ]));
    expect(() => assertShippingPublication(publication)).toThrow();
  });

  it("rejects Fast Fact and table overrides while ignoring stale summary entries", () => {
    const currentRelated = semanticIncident(
      2,
      "Cargo vessel grounded in the Singapore Strait",
      {
        eventClass: "collision_or_grounding",
        severity: "moderate",
        eventDate: "2026-06-12",
        country: "Singapore",
        physicalLocation: "Singapore Strait",
        developmentKey: "dev-grounding-2",
      },
    );
    const publication = finalizeShippingPublication(
      validOptions({
        incidents: [incident(1), currentRelated],
        sectionOverrides: {
          fastFactOverrides: {
            "Confirmed Incidents": { value: "999" },
            "Highest Severity": { value: "Low" },
          },
        },
        tableOverrides: { vessel: [{ id: 999, title: "Fabricated" }] },
        incidentSummaries: { "2": "The collision was reported in Oman and insurance doubled." },
      }),
    );
    const codes = publication.auditIssues.map((issue) => issue.code);

    expect(codes).toEqual(expect.arrayContaining([
      "UNSUPPORTED_TABLE_OVERRIDE",
      "FAST_FACT_COUNT_MISMATCH",
      "FAST_FACT_SEVERITY_MISMATCH",
    ]));
    expect(codes.some((code) => code.startsWith("SUMMARY_"))).toBe(false);
  });

  it.each([
    "High was the strongest incident.",
    "The most severe incident was High.",
    "High was the worst incident, although Extreme events also occurred.",
    "The highest individual incident severity is High.",
  ])("rejects a lower tier described as the maximum: %s", (claim) => {
    const publication = finalizeShippingPublication(validOptions({
      incidents: [incident(1, { maritimeSemantic: semantic({ severity: "extreme" }) })],
      report: { whatMatters: `${claim} The operational risk requires assessment.` },
    }));
    expect(publication.auditIssues.map((item) => item.code))
      .toContain("HIGHEST_SEVERITY_CONTRADICTION");
  });

  it("does not confuse overall risk with a separately labelled highest severity", () => {
    const options = validOptions({
      incidents: [incident(1, { maritimeSemantic: semantic({ severity: "extreme" }) })],
    });
    const initial = finalizeShippingPublication(options);
    const publication = finalizeShippingPublication({
      ...options,
      report: {
        executiveSummary: `Overall maritime risk is ${initial.maritimeBoard.risk.label}. The highest individual incident severity is Extreme.`,
      },
    });
    expect(publication.auditIssues.map((item) => item.code))
      .not.toContain("RISK_CONTRADICTION");
    expect(publication.auditIssues.map((item) => item.code))
      .not.toContain("HIGHEST_SEVERITY_CONTRADICTION");
  });

  it("rejects an unsupported appended claim even when it overlaps an evidence token", () => {
    const publication = finalizeShippingPublication(
      validOptions({
        report: {
          whatMatters: "The tanker attack at Bab el-Mandeb was reported. Insurance premiums doubled.",
        },
      }),
    );

    expect(publication.auditIssues.map((issue) => issue.code)).toContain(
      "UNSUPPORTED_COMMERCIAL_CONSEQUENCE",
    );
  });

  it("does not retell a detailed event in Related Incidents", () => {
    const publication = finalizeShippingPublication(validOptions());

    expect(publication.tables.vessel.map((row) => row.id)).toEqual([1]);
    expect(publication.tables.related.map((row) => row.id)).not.toContain(1);
  });

  it("rejects duplicate cross-section retelling of the same event", () => {
    const publication = finalizeShippingPublication(
      validOptions({
        report: {
          whatMatters: "Assessment: High risk centres on the tanker attacked at Bab el-Mandeb in Yemen.",
          polestarView: "Assessment: High risk centres on the tanker attacked at Bab el-Mandeb in Yemen.",
        },
      }),
    );

    expect(publication.auditIssues.map((issue) => issue.code)).toContain(
      "DUPLICATE_INCIDENT_RETELLING",
    );
  });

  it("keeps hidden sections in the same validation boundary", () => {
    const publication = finalizeShippingPublication(
      validOptions({
        hiddenSections: ["what-matters", "vessel-piracy"],
        report: { whatMatters: "Insurance premiums doubled in Oman." },
      }),
    );

    expect(publication.hiddenSections.has("what-matters")).toBe(true);
    expect(publication.hiddenSections.has("vessel-piracy")).toBe(true);
    expect(publication.auditIssues.map((issue) => issue.code)).toContain(
      "UNSUPPORTED_COMMERCIAL_CONSEQUENCE",
    );
  });

  it("ignores stale AI prose and rejects stale analyst prose", () => {
    const publication = finalizeShippingPublication(
      validOptions({
        aiProse: {
          executiveSummary: "Overall maritime risk is Low in Oman.",
          whatMatters: "Insurance premiums doubled.",
          implications: "Use the route.",
          watchNext: "Watch the route.",
          polestarView: "Overall maritime risk is Low.",
          stale: true,
        },
        report: { executiveSummary: "Overall maritime risk is Low in Oman." },
      }),
    );

    expect(publication.prose.executiveSummary).toContain("Overall maritime risk is Low in Oman.");
    expect(publication.auditIssues.map((issue) => issue.code)).toContain("RISK_CONTRADICTION");
  });

  it("treats current and legacy automatic prose as fallback text, not analyst edits", () => {
    const draft = draftTopicReportProse({
      topic: "shipping",
      issueDate: ISSUE_DATE,
      incidents: [incident(1)],
    });
    const legacyDataset = buildShippingReportDataset(
      [incident(1)],
      "shipping",
      ISSUE_DATE,
      [],
    );
    const publication = finalizeShippingPublication(
      validOptions({
        report: {
          executiveSummary: draft.executiveSummary,
          whatMatters: legacyDataset.autoWhatMatters,
          implications: legacyDataset.autoImplications,
          watchNext: legacyDataset.autoWatchNext,
          polestarView: legacyDataset.autoPolestarView,
          vesselPiracyRead: legacyDataset.vesselPiracyRead,
          commercialImpactRead: legacyDataset.commercialImpactRead,
        },
      }),
    );

    expect(publication.auditIssues).toEqual([]);
    expect(Object.values(publication.prose).join("\n")).not.toMatch(
      /\b(canonical set|source[- ]grounded|shown in the chart below|internal validation)\b/i,
    );
  });

  it("keeps a non-generated saved edit while automatic prose follows the live fallback", () => {
    const savedEdit =
      "Review Bab el-Mandeb escalation triggers against the confirmed incident and keep the route response conditional.";
    const publication = finalizeShippingPublication(
      validOptions({
        report: {
          whatMatters: savedEdit,
        },
      }),
    );

    expect(publication.prose.whatMatters).toBe(savedEdit);
    expect(publication.auditIssues.map((item) => item.code)).not.toContain(
      "BACKEND_COMMENTARY",
    );
  });

  it("publishes a safe zero-data branch without fabricating a route or consequence", () => {
    const publication = finalizeShippingPublication(validOptions({ incidents: [] }));

    expect(publication.auditIssues).toEqual([]);
    expect(publication.maritimeBoard.risk.label).toBe("Not assessed");
    expect(publication.dataset.canonicalIncidents).toHaveLength(0);
    expect(publication.prose.commercialImpactRead).toContain("No confirmed commercial cost");
    expect(publication.prose.chokepointRouteRead).toContain("No route-related incident");
  });
});