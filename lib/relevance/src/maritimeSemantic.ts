/**
 * Shared, source-agnostic semantic contract for maritime news.
 *
 * Route relevance is not physical geography; routing consequence is not proof
 * that a commercial target was attacked.  Every report surface consumes this
 * contract, while AIS remains an intentionally separate context layer.
 */

// Bumped with the relational development resolver hardening. Existing v2
// projections are intentionally stale and must be re-evaluated before they
// can participate in admission, attachment, or canonical counts.
export const MARITIME_SEMANTIC_VERSION = "maritime-semantic-v3";

export const MARITIME_EVENT_CLASSES = [
  "commercial_attack",
  "commercial_seizure",
  "piracy_or_armed_robbery",
  "collision_or_grounding",
  "port_disruption",
  "chokepoint_disruption",
  "route_disruption",
  "environmental_maritime_event",
  "naval_activity",
  "military_naval_activity",
  "drone_activity",
  "military_exercise",
  "geopolitical_maritime_development",
  "protest_or_labour",
  "other_maritime_event",
  "non_event",
] as const;

export type MaritimeEventClass = (typeof MARITIME_EVENT_CLASSES)[number];

export const MARITIME_COMMERCIAL_TARGETS = [
  "vessel",
  "cargo",
  "port_facility",
  "shipping_operations",
  "none",
  "unknown",
] as const;

export type MaritimeCommercialTarget =
  (typeof MARITIME_COMMERCIAL_TARGETS)[number];

/**
 * Event classes whose validity depends on positively identifying the affected
 * commercial target.  Keep this list in the shared contract so SQL admission,
 * report admission and publication audit cannot silently grow different
 * definitions of a commercial incident.
 */
export const MARITIME_COMMERCIAL_EVENT_CLASSES = [
  "commercial_attack",
  "commercial_seizure",
  "piracy_or_armed_robbery",
  "port_disruption",
] as const satisfies readonly MaritimeEventClass[];

export type MaritimeCommercialEventClass =
  (typeof MARITIME_COMMERCIAL_EVENT_CLASSES)[number];

/** Values that can satisfy `commercialTargetValidated`. */
export const MARITIME_VALIDATED_COMMERCIAL_TARGETS = [
  "vessel",
  "cargo",
  "port_facility",
  "shipping_operations",
] as const satisfies readonly MaritimeCommercialTarget[];

export const MARITIME_ROUTE_RELATIONSHIP_KINDS = [
  "physical",
  "direct_passage",
  "indirect",
  "none",
] as const;

export type MaritimeRouteRelationshipKind =
  (typeof MARITIME_ROUTE_RELATIONSHIP_KINDS)[number];

export const MARITIME_CONSEQUENCE_KINDS = [
  "none",
  "observed",
  "reported",
  "potential",
  "unknown",
] as const;

export type MaritimeConsequenceKind =
  (typeof MARITIME_CONSEQUENCE_KINDS)[number];

export const MARITIME_CONSEQUENCE_STATUSES = [
  "none",
  "confirmed",
  "assessed",
] as const;

export type MaritimeConsequenceStatus =
  (typeof MARITIME_CONSEQUENCE_STATUSES)[number];

export const MARITIME_VALIDITY_STATUSES = [
  "valid",
  "invalid",
  "needs_review",
] as const;

export type MaritimeValidityStatus = (typeof MARITIME_VALIDITY_STATUSES)[number];

export const MARITIME_SEVERITIES = [
  "insignificant",
  "low",
  "moderate",
  "high",
  "extreme",
] as const;

export type MaritimeSeverity = (typeof MARITIME_SEVERITIES)[number];

export type MaritimeConfidence = {
  event: number;
  classification: number;
  commercialTarget: number;
  geography: number;
  routeRelationship: number;
  consequence: number;
  date: number;
};

export type MaritimeSourceQuote = {
  quote: string;
  claim: string;
};

export type MaritimeRouteRelationship = {
  kind: MaritimeRouteRelationshipKind;
  routeName: string | null;
  evidence: string | null;
};

export type MaritimeConsequence = {
  status: MaritimeConsequenceStatus;
  claim: string | null;
  evidenceQuote: string | null;
  confidence: number;
};

export type MaritimeRoutingConsequence = MaritimeConsequence & {
  /** Backward-compatible classification used by older board adapters. */
  kind: MaritimeConsequenceKind;
  description: string | null;
  evidence: string | null;
};

