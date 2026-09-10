/**
 * The publication boundary for Shipping Watch.
 *
 * This module deliberately sits in front of both renderers.  It is the only
 * place where the canonical incident set, the Maritime Intelligence board,
 * overrides, prose, tables and incident summaries are assembled for
 * publication.  A renderer may display this model, or display the validation
 * failure, but it must not assemble a second version of it.
 */

import type {
  MaritimeMovement,
  MaritimeSecurityEvent,
} from "@workspace/api-client-react";
import {
  buildMaritimeIntelligence,
  assertShippingReportConsistency,
  type MaritimeIntelligence,
} from "./maritimeIntelligence";
import {
  buildShippingReportDataset,
  type BarRow,
  type ChokepointRow,
  type EnrichedIncident,
  type KpiCard,
  type PiracyRow,
  type ShippingReportDataset,
  type ShippingReportIncident,
  type VesselRow,
} from "./shippingReportDataset";
import {
  applyFastFactOverrides,
  type TopicSectionOverrides,
} from "./topicSectionOverrides";
import {
  stableDraftTopicReportProse,
  toDraftableIncidents,
  type TopicAiProse,
} from "./topicProseResolution";
import { resolveIncidentSummary } from "./incidentSummary";
import { resolveReportWindow } from "./reportWindow";
import {
  auditFinalReportEvidence,
  type FinalReportTypedReference,
} from "./finalReportEvidenceAudit";

const SEVERITY_RANK: Record<string, number> = {
  insignificant: 1,
  low: 2,
  moderate: 3,
  high: 4,
  extreme: 5,
};

const SEVERITY_LABEL: Record<string, string> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};

const EVENT_CLASS_LABEL: Record<string, string> = {
  commercial_attack: "commercial-vessel attack",
  commercial_seizure: "commercial-vessel seizure",
  piracy_or_armed_robbery: "piracy or armed robbery",
  collision_or_grounding: "collision or grounding",
  port_disruption: "port disruption",
  chokepoint_disruption: "chokepoint disruption",
  route_disruption: "route disruption",
  environmental_maritime_event: "environmental maritime event",
  naval_activity: "naval activity",
  military_naval_activity: "military naval activity",
  drone_activity: "drone activity",
  military_exercise: "military exercise",
  geopolitical_maritime_development: "geopolitical maritime development",
  protest_or_labour: "maritime protest or labour disruption",
  other_maritime_event: "maritime event",
  non_event: "non-event",
};

/*
 * This is intentionally structural.  Semantic evidence is being added to
 * incident API rows independently of the workbench package.  Keeping the
 * adapter structural lets the publication gate accept both the new nested
 * shape and the persisted relation shape without weakening the gate.
 */
type SemanticEvidence = {
  version?: string | null;
  verdict?: string | null;
  eventOccurred?: boolean | null;
  eventClass?: string | null;
  commercialTargetValidated?: boolean;
  commercialTarget?: string | null;
  commercialTargetName?: string | null;
  commercialTargetEvidence?: string | null;
  physicalLocation?: string | null;
  physicalLocationEvidence?: string | null;
  country?: string | null;
  coastalState?: string | null;
  routeRelationship?: {
    kind?: string | null;
    routeName?: string | null;
    evidence?: string | null;
  } | null;
  routingConsequence?: {
    kind?: string | null;
    status?: string | null;
    claim?: string | null;
    description?: string | null;
    evidence?: string | null;
    evidenceQuote?: string | null;
  } | null;
  commercialConsequence?: {
    status?: string | null;
    claim?: string | null;
    evidenceQuote?: string | null;
  } | null;
  developmentKey?: string | null;
  severity?: string | null;
  severityJustification?: string | null;
  severityEvidenceQuote?: string | null;
  sourceQuotes?: Array<{ quote?: string | null; claim?: string | null }>;
  evidence?: string[];
  contradictions?: string[];
};

type IncidentWithSemantic = ShippingReportIncident & {
  maritimeSemantic?: SemanticEvidence | null;
  maritimeSemanticEvidence?: SemanticEvidence | null;
  validityGates?: { maritimeSemantic?: SemanticEvidence | null } | null;
};

export interface ShippingPublicationReport {
  topic?: string | null;
  issueDate?: string | null;
  title?: string | null;
  riskRating?: string | null;
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
  chokepointRouteRead?: string | null;
  vesselPiracyRead?: string | null;
  maritimeSecurityRead?: string | null;
  commercialImpactRead?: string | null;
  regionalCountryRead?: string | null;
}

export interface ShippingPublicationOptions {
  topic?: string | null;
  issueDate?: string | null;
  report?: ShippingPublicationReport | null;
  incidents: ShippingReportIncident[];
  movement?: MaritimeMovement[] | null;
  maritimeSecurityEvents?: MaritimeSecurityEvent[];
  dataset?: ShippingReportDataset;
  incidentSummaries?: Record<string, string>;
  aiProse?: TopicAiProse | null;
  hiddenSections?: string[];
  sectionOverrides?: TopicSectionOverrides | null;
  /**
   * Reserved for future row-level table editing.  Shipping currently has no
   * safe table-edit contract; accepting arbitrary rows here would let a
   * caller bypass the canonical set, so non-empty values fail closed.
   */
  tableOverrides?: Record<string, unknown> | null;
}

export interface ShippingPublicationProse {
  executiveSummary: string;
  chokepointRouteRead: string;
  vesselPiracyRead: string;
  maritimeSecurityRead: string;
  commercialImpactRead: string;
  regionalCountryRead: string;
  whatMatters: string;
  implications: string;
  watchNext: string;
  polestarView: string;
}

export interface ShippingPublicationTables {
  chokepoints: ChokepointRow[];
  vessel: VesselRow[];
  piracy: PiracyRow[];
  commercial: EnrichedIncident[];
  regions: BarRow[];
  countries: BarRow[];
  maritimeSecurity: ShippingReportDataset["maritimeSecurity"];
  related: EnrichedIncident[];
}

export interface ShippingPublicationIssue {
  code: string;
  section?: string;
  message: string;
  incidentIds?: Array<number | string>;
}

export interface ShippingPublicationBundle {
  dataset: ShippingReportDataset;
  maritimeBoard: MaritimeIntelligence;
  fastFacts: KpiCard[];
  prose: ShippingPublicationProse;
  tables: ShippingPublicationTables;
  charts: {
    regions: BarRow[];
    countries: BarRow[];
  };
  incidentSummaries: Record<string, string>;
  hiddenSections: Set<string>;
  auditIssues: ShippingPublicationIssue[];
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function semanticFor(row: ShippingReportIncident): SemanticEvidence | null {
  const value = row as IncidentWithSemantic;
  return (
    value.maritimeSemantic ??
    value.maritimeSemanticEvidence ??
    value.validityGates?.maritimeSemantic ??
    null
  );
}

function normalizeText(value: unknown): string {
  return trim(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: unknown): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 4);
}

function hasAny(text: string, expressions: RegExp[]): boolean {
  return expressions.some((expression) => expression.test(text));
}

function highestSeverity(rows: ShippingReportIncident[]): string {
  let best = "";
  let rank = 0;
  for (const row of rows) {
    const key = trim(row.severity).toLowerCase();
    if ((SEVERITY_RANK[key] ?? 0) > rank) {
      rank = SEVERITY_RANK[key] ?? 0;
      best = key;
    }
  }
  return best ? SEVERITY_LABEL[best] : "Not assessed";
}

function firstRoute(dataset: ShippingReportDataset): string {
  const semanticRoutes = dataset.canonicalIncidents
    .map(semanticFor)
    .filter(
      (semantic): semantic is SemanticEvidence =>
        Boolean(
          semantic &&
            (semantic.routeRelationship?.kind === "physical" ||
              semantic.routeRelationship?.kind === "direct_passage") &&
            trim(semantic.routeRelationship.routeName),
        ),
    )
    .map((semantic) => trim(semantic.routeRelationship?.routeName))
    .filter(Boolean);
  if (semanticRoutes.length > 0) return semanticRoutes[0];
  if (dataset.canonicalIncidents.some((row) => semanticFor(row))) return "";
  const route = dataset.chokepointRows.find((row) => row.count > 0)?.name;
  return route ?? "";
}

