// Shared prose-resolution layer for topic reports.
//
// Every report narrative section resolves to ONE string through these helpers,
// and the SAME helper is used by the on-screen preview component and the PDF
// builder for a given topic. That guarantees preview == PDF byte-parity.
//
// Precedence (highest first):
//   1. a genuine analyst edit (the editor/saved field, when non-empty)
//   2. the cached AI narrative for that section (when present)
//   3. the deterministic draft/auto fallback (always available)
//
// Topics that keep a "generic seed" detector (conflict, flashpoint/protests)
// resolve via their own pickProse(editor, aiOr(ai, auto)) instead — there the
// editor field is seeded with deterministic text, so a generic seed must be
// discarded. The simple resolver below is for the topics whose editor fields
// are seeded SAVED-ONLY (shipping, cargo_watch, fuel, energy, fertiliser):
// there an empty field means "unedited", so no generic detection is needed.

import {
  draftTopicReportProse,
  type DraftableIncident,
  type TopicReportProse,
} from "./draftReportProse";
import type { FuelGulfChokepointWatch } from "./fuelNarratives";
import { displayIncidentTitle } from "./incidentTitle";

// Cached AI narrative sections. Mirrors the server TopicProseSections shape;
// every field optional/nullable so a partial or absent payload degrades safely.
export interface TopicAiProse {
  executiveSummary?: string | null;
  situation?: string | null;
  whatHappened?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
}

// AI when present, otherwise the deterministic fallback. Never returns the
// empty string in place of a real fallback.
export function aiOr(ai: string | null | undefined, det: string): string {
  const t = (ai ?? "").trim();
  return t ? t : det;
}

// Full precedence for SAVED-ONLY-seeded topics: analyst edit -> AI -> det.
export function resolveSimpleProse(
  editor: string | null | undefined,
  ai: string | null | undefined,
  det: string,
): string {
  const e = (editor ?? "").trim();
  if (e) return e;
  return aiOr(ai, det);
}

// Permissive structural input for mapping app incident rows (which carry many
// more fields than the classifier needs) into the DraftableIncident shape the
// deterministic draft engine expects. Used by BOTH a topic's preview component
// and its PDF builder, so the deterministic fallback they each compute from the
// same incidents + issue date is byte-identical.
export interface DraftIncidentInput {
  id?: number | string | null;
  topic?: string | null;
  title?: string | null;
  displayTitle?: string | null;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
  severity?: string | null;
  occurredAt?: string | null;
  country?: string | null;
}

export function toDraftableIncidents(
  incidents: ReadonlyArray<DraftIncidentInput>,
): DraftableIncident[] {
  return incidents.map((i) => ({
    id: i.id ?? undefined,
    topic: i.topic ?? "",
    title: displayIncidentTitle(i.title ?? "", i.displayTitle),
    summary: i.summary ?? null,
    source: i.source ?? null,
    sourceUrl: i.sourceUrl ?? null,
    location: i.location ?? null,
    severity: i.severity ?? "",
    occurredAt: i.occurredAt ?? "",
    country: i.country ?? null,
  }));
}

// Deterministic draft generation with a STABLE incident order so the preview
// and the PDF (which build the draft independently) produce identical text.
// Sort: occurredAt descending, then by id ascending as a tie-break.
export function stableDraftTopicReportProse(opts: {
  topic: string;
  issueDate: string;
  incidents: DraftableIncident[];
  // Fuel only: Gulf/Hormuz chokepoint activity used to name a live Gulf
  // story in the lead narrative. Hormuz rows are often topic=shipping and
  // never survive the fuel topic filter on their own. Both the preview and
  // the PDF pass the watch from the SAME buildFuelWatchReportData payload.
  fuelGulf?: FuelGulfChokepointWatch | null;
}): TopicReportProse {
  const incidents = [...opts.incidents].sort((a, b) => {
    const ad = a.occurredAt ?? "";
    const bd = b.occurredAt ?? "";
    if (ad !== bd) return ad < bd ? 1 : -1; // occurredAt desc
    const ai = a.id == null ? "" : String(a.id);
    const bi = b.id == null ? "" : String(b.id);
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
  return draftTopicReportProse({
    topic: opts.topic,
    issueDate: opts.issueDate,
    incidents,
    fuelGulf: opts.fuelGulf ?? null,
  });
}
