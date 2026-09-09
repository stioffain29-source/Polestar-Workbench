export const FLASHPOINT_VALIDITY_VERSION = "2026-09-09.semantic.4";
export const FLASHPOINT_EVENT_TYPES = [
  "protest", "demonstration", "labour_strike", "blockade", "riot_public_disorder",
  "political_mobilisation", "other_public_order", "non_flashpoint", "unknown",
] as const;
export const FLASHPOINT_ACCEPTED_EVENT_TYPES = [
  "protest", "demonstration", "labour_strike", "blockade", "riot_public_disorder",
  "political_mobilisation", "other_public_order",
] as const;
export const FLASHPOINT_CONFIDENCE_THRESHOLDS = {
  event: .75,
  classification: .7,
  geography: .75,
  date: .65,
} as const;
export type FlashpointEventType = typeof FLASHPOINT_EVENT_TYPES[number];
export type FlashpointCurrentness = "current" | "future" | "historical" | "unclear";
export type FlashpointProviderVerdict = "valid" | "invalid" | "needs_review";

export interface FlashpointSemanticGates {
  version: string;
  verdict: FlashpointProviderVerdict;
  eventOccurred: boolean | null;
  actor: string | null;
  activity: string | null;
  physicalLocation: string | null;
  country: string | null;
  eventType: FlashpointEventType | null;
  eventDate: string | null;
  currentness: FlashpointCurrentness | null;
  assignedCountrySupported: boolean;
  confidence: { event: number; classification: number; geography: number; date: number };
  contradictions: string[];
}

export function validateFlashpointSemanticContract(g: FlashpointSemanticGates): { valid: boolean; failures: string[] } {
  const failures: string[] = [];
  if (g.version !== FLASHPOINT_VALIDITY_VERSION) failures.push("classifier_version_mismatch");
  if (g.verdict !== "valid") failures.push(`provider_verdict:${g.verdict}`);
  if (g.eventOccurred !== true) failures.push("event_not_established");
  for (const [key, value] of [["actor", g.actor], ["activity", g.activity], ["physical_location", g.physicalLocation], ["country", g.country], ["event_date", g.eventDate]] as const) {
    if (typeof value !== "string" || !value.trim()) failures.push(`missing_${key}`);
  }
  if (!g.eventType || !FLASHPOINT_EVENT_TYPES.includes(g.eventType) || !FLASHPOINT_ACCEPTED_EVENT_TYPES.includes(g.eventType as typeof FLASHPOINT_ACCEPTED_EVENT_TYPES[number])) failures.push("unsupported_event_type");
  if (!g.currentness || !["current", "future"].includes(g.currentness)) failures.push("unsupported_currentness");
  if (g.assignedCountrySupported !== true) failures.push("assigned_country_unsupported");
  if (!g.eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(g.eventDate)) {
    failures.push("invalid_event_date");
  } else {
    const [year, month, day] = g.eventDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) failures.push("invalid_event_date");
  }
  if (!Array.isArray(g.contradictions) || g.contradictions.length) failures.push("material_contradiction");
  for (const key of Object.keys(FLASHPOINT_CONFIDENCE_THRESHOLDS) as Array<keyof typeof FLASHPOINT_CONFIDENCE_THRESHOLDS>) {
    const value = g.confidence?.[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < FLASHPOINT_CONFIDENCE_THRESHOLDS[key] || value > 1) failures.push(`low_${key}_confidence`);
  }
  return { valid: failures.length === 0, failures };
}