function firstGeography(dataset: ShippingReportDataset): string {
  const country = dataset.countryRows.find((row) => row.value > 0)?.label;
  if (country) return country;
  const row = dataset.canonicalIncidents[0];
  return row?.incidentCountry ?? row?.location ?? "";
}

function firstEventLabel(
  dataset: ShippingReportDataset,
  incidents: ShippingReportIncident[],
): string {
  for (const row of dataset.canonicalIncidents) {
    const semantic = semanticFor(row);
    if (semantic?.eventClass && EVENT_CLASS_LABEL[semantic.eventClass]) {
      return EVENT_CLASS_LABEL[semantic.eventClass];
    }
  }
  const vessel = dataset.vesselRows[0];
  if (vessel) return "commercial-vessel event";
  const piracy = dataset.piracyRows[0];
  if (piracy) return "piracy or armed-robbery event";
  if (incidents.length > 0) return "confirmed maritime event";
  return "new maritime event";
}

/**
 * Deterministic prose used when no analyst or AI text is present.  It uses
 * only values in the final dataset/board, and intentionally avoids claiming a
 * price, delay, insurance, rerouting or other commercial consequence unless
 * semantic evidence has supplied one.
 */
function safeDeterministicProse(
  dataset: ShippingReportDataset,
  board: MaritimeIntelligence,
  incidents: ShippingReportIncident[],
): ShippingPublicationProse {
  const risk = board.risk.label;
  const highest = highestSeverity(dataset.canonicalIncidents);
  const route = firstRoute(dataset);
  const geography = firstGeography(dataset);
  const event = firstEventLabel(dataset, incidents);
  const place = geography || route || "the tracked maritime area";
  const routeSentence = route
    ? `Reported route-related activity is concentrated on ${route}.`
    : "No route-related incident is identified in this window.";
  const geographySentence = geography
    ? `The leading reported location is ${geography}.`
    : "The available reports do not identify a leading physical geography.";

  const direct = dataset.vesselRows.length;
  const piracy = dataset.piracyRows.length;
  const commercialConsequences = dataset.canonicalIncidents
    .map(semanticFor)
    .filter(
      (semantic): semantic is SemanticEvidence =>
        Boolean(semantic?.commercialConsequence?.status === "confirmed"),
    );

  return {
    executiveSummary:
      `Shipping Watch assesses overall maritime risk as ${risk}. ` +
      `${event} is the clearest reported signal in ${place}; ` +
      `the highest individual incident severity is ${highest}. ` +
      `Overall risk and individual incident severity are separate judgements.`,
    chokepointRouteRead:
      `${routeSentence} ${geographySentence} ` +
      `The reported developments are assessed below.`,
    vesselPiracyRead:
      direct || piracy
        ? `${direct} commercial-vessel event${direct === 1 ? "" : "s"} ` +
          `and ${piracy} piracy or armed-robbery event${piracy === 1 ? "" : "s"} ` +
          `are reported in the window.`
        : "No commercial-vessel attack, seizure or piracy event is reported in this window.",
    maritimeSecurityRead:
      dataset.maritimeSecurity.rows.length > 0
        ? "Separate maritime-security reporting provides additional context for this window."
        : "No separate maritime-security reporting is available in this window.",
    commercialImpactRead:
      commercialConsequences.length > 0
        ? "A commercial consequence is reported alongside the relevant maritime developments."
        : "No confirmed commercial cost, insurance, rerouting or transit-time consequence is reported in this window.",
    regionalCountryRead:
      `${geographySentence} The regional view follows that physical geography.`,
    whatMatters:
      `Assessment: ${risk} overall maritime risk is concentrated on ${place}. ` +
      `What matters operationally is whether another ${event} occurs or a route disruption is reported; ` +
      `that assessment is distinct from the highest individual incident severity of ${highest}.`,
    implications:
      route
        ? `Review passage plans and escalation triggers for ${route}.`
        : "Review escalation triggers for further maritime incidents.",
    watchNext:
      route
        ? `Monitor ${route} for a further ${event}, a route disruption, or a commercial consequence.`
        : `Monitor for a further ${event}, a physical route relationship, or a commercial consequence.`,
    polestarView:
      `Polestar assesses overall maritime risk as ${risk}, while the highest individual incident severity is ${highest}. ` +
      `Priority remains ${place}; the assessment would change if a new ${event} or route disruption were reported.`,
  };
}

function clientMaritimeBoard(
  board: MaritimeIntelligence,
  dataset: ShippingReportDataset,
): MaritimeIntelligence {
  const riskRationale =
    board.risk.label === "Not assessed"
      ? "No maritime incident was reported in this window."
      : `Overall risk is assessed from maritime incidents; the highest individual severity is ${highestSeverity(dataset.canonicalIncidents)}.`;
  const risk = { ...board.risk, rationale: riskRationale };
  return {
    ...board,
    risk,
    bluf:
      board.risk.label === "Not assessed"
        ? "Maritime risk is not assessed because no maritime incident was reported in this window."
        : `Maritime risk is ${board.risk.label}. ${riskRationale}`,
    // Empty route cards are not a client-facing finding.  Movement-only
    // theatres and the fixed board vocabulary must not become seven rows
    // saying "None in window"; retain only routes with a current confirmed
    // incident or an explicitly confirmed indirect route consequence.
    chokepointCards: board.chokepointCards
      .filter((card) => card.incidentCount > 0)
      .map((card) => ({
        ...card,
        lastConfirmed: card.lastConfirmed
          ? { ...card.lastConfirmed, title: "Incident reported" }
          : null,
        risk: {
          ...card.risk,
          rationale:
            card.risk.label === "Not assessed"
              ? "No maritime incident was reported at this route in this window."
              : `Route-specific risk is assessed from reported incidents at ${card.key}.`,
        },
      })),
  };
}

function issue(
  issues: ShippingPublicationIssue[],
  code: string,
  message: string,
  section?: string,
  incidentIds?: Array<number | string>,
): void {
  issues.push({ code, message, section, incidentIds });
}

function validateClientFacingBoard(
  board: MaritimeIntelligence,
  issues: ShippingPublicationIssue[],
): void {
  const implementationCommentary =
    /\b(canonical|source[- ]grounded|semantic evidence|AIS movement|movement as evidence|validated incident|validated maritime|newly validated|route context|incident totals|shown separately|operational tables|backend|data layer|internal pipeline)\b/i;
  const visible = [
    ["board.bluf", board.bluf],
    ["board.risk", board.risk.rationale],
    ...board.confirmedIncidents.map((incident) => [
      `board.confirmed:${String(incident.id)}`,
      `${incident.category} ${incident.title} ${incident.country ?? ""}`,
    ] as const),
    ...board.keyRiskIndicators.map((indicator, index) => [
      `board.indicator:${index}`,
      indicator,
    ] as const),
    ...board.watchNext.map((item, index) => [
      `board.watchNext:${index}`,
      item,
    ] as const),
    ...board.chokepointCards.map((card) => [
      `board.chokepoint:${card.key}`,
      card.risk.rationale,
    ] as const),
  ] as Array<[string, string]>;
  for (const [section, text] of visible) {
    if (implementationCommentary.test(text)) {
      issue(
        issues,
        "BOARD_BACKEND_COMMENTARY",
        "Visible Maritime Intelligence text contains implementation commentary.",
        section,
      );
    }
  }
}

