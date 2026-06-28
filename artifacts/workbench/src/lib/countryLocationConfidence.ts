// Location confidence for the Country Report map (spec §6 plotting rule).
//
// Country incidents are geocoded from a curated place -> centroid table, so a
// coordinate is only ever as precise as the place NAME we resolved. A record
// known only as "Jakarta" lands on the Jakarta city centroid; plotting it as an
// exact dot implies a precision the source never gave (false precision). This
// pure classifier reads the title + location TEXT and decides how precisely we
// actually know WHERE an incident happened, so the map can plot only the
// records with a confirmed local fix and COUNT the vaguer ones in a note.
//
// Confidence ladder (most precise first):
//   exact         explicit coordinates in the text.
//   good-local    a sub-city geographic fix — street, neighbourhood, named
//                 admin unit below city level, landmark, terminal/berth, etc.
//   city-only     a place name no more precise than a city / town / regency.
//   province-only the only place named is a province / region / highlands /
//                 governorate etc. (above city level).
//   unknown       no usable place text at all.
//
// Only `exact` and `good-local` are `plottable`; everything else is honest as a
// count, never a precise marker. The classifier is deliberately CONSERVATIVE —
// it requires POSITIVE evidence of sub-city specificity before it calls a record
// good-local, because the geocoder cannot give us a precise point otherwise.

export type LocationConfidence =
  | "exact"
  | "good-local"
  | "city-only"
  | "province-only"
  | "unknown";

export interface LocationConfidenceResult {
  confidence: LocationConfidence;
  /** True only for `exact` / `good-local` — safe to drop a precise marker. */
  plottable: boolean;
}

// Explicit lat,lng in the text (>= 3 decimals so dates / scores never match).
const COORD_RE = /-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/;

// Sub-city geographic specificity: streets, landmarks and admin units BELOW
// city level. Any of these means we know roughly where below the city, so a
// marker is defensible. (A named business — "the sandal factory" — tells us
// WHAT, not WHERE precisely, so premises names are intentionally NOT here.)
const LOCAL_SPECIFIC_RE =
  /\b(jalan|jl\.?|street|road|avenue|boulevard|blvd|highway|expressway|toll\s?road|flyover|overpass|underpass|bridge|roundabout|junction|intersection|km\s?\d+|kelurahan|kecamatan|desa|dusun|kampung|barangay|purok|sitio|ward\s?\d*|sector\s?\d+|block\s?[a-z0-9]+|phase\s?\d+|sub-?district|neighbou?rhood|suburb|village|hamlet|terminal\s?\d+|gate\s?\d+|pier\s?\d+|berth\s?\d+|jetty|wharf|airport|seaport)\b/i;

// Region / admin markers ABOVE city level. Bare "district" is intentionally
// excluded — it is used both for sub-city wards and for regency-level units, so
// it is too ambiguous to bucket either way.
const REGION_MARKER_RE =
  /\b(province|provinces|provincial|regency|regencies|prefecture|governorate|district of|autonomous region|special region|metropolitan|greater|highlands|valley|division|county|region of|regional)\b/i;

export function classifyLocationConfidence(input: {
  title?: string | null;
  location?: string | null;
}): LocationConfidenceResult {
  const loc = (input.location ?? "").trim();
  const ttl = (input.title ?? "").trim();

  if (COORD_RE.test(loc) || COORD_RE.test(ttl)) {
    return { confidence: "exact", plottable: true };
  }

  // Sub-city specificity (in either the location text or the headline) earns a
  // precise marker.
  if (LOCAL_SPECIFIC_RE.test(loc) || LOCAL_SPECIFIC_RE.test(ttl)) {
    return { confidence: "good-local", plottable: true };
  }

  const parts = loc
    .split(/[,/]|\s-\s/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { confidence: "unknown", plottable: false };
  }

  if (REGION_MARKER_RE.test(loc)) {
    return { confidence: "province-only", plottable: false };
  }
  return { confidence: "city-only", plottable: false };
}

export interface LocationConfidenceSummary {
  total: number;
  /** exact + good-local. */
  plottable: number;
  /** city-only + province-only (known place, but no precise fix). */
  vague: number;
  /** no usable place text. */
  unknown: number;
  byConfidence: Record<LocationConfidence, number>;
}

export function summariseLocationConfidence(
  items: { title?: string | null; location?: string | null }[],
): LocationConfidenceSummary {
  const byConfidence: Record<LocationConfidence, number> = {
    exact: 0,
    "good-local": 0,
    "city-only": 0,
    "province-only": 0,
    unknown: 0,
  };
  for (const it of items) {
    byConfidence[classifyLocationConfidence(it).confidence] += 1;
  }
  return {
    total: items.length,
    plottable: byConfidence.exact + byConfidence["good-local"],
    vague: byConfidence["city-only"] + byConfidence["province-only"],
    unknown: byConfidence.unknown,
    byConfidence,
  };
}
