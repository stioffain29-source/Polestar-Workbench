// Shared selection for the Related Incidents table.
//
// Both the PDF builder (drawRelatedIncidents in exportTopicReportPdf.ts) and the
// on-screen preview render this section, so the row selection — title dedupe,
// weak-bucket filtering, recency ordering and the per-topic cap — must live in
// ONE place. If the two surfaces ran their own selection they would drift and
// the preview/PDF parity guarantee would break.

import { classifyIncidentType, type ClassifiableIncident } from "./incidentClassifier";
import { relatedIncidentsLimit } from "./reportWindow";

export interface RelatedIncidentInput {
  topic: string;
  title: string;
  occurredAt: string;
  severity?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
  country?: string | null;
}

// The classifier's weakest bucket (e.g. "Other fuel incident"). These rows are
// pushed below operationally classified rows and dropped when enough strong
// rows exist.
function weakBucket(label: string): boolean {
  return /^other\s.+incident$/i.test(label) || label === "Unclassified maritime record";
}

// For Cargo specifically the source data carries a lot of generic
// "Warehouse theft - Other" / "Container theft - Electronics" titles that
// repeat across the window. Treat any title that is just a bucket + a single
// trailing category word as generic so the table prefers named-place /
// named-corridor / named-cargo records when they exist.
function isGenericCargoTitle(title: string): boolean {
  const t = (title ?? "").trim();
  return (
    /\b(warehouse|container|cargo|truck|depot)\s+(theft|hijack|hijacking|robbery|loss|raid)\s+[-\u2013\u2014]\s+\S+\s*$/i.test(
      t,
    ) ||
    /^other\s+land[- ]based\s+cargo\s+theft\s+[-\u2013\u2014]\s+\S+\s*$/i.test(t)
  );
}

// The single significant-token authority for cargo title similarity. Lower-cases,
// strips punctuation and drops common stop / attribution words. Both the Related
// Incidents dedupe (titleKey) and the cargo clustering module consume THIS so the
// two never tokenise differently.
const TITLE_STOP = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and",
  "as", "by", "off", "near", "after", "amid", "with", "from", "into", "over",
  "says", "say", "said", "reports", "report",
]);

export function significantTitleTokens(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !TITLE_STOP.has(w));
}

// Title-based dedupe: collapse syndicated / repeated rows so the table does not
// list the same loss four times. Different places survive because their first
// eight significant words differ.
function titleKey(s: string): string {
  return significantTitleTokens(s).slice(0, 8).join(" ");
}

// Hard per-topic row caps for the Related Incidents table. Fuel runs a tighter
// table than the other topic/conflict reports. These bound the rendered rows
// regardless of the wider `relatedIncidentsLimit` ceiling.
export const FUEL_RELATED_ROW_CAP = 6;
export const DEFAULT_RELATED_ROW_CAP = 10;

// The largest number of rows `selectRelatedIncidents` can ever return, across
// every topic and the `relatedIncidentsLimit` ceiling. The server only
// generates per-incident AI summaries for the first `MAX_PROSE_INCIDENTS` rows
// (see artifacts/api-server/src/lib/countryProse.ts), so this must never exceed
// that cap — otherwise rows beyond it would silently fall back to the
// deterministic line in both preview and PDF. The lockstep is asserted in
// __tests__/workbench/relatedIncidentsCap.test.ts; raising a cap here without
// raising the generation cap fails that guard loudly.
export function maxRelatedIncidentsRows(): number {
  const { max } = relatedIncidentsLimit("");
  return Math.max(
    Math.min(max, FUEL_RELATED_ROW_CAP),
    Math.min(max, DEFAULT_RELATED_ROW_CAP),
  );
}

// Returns the ordered, deduped, capped rows for the Related Incidents table.
export function selectRelatedIncidents<T extends RelatedIncidentInput>(
  windowIncidents: T[],
  topic: string,
): T[] {
  if (windowIncidents.length === 0) return [];
  const { max } = relatedIncidentsLimit(topic);

  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const i of windowIncidents) {
    const k = titleKey(i.title);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    deduped.push(i);
  }

  const annotated = deduped.map((i) => ({
    i,
    weak:
      weakBucket(classifyIncidentType(i as unknown as ClassifiableIncident)) ||
      (topic === "cargo_watch" && isGenericCargoTitle(i.title)),
  }));
  const strong = annotated.filter((r) => !r.weak).map((r) => r.i);
  const weak = annotated.filter((r) => r.weak).map((r) => r.i);
  const STRONG_FLOOR = 4;
  // Cargo: generic-suffix titles are hard-excluded regardless of strong-row
  // count — they add noise without operational signal. Other topics keep the
  // weak-fallback so sparse windows still produce a usable table.
  const ordered =
    topic === "cargo_watch"
      ? strong
      : strong.length >= STRONG_FLOOR
        ? strong
        : [...strong, ...weak];

  const sorted = [...ordered].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  const effectiveMax =
    topic === "fuel"
      ? Math.min(max, FUEL_RELATED_ROW_CAP)
      : Math.min(max, DEFAULT_RELATED_ROW_CAP);
  return sorted.slice(0, effectiveMax);
}