function addConsistencyIssues(
  dataset: ShippingReportDataset,
  board: MaritimeIntelligence,
  facts: KpiCard[],
  issues: ShippingPublicationIssue[],
): void {
  try {
    assertShippingReportConsistency(dataset, board, facts);
  } catch (error) {
    issue(
      issues,
      "CANONICAL_CONSISTENCY",
      error instanceof Error ? error.message : "Canonical shipping consistency failed.",
    );
  }
  const vesselFact = facts.find((fact) => fact.label === "Vessel Attacks / Seizures");
  if (!vesselFact || vesselFact.value !== String(dataset.vesselRows.length)) {
    issue(
      issues,
      "VESSEL_FAST_FACT_MISMATCH",
      "Vessel attack/seizure Fast Fact does not match the canonical vessel table.",
      "fastFacts",
    );
  }
  const piracyFact = facts.find((fact) => fact.label === "Piracy / Armed Robbery");
  if (!piracyFact || piracyFact.value !== String(dataset.piracyRows.length)) {
    issue(
      issues,
      "PIRACY_FAST_FACT_MISMATCH",
      "Piracy Fast Fact does not match the canonical piracy table.",
      "fastFacts",
    );
  }
  const autoFactsByLabel = new Map(dataset.fastFacts.map((fact) => [fact.label, fact]));
  for (const label of ["Confirmed Incidents", "Highest Severity", "Main Affected Chokepoint"]) {
    const current = facts.find((fact) => fact.label === label);
    const expected = autoFactsByLabel.get(label);
    if (current && expected && current.value !== expected.value) {
      issue(
        issues,
        label === "Highest Severity"
          ? "FAST_FACT_SEVERITY_MISMATCH"
          : label === "Main Affected Chokepoint"
            ? "FAST_FACT_ROUTE_MISMATCH"
            : "FAST_FACT_COUNT_MISMATCH",
        `Fast Fact ${label} does not match the canonical publication value.`,
        "fastFacts",
      );
    }
  }

  const ids = dataset.canonicalIncidents.map((row) => String(row.id));
  if (new Set(ids).size !== ids.length) {
    issue(issues, "DUPLICATE_CANONICAL_INCIDENT", "The canonical incident set contains duplicate incident IDs.");
  }
  const developmentKeys = new Map<string, string>();
  for (const row of dataset.canonicalIncidents) {
    const semantic = semanticFor(row);
    const key = trim(semantic?.developmentKey);
    if (!key) continue;
    const prior = developmentKeys.get(key);
    if (prior && prior !== String(row.id)) {
      issue(
        issues,
        "DUPLICATE_DEVELOPMENT",
        `Development ${key} appears more than once in the canonical publication set.`,
        "canonical",
        [prior, row.id],
      );
    }
    developmentKeys.set(key, String(row.id));
  }

  for (const row of dataset.vesselRows) {
    const semantic = semanticFor(row);
    if (!semantic) continue;
    const validVesselClass =
      semantic.eventClass === "commercial_attack" ||
      semantic.eventClass === "commercial_seizure" ||
      semantic.eventClass === "piracy_or_armed_robbery" ||
      semantic.eventClass === "drone_activity";
    if (
      !validVesselClass ||
      semantic.verdict !== "valid" ||
      semantic.eventOccurred !== true ||
      !semantic.commercialTargetValidated
    ) {
      issue(
        issues,
        "VESSEL_TOTAL_NOT_CANONICAL",
        "Vessel attack totals include an event class without validated commercial-target evidence.",
        "vessel",
        [row.id],
      );
    }
  }
  for (const row of dataset.piracyRows) {
    const semantic = semanticFor(row);
    if (
      semantic &&
      (semantic.verdict !== "valid" ||
        semantic.eventOccurred !== true ||
        semantic.eventClass !== "piracy_or_armed_robbery" ||
        !semantic.commercialTargetValidated)
    ) {
      issue(
        issues,
        "PIRACY_TOTAL_NOT_CANONICAL",
        "Piracy totals include an event without validated piracy and target evidence.",
        "piracy",
        [row.id],
      );
    }
  }

  const incidentIds = new Set(ids);
  for (const row of [...dataset.vesselRows, ...dataset.piracyRows, ...dataset.commercialRows]) {
    if (!incidentIds.has(String(row.id))) {
      issue(issues, "TABLE_NON_CANONICAL_ROW", "A rendered table row is not in the canonical incident set.", "tables", [row.id]);
    }
  }
  for (const row of board.confirmedIncidents) {
    if (!incidentIds.has(String(row.id))) {
      issue(issues, "BOARD_NON_CANONICAL_ROW", "The Maritime Intelligence board contains a non-canonical incident.", "board", [row.id]);
    }
  }
}

function validateSemanticRows(
  rawIncidents: ShippingReportIncident[],
  dataset: ShippingReportDataset,
  issues: ShippingPublicationIssue[],
): void {
  const semanticRows = rawIncidents
    .map((row) => ({ row, semantic: semanticFor(row) }))
    .filter((value): value is { row: ShippingReportIncident; semantic: SemanticEvidence } =>
      Boolean(value.semantic),
    );
  if (semanticRows.length === 0) return;

  const canonicalById = new Map(
    dataset.canonicalIncidents.map((row) => [String(row.id), row]),
  );
  const semanticRouteNames = new Set(
    dataset.canonicalIncidents
      .map(semanticFor)
      .filter(
        (semantic): semantic is SemanticEvidence =>
          Boolean(
            semantic &&
              (semantic.routeRelationship?.kind === "physical" ||
                semantic.routeRelationship?.kind === "direct_passage") &&
              trim(semantic.routeRelationship.routeName),
          ),
      )
      .map((semantic) => normalizeText(semantic.routeRelationship?.routeName)),
  );
  if (
    dataset.chokepointRows.some((row) => row.count > 0) &&
    semanticRouteNames.size === 0
  ) {
    issue(
      issues,
      "ROUTE_DERIVATION_CONTRADICTION",
      "Chokepoint totals are present but no canonical semantic incident has a physical or direct-passage route relationship.",
      "route",
    );
  }
  const validClasses = new Set([
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
  ]);
  const commercialClasses = new Set([
    "commercial_attack",
    "commercial_seizure",
    "piracy_or_armed_robbery",
    "port_disruption",
  ]);
  const militaryClasses = new Set([
    "naval_activity",
    "military_naval_activity",
    "military_exercise",
    "drone_activity",
  ]);

  for (const { row, semantic } of semanticRows) {
    const id = row.id;
    const canonical = canonicalById.get(String(id));
    const section = `incident:${String(id)}`;
    if (semantic.verdict !== "valid" || semantic.eventOccurred !== true) {
      if (canonical) issue(issues, "INVALID_SEMANTIC_INCIDENT", "A non-valid semantic incident reached the canonical set.", section, [id]);
      continue;
    }
    if (!semantic.eventClass || !validClasses.has(semantic.eventClass)) {
      issue(issues, "INVALID_EVENT_CLASS", "The incident has no valid semantic event class.", section, [id]);
    }
    if (!semantic.eventClass || semantic.eventClass === "non_event") {
      issue(issues, "NON_EVENT_IN_CANONICAL_SET", "A semantic non-event reached the canonical set.", section, [id]);
    }
    const needsTarget = semantic.eventClass ? commercialClasses.has(semantic.eventClass) : false;
    if (
      needsTarget &&
      (!semantic.commercialTargetValidated ||
        !trim(semantic.commercialTargetEvidence) ||
        !semantic.commercialTarget ||
        semantic.commercialTarget === "none" ||
        semantic.commercialTarget === "unknown")
    ) {
      issue(issues, "UNVALIDATED_COMMERCIAL_TARGET", "A commercial event has no positively identified target evidence.", section, [id]);
    }
    if (
      militaryClasses.has(semantic.eventClass ?? "") &&
      canonical &&
      (dataset.vesselRows.some((vessel) => String(vessel.id) === String(id)) ||
        dataset.piracyRows.some((piracy) => String(piracy.id) === String(id))) &&
      !semantic.commercialTargetValidated
    ) {
      issue(issues, "MILITARY_AS_COMMERCIAL_EVENT", "Military or drone activity was counted as a direct commercial incident without target evidence.", section, [id]);
    }
    if (semantic.physicalLocation !== null && semantic.physicalLocation !== undefined && !trim(semantic.physicalLocationEvidence)) {
      issue(issues, "UNSUPPORTED_PHYSICAL_LOCATION", "Physical location lacks source evidence.", section, [id]);
    }
    const route = semantic.routeRelationship;
    if (route && route.kind && route.kind !== "none" && (!trim(route.routeName) || !trim(route.evidence))) {
      issue(issues, "UNSUPPORTED_ROUTE_RELATIONSHIP", "A physical or direct/indirect route relationship lacks source evidence.", section, [id]);
    }
    if (
      route &&
      (route.kind === "indirect" || route.kind === "none") &&
      canonical &&
      dataset.chokepointRows.some(
        (chokepoint) =>
          chokepoint.count > 0 &&
          normalizeText(canonical.title).includes(normalizeText(chokepoint.name)),
      )
    ) {
      issue(
        issues,
        "ROUTE_RELATIONSHIP_CONTRADICTION",
        "A chokepoint incident is labelled as having no direct or physical route relationship.",
        section,
        [id],
      );
    }
    const consequence = semantic.routingConsequence;
    if (consequence && consequence.status && consequence.status !== "none") {
      if (!trim(consequence.claim ?? consequence.description) || !trim(consequence.evidence ?? consequence.evidenceQuote)) {
        issue(issues, "UNSUPPORTED_ROUTING_CONSEQUENCE", "A routing consequence lacks source evidence.", section, [id]);
      }
    }
    const sourceQuotes = semantic.sourceQuotes ?? [];
    if (sourceQuotes.length === 0 && (!semantic.evidence || semantic.evidence.length === 0)) {
      issue(issues, "MISSING_SEMANTIC_EVIDENCE", "The semantic incident has no source-grounded evidence.", section, [id]);
    }
    if (semantic.country && canonical) {
      const derived = trim(canonical.incidentCountry || canonical.country).toLowerCase();
      if (derived && normalizeText(derived) !== normalizeText(semantic.country)) {
        issue(issues, "COUNTRY_CONTRADICTION", "Canonical country contradicts the source-grounded physical country.", section, [id]);
      }
    }
    if (
      semantic.severity &&
      canonical &&
      SEVERITY_RANK[semantic.severity.toLowerCase()] &&
      SEVERITY_RANK[canonical.severity.toLowerCase()] &&
      SEVERITY_RANK[canonical.severity.toLowerCase()] > SEVERITY_RANK[semantic.severity.toLowerCase()]
    ) {
      issue(issues, "SEVERITY_CONTRADICTION", "Canonical severity is higher than the authoritative semantic severity.", section, [id]);
    }
  }
}

