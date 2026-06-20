import { format, parseISO } from "date-fns";
import { classifyIncidentType, type ClassifiableIncident } from "./incidentClassifier";

// The five-tier severity vocabulary, the ONLY severity words allowed anywhere in
// report prose (no substitution).
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};

export interface DeterministicSummaryInput extends ClassifiableIncident {
  severity?: string | null;
  location?: string | null;
  occurredAt: string;
}

// Deterministic per-incident summary — the labelled fallback shown under a
// Related Incidents row when the AI summary for that incident is unavailable.
// Mirrors the country brief's deterministicIncidentSummary: grounded ONLY on the
// incident's own fields (derived type, location, date, severity), no fabricated
// facts, British English, five-tier severity vocab, no parenthetical counts.
export function deterministicIncidentSummary(i: DeterministicSummaryInput): string {
  const type = classifyIncidentType(i);
  const sevLabel = SEV_LABEL[(i.severity ?? "").toLowerCase()];
  const loc = (i.location ?? "").trim();
  const where = loc ? ` in ${loc}` : "";
  const sev = sevLabel ? `, assessed at ${sevLabel} severity` : "";
  let dateStr = i.occurredAt;
  try {
    dateStr = format(parseISO(i.occurredAt), "dd MMM yyyy");
  } catch {
    /* leave raw */
  }
  return `${type}${where}, reported ${dateStr}${sev}.`;
}

// Resolve the summary to render for an incident: the analyst-edited or
// AI-generated summary keyed by incident id, else the deterministic fallback.
// Keys are stringified ids (the cache map is keyed by String(id)).
export function resolveIncidentSummary(
  i: DeterministicSummaryInput & { id?: number | string | null },
  summaries: Record<string, string> | undefined,
): string {
  const id = i.id == null ? "" : String(i.id);
  const ai = id ? summaries?.[id]?.trim() : "";
  return ai && ai.length > 0 ? ai : deterministicIncidentSummary(i);
}
