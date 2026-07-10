import { TRIGGER_TERMS, matchesTerms } from "./triggerTerms";

// M1.5 official-source watch routing — pure matrix from the product spec.
// No DB, no HTTP. Connectors call this at ingest to populate primary_watch and
// watch_tags on official_military_maritime_sources rows.

export type M15Watch = "conflict" | "shipping";

export type M15SourceKind = "centcom" | "ukmto" | "partner";

export interface RouteOfficialSourceInput {
  source: M15SourceKind;
  title: string;
  body: string;
}

export interface RouteOfficialSourceResult {
  primaryWatch: M15Watch;
  watchTags: M15Watch[];
}

function blob(input: RouteOfficialSourceInput): string {
  return `${input.title} ${input.body}`;
}

function uniqueWatches(tags: M15Watch[]): M15Watch[] {
  const seen = new Set<M15Watch>();
  const out: M15Watch[] = [];
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * Partner escalation advisories (JMIC/CMF) route to both watches; routine
 * threat-level / guidance products stay on Shipping context even when they name
 * CMF or JMIC in the header.
 */
export function isPartnerEscalationAdvisory(text: string): boolean {
  const { partners } = TRIGGER_TERMS;
  if (!matchesTerms(text, partners.escalationTerms)) return false;
  return (
    /\bescalation advisory\b/i.test(text) ||
    /\belevated threat to commercial shipping\b/i.test(text) ||
    /\bkinetic incidents?\b/i.test(text) ||
    /\bkinetic activity\b/i.test(text)
  );
}

/**
 * Product routing matrix (M1.5 § Product routing matrix):
 *   CENTCOM release                         → Conflict Watch
 *   CENTCOM + maritime terms                → Conflict + Shipping
 *   UKMTO warning/advisory                  → Shipping Watch
 *   UKMTO + escalation terms                → Shipping + Conflict
 *   Partner threat-level update             → Shipping context
 *   JMIC / CMF escalation advisory          → Shipping + Conflict context
 */
export function routeOfficialSource(
  input: RouteOfficialSourceInput,
): RouteOfficialSourceResult {
  const text = blob(input);
  const { centcom, ukmto, partners } = TRIGGER_TERMS;

  switch (input.source) {
    case "centcom": {
      const maritime = matchesTerms(text, centcom.maritimeTerms);
      return {
        primaryWatch: "conflict",
        watchTags: maritime ? ["conflict", "shipping"] : ["conflict"],
      };
    }
    case "ukmto": {
      const escalation = matchesTerms(text, ukmto.escalationTerms);
      return {
        primaryWatch: "shipping",
        watchTags: escalation ? ["shipping", "conflict"] : ["shipping"],
      };
    }
    case "partner": {
      const escalationAdvisory = isPartnerEscalationAdvisory(text);
      if (escalationAdvisory) {
        return {
          primaryWatch: "shipping",
          watchTags: uniqueWatches(["shipping", "conflict"]),
        };
      }
      // Threat-level / routine partner context — Shipping Watch only.
      return {
        primaryWatch: "shipping",
        watchTags: ["shipping"],
      };
    }
    default: {
      const _exhaustive: never = input.source;
      return _exhaustive;
    }
  }
}

/** Whether partner text is a threat-level / guidance update (not escalation). */
export function isPartnerThreatLevelUpdate(text: string): boolean {
  return (
    matchesTerms(text, TRIGGER_TERMS.partners.threatLevelTerms) &&
    !isPartnerEscalationAdvisory(text)
  );
}