export type MaritimeSemanticEvidence = {
  version: string;
  verdict: MaritimeValidityStatus;
  reason: string;
  eventOccurred: boolean | null;
  eventClass: MaritimeEventClass | null;
  /** True only when a source positively identifies a commercial target. */
  commercialTargetValidated: boolean;
  commercialTarget: MaritimeCommercialTarget;
  commercialTargetName: string | null;
  commercialTargetEvidence: string | null;
  /** Physical event location; may remain null when source geography is unknown. */
  physicalLocation: string | null;
  physicalLocationEvidence: string | null;
  country: string | null;
  coastalState: string | null;
  routeRelationship: MaritimeRouteRelationship;
  routingConsequence: MaritimeRoutingConsequence;
  commercialConsequence: MaritimeConsequence;
  geopolitical: {
    relevant: boolean;
    claim: string | null;
    evidenceQuote: string | null;
  };
  eventDate: string | null;
  developmentKey: string | null;
  severity: MaritimeSeverity | null;
  severityJustification: string | null;
  severityEvidenceQuote: string | null;
  confidence: MaritimeConfidence;
  contradictions: string[];
  /** Source-grounded quotes are required for every non-trivial claim. */
  sourceQuotes: MaritimeSourceQuote[];
  /** Compact legacy evidence strings retained for audit/display adapters. */
  evidence: string[];
};

export type MaritimeSemanticInput = {
  title: string;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  assignedCountry?: string | null;
  assignedLocation?: string | null;
  publishedAt?: Date | string | null;
  candidateEventDate?: Date | string | null;
};

const COMMERCIAL_TARGETS = new Set<MaritimeCommercialTarget>(
  MARITIME_VALIDATED_COMMERCIAL_TARGETS,
);

const finiteConfidence = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Whether an event class is admitted only with a positively identified
 * commercial target.  This is deliberately a semantic-class rule, never a
 * title/raw-text inference.
 */
export function maritimeEventRequiresCommercialTarget(
  eventClass: unknown,
): eventClass is MaritimeCommercialEventClass {
  return (MARITIME_COMMERCIAL_EVENT_CLASSES as readonly unknown[]).includes(
    eventClass,
  );
}

/**
 * The common target-evidence predicate used by semantic validation and
 * downstream consumers.  A target flag by itself is not evidence: the target
 * must be one of the admitted commercial target values and carry a
 * source-grounded evidence quote.
 */
export function hasValidatedCommercialTarget(
  value:
    | {
        commercialTargetValidated?: unknown;
        commercialTarget?: unknown;
        commercialTargetEvidence?: unknown;
      }
    | null
    | undefined,
): boolean {
  return (
    value?.commercialTargetValidated === true &&
    COMMERCIAL_TARGETS.has(value.commercialTarget as MaritimeCommercialTarget) &&
    nonEmpty(value.commercialTargetEvidence)
  );
}

export function sourceQuoteGrounded(
  quote: string | null | undefined,
  sourceText: string | null | undefined,
): boolean {
  if (!nonEmpty(quote) || !nonEmpty(sourceText)) return false;
  const normalize = (text: string) =>
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ");
  const cleanQuote = normalize(quote);
  const cleanSource = normalize(sourceText);
  return cleanSource.includes(cleanQuote);
}

function validateConsequence(
  consequence: Partial<MaritimeConsequence> | null | undefined,
  label: string,
  failures: string[],
): consequence is MaritimeConsequence {
  if (!consequence || typeof consequence !== "object") {
    failures.push(`missing ${label}`);
    return false;
  }
  if (!MARITIME_CONSEQUENCE_STATUSES.includes(
    consequence.status as MaritimeConsequenceStatus,
  )) {
    failures.push(`invalid ${label}.status`);
  }
  if (!finiteConfidence(consequence.confidence)) {
    failures.push(`invalid ${label}.confidence`);
  }
  if (consequence.status !== "none") {
    if (!nonEmpty(consequence.claim)) failures.push(`${label} has no claim`);
    if (!nonEmpty(consequence.evidenceQuote)) {
      failures.push(`${label} has no source evidence quote`);
    }
  }
  if (consequence.status === "none" && consequence.claim !== null) {
    failures.push(`${label} none status has a claim`);
  }
  return true;
}

/**
 * Validate provider output.  This function never derives a field from title,
 * feed country, route, vessel flag, nationality, HQ, or AIS.
 */
