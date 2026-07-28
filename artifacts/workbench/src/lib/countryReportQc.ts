// Non-blocking quality-control pass for the structured country brief (spec §13).
//
// This is a PURE, no-fabrication guard: it inspects the ALREADY-BUILT dataset
// and the map's input incidents and returns human-readable advisory strings. An
// empty array means every check passed. It never throws, never mutates and never
// blocks the PDF — a warning renders as a subdued-red, no-print banner in the
// editor (and is logged by the headless exporter) so the analyst can see a
// consistency problem without the report silently shipping wrong.
//
// Scope, per the session decision, is deliberately narrow. It covers the three
// §13 checks that can be verified purely from the dataset without re-deriving
// classifier state:
//   A. Older incidents (event date before the window) state BOTH dates, so a
//      publication date is never presented as the incident date.
//   B. Every location referenced by a top development is present in the map's
//      input set (the map plots from the same window pool).
//   C. Every top development is referenced in the narrative assessment.
// Severity/category correctness and pixel-level clipping are OUT of scope here
// (they belong to the classifier and the PDF paginator respectively).
import { format as formatDate } from "date-fns";
import type { PngReportDataset, PngReportItem } from "./pngReportDataset";

export interface CountryReportQcMapIncident {
  province?: string | null;
  location?: string | null;
}

// Generic geographic filler that is not distinctive enough to anchor a
// narrative/map cross-check ("Dekai District, Yahukimo Regency" → dekai,
// yahukimo). Kept lowercase; matching is case-insensitive.
const PLACE_STOPWORDS = new Set([
  "district",
  "districts",
  "regency",
  "regencies",
  "province",
  "provinces",
  "papua",
  "indonesia",
  "indonesian",
  "area",
  "areas",
  "near",
  "central",
  "highland",
  "highlands",
  "lowland",
  "lowlands",
  "city",
  "town",
  "village",
  "region",
  "kabupaten",
  "kota",
  "capital",
  "north",
  "south",
  "east",
  "west",
]);

// Distinctive, lowercase place tokens for an item (province + free-form
// location), stopwords removed. Used to cross-check the map and the narrative.
function placeTokens(item: {
  province?: string | null;
  location?: string | null;
}): string[] {
  const raw = `${item.province ?? ""} ${item.location ?? ""}`.toLowerCase();
  const seen = new Set<string>();
  for (const w of raw.split(/[^a-z]+/)) {
    if (w.length >= 4 && !PLACE_STOPWORDS.has(w)) seen.add(w);
  }
  return Array.from(seen);
}

// Short, human label for an item in a warning line.
function itemLabel(item: Pick<PngReportItem, "title" | "province" | "location">): string {
  const place = item.location?.trim() || item.province?.trim() || "location not specified";
  const title = (item.title ?? "").trim() || "untitled development";
  const short = title.length > 80 ? `${title.slice(0, 77)}…` : title;
  return `“${short}” (${place})`;
}

// Mirror pngReportDataset.formatBriefDate ("d MMM yyyy", e.g. "5 Jul 2026"),
// lowercased for the case-insensitive narrative search.
function briefDateToken(d: Date): string {
  return formatDate(d, "d MMM yyyy").toLowerCase();
}

type QcDataset = Pick<
  PngReportDataset,
  | "topThree"
  | "incidentDetailsItems"
  | "windowItems"
  | "bluf"
  | "executiveSummary"
  | "outlook"
  | "polestarView"
  | "whatChanged"
  | "businessImpact"
  | "escalationIndicators"
  | "recommendedActions"
> &
  // The §33 gate result is AUTHORITATIVE — its failures are surfaced first. Made
  // optional so existing callers/tests that pass a partial dataset still work.
  Partial<Pick<PngReportDataset, "gate">>;

