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
  /** Analyst-set exact severity per incident id (either direction — an explicit
   *  analyst judgement, unlike the demote-only hedge). Wins over
   *  severityDemotions for the same id. */
  severityOverrides?: Record<string, string>;
  /** Top 3 Developments curation — pinned incident ids render in the section
   *  (in pin order, ahead of the automatic picks) and top3ExcludedIds drop an
   *  automatic pick from the section only (the incident falls back to the
   *  Incident Details buckets). Section-scoped, unlike excludedIncidentIds. */
  top3PinnedIds?: string[];
  top3ExcludedIds?: string[];
  /** Analyst-authored free-text developments — something the data has missed
   *  or that has only just come through. Rendered as Top-3 cards AHEAD of the
   *  pinned/automatic picks. Clearly analyst-attributed (source "Analyst
   *  entry"), never mixed into any dataset aggregate, chart or watchlist. */
  top3CustomItems?: CustomTop3Development[];
  /** Analyst-edited Current Situation theme paragraphs, keyed by theme key
   *  (e.g. "governance", "crime"). Blank/absent = auto paragraph. */
  themeParagraphs?: Record<string, string>;
  /** Analyst-edited Recommended Actions bullets, keyed by action-group key;
   *  value is newline-separated bullet lines. Blank/absent = auto bullets. */
  actionGroups?: Record<string, string>;
  /** Analyst-placed extra map markers (facility, route point, area of concern
   *  …), rendered ALONGSIDE the §23-gated incident dots on the spot-style
   *  report map. Same shape as the spot-report mapPoints: hand-typed
   *  coordinates + label + optional severity tint. Display-only — never joins
   *  any aggregate, watchlist or prose grounding. */
  mapMarkers?: CountryMapMarker[];
}

/** One analyst-placed report-map marker. */
export interface CountryMapMarker {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  severity?: string;
}

/** Persisted mapMarkers can be malformed (hand-edited jsonb, older shapes) —
 *  keep only rows with real finite coordinates. */
export function sanitizeMapMarkers(raw: unknown): CountryMapMarker[] {
  if (!Array.isArray(raw)) return [];
  const out: CountryMapMarker[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const lat = typeof r.lat === "number" ? r.lat : Number(r.lat);
    const lng = typeof r.lng === "number" ? r.lng : Number(r.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : `${lat},${lng}`,
      lat,
      lng,
      label: typeof r.label === "string" ? r.label : undefined,
      severity: typeof r.severity === "string" ? r.severity : undefined,
    });
  }
  return out;
}

/** One analyst-typed Top-3 development. `date` is ISO yyyy-mm-dd. */
export interface CustomTop3Development {
  id: string;
  title: string;
  detail?: string;
  location?: string;
  severity?: string;
  date?: string;
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
  const overrides = ov?.severityOverrides ?? {};
  const out: T[] = [];
  for (const inc of incidents) {
    const key = incidentIdKey(inc.id);
    if (key != null && excluded.has(key)) continue;
    // Explicit analyst severity override (either direction) beats the
    // demote-only correction for the same incident.
    const overrideTo = key != null ? overrides[key] : undefined;
    if (overrideTo && SEVERITY_RANK[overrideTo.trim().toLowerCase()] != null) {
      out.push({ ...inc, severity: overrideTo });
      continue;
    }
    const demoteTo = key != null ? demotions[key] : undefined;
    if (demoteTo && rank(demoteTo) < rank(inc.severity)) {
      out.push({ ...inc, severity: demoteTo });
    } else {
      out.push(inc);
    }
  }
  return out;
}

/** Curation for the Top 3 Developments selection. Pinned items (looked up in
 *  the curated window pool by id, in pin order) lead the section; automatic
 *  picks carrying a top3ExcludedIds entry drop from the section (falling back
 *  to Incident Details); the list is then capped so it never shrinks below the
 *  automatic three unless the pool itself is smaller. Pinning more than three
 *  keeps every pinned item (the analyst's explicit choice wins over the cap). */
export function applyTopThreeCuration<T extends { id: string }>(
  autoPicks: T[],
  pool: T[],
  ov: CountrySectionOverrides | null | undefined,
): T[] {
  const pinnedIds = ov?.top3PinnedIds ?? [];
  const excludedIds = new Set((ov?.top3ExcludedIds ?? []).map(String));
  if (pinnedIds.length === 0 && excludedIds.size === 0) return autoPicks;
  const byId = new Map(pool.map((it) => [String(it.id), it]));
  const pinned: T[] = [];
  const seen = new Set<string>();
  for (const rawId of pinnedIds) {
    const id = String(rawId);
    if (seen.has(id)) continue;
    const item = byId.get(id);
    if (!item) continue; // pinned incident no longer in the window pool
    pinned.push(item);
    seen.add(id);
  }
  const autos = autoPicks.filter(
    (it) => !seen.has(String(it.id)) && !excludedIds.has(String(it.id)),
  );
  const cap = Math.max(3, pinned.length);
  return [...pinned, ...autos].slice(0, cap);
}