export function validateMaritimeSemanticContract(
  value: Partial<MaritimeSemanticEvidence> | null | undefined,
  sourceText?: string | null,
): { valid: boolean; failures: string[] } {
  const failures: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, failures: ["missing semantic evidence"] };
  }
  if (value.version !== MARITIME_SEMANTIC_VERSION) {
    failures.push("unsupported semantic version");
  }
  if (!MARITIME_VALIDITY_STATUSES.includes(value.verdict as MaritimeValidityStatus)) {
    failures.push("invalid verdict");
  }
  if (!MARITIME_EVENT_CLASSES.includes(value.eventClass as MaritimeEventClass)) {
    failures.push("invalid event class");
  }
  if (!MARITIME_COMMERCIAL_TARGETS.includes(
    value.commercialTarget as MaritimeCommercialTarget,
  )) {
    failures.push("invalid commercial target");
  }
  if (!MARITIME_SEVERITIES.includes(value.severity as MaritimeSeverity) &&
    value.severity !== null) {
    failures.push("invalid severity");
  }
  const confidence = value.confidence;
  if (!confidence || typeof confidence !== "object") {
    failures.push("missing confidence");
  } else {
    for (const field of [
      "event",
      "classification",
      "commercialTarget",
      "geography",
      "routeRelationship",
      "consequence",
      "date",
    ] as const) {
      if (!finiteConfidence(confidence[field])) {
        failures.push(`invalid confidence.${field}`);
      }
    }
  }

  if (!Array.isArray(value.contradictions)) failures.push("missing contradictions");
  if (!Array.isArray(value.evidence)) failures.push("missing evidence");
  if (!Array.isArray(value.sourceQuotes)) {
    failures.push("missing source quotes");
  } else {
    for (const [index, quote] of value.sourceQuotes.entries()) {
      if (!quote || !nonEmpty(quote.quote) || !nonEmpty(quote.claim)) {
        failures.push(`invalid source quote ${index}`);
      } else if (
        sourceText !== undefined &&
        !sourceQuoteGrounded(quote.quote, sourceText)
      ) {
        failures.push(`source quote ${index} is not grounded in source text`);
      }
    }
  }

  const route = value.routeRelationship;
  if (!route || typeof route !== "object") {
    failures.push("missing route relationship");
  } else {
    if (!MARITIME_ROUTE_RELATIONSHIP_KINDS.includes(
      route.kind as MaritimeRouteRelationshipKind,
    )) {
      failures.push("invalid route relationship kind");
    }
    if (route.kind === "none") {
      if (route.routeName !== null) failures.push("none route has a route name");
    } else {
      if (!nonEmpty(route.routeName)) failures.push("route relationship has no route name");
      if (!nonEmpty(route.evidence)) failures.push("route relationship has no evidence");
      else if (
        sourceText !== undefined &&
        !sourceQuoteGrounded(route.evidence, sourceText)
      ) {
        failures.push("route evidence is not grounded in source text");
      }
    }
  }

  const routing = value.routingConsequence;
  validateConsequence(routing, "routing consequence", failures);
  if (routing && routing.status !== "none") {
    if (!MARITIME_CONSEQUENCE_KINDS.includes(routing.kind)) {
      failures.push("invalid routing consequence kind");
    }
    if (!nonEmpty(routing.description) || !nonEmpty(routing.evidence)) {
      failures.push("routing consequence lacks structured evidence");
    }
  }
  validateConsequence(value.commercialConsequence, "commercial consequence", failures);

  const geopolitical = value.geopolitical;
  if (!geopolitical || typeof geopolitical !== "object") {
    failures.push("missing geopolitical assessment");
  } else if (geopolitical.relevant &&
    (!nonEmpty(geopolitical.claim) || !nonEmpty(geopolitical.evidenceQuote))) {
    failures.push("geopolitical assessment lacks source evidence");
  }

  const eventClass = value.eventClass;
  const occurred = value.eventOccurred === true;
  const sourceQuotes = Array.isArray(value.sourceQuotes)
    ? value.sourceQuotes
    : [];
  const targetRequired = maritimeEventRequiresCommercialTarget(eventClass);

  if (value.verdict === "valid") {
    if (!occurred) failures.push("valid event did not occur");
    if (!eventClass || eventClass === "non_event") {
      failures.push("valid event has no qualifying class");
    }
    // Unknown geography is allowed.  If a location is supplied it must have
    // positive evidence; an assigned country can never supply that evidence.
    if (value.physicalLocation !== null &&
      (!nonEmpty(value.physicalLocation) || !nonEmpty(value.physicalLocationEvidence))) {
      failures.push("physical location lacks source evidence");
    }
    if (value.country !== null && !nonEmpty(value.country)) {
      failures.push("empty country is not unassigned");
    }
    if (value.country !== null &&
      (!nonEmpty(value.physicalLocation) || !nonEmpty(value.physicalLocationEvidence))) {
      failures.push("country lacks physical-location evidence");
    }
    if (value.coastalState !== null &&
      (!nonEmpty(value.physicalLocation) || !nonEmpty(value.physicalLocationEvidence))) {
      failures.push("coastal state lacks physical-location evidence");
    }
    if (value.eventDate !== null &&
      (typeof value.eventDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value.eventDate) ||
        !Number.isFinite(Date.parse(`${value.eventDate}T00:00:00.000Z`)))) {
      failures.push("invalid event date");
    }
    if (targetRequired && !hasValidatedCommercialTarget(value)) {
      failures.push("commercial event lacks confirmed target evidence");
    }
    if (value.commercialTargetValidated && !hasValidatedCommercialTarget(value)) {
      failures.push("commercial target flag has no grounded target evidence");
    }
    if (value.severity !== null &&
      (!nonEmpty(value.severityJustification) || !nonEmpty(value.severityEvidenceQuote))) {
      failures.push("severity lacks source-grounded justification");
    }
    if (sourceQuotes.length === 0) {
      failures.push("valid event has no source-grounded quotes");
    }
    if (Array.isArray(value.contradictions) && value.contradictions.length > 0) {
      failures.push("valid event has unresolved contradictions");
    }
    if (sourceText !== undefined) {
      for (const [label, quote] of [
        ["commercial target", value.commercialTargetEvidence],
        ["physical location", value.physicalLocationEvidence],
        ["severity", value.severityEvidenceQuote],
        ["routing consequence", value.routingConsequence?.evidenceQuote],
        ["commercial consequence", value.commercialConsequence?.evidenceQuote],
        ["geopolitical", value.geopolitical?.evidenceQuote],
      ] as const) {
        if (quote != null && !sourceQuoteGrounded(quote, sourceText)) {
          failures.push(`${label} evidence quote is not grounded in source text`);
        }
      }
    }
    if (value.eventClass === "geopolitical_maritime_development" &&
      (!geopolitical || !geopolitical.relevant)) {
      failures.push("geopolitical event lacks geopolitical assessment");
    }
  }

  // Naval/military/drone context can be valid, but it must not be admitted as
  // a direct commercial incident without a positively identified target.
  if (
    value.verdict === "valid" &&
    (eventClass === "naval_activity" ||
      eventClass === "military_naval_activity" ||
      eventClass === "military_exercise" ||
      eventClass === "drone_activity") &&
    value.commercialTargetValidated &&
    !hasValidatedCommercialTarget(value)
  ) {
    failures.push("military activity has invalid commercial target");
  }
  return { valid: failures.length === 0, failures };
}