function referencesFor(
  dataset: ShippingReportDataset,
  _board?: MaritimeIntelligence,
): Array<{
  id: number | string;
  places: string[];
  terms: string[];
  headlineTerms: string[];
  eventTerms: string[];
  eventClass: string;
  route: string[];
  routeKind: string;
  target: string;
  consequenceClaims: string[];
  consequenceSupported: boolean;
  routeConsequenceSupported: boolean;
}> {
  return dataset.canonicalIncidents.map((row) => {
    const semantic = semanticFor(row);
    const places = [
      row.incidentCountry,
      semantic ? null : row.country,
      semantic ? null : row.location,
      semantic?.physicalLocation,
      semantic?.country,
      semantic?.coastalState,
    ]
      .map(trim)
      .filter(Boolean);
    const route = [
      semantic?.routeRelationship?.routeName,
      semantic ? null : row.location,
      ...dataset.chokepointRows
        .filter((chokepoint) => chokepoint.count > 0)
        .map((chokepoint) => chokepoint.name)
        .filter(
          (name) =>
            !semantic &&
            (normalizeText(row.title).includes(normalizeText(name)) ||
              normalizeText(row.location).includes(normalizeText(name))),
        ),
    ]
      .map(trim)
      .filter(Boolean);
    const headlineTerms = [row.title, row.summary].flatMap(tokens);
    const eventTerms = [
      semantic?.eventClass ? EVENT_CLASS_LABEL[semantic.eventClass] : "",
    ].flatMap(tokens);
    const terms = [
      row.title,
      row.summary,
      semantic?.eventClass ? EVENT_CLASS_LABEL[semantic.eventClass] : "",
      semantic?.commercialTarget,
      semantic?.commercialTargetName,
      semantic?.routingConsequence?.claim,
      semantic?.commercialConsequence?.claim,
      ...((semantic?.sourceQuotes ?? []).map((quote) => quote.claim ?? "")),
    ]
      .flatMap(tokens);
    return {
      id: row.id,
      places,
      terms,
      headlineTerms,
      eventTerms,
      eventClass: trim(semantic?.eventClass),
      route,
      routeKind: trim(semantic?.routeRelationship?.kind),
      target: trim(semantic?.commercialTarget),
      consequenceClaims: [
        semantic?.commercialConsequence?.claim,
        semantic?.routingConsequence?.claim,
        semantic?.routingConsequence?.description,
      ].map(normalizeText).filter(Boolean),
      consequenceSupported:
        semantic?.commercialConsequence?.status === "confirmed" ||
        semantic?.routingConsequence?.status === "confirmed" ||
        semantic?.routingConsequence?.status === "assessed",
      routeConsequenceSupported:
        semantic?.routingConsequence?.status === "confirmed" ||
        semantic?.routingConsequence?.status === "assessed",
    };
  });
}

function eventClassSupportsSentence(eventClass: string, sentence: string): boolean {
  const text = normalizeText(sentence);
  switch (eventClass) {
    case "commercial_attack":
      return /\b(attack|attacked|strike|fired|missile|hostilit)\b/.test(text);
    case "commercial_seizure":
      return /\b(seiz|detain|hijack|held)\b/.test(text);
    case "piracy_or_armed_robbery":
      return /\b(piracy|pirate|armed robber|robber|robbery|boarding|boarded|skiff)\b/.test(text);
    case "collision_or_grounding":
      return /\b(collision|collided|allision|ground|aground|capsiz|sank|sunk|stranded|adrift|wreck)\b/.test(text);
    case "port_disruption":
      return /\b(port|terminal|berth|dock|closure|closed|strike|stoppage|disrupt|congest)\b/.test(text);
    case "chokepoint_disruption":
      return /\b(chokepoint|blockade|blocked|closure|closed|disrupt|congest)\b/.test(text);
    case "route_disruption":
      return /\b(route|rerout|divert|blockade|blocked|closure|closed|disrupt|transit)\b/.test(text);
    case "environmental_maritime_event":
      return /\b(spill|pollut|storm|weather|hurricane|typhoon|environment|debris|oil)\b/.test(text);
    case "naval_activity":
      return /\b(naval|warship|frigate|destroyer|patrol|escort)\b/.test(text);
    case "military_naval_activity":
      return /\b(military|naval|warship|frigate|destroyer|patrol|escort)\b/.test(text);
    case "drone_activity":
      return /\b(drone|uav|unmanned)\b/.test(text);
    case "military_exercise":
      return /\b(exercise|drill|training|manoeuvre|maneuver)\b/.test(text);
    case "geopolitical_maritime_development":
      return /\b(diplomatic|sanction|tension|negotiat|geopolit|agreement|dispute)\b/.test(text);
    case "protest_or_labour":
      return /\b(protest|labou?r|union|worker|strike|stoppage|walkout)\b/.test(text);
    case "other_maritime_event":
      return /\b(event|incident|reported|occurred|confirmed|development)\b/.test(text);
    default:
      return false;
  }
}

function eventClassContradictsSentence(eventClass: string, sentence: string): boolean {
  const text = normalizeText(sentence);
  const military = /\b(naval|military|warship|frigate|destroyer|patrol|exercise|drill)\b/.test(text);
  const hostileCommercial = /\b(attack|attacked|seiz|hijack|piracy|robber|boarding|boarded)\b/.test(text);
  const physical = /\b(collision|collided|ground|aground|capsiz|sank|sunk|stranded|adrift)\b/.test(text);
  if (military && !["naval_activity", "military_naval_activity", "military_exercise"].includes(eventClass)) return true;
  if (hostileCommercial && ["collision_or_grounding", "environmental_maritime_event", "naval_activity", "military_naval_activity", "military_exercise"].includes(eventClass)) return true;
  if (physical && ["commercial_attack", "commercial_seizure", "piracy_or_armed_robbery", "naval_activity", "military_naval_activity", "military_exercise"].includes(eventClass)) return true;
  return false;
}