export function runCountryReportQc(
  dataset: QcDataset,
  mapIncidents: CountryReportQcMapIncident[],
): string[] {
  const warnings: string[] = [];

  // §33 — the shared engine quality gate is authoritative. Surface every gate
  // failure first (critical failures also block the PDF elsewhere), then run the
  // existing dataset-level consistency checks below.
  const gate = dataset.gate;
  if (gate && gate.failures.length > 0) {
    for (const f of gate.failures) {
      const tag = f.severity === "critical" ? "GATE (critical)" : "GATE (warning)";
      warnings.push(`${tag} [${f.check}]: ${f.message}`);
    }
  }

  const topThree = dataset.topThree ?? [];

  // ---- Narrative haystack (shared by checks A and C) ---------------------
  // Everything a place or date could legitimately be stated in. Nested prose
  // (recommended actions) is folded in via JSON so a place or date named only
  // inside a grouped action still counts.
  const narrative = [
    dataset.bluf,
    dataset.executiveSummary,
    dataset.outlook,
    dataset.polestarView,
    dataset.whatChanged,
    ...(dataset.businessImpact ?? []),
    ...(dataset.escalationIndicators ?? []),
    JSON.stringify(dataset.recommendedActions ?? []),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();

  // ---- Check A: an older LEAD states BOTH its dates in the narrative -----
  // Spec §13: when the period's lead development is fresh reporting on an event
  // that actually happened BEFORE the window (occurredOutOfWindow), the brief
  // must state BOTH the occurrence date and the report date so an old event is
  // never presented as new. The lead is topThree[0] — the same row the event-led
  // opening sentence is built from — so this catches a REACHABLE regression: a
  // lead sentence that drops a date, or a stale analyst override that buries it.
  const lead = topThree[0];
  if (lead && lead.occurredOutOfWindow && lead.incidentDate) {
    const occ = briefDateToken(lead.incidentDate);
    const rep = briefDateToken(lead.reportedDate);
    if (!narrative.includes(occ) || !narrative.includes(rep)) {
      warnings.push(
        `QC: the lead development ${itemLabel(lead)} predates the reporting window but the narrative does not state both its occurrence date (${occ}) and report date (${rep}).`,
      );
    }
  }

  // ---- Check A (invariant): older rows must carry an incident date -------
  // Defensive builder-invariant net. The dataset builder sets occurredEarlier /
  // occurredOutOfWindow ONLY when an incidentDate was extracted, so on real
  // output this cannot fire — but if that coupling is ever broken an older event
  // would silently render with only its report date. Cheap to keep as a guard.
  const dateCheckPool: PngReportItem[] = [
    ...topThree,
    ...(dataset.incidentDetailsItems ?? []),
  ];
  const seenDateWarn = new Set<string>();
  for (const item of dateCheckPool) {
    const flaggedOlder = item.occurredOutOfWindow || item.occurredEarlier;
    if (flaggedOlder && !item.incidentDate) {
      if (seenDateWarn.has(item.id)) continue;
      seenDateWarn.add(item.id);
      warnings.push(
        `QC: ${itemLabel(item)} predates the reporting window but has no explicit incident date to distinguish it from its reported date.`,
      );
    }
  }

  // ---- Check B: top-development locations present in the map input --------
  const mapTokens = new Set<string>();
  for (const mi of mapIncidents ?? []) {
    for (const t of placeTokens(mi)) mapTokens.add(t);
  }
  for (const item of topThree) {
    const tokens = placeTokens(item);
    if (tokens.length === 0) continue; // no plottable place to verify
    const onMap = tokens.some((t) => mapTokens.has(t));
    if (!onMap) {
      warnings.push(
        `QC: top development ${itemLabel(item)} names a location that is not represented in the map's incident set.`,
      );
    }
  }

  // ---- Check C: every top development appears in the narrative ------------
  for (const item of topThree) {
    const tokens = placeTokens(item);
    if (tokens.length === 0) continue; // no distinctive anchor to search for
    const referenced = tokens.some((t) => narrative.includes(t));
    if (!referenced) {
      warnings.push(
        `QC: top development ${itemLabel(item)} is not referenced anywhere in the narrative assessment.`,
      );
    }
  }

  return warnings;
}
