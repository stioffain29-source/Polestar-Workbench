import {
  assertShippingPublication,
  finalizeShippingPublication,
  type ShippingPublicationOptions,
} from "../../artifacts/workbench/src/lib/shippingPublication";
import type { ShippingReportIncident } from "../../artifacts/workbench/src/lib/shippingReportDataset";
import { buildShippingReportDataset } from "../../artifacts/workbench/src/lib/shippingReportDataset";
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
    expect(publication.maritimeBoard.risk.label).toBe("Not assessed");
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