function sentenceSupported(
  sentence: string,
  references: ReturnType<typeof referencesFor>,
): boolean {
  const normalized = normalizeText(sentence);
  if (!normalized) return true;
  return references.some((reference) => {
    const placeMatch = reference.places.some((place) => {
      const candidate = normalizeText(place);
      return candidate.length >= 4 && normalized.includes(candidate);
    });
    const routeMatch = reference.route.some((route) => {
      const candidate = normalizeText(route);
      return candidate.length >= 4 && normalized.includes(candidate);
    });
    const termMatches = new Set(
      reference.terms.filter((term) => normalized.includes(term)),
    ).size;
    const headlineMatches = new Set(
      reference.headlineTerms.filter((term) => normalized.includes(term)),
    ).size;
    const eventMarker = /\b(attack|attacked|seizure|seized|piracy|boarding|grounding|collision|closure|disruption|incident|event)\b/i.test(sentence);
    const eventClassMatches = new Set(
      reference.eventTerms.filter((term) => normalized.includes(term)),
    ).size;
    const targetMention = /\b(vessel|ship|tanker|cargo|port|terminal|facility|shipping operations)\b/i.test(sentence);
    const aggregateEventCount =
      /\b\d+\s+(?:commercial[-\s]vessel|piracy|armed[-\s]robbery|maritime)\b/i.test(sentence);
    const specificEventMarker =
      !aggregateEventCount &&
      /\b(attack(?:ed)?|seiz(?:ed|ure)|piracy|boarding|grounding|collision|closure|disruption)\b/i.test(sentence);
    const genericEventMarker = /\b(incident|event)\b/i.test(sentence);
    const assessmentLanguage =
      /\b(no|not|without|monitor|assess(?:ed|ment)?|risk|may|might|could|potential|whether|review)\b/i.test(sentence);
    const eventLike =
      !aggregateEventCount &&
      (specificEventMarker ||
        (genericEventMarker && !assessmentLanguage) ||
        /\b(blockade|blocked|closure|closed|disruption|naval|military|drone|piracy|collision|grounding)\b/i.test(sentence));
    const classSupported = eventClassSupportsSentence(reference.eventClass, sentence);
    if (eventLike && (!classSupported || eventClassContradictsSentence(reference.eventClass, sentence))) {
      return false;
    }
    const targetCompatible =
      !targetMention ||
      !reference.target ||
      reference.target === "unknown" ||
      (reference.target === "vessel" && /\b(vessel|ship|tanker)\b/i.test(sentence)) ||
      (reference.target === "cargo" && /\b(cargo|freight)\b/i.test(sentence)) ||
      (reference.target === "port_facility" && /\b(port|terminal|facility)\b/i.test(sentence)) ||
      (reference.target === "shipping_operations" && /\b(shipping|operations?)\b/i.test(sentence));
    const routeClaim = /\b(route|passage|transit|shipping lane|chokepoint|rerout\w*|divert\w*)\b/i.test(sentence);
    const routeCompatible =
      !routeClaim ||
      reference.routeKind === "physical" ||
      reference.routeKind === "direct_passage" ||
      reference.routeKind === "indirect" ||
      reference.routeConsequenceSupported ||
      assessmentLanguage;
    return (
      (placeMatch || routeMatch || (headlineMatches >= 2 && eventMarker) || (eventClassMatches >= 2 && eventMarker)) &&
      (termMatches >= 1 || placeMatch || routeMatch) &&
      targetCompatible &&
      routeCompatible
    );
  });
}

function hasSupportedConsequence(
  sentence: string,
  dataset: ShippingReportDataset,
): boolean {
  const normalized = normalizeText(sentence);
  const consequenceTerms = /\b(cost|costs|freight|insurance|premium|rerout|divert|delay|delays|transit|schedule|surcharge|charter|capacity)\b/i;
  const assertedRouteConsequence =
    /\b(confirmed|reported|caused|forced|resulted|led to)\b[^.!?]{0,90}\b(rerout|divert|delay|closure|disruption)\b/i.test(sentence);
  if (!consequenceTerms.test(normalized) && !assertedRouteConsequence) return true;
  if (/\b(no|not|without|never)\b[^.!?]{0,100}\b(confirmed|supported|established|material|known|reported|evidence)\b/i.test(sentence)) {
    return true;
  }
  const assessment = /\b(assess|assessment|may|might|could|potential|if|would|risk|monitor|review|contingency|not|no|without|do not|does not)\b/i.test(sentence);
  if (
    assertedRouteConsequence &&
    assessment &&
    (!/\b(reported|caused|forced|resulted|led to)\b/i.test(sentence) ||
      /\b(whether|if|may|might|could|potential)\b/i.test(sentence))
  ) {
    return true;
  }
  return referencesFor(dataset).some((reference) => {
    if (!reference.consequenceSupported) return false;
    if (!sentenceSupported(sentence, [reference])) return false;
    const explicitlyConditional =
      /\b(may|might|could|potential|if|would)\b/i.test(sentence);
    if (assessment && explicitlyConditional) return true;
    return reference.consequenceClaims.some((claim) => {
      if (normalized.includes(claim)) return true;
      const claimTerms = new Set(tokens(claim).filter((term) => term.length >= 5));
      const sentenceTerms = new Set(tokens(sentence));
      const shared = [...claimTerms].filter((term) => sentenceTerms.has(term)).length;
      return claimTerms.size >= 2 && shared >= Math.ceil(claimTerms.size * 0.6);
    });
  });
}

function proseSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/u))
    .map((sentence) => sentence.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
}