/** A missing or ambiguous provider response is explicitly held. */
export function maritimeNeedsReview(reason: string): MaritimeSemanticEvidence {
  return {
    version: MARITIME_SEMANTIC_VERSION,
    verdict: "needs_review",
    reason: reason.slice(0, 240),
    eventOccurred: null,
    eventClass: null,
    commercialTargetValidated: false,
    commercialTarget: "unknown",
    commercialTargetName: null,
    commercialTargetEvidence: null,
    physicalLocation: null,
    physicalLocationEvidence: null,
    country: null,
    coastalState: null,
    routeRelationship: { kind: "none", routeName: null, evidence: null },
    routingConsequence: {
      status: "none",
      claim: null,
      evidenceQuote: null,
      confidence: 0,
      kind: "unknown",
      description: null,
      evidence: null,
    },
    commercialConsequence: {
      status: "none",
      claim: null,
      evidenceQuote: null,
      confidence: 0,
    },
    geopolitical: { relevant: false, claim: null, evidenceQuote: null },
    eventDate: null,
    developmentKey: null,
    severity: null,
    severityJustification: null,
    severityEvidenceQuote: null,
    confidence: {
      event: 0,
      classification: 0,
      commercialTarget: 0,
      geography: 0,
      routeRelationship: 0,
      consequence: 0,
      date: 0,
    },
    contradictions: [],
    sourceQuotes: [],
    evidence: [],
  };
}

/**
 * Canonical incident admission.  AIS/movement is not an argument and cannot
 * alter incident totals, country, route, severity, or risk.
 */
export function isValidatedMaritimeIncident(
  evidence: MaritimeSemanticEvidence | null | undefined,
): boolean {
  if (!evidence || evidence.verdict !== "valid") return false;
  if (!validateMaritimeSemanticContract(evidence).valid) return false;
  if (evidence.eventOccurred !== true || evidence.eventClass === "non_event") return false;
  if (
    evidence.eventClass === "naval_activity" ||
    evidence.eventClass === "military_naval_activity" ||
    evidence.eventClass === "military_exercise" ||
    evidence.eventClass === "drone_activity"
  ) {
    return hasValidatedCommercialTarget(evidence);
  }
  return true;
}

export function countryFromPhysicalEvidence(
  evidence: MaritimeSemanticEvidence | null | undefined,
): string | null {
  if (!evidence || evidence.verdict !== "valid") return null;
  if (evidence.physicalLocation === null ||
    !nonEmpty(evidence.physicalLocationEvidence)) return null;
  return nonEmpty(evidence.country) ? evidence.country.trim() : null;
}
