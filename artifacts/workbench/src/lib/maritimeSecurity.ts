import type { MaritimeSecurityEvent } from "@workspace/api-client-react";

// Shared selection / shaping logic for ICC CCS / IMB maritime-security events.
//
// CRITICAL PRODUCT RULE: these events are a STANDALONE maritime-security source.
// They live in their own `maritime_security_events` table and are NEVER mixed
// into the incidents pool — nothing here is ever added to an incident / crime /
// shipping count. Every surface (Shipping monitor, Shipping Watch report + PDF,
// country report, map) consumes the SAME builder below so the screen and the
// PDF can never disagree.
//
// Source: ICC International Maritime Bureau (IMB) Piracy Reporting Centre live
// piracy map, current calendar year only.

export const MARITIME_SECURITY_SOURCE_LABEL =
  "ICC CCS / IMB Piracy Reporting Centre";
export const MARITIME_SECURITY_SOURCE_PAGE = "https://icc-ccs.org/map/";

// Display ordering / accent for the IMB classifications, most severe first.
// Colours stay inside the five-tier severity palette already used across the
// report so the section does not introduce a new colour language.
export const MARITIME_TYPE_ORDER: string[] = [
  "Hijacking",
  "Fired Upon",
  "Boarded",
  "Armed Robbery",
  "Attempted Boarding",
  "Suspicious Vessel",
  "Unknown Maritime Security Incident",
];

export const MARITIME_TYPE_COLOR: Record<string, string> = {
  Hijacking: "#800000",
  "Fired Upon": "#C0392B",
  Boarded: "#E67E22",
  "Armed Robbery": "#E67E22",
  "Attempted Boarding": "#6FB872",
  "Suspicious Vessel": "#B8C2CC",
  "Unknown Maritime Security Incident": "#B8C2CC",
};

export function maritimeTypeColor(type: string): string {
  return MARITIME_TYPE_COLOR[type] ?? "#465bff";
}

// Map an IMB classification onto the shared five-tier severity key so the
// geospatial map can colour maritime-security markers with the SAME palette as
// every other layer (markerStyle keys off the severity string). This is a
// display mapping only — it never assigns a severity to an incident row.
export function maritimeTypeSeverityKey(type: string): string {
  switch (type) {
    case "Hijacking":
      return "extreme";
    case "Fired Upon":
      return "high";
    case "Boarded":
    case "Armed Robbery":
      return "moderate";
    case "Attempted Boarding":
      return "low";
    case "Suspicious Vessel":
      return "insignificant";
    default:
      return "low";
  }
}

export type MaritimeSecurityRow = {
  id: number;
  eventKey: string;
  incidentNumber: string | null;
  type: string;
  title: string;
  narrative: string | null;
  location: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  date: Date | null;
  sourceUrl: string | null;
  coordinateQuality: string;
};

export type MaritimeSecuritySummary = {
  /** Rows in scope, sorted newest-first, capped to `limit`. */
  rows: MaritimeSecurityRow[];
  /** Total in scope BEFORE the display cap (for "showing N of M"). */
  total: number;
  /** Per-classification counts, ordered by MARITIME_TYPE_ORDER. */
  byType: { type: string; count: number; color: string }[];
  /** Newest event date in scope, or null. */
  latestDate: Date | null;
  /** Distinct coastal-state count in scope. */
  countriesCovered: number;
  /** How many in-scope rows carry usable map coordinates. */
  mappableCount: number;
  /** Plain-language analyst read introducing the section. */
  read: string;
};

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function toMaritimeRow(e: MaritimeSecurityEvent): MaritimeSecurityRow {
  return {
    id: e.id,
    eventKey: e.eventKey,
    incidentNumber: e.incidentNumber ?? null,
    type: e.incidentType,
    title:
      (e.title && e.title.trim()) ||
      (e.incidentNumber && e.incidentNumber.trim()) ||
      "Maritime security event",
    narrative: e.narrative ?? null,
    location: e.locationName ?? null,
    country: e.country ?? null,
    lat: typeof e.latitude === "number" ? e.latitude : null,
    lng: typeof e.longitude === "number" ? e.longitude : null,
    date: parseDate(e.incidentDate),
    sourceUrl: e.sourceUrl ?? null,
    coordinateQuality: e.coordinateQuality ?? "missing",
  };
}

