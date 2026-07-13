import { TRIGGER_TERMS, matchesTerms } from "./triggerTerms";
import { routeOfficialSource, type M15SourceKind, type M15Watch } from "./routing";

// M1.5 analyst flag assignment — pure heuristics at the ingest boundary.
// Connectors call this when persisting official_military_maritime_sources rows.
// Flags surface items for analyst review; they NEVER create Spot Reports.

export interface AssignAnalystFlagsInput {
  source: M15SourceKind;
  title: string;
  body: string;
  hasOfficialUrl: boolean;
  hasPdf: boolean;
  hasImages?: boolean;
}

export interface AnalystFlags {
  flagSignificantIncident: boolean;
  flagEscalationIndicator: boolean;
  flagMaritimeDisruption: boolean;
  flagEvidenceAvailable: boolean;
  flagPossibleSpotReport: boolean;
}

function blob(input: AssignAnalystFlagsInput): string {
  return `${input.title} ${input.body}`;
}

function isUkmtoVesselIncident(text: string): boolean {
  return matchesTerms(text, TRIGGER_TERMS.ukmto.vesselIncidentTerms);
}

function isCentcomOperationalRelease(text: string): boolean {
  return matchesTerms(text, TRIGGER_TERMS.centcom.operationalTerms);
}

function matchesEscalation(source: M15SourceKind, text: string): boolean {
  switch (source) {
    case "centcom":
      return matchesTerms(text, TRIGGER_TERMS.centcom.escalationTerms);
    case "ukmto":
      return matchesTerms(text, TRIGGER_TERMS.ukmto.escalationTerms);
    case "partner":
      return matchesTerms(text, TRIGGER_TERMS.partners.escalationTerms);
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function matchesMaritimeDisruption(source: M15SourceKind, text: string): boolean {
  const maritime = matchesTerms(text, TRIGGER_TERMS.centcom.maritimeTerms);
  switch (source) {
    case "ukmto":
      return (
        maritime ||
        matchesTerms(text, TRIGGER_TERMS.ukmto.maritimeDisruptionTerms)
      );
    case "centcom":
      return maritime;
    case "partner":
      return maritime || matchesTerms(text, TRIGGER_TERMS.ukmto.maritimeDisruptionTerms);
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/**
 * Initial heuristic flag assignment (tune with owner during acceptance).
 *
 * | Flag                  | When true                                              |
 * |-----------------------|--------------------------------------------------------|
 * | Significant incident  | UKMTO vessel incident OR CENTCOM operational release   |
 * | Escalation indicator  | Escalation terms for the source family match           |
 * | Maritime disruption   | Maritime terms in UKMTO/CENTCOM/partner maritime context |
 * | Evidence available    | Official URL or PDF present                            |
 * | Possible Spot Report  | Significant + escalation + official evidence (queue only)|
 */
export function assignAnalystFlags(input: AssignAnalystFlagsInput): AnalystFlags {
  const text = blob(input);
  const flagSignificantIncident =
    (input.source === "ukmto" && isUkmtoVesselIncident(text)) ||
    (input.source === "centcom" && isCentcomOperationalRelease(text));

  const flagEscalationIndicator = matchesEscalation(input.source, text);
  const flagMaritimeDisruption = matchesMaritimeDisruption(input.source, text);
  const flagEvidenceAvailable =
    input.hasOfficialUrl || input.hasPdf || !!input.hasImages;

  const flagPossibleSpotReport =
    flagSignificantIncident &&
    flagEscalationIndicator &&
    flagEvidenceAvailable &&
    (input.source === "ukmto" || input.source === "centcom");

  return {
    flagSignificantIncident,
    flagEscalationIndicator,
    flagMaritimeDisruption,
    flagEvidenceAvailable,
    flagPossibleSpotReport,
  };
}

/** Compose routing + flags for fixture-driven ingest simulations. */
export function simulateOfficialSourceIngest(
  input: AssignAnalystFlagsInput,
): AnalystFlags & {
  primaryWatch: M15Watch;
  watchTags: M15Watch[];
} {
  return { ...routeOfficialSource(input), ...assignAnalystFlags(input) };
}
