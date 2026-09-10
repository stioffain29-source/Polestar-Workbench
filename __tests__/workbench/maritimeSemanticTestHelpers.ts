import {
  MARITIME_SEMANTIC_VERSION,
  type MaritimeSemanticEvidence,
} from "@workspace/relevance";

/**
 * Small source-grounded semantic-v3 fixture factory. Tests should exercise the
 * canonical admission path rather than accidentally relying on headline
 * classifiers, so every fixture carries the complete provider contract.
 */
export function semanticFixture(
  title: string,
  overrides: Partial<MaritimeSemanticEvidence> = {},
): MaritimeSemanticEvidence {
  const eventClass = overrides.eventClass ?? "commercial_attack";
  const commercialTargetValidated =
    overrides.commercialTargetValidated ??
    (eventClass === "commercial_attack" || eventClass === "commercial_seizure");
  const commercialTarget =
    overrides.commercialTarget ??
    (commercialTargetValidated ? "vessel" : "none");
  const targetEvidence =
    overrides.commercialTargetEvidence ??
    (commercialTargetValidated ? title : null);
  const physicalLocation = overrides.physicalLocation ?? "Strait of Hormuz";
  const physicalLocationEvidence =
    overrides.physicalLocationEvidence ??
    (physicalLocation ? title : null);
  const severity = overrides.severity === undefined ? "high" : overrides.severity;
  const severityQuote =
    overrides.severityEvidenceQuote ??
    (severity === null ? null : title);
  const routeKind = overrides.routeRelationship?.kind ?? "none";
  const routeName =
    overrides.routeRelationship?.routeName ??
    (routeKind === "none" ? null : "Strait of Hormuz");
  const routeEvidence =
    overrides.routeRelationship?.evidence ??
    (routeKind === "none" ? null : title);
  const routing = overrides.routingConsequence ?? {
    status: "none" as const,
    claim: null,
    evidenceQuote: null,
    confidence: 0,
    kind: "none" as const,
    description: null,
    evidence: null,
  };
  const commercial = overrides.commercialConsequence ?? {
    status: "none" as const,
    claim: null,
    evidenceQuote: null,
    confidence: 0,
  };

  return {
    version: MARITIME_SEMANTIC_VERSION,
    verdict: "valid",
    reason: "source-grounded test fixture",
    eventOccurred: true,
    eventClass,
    commercialTargetValidated,
    commercialTarget,
    commercialTargetName: commercialTargetValidated ? "Test vessel" : null,
    commercialTargetEvidence: targetEvidence,
    physicalLocation,
    physicalLocationEvidence,
    country: overrides.country === undefined ? "Iran" : overrides.country,
    coastalState: overrides.coastalState ?? null,
    routeRelationship: {
      kind: routeKind,
      routeName,
      evidence: routeEvidence,
    },
    routingConsequence: routing,
    commercialConsequence: commercial,
    geopolitical: overrides.geopolitical ?? {
      relevant: false,
      claim: null,
      evidenceQuote: null,
    },
    eventDate: overrides.eventDate === undefined ? "2026-06-16" : overrides.eventDate,
    developmentKey:
      overrides.developmentKey === undefined
        ? `development-${title.toLowerCase().replace(/\W+/g, "-")}`
        : overrides.developmentKey,
    severity,
    severityJustification:
      overrides.severityJustification ??
      (severity === null ? null : "Source reports the event severity."),
    severityEvidenceQuote: severityQuote,
    confidence: overrides.confidence ?? {
      event: 0.95,
      classification: 0.95,
      commercialTarget: commercialTargetValidated ? 0.95 : 0.2,
      geography: physicalLocation ? 0.95 : 0.2,
      routeRelationship: routeKind === "none" ? 0.2 : 0.95,
      consequence: 0.2,
      date: 0.95,
    },
    contradictions: overrides.contradictions ?? [],
    sourceQuotes: overrides.sourceQuotes ?? [{ quote: title, claim: "event" }],
    evidence: overrides.evidence ?? [title],
  };
}

export function semanticIncident(
  id: number | string,
  title: string,
  overrides: Partial<MaritimeSemanticEvidence> = {},
): {
  id: number | string;
  topic: "shipping";
  title: string;
  severity: string;
  occurredAt: string;
  country: string;
  location: string;
  summary: string;
  source: string;
  sourceUrl: string;
  maritimeSemantic: MaritimeSemanticEvidence;
} {
  const semantic = semanticFixture(title, overrides);
  return {
    id,
    topic: "shipping",
    title,
    severity: semantic.severity ?? "moderate",
    occurredAt: `${semantic.eventDate ?? "2026-06-16"}T08:00:00.000Z`,
    country: semantic.country ?? "Unknown",
    location: semantic.physicalLocation ?? "Unknown",
    summary: title,
    source: "Test source",
    sourceUrl: `https://example.test/${id}`,
    maritimeSemantic: semantic,
  };
}