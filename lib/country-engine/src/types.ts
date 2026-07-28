// Canonical country-report engine schema (owner brief §2).
//
// Pure types only — no runtime dependencies, safe for browser + server.
// Every source article becomes a SourceRecord; validated occurrences become
// CanonicalEvents. All country reports read ONLY from this schema.

// ---------------------------------------------------------------------------
// Controlled vocabularies
// ---------------------------------------------------------------------------

export const EVENT_STATUSES = [
  "Confirmed",
  "Ongoing",
  "Ended",
  "Planned",
  "Cancelled",
  "Unverified",
  "Commentary",
  "Background",
  "Not an incident",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const LOCATION_PRECISIONS = [
  "Exact site",
  "Town or city",
  "District",
  "Province or state",
  "Country only",
  "Unknown",
] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

// Fixed Pole Star five-tier severity vocabulary. No other wording may enter
// reports.
export const SEVERITIES = [
  "Insignificant",
  "Low",
  "Moderate",
  "High",
  "Extreme",
] as const;
export type Severity = (typeof SEVERITIES)[number];

// Controlled issue taxonomy (§10). One primary category per event.
export const ISSUE_CATEGORIES = [
  "Violent crime",
  "Theft and robbery",
  "Organised crime",
  "Communal or tribal violence",
  "Terrorism",
  "Insurgency",
  "Political violence",
  "Civil unrest",
  "Strike or labour action",
  "Governance and regulatory",
  "Policing operation",
  "Aviation",
  "Maritime",
  "Road and rail",
  "Utilities",
  "Telecommunications",
  "Infrastructure",
  "Natural hazard",
  "Health",
  "Supply chain",
  "Other operational disruption",
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const INCLUSION_STATUSES = ["included", "excluded", "held"] as const;
export type InclusionStatus = (typeof INCLUSION_STATUSES)[number];

// Permanent exclusion reasons (§4). Stored, never turned into Low filler.
export const EXCLUSION_REASONS = [
  "conference_or_forum",
  "ceremony_or_praise",
  "appointment_or_leadership",
  "policy_or_development_announcement",
  "commentary_or_opinion",
  "background_or_explainer",
  "misinformation_or_factcheck",
  "recycled_or_out_of_window",
  "foreign_venue",
  "duplicate",
  "response_only_followup",
  "successful_routine_response",
  "low_confidence",
  "not_an_event",
  // §7 gate tuning (held-queue regrowth): judicial / prosecutorial process
  // reporting (trials, corruption probes, verdicts) and preparedness /
  // awareness / risk-warning activity are non-occurrences, not incidents.
  "legal_process",
  "preparedness_or_awareness",
  // City-scoped reports (Jakarta): a home-country record with no gazetteer
  // match inside the city footprint is out of scope for the city brief.
  "outside_city_scope",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const IMPACT_LEVELS = ["Direct", "Indirect", "Monitor only"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export const SOURCE_RELIABILITIES = ["High", "Medium", "Low", "Unknown"] as const;
export type SourceReliability = (typeof SOURCE_RELIABILITIES)[number];

export const CLAIM_TYPES = [
  "Confirmed fact",
  "Assessment",
  "Forecast",
  "Trend",
  "Recommendation",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

// ---------------------------------------------------------------------------
// Source record (§2)
// ---------------------------------------------------------------------------

export interface SourceRecord {
  // Stable id — for rows derived from the incidents table this is the incident
  // id as a string.
  sourceRecordId: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceType: "news" | "wire" | "aggregator" | "official" | "social" | "other";
  publicationDate: string; // ISO
  retrievalDate: string | null; // ISO
  originalHeadline: string;
  articleText: string | null; // summary text where full text unavailable
  language: string; // "en", "id", ...
  translatedText: string | null; // English display title where translated
  sourceReliability: SourceReliability;
  sourceCountry: string | null;
  processingStatus: "processed" | "excluded" | "held";
}

// ---------------------------------------------------------------------------
// Canonical event (§2)
// ---------------------------------------------------------------------------

export interface CanonicalEvent {
  eventId: string; // deterministic: representative source record id
  eventTitle: string; // natural title, never a raw wire headline
  eventSummary: string;
  eventDate: string | null; // ISO date the event OCCURRED (null = unknown)
  eventEndDate: string | null;
  publicationDates: string[]; // ISO, all supporting sources
  physicalCountry: string; // where it physically happened
  relatedCountry: string | null; // country merely concerned/mentioned
  city: string | null;
  district: string | null;
  provinceOrState: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: LocationPrecision;
  issueCategory: IssueCategory;
  issueSubcategory: string | null;
  secondaryCategories: IssueCategory[];
  eventStatus: EventStatus;
  severity: Severity;
  severityReason: string;
  casualties: number | null;
  injuries: number | null;
  arrests: number | null;
  infrastructureImpact: string | null;
  transportImpact: string | null;
  commercialImpact: string | null;
  staffImpact: string | null;
  siteImpact: string | null;
  continuityImpact: string | null;
  confirmedOperationalEffect: string | null; // confirmed facts only
  assessedOperationalRelevance: string | null; // assessment wording only
  impactLevel: ImpactLevel;
  classificationConfidence: number; // 0-100
  locationConfidence: number; // 0-100
  dateConfidence: number; // 0-100
  supportingSourceIds: string[];
  duplicateGroupId: string | null;
  relatedEventIds: string[]; // linked responses/updates (§9)
  inclusionStatus: InclusionStatus;
  exclusionReason: ExclusionReason | null;
}

// ---------------------------------------------------------------------------
// Evidence records (§29)
// ---------------------------------------------------------------------------

export interface EvidenceRecord {
  claimId: string;
  claimText: string;
  section: string;
  supportingEventIds: string[];
  supportingSourceIds: string[];
  supportingMetric: string | null;
  claimType: ClaimType;
  confidence: number; // 0-100
}

// ---------------------------------------------------------------------------
// Engine input/output
// ---------------------------------------------------------------------------

// A raw incident-table row projected into the engine's input shape. The engine
// NEVER reads the incidents table directly — callers project rows into this.
export interface EngineSourceInput {
  id: string;
  topic: string;
  title: string;
  displayTitle?: string | null; // English translation where present
  summary?: string | null;
  country?: string | null; // stored (possibly compound) country tag
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  occurredAt: string; // stored occurrence/publication timestamp (ISO)
  incidentDate?: string | null; // explicit extracted event date where known
  province?: string | null;
  category?: string | null; // legacy classifier label, advisory only
  severity?: string | null; // stored severity (lowercase five-tier)
  source?: string | null;
  sourceUrl?: string | null;
  fatalities?: number | null;
}

// Analyst overrides applied on top of engine output (persisted server-side,
// audit-logged). All optional; the engine result is authoritative otherwise.
export interface AnalystEventOverride {
  eventId: string;
  physicalCountry?: string;
  eventDate?: string | null;
  issueCategory?: IssueCategory;
  locationPrecision?: LocationPrecision;
  severity?: Severity;
  inclusionStatus?: InclusionStatus; // exclude / approve a held record
  exclusionReason?: ExclusionReason | null;
  mergeIntoEventId?: string; // merge this event into another
  splitSourceIds?: string[]; // split these sources out as a new event
}

export interface EngineResult {
  sourceRecords: SourceRecord[];
  events: CanonicalEvent[]; // ALL canonical events, incl. excluded/held
  included: CanonicalEvent[]; // inclusionStatus === "included" only
  held: CanonicalEvent[];
  excluded: CanonicalEvent[];
  stats: {
    sourcesProcessed: number;
    excluded: number;
    held: number;
    duplicatesMerged: number;
    reattributed: number; // physical country differs from stored tag
  };
}

// ---------------------------------------------------------------------------
// Per-country configuration (§1) — data only, never logic.
// ---------------------------------------------------------------------------

export interface CountryEngineConfig {
  slug: string;
  countryName: string;
  // Accepted country tokens (mirror countryMatch groups).
  acceptedTokens: string[];
  // Known cities/provinces: token -> { province, lat, lng, precision }.
  gazetteer: Record<
    string,
    { province: string; lat?: number; lng?: number; precision: LocationPrecision }
  >;
  // Map bounds [south, west, north, east]; insets optional for archipelagos.
  mapBounds: [number, number, number, number] | null;
  // Approved local sources: name substring -> reliability.
  sourceReliability: Record<string, SourceReliability>;
  // Country-specific terminology (advisory keywords for local categories).
  localTerms?: Record<string, IssueCategory>;
  // City-scoped report (Jakarta): restrict to gazetteer-scoped records.
  cityScope?: boolean;
}