// Loose country match so the country report can attach events even when the IMB
// coastal-state string differs slightly from the report's country name (e.g.
// "Indonesia" vs the report slug). Substring match both directions, case-fold.
export function maritimeCountryMatches(
  rowCountry: string | null,
  rowLocation: string | null,
  wanted: string,
): boolean {
  const w = wanted.trim().toLowerCase();
  if (!w) return false;
  const fields = [rowCountry, rowLocation].filter(Boolean).map((s) =>
    s!.toLowerCase(),
  );
  return fields.some((f) => f.includes(w) || w.includes(f));
}

function cleanNarrativeSnippet(n: string | null, max = 160): string | null {
  if (!n) return null;
  const t = n.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "\u2026";
}

export function buildMaritimeSecuritySummary(
  events: MaritimeSecurityEvent[],
  opts: {
    windowStart?: Date | null;
    windowEnd?: Date | null;
    country?: string | null;
    limit?: number;
  } = {},
): MaritimeSecuritySummary {
  const { windowStart, windowEnd, country, limit = 40 } = opts;

  let rows = events.map(toMaritimeRow);

  if (country) {
    rows = rows.filter((r) =>
      maritimeCountryMatches(r.country, r.location, country),
    );
  }
  if (windowStart || windowEnd) {
    rows = rows.filter((r) => {
      if (!r.date) return false;
      if (windowStart && r.date < windowStart) return false;
      if (windowEnd && r.date > windowEnd) return false;
      return true;
    });
  }

  rows.sort((a, b) => {
    const at = a.date ? a.date.getTime() : 0;
    const bt = b.date ? b.date.getTime() : 0;
    return bt - at;
  });

  const total = rows.length;
  const latestDate = rows.find((r) => r.date)?.date ?? null;

  const typeCounts = new Map<string, number>();
  const countrySet = new Set<string>();
  let mappableCount = 0;
  for (const r of rows) {
    typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
    if (r.country) countrySet.add(r.country.trim().toLowerCase());
    if (r.lat != null && r.lng != null) mappableCount += 1;
  }

  const byType = MARITIME_TYPE_ORDER.filter((t) => typeCounts.has(t))
    .map((t) => ({
      type: t,
      count: typeCounts.get(t) ?? 0,
      color: maritimeTypeColor(t),
    }))
    .sort((a, b) => b.count - a.count);

  const read = buildRead(rows, byType, countrySet.size, latestDate);

  return {
    rows: rows.slice(0, limit),
    total,
    byType,
    latestDate,
    countriesCovered: countrySet.size,
    mappableCount,
    read,
  };
}

function buildRead(
  rows: MaritimeSecurityRow[],
  byType: { type: string; count: number }[],
  countries: number,
  latest: Date | null,
): string {
  if (rows.length === 0) {
    return "The ICC International Maritime Bureau recorded no piracy or armed-robbery activity for this scope in the current year. Maritime security is a standalone reference layer and is never added to incident totals.";
  }
  const leadType = byType[0]?.type ?? null;
  const lead = rows[0];
  const where =
    countries > 1
      ? "across several coastal states"
      : lead.country
        ? `concentrated off ${lead.country}`
        : "at sea and at anchorage";
  const typePhrase =
    leadType && leadType !== "Unknown Maritime Security Incident"
      ? `${leadType.toLowerCase()} activity`
      : "piracy and armed-robbery activity";
  const example = cleanNarrativeSnippet(lead.narrative, 140);
  const exampleSentence = example
    ? ` The most recent entry reports: ${example}`
    : "";
  void latest;
  return `Maritime security reporting from the ICC International Maritime Bureau this period was led by ${typePhrase}, ${where}. These events come from the IMB Piracy Reporting Centre as a standalone reference layer and are never counted as incidents.${exampleSentence}`;
}
