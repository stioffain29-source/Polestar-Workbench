import rawTerms from "./triggerTerms.json";

// M1.5 trigger-term config — externalised keyword lists for CENTCOM, UKMTO and
// partner classifiers. Source of truth is triggerTerms.json so analysts can
// review routing inputs without reading ingest code.

export interface M15CentcomTerms {
  maritimeTerms: string[];
  regionTags: string[];
  operationalTerms: string[];
  escalationTerms: string[];
}

export interface M15UkmtoTerms {
  escalationTerms: string[];
  vesselIncidentTerms: string[];
  maritimeDisruptionTerms: string[];
}

export interface M15PartnerTerms {
  escalationTerms: string[];
  threatLevelTerms: string[];
}

export interface M15TriggerTerms {
  centcom: M15CentcomTerms;
  ukmto: M15UkmtoTerms;
  partners: M15PartnerTerms;
}

function assertSection(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`M15 trigger terms: missing or empty ${label}`);
  }
}

/** Load and validate the trigger-term JSON (throws if sections are missing). */
export function loadTriggerTerms(): M15TriggerTerms {
  const parsed = rawTerms as M15TriggerTerms;
  assertSection(parsed.centcom?.maritimeTerms, "centcom.maritimeTerms");
  assertSection(parsed.centcom?.regionTags, "centcom.regionTags");
  assertSection(parsed.ukmto?.escalationTerms, "ukmto.escalationTerms");
  assertSection(parsed.partners?.escalationTerms, "partners.escalationTerms");
  return parsed;
}

/** Cached config — validated once per process. */
export const TRIGGER_TERMS: M15TriggerTerms = loadTriggerTerms();

function escapeRegex(fragment: string): string {
  return fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a word-boundary regex for a single trigger phrase (multi-word aware). */
export function termToPattern(term: string): RegExp {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return /(?!)/;
  const parts = normalized.split(/\s+/).map(escapeRegex);
  return new RegExp(`\\b${parts.join("\\s+")}\\b`, "i");
}

/** True when any configured trigger phrase matches the haystack text. */
export function matchesTerms(text: string, terms: readonly string[]): boolean {
  if (!text.trim() || terms.length === 0) return false;
  return terms.some((term) => termToPattern(term).test(text));
}

/** Return the subset of region tags that appear in the text (lowercased labels). */
export function matchRegionTags(text: string, terms: readonly string[]): string[] {
  return terms.filter((tag) => termToPattern(tag).test(text));
}