function validateProse(
  prose: ShippingPublicationProse,
  dataset: ShippingReportDataset,
  board: MaritimeIntelligence,
  issues: ShippingPublicationIssue[],
): void {
  const sections = Object.entries(prose) as Array<[keyof ShippingPublicationProse, string]>;
  const references = referencesFor(dataset, board);
  const allText = sections.map(([, text]) => text).join("\n");
  const canonicalTitles = dataset.canonicalIncidents
    .map((row) => trim(row.title))
    .filter((title) => title.length >= 20);
  for (const title of canonicalTitles) {
    if (normalizeText(allText).includes(normalizeText(title))) {
      issue(issues, "RAW_EVIDENCE_TITLE", "Visible prose repeats a source headline instead of an evidence-grounded assessment.", "prose");
    }
  }

  const backendCommentary =
    /\b(backend|raw evidence|dataset|data layer|selector|query|left off (the )?(chart|table)|not counted because|context[- ]only|never counts|does not enter (the )?(count|table|chart)|deduplicat(?:ed|ion) pass|internal pipeline|canonical|source[- ]grounded|semantic evidence|AIS movement|movement as evidence|validated incident|validated maritime|newly validated|route context|incident totals|shown separately|operational tables)\b/i;
  const emptyRouteBoilerplate =
    /\b(no single (?:chokepoint|route) stands out|chokepoints? and major ports remain|hormuz,?\s*bab[- ]el[- ]mandeb|standing chokepoint exposure)\b/i;
  for (const [section, text] of sections) {
    const value = trim(text);
    if (!value) {
      issue(issues, "EMPTY_VISIBLE_PROSE", "A visible Shipping Watch prose section is empty.", section);
      continue;
    }
    if (backendCommentary.test(value)) {
      issue(issues, "BACKEND_COMMENTARY", "Visible prose contains backend or context-only commentary.", section);
    }
    if (!dataset.chokepointRows.some((row) => row.count > 0) && emptyRouteBoilerplate.test(value)) {
      issue(issues, "EMPTY_ROUTE_BOILERPLATE", "Route prose asserts a generic route picture without a validated route event.", section);
    }
    if (!hasSupportedConsequence(value, dataset)) {
      issue(issues, "UNSUPPORTED_COMMERCIAL_CONSEQUENCE", "Commercial cost, insurance, rerouting, delay or schedule claims lack supporting semantic evidence or assessment framing.", section);
    }
    for (const sentence of proseSentences(value)) {
      const namedLocation = sentence.match(
        /\b(?:in|at|near|around|through|off|on)\s+([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2})/,
      )?.[1];
      if (
        namedLocation &&
        !references.some((reference) =>
          [...reference.places, ...reference.route].some(
            (place) => {
              const candidate = normalizeText(place);
              const named = normalizeText(namedLocation);
              return (
                candidate === named ||
                candidate.startsWith(`${named} `) ||
                named.startsWith(`${candidate} `)
              );
            },
          ),
        )
      ) {
        issue(issues, "UNSUPPORTED_LOCATION_ASSERTION", "Prose names a country, route or location that is not in canonical evidence.", section);
      }
      const factual = hasAny(sentence, [
        /\b(reported|occurred|confirmed|attack(?:ed)?|seiz(?:ed|ure)|piracy|boarding|grounding|collision|blockad\w*|clos\w*|disrupt\w*|incident|event)\b/i,
        /\b(?:country|route|chokepoint|vessel|port|cargo|target|severity)\b/i,
      ]);
    const assessment = /\b(assess(?:ed|es|ment)?|judg(?:e|ement)|risk|priority|monitor|review|would|could|may|potential|implication|matters|validated|not|no|without|do not|does not)\b/i.test(sentence);
      const supported = sentenceSupported(sentence, references);
      const explicitEvent = /\b(attack(?:ed)?|seiz(?:ed|ure)|piracy|boarding|blockad\w*|clos\w*|disrupt\w*|vessel|port|cargo|target)\b/i.test(sentence);
      const namedEvidence = references.some((reference) =>
        [...reference.places, ...reference.route].some((value) => {
          const candidate = normalizeText(value);
          return candidate.length >= 4 && normalizeText(sentence).includes(candidate);
        }),
      );
      if ((factual && !assessment && !supported) || (explicitEvent && namedEvidence && !supported)) {
        issue(issues, "UNSUPPORTED_PROSE_ASSERTION", "A material prose sentence cannot be linked to one canonical incident and its evidence.", section);
      }
      if (
        section === "watchNext" &&
        !/\b(monitor|watch|track|review|assess|prepare|follow|look)\b/i.test(sentence)
      ) {
        issue(issues, "UNSUPPORTED_WATCH_NEXT", "Watch Next must state a concrete monitoring or review action.", section);
      }
      const watchNextMeaningful =
        section !== "watchNext" ||
        references.length === 0 ||
        references.some((reference) => {
          if (!sentenceSupported(sentence, [reference])) return false;
          if (eventClassSupportsSentence(reference.eventClass, sentence)) return true;
          const routeMention =
            /\b(route|passage|transit|chokepoint|shipping lane)\b/i.test(sentence);
          return routeMention && reference.route.length > 0;
        });
      if (section === "watchNext" && references.length > 0 && !watchNextMeaningful) {
        issue(issues, "UNSUPPORTED_WATCH_NEXT", "Watch Next must be tied to a current incident, route relationship or supported consequence.", section);
      }
    }
  }

  const tierPattern = "(insignificant|low|moderate|high|extreme)";
  const expectedRisk = trim(board.risk.label).toLowerCase();
  for (const [section, text] of sections) {
    // Bind a tier to the overall-risk claim itself. An Extreme individual
    // event can legitimately be discussed beside a lower overall assessment.
    const riskSubject = "(?:overall(?:\\s+(?:maritime|shipping(?:\\s+watch)?))?|maritime|shipping(?:\\s+watch)?)\\s+risk";
    const riskClaim = new RegExp(`\\b${riskSubject}\\b\\s*(?:(?:is|was|remains|stands at|is assessed as|is rated|:)\\s*)?${tierPattern}\\b`, "gi");
    const mentioned = [...text.matchAll(riskClaim)].map((match) => match[1].toLowerCase());
    if (mentioned.some((label) => label !== expectedRisk)) {
      issue(issues, "RISK_CONTRADICTION", `Prose contradicts the authoritative overall risk (${board.risk.label}).`, section);
    }
  }
  const expectedSeverity = highestSeverity(dataset.canonicalIncidents).toLowerCase();
  for (const [section, text] of sections) {
    for (const sentence of proseSentences(text)) {
      const superlative = "(?:highest|most serious|most severe|strongest|worst|peak|greatest)";
      const after = new RegExp(`\\b(?:${superlative}(?:\\s+(?:individual|incident|event|severity|level|was|is|rated|at|assessed|as|the))*|individual incident severity)\\s*(?::\\s*)?${tierPattern}\\b`, "gi");
      const before = new RegExp(`\\b${tierPattern}\\b(?:[-\\s]+(?:severity|rated|event|incident|was|is|remains|the|as))*\\s+${superlative}\\b`, "gi");
      const stated = [...sentence.matchAll(after), ...sentence.matchAll(before)]
        .map((match) => match[1].toLowerCase());
      if (expectedSeverity && stated.some((tier) => tier !== expectedSeverity)) {
        issue(issues, "HIGHEST_SEVERITY_CONTRADICTION", "Prose contradicts the canonical highest individual incident severity.", section);
      }
    }
  }

  if (trim(prose.whatMatters).split(/\s+/).length < 12 || !/\b(assessment|matters|means|risk|exposure|priority|operational)\b/i.test(prose.whatMatters)) {
    issue(issues, "NON_SUBSTANTIVE_WHAT_MATTERS", "What Matters must contain a substantive operational assessment.", "whatMatters");
  }
  if (!/\b(assess|assessment|risk|monitor|indicator|trigger|if|would|could|may)\b/i.test(prose.watchNext)) {
    issue(issues, "WATCH_NEXT_NOT_ASSESSMENT", "Watch Next must distinguish forward assessment from a reported fact.", "watchNext");
  }
  if (dataset.canonicalIncidents.length > 0) {
    const forward = proseSentences(prose.watchNext);
    if (forward.length === 0 || !forward.some((sentence) => sentenceSupported(sentence, references))) {
      issue(issues, "UNGROUNDED_WATCH_NEXT", "Watch Next contains no event-specific indicator tied to canonical evidence.", "watchNext");
    }
  }
  if (!/\b(assess|assessment|risk|priority|judg)\b/i.test(prose.polestarView)) {
    issue(issues, "POLESTAR_NOT_ASSESSMENT", "Polestar View must state an assessment rather than retell an event.", "polestarView");
  }

  const sectionPairs = sections.filter(([section]) => section !== "executiveSummary");
  for (let i = 0; i < sectionPairs.length; i += 1) {
    for (let j = i + 1; j < sectionPairs.length; j += 1) {
      const [leftSection, left] = sectionPairs[i];
      const [rightSection, right] = sectionPairs[j];
      for (const reference of references) {
        const distinctive = reference.headlineTerms.filter((term) => term.length >= 6);
        const overlap = new Set(
          distinctive.filter((term) => normalizeText(left).includes(term) && normalizeText(right).includes(term)),
        ).size;
        if (overlap >= 3) {
          issue(issues, "DUPLICATE_INCIDENT_RETELLING", "The same incident development is retold across visible prose sections.", `${leftSection}/${rightSection}`);
          break;
        }
      }
    }
  }
}

