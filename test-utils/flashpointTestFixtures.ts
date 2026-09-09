import type {
  FlashpointReportIncident,
  FlashpointValidityGates,
} from "../artifacts/workbench/src/lib/flashpointReportDataset";
import { FLASHPOINT_VALIDITY_VERSION } from "@workspace/relevance";

const MONTH: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function statedDate(text: string, occurredAt: string): string | null {
  const match =
    text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i) ??
    text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (!match) return null;
  const dayFirst = /^\d/.test(match[1]);
  const day = Number(dayFirst ? match[1] : match[2]);
  const month = MONTH[(dayFirst ? match[2] : match[1]).toLowerCase()];
  const occurred = new Date(occurredAt);
  const date = new Date(Date.UTC(occurred.getUTCFullYear(), month, day));
  if (date.getTime() < occurred.getTime() - 180 * 86400000) {
    date.setUTCFullYear(date.getUTCFullYear() + 1);
  }
  return date.toISOString().slice(0, 10);
}

function eventType(text: string): string {
  if (/\b(riot|public disorder|looting)\b/i.test(text)) return "riot_public_disorder";
  if (/\b(strike|walkout|stoppage|shut(?:ter)?down)\b/i.test(text)) return "labour_strike";
  if (/\b(block|roadblock|blockade)\b/i.test(text)) return "blockade";
  if (/\b(rally|march|demonstration)\b/i.test(text)) return "demonstration";
  if (/\b(protest(?:er|ers|s)?|sit[- ]?in)\b/i.test(text)) return "protest";
  return "other_public_order";
}

/** Coherent persisted semantic evidence for report-layer synthetic positives. */
export function validFlashpointSemantic(
  row: Partial<FlashpointReportIncident>,
  gateOverrides: Partial<FlashpointValidityGates> = {},
): Pick<
  FlashpointReportIncident,
  "validityStatus" | "validityVersion" | "validityReason" | "validityGates"
> {
  const occurredAt = row.occurredAt ?? "2026-01-01T00:00:00Z";
  const text = `${row.title ?? ""} ${row.summary ?? ""}`;
  const explicit = statedDate(text, occurredAt);
  const futureCue = /\b(announce|planned|plans?|set for|scheduled|will|upcoming|coming)\b/i.test(text);
  const gates: FlashpointValidityGates = {
    verdict: "valid",
    eventOccurred: true,
    actor: "Synthetic event actors",
    activity: "public-order activity",
    physicalLocation: row.location?.trim() || row.country?.trim() || "Synthetic location",
    country: row.country?.trim() || "India",
    eventType: eventType(text),
    eventDate: explicit ?? occurredAt.slice(0, 10),
    currentness: futureCue && explicit ? "future" : "current",
    assignedCountrySupported: true,
    confidence: { event: 1, classification: 1, geography: 1, date: 1 },
    contradictions: [],
    evidence: { synthetic: true, text },
    version: FLASHPOINT_VALIDITY_VERSION,
    ...gateOverrides,
  };
  return {
    validityStatus: "valid",
    validityVersion: FLASHPOINT_VALIDITY_VERSION,
    validityReason: "coherent synthetic semantic event",
    validityGates: gates,
  };
}

/** Explicit persisted rejection for synthetic non-events/noise. */
export function invalidFlashpointSemantic(
  reason = "synthetic row is not a valid current Flashpoint event",
): Pick<
  FlashpointReportIncident,
  "validityStatus" | "validityVersion" | "validityReason" | "validityGates"
> {
  return {
    validityStatus: "invalid",
    validityVersion: FLASHPOINT_VALIDITY_VERSION,
    validityReason: reason,
    validityGates: {
      verdict: "invalid",
      eventOccurred: false,
      eventType: "non_flashpoint",
      currentness: "unclear",
      assignedCountrySupported: false,
      contradictions: [reason],
      version: FLASHPOINT_VALIDITY_VERSION,
    },
  };
}