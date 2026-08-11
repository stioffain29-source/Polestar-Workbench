// Durable analyst layout controls for the country / city brief that let the
// analyst tailor the report WITHOUT touching data:
//
//   - hiddenSections     — canonical brief sections dropped from the rendered
//                          brief (preview AND the DOM-rasterised PDF, in
//                          lockstep, because both are the SAME component).
//   - excludedIncidentIds — relevance-passing window incidents the analyst has
//                          removed from the brief. STRICT no-fabrication: the
//                          analyst can only include/exclude from the pool that
//                          already passed relevance — never free-text, never a
//                          hand-placed incident.
//   - severityDemotions  — DEMOTE-ONLY Fast Facts corrections (incident id ->
//                          a lower tier). An entry can only reduce an incident's
//                          severity below its stored tier; an attempt to raise it
//                          is ignored so the analyst can never up-rate the data.
//
// These persist per-report in the country_reports.section_overrides jsonb column
// and are deliberately OUTSIDE the AI prose fingerprint cache concern: excluding
// an incident or demoting a severity re-grounds the brief on the curated set, so
// the narrative stays consistent with what is shown.

// The eight canonical brief sections in fixed render order. The key is a stable
// identifier decoupled from the display title (so re-titling never orphans a
// saved override). Kept in lockstep with the `<Section>` blocks in
// PngCountryReportBody.tsx.
export const COUNTRY_SECTION_KEYS = [
  "bottom-line",
  "top-3",
  "current-situation",
  "actions-outlook",
  "polestar-view",
] as const;

export type CountrySectionKey = (typeof COUNTRY_SECTION_KEYS)[number];

export const COUNTRY_SECTION_LABELS: Record<CountrySectionKey, string> = {
  "bottom-line": "Bottom Line Up Front",
  "top-3": "Top 3 Developments",
  "current-situation": "Current Situation",
  "actions-outlook": "Actions & Outlook",
  "polestar-view": "Polestar View",
};

// Legacy → merged key map (owner ruling, 11 Aug 2026: five sections, Fast Facts
// kept). Saved overrides may still carry the pre-merge 8-key vocabulary; they
// are normalised on read so an old hidden key keeps hiding the section that now
// CONTAINS its content, and unknown keys are dropped rather than silently kept.
const LEGACY_SECTION_KEY_MAP: Record<string, CountrySectionKey> = {
  "incident-details": "current-situation",
  "operational-impact": "actions-outlook",
  "recommended-actions": "actions-outlook",
  outlook: "actions-outlook",
};

/** Normalise a persisted hiddenSections list to the current 5-key vocabulary. */
export function normalizeHiddenSections(raw: string[] | null | undefined): CountrySectionKey[] {
  const out = new Set<CountrySectionKey>();
  for (const k of raw ?? []) {
    const mapped = (COUNTRY_SECTION_KEYS as readonly string[]).includes(k)
      ? (k as CountrySectionKey)
      : LEGACY_SECTION_KEY_MAP[k];
    if (mapped) out.add(mapped);
  }
  return [...out];
}

export interface CountrySectionOverrides {
  hiddenSections?: string[];
  excludedIncidentIds?: string[];
  severityDemotions?: Record<string, string>;
}

// Severity ordering (least -> most severe) used for the demote-only guard. The
// five-tier vocabulary is fixed by brand spec; unknown labels sort as the most
// severe so an unrecognised tier is never silently demoted.
const SEVERITY_RANK: Record<string, number> = {
  insignificant: 0,
  low: 1,
  moderate: 2,
  high: 3,
  extreme: 4,
};

function rank(severity: string | null | undefined): number {
  return SEVERITY_RANK[(severity ?? "").trim().toLowerCase()] ?? 4;
}

export function isSectionVisible(
  ov: CountrySectionOverrides | null | undefined,
  key: CountrySectionKey,
): boolean {
  return !(ov?.hiddenSections ?? []).includes(key);
}

function incidentIdKey(id: number | string | null | undefined): string | null {
  if (id == null) return null;
  return String(id);
}

// Apply the analyst curation to a list of window incidents: drop any excluded
// incident and DEMOTE (never raise) the severity of any incident carrying a
// severity-demotion entry. Generic over the incident shape so it can run on both
// the raw window rows and the structured dataset's source rows.
export function applyIncidentCurations<
  T extends { id?: number | string | null; severity: string },
>(incidents: T[], ov: CountrySectionOverrides | null | undefined): T[] {
  const excluded = new Set((ov?.excludedIncidentIds ?? []).map(String));
  const demotions = ov?.severityDemotions ?? {};
  const out: T[] = [];
  for (const inc of incidents) {
    const key = incidentIdKey(inc.id);
    if (key != null && excluded.has(key)) continue;
    const demoteTo = key != null ? demotions[key] : undefined;
    if (demoteTo && rank(demoteTo) < rank(inc.severity)) {
      out.push({ ...inc, severity: demoteTo });
    } else {
      out.push(inc);
    }
  }
  return out;
}