function validateRenderedSurfaces(
  dataset: ShippingReportDataset,
  fastFacts: KpiCard[],
  summaries: Record<string, string>,
  suppliedSummaries: Record<string, string> | undefined,
  issues: ShippingPublicationIssue[],
): void {
  const references = referencesFor(dataset);
  const backendCommentary =
    /\b(backend|raw evidence|dataset|data layer|selector|query|left off (the )?(chart|table)|not counted because|context[- ]only|never counts|internal pipeline)\b/i;
  for (const fact of fastFacts) {
    const note = trim(fact.note);
    if (!note) continue;
    if (backendCommentary.test(note)) {
      issue(issues, "FAST_FACT_BACKEND_COMMENTARY", "A Fast Fact override exposes backend or implementation commentary.", "fastFacts");
    }
    if (!hasSupportedConsequence(note, dataset)) {
      issue(issues, "FAST_FACT_UNSUPPORTED_CONSEQUENCE", "A Fast Fact note contains an unsupported commercial consequence.", "fastFacts");
    }
  }
  for (const row of dataset.chokepointRows) {
    if (backendCommentary.test(row.readText)) {
      issue(issues, "TABLE_BACKEND_COMMENTARY", "A chokepoint table read exposes backend commentary.", "chokepoints");
    }
    if (row.count === 0 && /\b(no single (?:chokepoint|route) stands out|standing chokepoint exposure)\b/i.test(row.readText)) {
      issue(issues, "EMPTY_ROUTE_BOILERPLATE", "A chokepoint row uses empty route boilerplate without a validated event.", "chokepoints");
    }
  }
  for (const row of dataset.relatedIncidents) {
    const id = String(row.id);
    const supplied = trim(suppliedSummaries?.[id]);
    const rendered = trim(summaries[id]);
    if (!rendered) {
      issue(issues, "EMPTY_INCIDENT_SUMMARY", "A rendered incident summary is empty.", "incidentSummary", [row.id]);
      continue;
    }
    if (backendCommentary.test(rendered)) {
      issue(issues, "INCIDENT_SUMMARY_BACKEND_COMMENTARY", "An incident summary exposes backend commentary.", "incidentSummary", [row.id]);
    }
    if (!hasSupportedConsequence(rendered, dataset)) {
      issue(issues, "INCIDENT_SUMMARY_UNSUPPORTED_CONSEQUENCE", "An incident summary contains an unsupported commercial consequence.", "incidentSummary", [row.id]);
    }
    // Deterministic summaries are generated from the incident itself.  Apply
    // the stricter arbitrary-claim check only to an analyst/AI supplied value.
    if (supplied) {
      for (const sentence of proseSentences(rendered)) {
        const factual = /\b(reported|occurred|confirmed|attack(?:ed)?|seiz(?:ed|ure)|piracy|boarding|grounding|collision|closure|disruption|incident|event|target|vessel|port|cargo)\b/i.test(sentence);
        if (factual && !sentenceSupported(sentence, references)) {
          issue(issues, "INCIDENT_SUMMARY_UNSUPPORTED_ASSERTION", "An edited incident summary cannot be linked to that incident's evidence.", "incidentSummary", [row.id]);
        }
      }
    }
  }
  // Saved summaries can outlive a row's appearance in Related Incidents (for
  // example when the same event is already shown in a specialised table).
  // Stale entries must not block publication: only summaries for rows in the
  // final Related Incidents table are client-facing and therefore auditable.
  const renderedSummaryIds = new Set(
    dataset.relatedIncidents.map((candidate) => String(candidate.id)),
  );
  for (const [id, suppliedText] of Object.entries(suppliedSummaries ?? {})) {
    if (!renderedSummaryIds.has(id)) continue;
    const row = dataset.canonicalIncidents.find((candidate) => String(candidate.id) === id);
    if (!row) {
      issue(issues, "SUMMARY_UNKNOWN_OVERRIDE", "An incident summary override has no canonical incident.", "incidentSummary");
      continue;
    }
    const rendered = trim(suppliedText);
    if (!rendered) continue;
    const rowDataset = { ...dataset, canonicalIncidents: [row] };
    const rowReferences = referencesFor(rowDataset);
    if (backendCommentary.test(rendered)) {
      issue(issues, "INCIDENT_SUMMARY_BACKEND_COMMENTARY", "An incident summary exposes backend commentary.", "incidentSummary", [row.id]);
    }
    if (!hasSupportedConsequence(rendered, rowDataset)) {
      issue(issues, "SUMMARY_UNSUPPORTED_CONSEQUENCE", "An incident summary contains an unsupported commercial consequence.", "incidentSummary", [row.id]);
    }
    for (const sentence of proseSentences(rendered)) {
      const namedLocation = sentence.match(
        /\b(?:in|at|near|around|through|off|on)\s+([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2})/,
      )?.[1];
      if (
        namedLocation &&
        !rowReferences.some((reference) =>
          [...reference.places, ...reference.route].some((place) => {
            const candidate = normalizeText(place);
            const named = normalizeText(namedLocation);
            return candidate === named || candidate.startsWith(`${named} `) || named.startsWith(`${candidate} `);
          }),
        )
      ) {
        issue(issues, "SUMMARY_UNSUPPORTED_LOCATION", "An incident summary names a location outside that incident's evidence.", "incidentSummary", [row.id]);
      }
      const factual = /\b(reported|occurred|confirmed|attack(?:ed)?|seiz(?:ed|ure)|piracy|boarding|grounding|collision|closure|disruption|incident|event|target|vessel|port|cargo)\b/i.test(sentence);
      if (factual && !sentenceSupported(sentence, rowReferences)) {
        issue(issues, "INCIDENT_SUMMARY_UNSUPPORTED_ASSERTION", "An edited incident summary cannot be linked to that incident's evidence.", "incidentSummary", [row.id]);
      }
    }
  }
}

function auditWithGenericEvidence(
  prose: ShippingPublicationProse,
  dataset: ShippingReportDataset,
  issues: ShippingPublicationIssue[],
): void {
  try {
    const typedReferences: FinalReportTypedReference[] = referencesFor(dataset).flatMap((reference) => [
      {
        id: `shipping-${String(reference.id)}`,
        type: "forward-indicator" as const,
        text: [...reference.places, ...reference.route, ...reference.terms].join(" "),
        evidenceId: reference.id,
      },
    ]);
    // Watch Next must be grounded by the canonical incident references above.
    // Never add the section itself as evidence: doing so makes this audit
    // circular and lets arbitrary prose self-authorize.
    const generic = auditFinalReportEvidence({
      topic: "shipping",
      issueDate: new Date().toISOString().slice(0, 10),
      evidence: dataset.canonicalIncidents.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary ?? null,
        country: row.incidentCountry ?? row.country ?? null,
        location: row.location ?? null,
        severity: row.severity,
        occurredAt: row.occurredAt,
        supportedClaims: [row.issue],
      })),
      sections: {
        executiveSummary: prose.executiveSummary,
        whatMatters: prose.whatMatters,
        implications: prose.implications,
        // With no canonical incidents, the deterministic Watch Next sentence
        // is intentionally a safe no-data instruction, not an evidence claim.
        watchNext: typedReferences.length > 0 ? prose.watchNext : "",
        polestarView: prose.polestarView,
      },
      validatedForwardIndicators: [],
      typedReferences,
    });
    for (const finding of generic) {
      issue(issues, `GENERIC_${finding.code ?? "EVIDENCE"}`, finding.message, finding.section);
    }
  } catch (error) {
    issue(issues, "GENERIC_EVIDENCE_AUDIT", error instanceof Error ? error.message : "Evidence audit failed.");
  }
}

/**
 * Build the complete, renderer-independent Shipping Watch publication model.
 * This function does not throw for evidence failures: callers can show the
 * validation state in the editor. PDF/export callers should use
 * assertShippingPublication before rendering.
 */
export function finalizeShippingPublication(
  options: ShippingPublicationOptions,
): ShippingPublicationBundle {
  const topic = options.topic ?? options.report?.topic ?? "shipping";
  const issueDate =
    options.issueDate ??
    options.report?.issueDate ??
    new Date().toISOString().slice(0, 10);
  const baseDataset =
    options.dataset ??
    buildShippingReportDataset(
      options.incidents,
      topic,
      issueDate,
      options.maritimeSecurityEvents ?? [],
    );
  const detailedIncidentIds = new Set(
    [
      ...baseDataset.vesselRows,
      ...baseDataset.piracyRows,
      ...baseDataset.commercialRows,
    ].map((row) => String(row.id)),
  );
  const semanticPublication = baseDataset.canonicalIncidents.some((row) => Boolean(semanticFor(row)));
  const boardIncidentIds = new Set<string>();
  const window = resolveReportWindow(topic, issueDate);
  const builtMaritimeBoard = buildMaritimeIntelligence({
    incidents: baseDataset.canonicalIncidents,
    movement: options.movement ?? [],
    windowStart: window.start,
    windowEnd: window.end,
    inputMode: "prevalidated",
  });
  for (const row of builtMaritimeBoard.confirmedIncidents) {
    boardIncidentIds.add(String(row.id));
  }
  const vesselOrPiracyIds = new Set(
    [...baseDataset.vesselRows, ...baseDataset.piracyRows].map((row) => String(row.id)),
  );
  const dataset: ShippingReportDataset = {
    ...baseDataset,
    chokepointRows: baseDataset.chokepointRows.map((row) => ({
      ...row,
      readText:
        row.count > 0
          ? `Reported activity was recorded at ${row.name} during this window.`
          : `No incident was reported at ${row.name} during this window.`,
    })),
    // The Maritime Intelligence confirmed table carries the event detail.
    // Specialised tables retain dates, severity and classification but do not
    // repeat the source headline.
    vesselRows: semanticPublication
      ? baseDataset.vesselRows.map((row) => ({
          ...row,
          title: "Commercial-vessel event",
        }))
      : baseDataset.vesselRows,
    piracyRows: semanticPublication
      ? baseDataset.piracyRows.map((row) => ({
          ...row,
          title: "Piracy or armed-robbery event",
        }))
      : baseDataset.piracyRows,
    commercialRows: semanticPublication
      ? baseDataset.commercialRows.filter(
          (row) => !boardIncidentIds.has(String(row.id)) && !vesselOrPiracyIds.has(String(row.id)),
        )
      : baseDataset.commercialRows,
    // Detailed incident rows already appear in Maritime Intelligence or a
    // specialised table. Related Incidents is reserved for developments not
    // otherwise given a full event row, so an event is not retold at the end.
    relatedIncidents: semanticPublication
      ? baseDataset.relatedIncidents.filter((row) => {
          const id = String(row.id);
          return !boardIncidentIds.has(id) && !detailedIncidentIds.has(id);
        })
      : baseDataset.relatedIncidents,
  };
  const maritimeBoard = clientMaritimeBoard(builtMaritimeBoard, dataset);
  const fastFacts = applyFastFactOverrides(
    dataset.fastFacts,
    options.sectionOverrides?.fastFactOverrides,
  ).map((fact) => {
    if (fact.label === "Latest Significant Incident" && fact.note) {
      return { ...fact, note: "Incident reported" };
    }
    if (fact.label === "Confirmed Incidents" && fact.note) {
      return { ...fact, note: undefined };
    }
    return fact;
  });
  const deterministic = safeDeterministicProse(dataset, maritimeBoard, options.incidents);
  const draft = stableDraftTopicReportProse({
    topic,
    issueDate,
    incidents: toDraftableIncidents(dataset.canonicalIncidents),
  });
  const ai = options.aiProse?.stale ? null : options.aiProse;
  const report = options.report ?? {};
  const resolveNarrative = (
    field: keyof Pick<ShippingPublicationReport, "executiveSummary" | "whatMatters" | "implications" | "watchNext" | "polestarView">,
    fallback: string,
  ): string => {
    const saved = trim(report[field]);
    // ReportEditor seeds these fields with draftReportProse.  Treat an exact
    // generated seed as blank so a stale seed cannot veto the live finalizer.
    const seeded = trim(draft[field]);
    const analyst = saved && saved !== seeded ? saved : "";
    const aiText = trim(ai?.[field]);
    return analyst || aiText || fallback;
  };
  const resolveRead = (
    field: keyof Pick<ShippingPublicationReport, "chokepointRouteRead" | "vesselPiracyRead" | "maritimeSecurityRead" | "commercialImpactRead" | "regionalCountryRead">,
    fallback: string,
  ): string => trim(report[field]) || fallback;
  const prose: ShippingPublicationProse = {
    executiveSummary: resolveNarrative("executiveSummary", deterministic.executiveSummary),
    chokepointRouteRead: resolveRead("chokepointRouteRead", deterministic.chokepointRouteRead),
    vesselPiracyRead: resolveRead("vesselPiracyRead", deterministic.vesselPiracyRead),
    maritimeSecurityRead: resolveRead("maritimeSecurityRead", deterministic.maritimeSecurityRead),
    commercialImpactRead: resolveRead("commercialImpactRead", deterministic.commercialImpactRead),
    regionalCountryRead: resolveRead("regionalCountryRead", deterministic.regionalCountryRead),
    whatMatters: resolveNarrative("whatMatters", deterministic.whatMatters),
    implications: resolveNarrative("implications", deterministic.implications),
    watchNext: resolveNarrative("watchNext", deterministic.watchNext),
    polestarView: resolveNarrative("polestarView", deterministic.polestarView),
  };
  const summaries: Record<string, string> = {};
  // Summary generation and rendering are scoped to the final Related
  // Incidents rows. Canonical incidents already shown in Maritime Intelligence
  // or a specialised table do not need (and must not request) a second
  // narrative line. This also makes stale cache entries harmless.
  for (const row of dataset.relatedIncidents) {
    const id = String(row.id);
    summaries[id] = resolveIncidentSummary(row, options.incidentSummaries);
  }
  const issues: ShippingPublicationIssue[] = [];
  const reportRisk = trim(report.riskRating).toLowerCase();
  const authoritativeRisk = trim(maritimeBoard.risk.label).toLowerCase();
  if (
    reportRisk &&
    SEVERITY_RANK[reportRisk] &&
    reportRisk !== authoritativeRisk
  ) {
    issue(
      issues,
      "REPORT_RISK_CONTRADICTION",
      `Report risk rating (${report.riskRating}) contradicts the authoritative Maritime Intelligence risk (${maritimeBoard.risk.label}).`,
      "risk",
    );
  }
  const dynamicOverrides = options.sectionOverrides as
    | (TopicSectionOverrides & { tableOverrides?: Record<string, unknown> })
    | null
    | undefined;
  if (
    (options.tableOverrides && Object.keys(options.tableOverrides).length > 0) ||
    (dynamicOverrides?.tableOverrides && Object.keys(dynamicOverrides.tableOverrides).length > 0)
  ) {
    issue(
      issues,
      "UNSUPPORTED_TABLE_OVERRIDE",
      "Shipping table overrides are not accepted until they can be reconciled with the canonical incident set.",
      "tables",
    );
  }
  // The source consistency helper checks that the lead incident is represented
  // in the dataset's prioritised Related Incidents source list.  Publication
  // removes rows already shown in a detailed board/table surface below, so run
  // that source-level check before the no-retelling projection is applied.
  addConsistencyIssues(baseDataset, maritimeBoard, fastFacts, issues);
  validateClientFacingBoard(maritimeBoard, issues);
  validateSemanticRows(options.incidents, dataset, issues);
  validateProse(prose, dataset, maritimeBoard, issues);
  auditWithGenericEvidence(prose, dataset, issues);
  validateRenderedSurfaces(
    dataset,
    fastFacts,
    summaries,
    options.incidentSummaries,
    issues,
  );

  return {
    dataset,
    maritimeBoard,
    fastFacts,
    prose,
    tables: {
      chokepoints: dataset.chokepointRows,
      vessel: dataset.vesselRows,
      piracy: dataset.piracyRows,
      commercial: dataset.commercialRows,
      regions: dataset.regionRows,
      countries: dataset.countryRows,
      maritimeSecurity: dataset.maritimeSecurity,
      related: dataset.relatedIncidents,
    },
    charts: {
      regions: dataset.regionRows,
      countries: dataset.countryRows,
    },
    incidentSummaries: summaries,
    hiddenSections: new Set(options.hiddenSections ?? []),
    auditIssues: issues,
  };
}

export class ShippingPublicationValidationError extends Error {
  readonly issues: ShippingPublicationIssue[];

  constructor(issues: ShippingPublicationIssue[]) {
    super(
      `Shipping Watch publication validation failed: ${issues
        .map((item) => item.message)
        .join(" ")}`,
    );
    this.name = "ShippingPublicationValidationError";
    this.issues = issues;
  }
}

export function assertShippingPublication(
  publication: ShippingPublicationBundle,
): ShippingPublicationBundle {
  if (publication.auditIssues.length > 0) {
    throw new ShippingPublicationValidationError(publication.auditIssues);
  }
  return publication;
}

export function validateShippingPublication(
  options: ShippingPublicationOptions,
): ShippingPublicationIssue[] {
  return finalizeShippingPublication(options).auditIssues;
}

/** Naming aliases used by topic publication adapters and publication tests. */
export function validateShippingFinalEvidenceAudit(
  publication: ShippingPublicationBundle,
): ShippingPublicationIssue[] {
  return publication.auditIssues;
}

export function assertFinalShippingPublication(
  publication: ShippingPublicationBundle,
): ShippingPublicationBundle {
  return assertShippingPublication(publication);
}
