// Structured country-brief dataset builder (Papua New Guinea + West Papua).
//
// Builds the nine-section structured security brief from the live incident feed.
// Originally PNG-only; now config-driven so the West Papua brief reuses the
// IDENTICAL section order, card shape and prose engine — only the theatre config
// (country name, location buckets -> provinces, and a few theatre-specific prose
// anchors) differs. This module is invoked exclusively for the structured
// country reports, so its broadened scope and derived attributes never leak into
// any other country report or the topic monitors.
//
// Per-item extraction (province / category / business impact / occurred-vs-
// reported date) is read STRAIGHT FROM THE INCIDENTS API. The columns are
// populated server-side by the canonical rulebook in
// `lib/ingest/src/structuredExtract.ts` (bound to a theatre gazetteer in
// pngExtract.ts / westPapuaExtract.ts) — at ingest for new rows and via the
// marker-gated backfill + the live-ingest onlyNull enrichment pass for every
// tagged row across topics — so the client no longer recomputes them and can
// never drift from ingest. The columns are nullable, so a residual unextracted
// row falls back to the rulebook's own "Other security" default (NOT a re-run of
// the rulebook).
//
// `derivePngProvince` / `deriveWestPapuaProvince` are imported below — but only
// to map curated watchlist LABELS to provinces for the coverage-gap check, which
// is not per-incident recomputation.

import { derivePngProvince, extractPngItem } from "@workspace/ingest/pngExtract";
import { deriveWestPapuaProvince, extractWestPapuaItem } from "@workspace/ingest/westPapuaExtract";
import { deriveIndonesiaProvince, extractIndonesiaItem } from "@workspace/ingest/indonesiaExtract";
import { deriveJakartaArea, extractJakartaItem } from "@workspace/ingest/jakartaExtract";

export type { PngCategory } from "@workspace/ingest/pngExtract";
import type { PngCategory } from "@workspace/ingest/pngExtract";

// ---------------------------------------------------------------------------
// Input shape (permissive — the page passes CountryFastFactsIncident objects,
// which at runtime also carry `confidence` even though that field is not on the
// narrow type). Everything except title/severity/occurredAt is optional.
// ---------------------------------------------------------------------------
export interface PngSourceIncident {
  id?: number | string;
  title: string;
  displayTitle?: string | null;
  summary?: string | null;
  severity: string;
  occurredAt: string;
  country?: string | null;
  location?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  resolvedUrl?: string | null;
  confidence?: string | null;
  // Server-extracted enrichment (see lib/ingest/src/structuredExtract.ts),
  // surfaced through the incidents API. When present these are authoritative and
  // the client derivation below is skipped; when null (non-structured-theatre /
  // not-yet-backfilled rows, e.g. prod before a republish+ingest) the client
  // falls back to the rulebook default so the report renders either way.
  province?: string | null;
  category?: string | null;
  businessImpact?: string | null;
  incidentDate?: string | null;
}

// Generic word-boundary helper — used only by the watchlist-gap check further
// down. Province / category / occurred-date derivation all come from the shared
// @workspace/ingest rulebook imported above (no duplicated copy).
function hasWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack);
}

// ---------------------------------------------------------------------------
// Title cleanup (strip a trailing " - Publisher" masthead)
// ---------------------------------------------------------------------------
function cleanTitle(title: string | null | undefined, source: string | null | undefined): string {
  let t = (title ?? "").trim();
  const src = (source ?? "").trim();
  if (!t) return "";
  const seps = [" - ", " — ", " – ", " | "];
  if (src) {
    for (const sep of seps) {
      const suffix = `${sep}${src}`;
      if (t.toLowerCase().endsWith(suffix.toLowerCase())) return t.slice(0, t.length - suffix.length).trim();
    }
  }
  const m = t.match(/^(.*\S)\s[-–—|]\s([^-–—|]{2,40})$/);
  if (m) {
    const tail = m[2].trim();
    const wordCount = tail.split(/\s+/).length;
    const looksLikeMasthead = /\b(news|times|post|herald|guardian|reuters|bloomberg|daily|tribune|gazette|journal|chronicle|observer|telegraph|press|wire|report|today|mail|express|standard|abc|bbc|cnn|afp|rnz|pngfm|loop|bulletin|review|insider|monitor|dispatch|courier|sun|star|globe|record|digest|radio|tv|online|media|emtv|national|jubi|antara|kompas|detik|tempo|tribun|suara|cendrawasih|tabloid)\b/i.test(tail);
    if (wordCount <= 6 && !/\d/.test(tail) && looksLikeMasthead) return m[1].trim();
  }
  return t;
}

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------
const SEV_RANK: Record<string, number> = { insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5 };
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};

// Empty-location fallback — EXACT wording required by the brief spec. Both
// theatres use the same location-generic sentence.
export const PNG_EMPTY_LOCATION_FALLBACK =
  "No fresh publicly reported protest, theft, robbery or major crime incident identified in open sources for this location during the reporting period.";

// Shown for a location section whose only incidents this period were promoted
// into "Top 3 Incidents This Week" above. Without this the section would render
// the empty-location fallback, which would falsely claim no fresh reporting for
// a location that in fact had a headline incident.
export const PNG_FEATURED_ABOVE_NOTE =
  "The most significant incidents for this location this period appear under Top 3 Incidents This Week above; no additional reporting was identified for this location during the reporting period.";

// ---------------------------------------------------------------------------
// Theatre configuration
// ---------------------------------------------------------------------------
// A structured-brief theatre supplies its country name, the location buckets
// (each bucket maps one or more provinces from its gazetteer), and a handful of
// theatre-specific prose anchors. Everything else (section order, card shape,
// diagnostics, dedup, severity sorting) is shared.
export interface StructuredBucketDef {
  key: string;
  label: string;
  provinces: string[];
}

// Optional per-location augmentation. When a bucket key carries one, the
// renderer splits that location into labelled strands (confirmed incidents /
// police activity & arrests / crime trend indicators) and ALWAYS renders a
// standing operating-risk paragraph so the section is never blank — even in a
// week with no fresh reporting. Used for PNG's Port Moresby / NCD section;
// theatres that omit it (e.g. West Papua) render the flat location list.
export interface StructuredLocationAugmentation {
  // EXACT caveat shown when no confirmed incidents were reported in-window for
  // this location. Required wording per the brief spec — do not alter.
  sparseCaveat: string;
  // Standing operating-risk prose, ALWAYS rendered for this location so a quiet
  // reporting week never reads as an absence of risk.
  standingOperatingRisk: string;
}

export interface StructuredTheatreConfig {
  countryName: string;
  buckets: StructuredBucketDef[];
  otherBucketLabel: string;
  emptyLocationFallback: string;
  businessImpactEmptyNote: string;
  emptyOutlook: string;
  // Inserted into "Conditions can shift quickly around <clause>, so treat any
  // single quiet week as provisional."
  outlookVolatilityClause: string;
  deriveProvince: (location: string | null | undefined, text: string) => string | null;
  // Optional client-side per-item extraction fallback. Used ONLY when the
  // incidents API has not populated the server-extracted province / category /
  // business-impact columns (the Indonesia + Jakarta theatres are not
  // backfilled server-side). PNG / West Papua rows always carry the columns, so
  // their entry stays inert. Mirrors the shared structuredExtract output.
  extractItem?: (
    title: string,
    summary: string,
    location: string | null | undefined,
  ) => { province: string | null; category: PngCategory; businessImpact: string };
  // Optional, keyed by bucket key (e.g. "ncd"). Buckets without an entry render
  // the standard flat location list.
  locationAugmentations?: Record<string, StructuredLocationAugmentation>;
}

export const PNG_REPORT_CONFIG: StructuredTheatreConfig = {
  countryName: "Papua New Guinea",
  buckets: [
    { key: "ncd", label: "Port Moresby / National Capital District", provinces: ["National Capital District"] },
    { key: "morobe", label: "Lae / Morobe", provinces: ["Morobe"] },
    { key: "westernHighlands", label: "Mt Hagen / Western Highlands", provinces: ["Western Highlands"] },
  ],
  otherBucketLabel: "Other National Security-Relevant Activity",
  emptyLocationFallback: PNG_EMPTY_LOCATION_FALLBACK,
  businessImpactEmptyNote:
    "No fresh incident-driven business impact was identified this period. Standing exposures — urban crime, Highlands tribal violence, and intermittent road, power and connectivity disruption — continue to apply.",
  emptyOutlook:
    "With no fresh reporting this period, expect the standing risk pattern to persist: opportunistic crime in urban centres, periodic tribal and communal flare-ups in the Highlands, and intermittent road, power and connectivity disruption. Maintain current movement and continuity precautions and re-test them as fresh reporting comes through.",
  outlookVolatilityClause: "paydays, court rulings, election cycles and tribal-payback events",
  deriveProvince: derivePngProvince,
  extractItem: extractPngItem,
  locationAugmentations: {
    ncd: {
      sparseCaveat:
        "Open source incident reporting was limited during the period. This should not be read as an absence of crime.",
      standingOperatingRisk:
        "Port Moresby and the wider National Capital District carry a persistently high baseline of urban crime that holds regardless of week-to-week reporting. Armed robbery, hold-ups, carjacking and vehicle theft, opportunistic street crime and organised gang activity are entrenched — concentrated around settlements, markets, transport corridors and commercial premises, and rising around paydays, month-end and public holidays. Treat the standing threat as continuous: maintain movement security, premises protection and after-hours precautions irrespective of how much fresh reporting comes through in any given week.",
    },
  },
};

export const WEST_PAPUA_REPORT_CONFIG: StructuredTheatreConfig = {
  countryName: "West Papua",
  buckets: [
    {
      key: "centralHighlands",
      label: "Central Highlands (Highland & Central Papua)",
      provinces: ["Papua Pegunungan", "Papua Tengah"],
    },
    {
      key: "jayapuraNorthCoast",
      label: "Jayapura & North Coast (Papua Province)",
      provinces: ["Papua"],
    },
    {
      key: "southPapua",
      label: "Merauke & South Papua",
      provinces: ["Papua Selatan"],
    },
    {
      key: "birdsHead",
      label: "Bird's Head (West & Southwest Papua)",
      provinces: ["Papua Barat", "Papua Barat Daya"],
    },
  ],
  otherBucketLabel: "Other Provincial / National Security-Relevant Activity",
  emptyLocationFallback: PNG_EMPTY_LOCATION_FALLBACK,
  businessImpactEmptyNote:
    "No fresh incident-driven business impact was identified this period. Standing exposures — security-force and insurgent activity in the central highlands, periodic urban unrest around Jayapura, and intermittent road, air and connectivity disruption — continue to apply.",
  emptyOutlook:
    "With no fresh reporting this period, expect the standing risk pattern to persist: security-force and insurgent activity in the central highlands, periodic unrest around Jayapura and the university districts, and intermittent road, air and connectivity disruption. Maintain current movement and continuity precautions and re-test them as fresh reporting comes through.",
  outlookVolatilityClause:
    "security-force operations, separatist anniversaries, student mobilisation and flashpoints around resource projects",
  deriveProvince: deriveWestPapuaProvince,
  extractItem: extractWestPapuaItem,
};

export const INDONESIA_REPORT_CONFIG: StructuredTheatreConfig = {
  countryName: "Indonesia",
  buckets: [
    {
      key: "greaterJakartaWestJava",
      label: "Greater Jakarta & West Java",
      provinces: ["DKI Jakarta", "West Java", "Banten"],
    },
    {
      key: "centralEastJava",
      label: "Central & East Java",
      provinces: ["Central Java", "Yogyakarta", "East Java"],
    },
    {
      key: "sumatra",
      label: "Sumatra",
      provinces: [
        "Aceh",
        "North Sumatra",
        "West Sumatra",
        "Riau",
        "Riau Islands",
        "Jambi",
        "South Sumatra",
        "Bengkulu",
        "Lampung",
        "Bangka Belitung",
      ],
    },
    {
      key: "kalimantan",
      label: "Kalimantan (Borneo)",
      provinces: [
        "West Kalimantan",
        "Central Kalimantan",
        "South Kalimantan",
        "East Kalimantan",
        "North Kalimantan",
      ],
    },
    {
      key: "sulawesi",
      label: "Sulawesi",
      provinces: [
        "North Sulawesi",
        "Central Sulawesi",
        "South Sulawesi",
        "Southeast Sulawesi",
        "West Sulawesi",
        "Gorontalo",
      ],
    },
    {
      key: "baliNusaMaluku",
      label: "Bali, Nusa Tenggara & Maluku",
      provinces: [
        "Bali",
        "West Nusa Tenggara",
        "East Nusa Tenggara",
        "Maluku",
        "North Maluku",
      ],
    },
  ],
  otherBucketLabel: "Other National Security-Relevant Activity",
  emptyLocationFallback: PNG_EMPTY_LOCATION_FALLBACK,
  businessImpactEmptyNote:
    "No fresh incident-driven business impact was identified this period. Standing exposures — urban crime in the major cities, periodic mass demonstrations around fuel, wage and political flashpoints, localised communal and sectarian tension, and recurrent natural-hazard disruption — continue to apply.",
  emptyOutlook:
    "With no fresh reporting this period, expect the standing risk pattern to persist: opportunistic and organised urban crime, episodic large-scale protest around economic and political triggers, localised communal tension, and natural-hazard disruption to transport and operations. Maintain current movement and continuity precautions and re-test them as fresh reporting comes through.",
  outlookVolatilityClause:
    "fuel-subsidy and minimum-wage decisions, student and labour mobilisation, election dates and natural-hazard episodes",
  deriveProvince: deriveIndonesiaProvince,
  extractItem: extractIndonesiaItem,
};

export const JAKARTA_REPORT_CONFIG: StructuredTheatreConfig = {
  countryName: "Jakarta",
  buckets: [
    { key: "centralJakarta", label: "Central Jakarta", provinces: ["Central Jakarta"] },
    { key: "southJakarta", label: "South Jakarta", provinces: ["South Jakarta"] },
    { key: "northJakarta", label: "North Jakarta", provinces: ["North Jakarta"] },
    { key: "eastJakarta", label: "East Jakarta", provinces: ["East Jakarta"] },
    { key: "westJakarta", label: "West Jakarta", provinces: ["West Jakarta"] },
    {
      key: "greaterJakarta",
      label: "Greater Jakarta (Jabodetabek)",
      provinces: ["Greater Jakarta (Jabodetabek)"],
    },
  ],
  otherBucketLabel: "Other Jakarta-Area Activity",
  emptyLocationFallback: PNG_EMPTY_LOCATION_FALLBACK,
  businessImpactEmptyNote:
    "No fresh incident-driven business impact was identified this period. Standing exposures — petty and organised urban crime, large demonstrations around the presidential palace, parliament and major thoroughfares, traffic and transport disruption, and seasonal flooding — continue to apply across the capital.",
  emptyOutlook:
    "With no fresh reporting this period, expect the standing risk pattern to persist across Greater Jakarta: opportunistic street crime, episodic mass protest in the central business and government districts, recurrent traffic and transport disruption, and seasonal flooding. Maintain current movement and continuity precautions and re-test them as fresh reporting comes through.",
  outlookVolatilityClause:
    "wage and fuel-subsidy announcements, major court and parliamentary calendar dates, and large rallies around the presidential palace and parliament",
  deriveProvince: deriveJakartaArea,
  extractItem: extractJakartaItem,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface PngReportItem {
  id: string;
  title: string;
  // The incident's own reported summary text. Carried through so the AI
  // per-incident analyst summary can be grounded on title + summary, and used as
  // the fingerprint/grounding input for the prose engine.
  summary: string;
  province: string | null;
  category: PngCategory;
  businessImpact: string;
  severity: string;
  severityLabel: string;
  severityRank: number;
  reportedDate: Date;
  incidentDate: Date | null;
  occurredEarlier: boolean;
  source: string;
  url: string | null;
  confidence: string;
}

export interface StructuredLocationBucket {
  key: string;
  label: string;
  items: PngReportItem[];
  // True when this location had incident(s) this period but all were promoted
  // into Top 3 above, so the section shows a "featured above" note rather than a
  // false "no fresh reporting" fallback.
  hadFeatured: boolean;
  // Present only for buckets with a config locationAugmentation (PNG NCD). When
  // set, the renderer shows the strand layout + standing-risk block.
  augmentation?: StructuredLocationAugmentation;
  // The bucket's items split into the three incident strands. Present iff
  // `augmentation` is set. Standing operating risk is config prose, not items.
  strands?: {
    confirmed: PngReportItem[];
    police: PngReportItem[];
    trend: PngReportItem[];
  };
}

// One row of the Location Watchlist: a location that carries fresh or standing
// watch signals, with WHY it matters and a recommended action. All three fields
// are deterministic — derived from this period's incidents (backstopped by the
// curated baseline watchlist), never fabricated.
export interface LocationWatchlistEntry {
  location: string;
  why: string;
  action: string;
}

// Assessed confidence in this period's open-source picture. Level drives a chip
// colour in the renderer; rationale explains the call qualitatively (source
// breadth + location detail), never with raw counts.
export interface ReportingConfidence {
  level: "High" | "Moderate" | "Low";
  rationale: string;
}

export interface PngReportDataset {
  periodLabel: string;
  // Bottom Line Up Front — a single short paragraph at the very top giving the
  // week's trajectory, the lead concern and the principal business risk.
  bluf: string;
  executiveSummary: string;
  // Week-on-week delta (volume / severity / focus / type / quiet areas),
  // described qualitatively against the previous 7-day window.
  whatChanged: string;
  topThree: PngReportItem[];
  buckets: StructuredLocationBucket[];
  otherNational: PngReportItem[];
  // True when the "Other" catch-all had incident(s) this period but all were
  // promoted into Top 3 above (see StructuredLocationBucket.hadFeatured).
  otherNationalHadFeatured: boolean;
  otherBucketLabel: string;
  emptyLocationFallback: string;
  featuredAboveNote: string;
  businessImpactEmptyNote: string;
  businessImpact: string[];
  // Locations to watch, ranked by this-period volume / severity / repeat
  // reporting, backstopped by the curated baseline watchlist.
  locationWatchlist: LocationWatchlistEntry[];
  outlook: string;
  // Polestar's assessed judgement: what the pattern means, the practical
  // adjustment for the week, and what would raise concern.
  polestarView: string;
  reportingConfidence: ReportingConfidence;
  windowItems: PngReportItem[];
}

interface BuildArgs {
  windowIncidents: PngSourceIncident[];
  // The 7-day window immediately before `windowIncidents`. Optional so any
  // caller that cannot supply it still builds (week-on-week delta degrades to a
  // "limited history" note). Defaults to [].
  previousWindowIncidents?: PngSourceIncident[];
  thirtyDay: PngSourceIncident[];
  ninetyDay: PngSourceIncident[];
  baselineWatchlist: string[];
  periodLabel: string;
}

// Rulebook "Other security" default — used ONLY for a residual row that somehow
// reaches the report without server-extracted columns (after the backfill + the
// live-ingest enrichment pass this should not occur for any structured-report
// row). Kept in sync with OTHER_SECURITY_IMPACT / the default category in
// lib/ingest/src/structuredExtract.ts. This is a benign fallback, NOT a re-run
// of the rulebook — the client no longer recomputes per-incident attributes.
const DEFAULT_CATEGORY: PngCategory = "Other security";
const DEFAULT_BUSINESS_IMPACT =
  "Security-relevant development; monitor for operational follow-on in the affected area.";

function toItem(i: PngSourceIncident, config: StructuredTheatreConfig): PngReportItem {
  // Read the per-incident enrichment STRAIGHT from the incidents API. The
  // columns are populated server-side (ingest + backfill + onlyNull enrichment
  // pass) for every PNG / West Papua tagged row, so the client does not
  // recompute them. For theatres whose rows are NOT backfilled server-side
  // (Indonesia, Jakarta) the columns are null, so fall back to the theatre's
  // client-side rulebook via config.extractItem. category + businessImpact are
  // written together by the rulebook, so they are present or absent as a pair.
  const needsExtract = !i.province || !(i.category && i.businessImpact);
  const ext =
    needsExtract && config.extractItem
      ? config.extractItem(i.title ?? "", i.summary ?? "", i.location)
      : null;
  const province = i.province ?? ext?.province ?? null;
  const category: PngCategory =
    i.category && i.businessImpact
      ? (i.category as PngCategory)
      : ext?.category ?? DEFAULT_CATEGORY;
  const impact =
    i.category && i.businessImpact
      ? i.businessImpact
      : ext?.businessImpact ?? DEFAULT_BUSINESS_IMPACT;
  const sev = (i.severity ?? "").toLowerCase();
  const reportedDate = new Date(i.occurredAt);
  const incidentDate = i.incidentDate ? new Date(i.incidentDate) : null;
  const title =
    i.displayTitle && i.displayTitle.trim() ? i.displayTitle.trim() : cleanTitle(i.title, i.source);
  return {
    id: String(i.id ?? `${i.title}-${i.occurredAt}`),
    title,
    summary: (i.summary ?? "").trim(),
    province,
    category,
    businessImpact: impact,
    severity: sev,
    severityLabel: SEV_LABEL[sev] ?? (i.severity ?? ""),
    severityRank: SEV_RANK[sev] ?? 0,
    reportedDate,
    incidentDate,
    occurredEarlier: incidentDate != null,
    source: (i.source ?? "").trim(),
    url: (i.resolvedUrl ?? i.sourceUrl ?? null) || null,
    confidence: (i.confidence ?? "").trim().toLowerCase() || "unrated",
  };
}

function sortBySeverityThenRecency(a: PngReportItem, b: PngReportItem): number {
  if (b.severityRank !== a.severityRank) return b.severityRank - a.severityRank;
  const da = (a.incidentDate ?? a.reportedDate).getTime();
  const db = (b.incidentDate ?? b.reportedDate).getTime();
  return db - da;
}

// Strand assignment for an augmented location section (currently PNG NCD).
// Policing operations and arrests form their own strand; crime/violence
// incidents are "confirmed incidents"; everything else (contextual, governance
// or infrastructure signals) is treated as a crime-trend indicator. Matches on
// the curated category label, so it tracks the ingest rulebook's categories.
function strandForItem(item: PngReportItem): "confirmed" | "police" | "trend" {
  const c = item.category.toLowerCase();
  if (/(polic|arrest|detention|corrections|custody|operation|patrol)/.test(c)) return "police";
  if (
    /(robbery|hold-up|homicide|violent|tribal|communal|theft|break-in|assault|unrest|protest|kidnap|arson|sexual|attack|crime)/.test(
      c,
    )
  )
    return "confirmed";
  return "trend";
}

function joinList(parts: string[]): string {
  const clean = parts.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

function topLabels<T>(items: T[], key: (t: T) => string, n: number): string[] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// Collapse syndicated re-runs of the same story. Feeds carry the same incident
// under near-identical headlines (with/without a " - Publisher" masthead) from
// several outlets; after cleanTitle they normalise to the same string. Keep one
// representative per normalised title — the best by severity then recency — so
// the report never shows the same event twice.
function dedupKey(title: string): string {
  let t = title.toLowerCase().trim();
  // Drop a trailing " - Publisher"-style segment that some feeds append even
  // when it does not match the row's own source (so cleanTitle left it on).
  // Only strip it when the surviving prefix is still a substantial headline.
  const m = t.match(/^(.*\S)\s[-–—|]\s+(.{1,40})$/);
  if (m && m[1].trim().split(/\s+/).length >= 5) t = m[1];
  return t.replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeByTitle(items: PngReportItem[]): PngReportItem[] {
  const best = new Map<string, PngReportItem>();
  for (const it of items) {
    const key = dedupKey(it.title);
    if (!key) {
      best.set(it.id, it);
      continue;
    }
    const prev = best.get(key);
    if (!prev || sortBySeverityThenRecency(it, prev) < 0) best.set(key, it);
  }
  return Array.from(best.values());
}

function capitaliseFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Raw category bucket labels ("Other security", "Civil unrest / protest") read
// as word salad when spliced into a sentence. Map each to a natural, lowercase
// prose noun phrase; unlisted labels fall back to a slash → "and" rewrite.
const CATEGORY_PHRASE: Record<string, string> = {
  "terrorism / militancy": "terrorism and militancy",
  "armed robbery / hold-up": "armed robbery",
  "tribal / communal violence": "tribal and communal violence",
  "homicide / violent crime": "violent crime",
  "theft / break-in": "theft and break-ins",
  "civil unrest / protest": "protest and civil unrest",
  "labour action": "labour action",
  "policing operation": "policing operations",
  "community policing": "community policing",
  "intelligence / training": "intelligence and training activity",
  "corrections / detention": "corrections and detention",
  "aviation / airport": "aviation and airport disruption",
  "maritime / port": "maritime and port disruption",
  "road / highway": "road and highway disruption",
  "natural hazard": "natural hazards",
  fire: "fires",
  "environmental / haze": "haze and environmental incidents",
  "power / utilities": "power and utility disruption",
  "telecoms / connectivity": "telecoms and connectivity disruption",
  "government stability": "government-stability concerns",
  "other security": "other security-relevant incidents",
};
function categoryPhrase(label: string): string {
  const k = label.toLowerCase();
  return CATEGORY_PHRASE[k] ?? k.replace(/\s*\/\s*/g, " and ");
}

// Map a curated category (matched on keywords, mirroring strandForItem) to a
// recommended action for the Location Watchlist / Polestar View. Severity-aware:
// a high/extreme worst-case for the location prefixes a priority cue. Returns a
// standing-precautions default so an entry is never left without an action.
function recommendedAction(catLower: string, worstRank: number): string {
  let base: string;
  if (/(polic|arrest|detention|corrections|custody|operation|patrol)/.test(catLower))
    base = "Expect security-force activity; confirm road and checkpoint status before movement.";
  else if (/(protest|unrest|demonstration|riot|strike|blockad|march)/.test(catLower))
    base = "Avoid gatherings and choke points; build in extra transit time and keep routes flexible.";
  else if (/(tribal|communal|clash|violen|attack|arson|insurg|militant|armed|gun|shoot|ambush|kidnap)/.test(catLower))
    base = "Hold non-essential movement to affected areas until conditions are confirmed stable.";
  else if (/(robbery|hold-up|holdup|carjack|theft|break-in|burglar|crime|assault|hijack)/.test(catLower))
    base = "Harden movement and premises security; vary routines and avoid predictable timings.";
  else
    base = "Maintain standard movement and continuity precautions; monitor for operational follow-on.";
  return worstRank >= 4 ? `Treat as priority. ${base}` : base;
}

// A short "why it matters" line for a watchlist location, from its dominant
// category this period and whether the worst entry was high-severity. Counts are
// deliberately omitted (user preference) — direction and severity LABELS only.
function whyForLocation(dominantCatLower: string | null, worstRank: number, fresh: boolean): string {
  if (!fresh)
    return "Standing watch location; no fresh open-source reporting this period, so the standing baseline applies.";
  const sev =
    worstRank >= 5 ? "extreme-severity " : worstRank >= 4 ? "high-severity " : "";
  const cat = dominantCatLower ? categoryPhrase(dominantCatLower) : "security-relevant activity";
  return `Fresh ${sev}reporting of ${cat} this period.`;
}

// Generic config-driven builder. The PNG and West Papua entry points below are
// thin wrappers that pass their theatre config.
function buildStructuredReportDataset(
  args: BuildArgs,
  config: StructuredTheatreConfig,
): PngReportDataset {
  const { windowIncidents, previousWindowIncidents, baselineWatchlist, periodLabel } = args;
  const windowItems = dedupeByTitle(windowIncidents.map((i) => toItem(i, config)));
  // Prior 7-day window, deduped the same way, for the week-on-week delta. Empty
  // when the caller supplies none (delta degrades to a "limited history" note).
  const previousWindowItems = dedupeByTitle((previousWindowIncidents ?? []).map((i) => toItem(i, config)));
  // Distinguish "no previous window supplied at all" (week-on-week comparison
  // impossible — never assert a trend) from "previous window supplied but quiet"
  // (a valid comparison against a calm prior week).
  const hasPreviousWindow = previousWindowIncidents !== undefined;

  // Shared week-on-week signals (qualitative — counts never reach the prose).
  const curWorstRank = windowItems.reduce((m, it) => Math.max(m, it.severityRank), 0);
  const prevWorstRank = previousWindowItems.reduce((m, it) => Math.max(m, it.severityRank), 0);
  const curWorstLabel = SEV_LABEL[Object.keys(SEV_RANK).find((k) => SEV_RANK[k] === curWorstRank) ?? ""] ?? "";
  const prevWorstLabel = SEV_LABEL[Object.keys(SEV_RANK).find((k) => SEV_RANK[k] === prevWorstRank) ?? ""] ?? "";
  const topCats = topLabels(windowItems, (it) => it.category, 3).map((c) => c.toLowerCase());
  // Natural-prose forms of the same categories. Raw bucket labels read as word
  // salad in a sentence, so every narrative section uses these instead.
  const topCatPhrases = topCats.map(categoryPhrase);
  const topProvs = topLabels(windowItems.filter((it) => it.province), (it) => it.province as string, 3);
  const prevTopProv = topLabels(previousWindowItems.filter((it) => it.province), (it) => it.province as string, 1)[0] ?? null;
  const prevTopCat = (topLabels(previousWindowItems, (it) => it.category, 1)[0] ?? "").toLowerCase() || null;
  // Volume trajectory bucket: "up" / "down" / "level" (>=2-incident swing to
  // register as a move; otherwise level), and "nohistory" when the prior week
  // has no comparable reporting.
  const volumeTrend: "up" | "down" | "level" | "nohistory" = !hasPreviousWindow
    ? "nohistory"
    : windowItems.length - previousWindowItems.length >= 2
      ? "up"
      : previousWindowItems.length - windowItems.length >= 2
        ? "down"
        : "level";

  // Headline highlights: the three most significant incidents this period.
  // They get their own "Top 3" section, so they are EXCLUDED from the location
  // buckets below — otherwise the same incident is reported twice (once in
  // Top 3, again in its regional section). The regional sections therefore show
  // the REMAINDER. Aggregate sections (Executive Summary, Business Impact,
  // Outlook, diagnostics) still draw on the full windowItems set.
  const topThree = [...windowItems].sort(sortBySeverityThenRecency).slice(0, 3);
  const topThreeIds = new Set(topThree.map((it) => it.id));
  const bucketableItems = windowItems.filter((it) => !topThreeIds.has(it.id));

  // Location buckets from the theatre config; each bucket owns one or more
  // provinces (no overlap). "Other" captures everything not in any bucket.
  const bucketProvinces = new Set<string>();
  for (const b of config.buckets) for (const p of b.provinces) bucketProvinces.add(p);
  const buckets: StructuredLocationBucket[] = config.buckets.map((b) => {
    const provSet = new Set(b.provinces);
    const inBucket = (it: PngReportItem) => it.province != null && provSet.has(it.province);
    const items = bucketableItems.filter(inBucket).sort(sortBySeverityThenRecency);
    const augmentation = config.locationAugmentations?.[b.key];
    let strands: StructuredLocationBucket["strands"];
    if (augmentation) {
      const grouped = {
        confirmed: [] as PngReportItem[],
        police: [] as PngReportItem[],
        trend: [] as PngReportItem[],
      };
      for (const it of items) grouped[strandForItem(it)].push(it);
      strands = grouped;
    }
    return {
      key: b.key,
      label: b.label,
      items,
      hadFeatured: windowItems.some((it) => topThreeIds.has(it.id) && inBucket(it)),
      augmentation,
      strands,
    };
  });
  const inOther = (it: PngReportItem) => !it.province || !bucketProvinces.has(it.province);
  const otherNational = bucketableItems.filter(inOther).sort(sortBySeverityThenRecency);
  const otherNationalHadFeatured = windowItems.some(
    (it) => topThreeIds.has(it.id) && inOther(it),
  );

  // --- Executive summary (deterministic, event-led, no parenthetical counts) -
  let executiveSummary: string;
  if (windowItems.length === 0) {
    executiveSummary = `${config.emptyLocationFallback} The standing operating picture for ${config.countryName} carries over from the preceding period; treat the absence of fresh reporting as a coverage signal, not as an improvement in conditions.`;
  } else {
    const cats = topLabels(windowItems, (it) => it.category, 3).map((c) => c.toLowerCase());
    const provs = topLabels(
      windowItems.filter((it) => it.province),
      (it) => it.province as string,
      3,
    );
    const worst = [...windowItems].sort((a, b) => b.severityRank - a.severityRank)[0];
    const catText = cats.length ? joinList(cats.map(categoryPhrase)) : "security-relevant activity";
    const provText = provs.length ? ` Reporting clustered around ${joinList(provs)}.` : "";
    const sevText =
      worst && worst.severityRank >= 4
        ? ` The most serious entry reached ${worst.severityLabel} severity.`
        : "";
    const p1 = `Open-source reporting for ${config.countryName} this period was led by ${catText}.${provText}${sevText}`;
    const p2 = `The picture is operational rather than a single dramatic event: the priority for business users is movement security, premises protection and continuity at exposed sites while this picture holds.`;
    executiveSummary = `${p1}\n\n${p2}`;
  }

  // --- Business impact (de-duplicated impact lines for the categories present)-
  const seenImpacts = new Set<string>();
  const businessImpact: string[] = [];
  for (const it of [...windowItems].sort(sortBySeverityThenRecency)) {
    if (seenImpacts.has(it.businessImpact)) continue;
    seenImpacts.add(it.businessImpact);
    businessImpact.push(it.businessImpact);
    if (businessImpact.length >= 6) break;
  }

  // --- Outlook (structured: most-likely scenario / key locations / escalation
  // triggers / what would reduce concern; forward-looking, no counts) ---------
  let outlook: string;
  if (windowItems.length === 0) {
    outlook = config.emptyOutlook;
  } else {
    const recurringProv = topProvs.slice(0, 2);
    const recurringCat = topCatPhrases.slice(0, 2);
    const keyLocs = recurringProv.length
      ? joinList(recurringProv)
      : baselineWatchlist.length
        ? joinList(baselineWatchlist.slice(0, 3))
        : "the main urban centres";
    const escClause =
      curWorstRank >= 4
        ? "a spread of high-severity or casualty-bearing incidents beyond the locations above"
        : "any move to high-severity or casualty-bearing incidents, or a spread to new districts";
    const mostLikely =
      recurringCat.length >= 2
        ? `The coming week most likely follows the current pattern, led by ${recurringCat[0]}, with ${recurringCat[1]} also likely to recur.`
        : recurringCat.length === 1
          ? `The coming week most likely follows the current pattern, led by ${recurringCat[0]}.`
          : "The coming week most likely follows the established pattern.";
    const locLine = `Key locations to watch: ${keyLocs}.`;
    const escLine = `Escalation triggers: ${escClause}, and flashpoints around ${config.outlookVolatilityClause}.`;
    const reduceLine = `Concern would ease with a sustained, well-sourced quiet stretch — but, given uneven open-source coverage, treat any single quiet week as provisional rather than a confirmed improvement.`;
    outlook = `${mostLikely} ${locLine}\n\n${escLine} ${reduceLine}`;
  }

  // --- Trajectory (shared by BLUF + Polestar View) ---------------------------
  // Without a previous window there is no honest basis for a trend, so fall back
  // to "stable" (reads as "holds to the standing pattern") rather than inferring
  // a move from an absent baseline.
  const trajectory: "worsening" | "easing" | "stable" | "quiet" =
    windowItems.length === 0
      ? "quiet"
      : !hasPreviousWindow
        ? "stable"
        : curWorstRank > prevWorstRank && curWorstRank >= 4
          ? "worsening"
          : volumeTrend === "up" && curWorstRank >= prevWorstRank
            ? "worsening"
            : volumeTrend === "down" && curWorstRank <= prevWorstRank
              ? "easing"
              : "stable";
  const leadCat = topCats[0] ?? "security-relevant activity";
  const leadCatPhrase = topCatPhrases[0] ?? "security-relevant incidents";
  const leadProvClause = topProvs.length ? ` concentrated around ${joinList(topProvs.slice(0, 2))}` : "";

  // --- BLUF (Bottom Line Up Front) ------------------------------------------
  let bluf: string;
  if (windowItems.length === 0) {
    bluf = `The picture for ${config.countryName} is unclear this period: no fresh open-source reporting was identified, which is read as a coverage signal rather than an improvement in conditions. Standing exposures continue to apply, so maintain existing movement and continuity precautions and treat the quiet period as provisional.`;
  } else {
    const trendWord =
      trajectory === "worsening"
        ? "looks to be deteriorating"
        : trajectory === "easing"
          ? "looks to be easing, though from a high baseline"
          : "holds to the standing pattern";
    const bizRisk =
      curWorstRank >= 4
        ? "the principal business risk is direct exposure to violence and disruption at affected sites"
        : "the principal business risk is incidental exposure to crime and localised disruption rather than a targeted threat";
    bluf = `The operating picture for ${config.countryName} this period ${trendWord}: the lead security concern is ${leadCatPhrase}${leadProvClause}. For business users, ${bizRisk}. Treat any quiet stretch as provisional rather than a confirmed improvement, as open-source coverage is uneven.`;
  }

  // --- What Changed This Week (week-on-week delta, qualitative) --------------
  let whatChanged: string;
  if (windowItems.length === 0) {
    whatChanged =
      previousWindowItems.length > 0
        ? "No fresh reporting was identified this period. This is a fall from the previous week and is treated as a coverage signal, not a confirmed improvement."
        : "Reporting this period remains fragmented, so trend confidence is limited.";
  } else {
    const volumeClause =
      volumeTrend === "nohistory"
        ? "there is no comparable reporting from the previous week, so week-on-week comparison is limited"
        : volumeTrend === "up"
          ? "open-source reporting picked up against the previous week"
          : volumeTrend === "down"
            ? "open-source reporting eased against the previous week"
            : "open-source reporting held at a similar level to the previous week";
    const sevClause =
      previousWindowItems.length === 0
        ? `the most serious entry reached ${curWorstLabel} severity`
        : curWorstRank > prevWorstRank
          ? `the most serious entry rose to ${curWorstLabel} severity`
          : curWorstRank < prevWorstRank
            ? `the most serious entry eased to ${curWorstLabel} severity (from ${prevWorstLabel})`
            : `the most serious entry held at ${curWorstLabel} severity`;
    const focusClause =
      topProvs[0] && prevTopProv && topProvs[0] !== prevTopProv
        ? `The main focus moved to ${topProvs[0]}.`
        : topProvs[0] && prevTopProv && topProvs[0] === prevTopProv
          ? `${topProvs[0]} remained the main focus.`
          : topProvs[0]
            ? `Reporting centred on ${topProvs[0]}.`
            : "";
    const typeClause =
      leadCat && prevTopCat && leadCat !== prevTopCat
        ? ` ${capitaliseFirst(leadCatPhrase)} featured more prominently than in the previous week.`
        : "";
    const prevProvs = topLabels(
      previousWindowItems.filter((it) => it.province),
      (it) => it.province as string,
      3,
    );
    const wentQuiet = prevProvs.filter((p) => !windowItems.some((it) => it.province === p));
    const quietClause = wentQuiet.length
      ? ` No fresh reporting came through from ${joinList(wentQuiet)} this period, which may reflect a coverage gap rather than confirmed calm.`
      : "";
    const body = `${volumeClause}, and ${sevClause}.`;
    const lead = hasPreviousWindow ? `Against the previous week, ${body}` : capitaliseFirst(body);
    whatChanged = `${lead} ${focusClause}${typeClause}${quietClause}`.trim();
  }

  // --- Location Watchlist ----------------------------------------------------
  // Rank locations by this-period signal: volume + high severity + repeat
  // reporting (also seen in the prior week or the 30-day context). Provinces are
  // shown under their friendly bucket label. Backstop with the curated baseline
  // watchlist so the section is never empty when the feed is thin. Cap at 5.
  const thirtyDayItems = dedupeByTitle((args.thirtyDay ?? []).map((i) => toItem(i, config)));
  const provinceLabel = new Map<string, string>();
  for (const b of config.buckets) for (const p of b.provinces) provinceLabel.set(p, b.label);
  const provStats = new Map<string, { count: number; worstRank: number; cat: string | null }>();
  for (const it of windowItems) {
    if (!it.province) continue;
    const s = provStats.get(it.province) ?? { count: 0, worstRank: 0, cat: null };
    s.count += 1;
    s.worstRank = Math.max(s.worstRank, it.severityRank);
    provStats.set(it.province, s);
  }
  for (const [prov, s] of provStats) {
    s.cat =
      topLabels(windowItems.filter((it) => it.province === prov), (it) => it.category, 1)[0]?.toLowerCase() ??
      null;
  }
  const repeatProvinces = new Set<string>();
  for (const it of [...previousWindowItems, ...thirtyDayItems]) if (it.province) repeatProvinces.add(it.province);
  const scoredProvinces = Array.from(provStats.entries())
    .map(([prov, s]) => ({
      prov,
      s,
      score: s.count + (s.worstRank >= 4 ? 3 : s.worstRank >= 3 ? 1 : 0) + (repeatProvinces.has(prov) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const locationWatchlist: LocationWatchlistEntry[] = [];
  const usedLocations = new Set<string>();
  const overlapsUsed = (label: string) => {
    const l = label.toLowerCase();
    for (const u of usedLocations) if (u.includes(l) || l.includes(u)) return true;
    return false;
  };
  for (const { prov, s } of scoredProvinces) {
    if (locationWatchlist.length >= 5) break;
    const label = provinceLabel.get(prov) ?? prov;
    usedLocations.add(label.toLowerCase());
    locationWatchlist.push({
      location: label,
      why: whyForLocation(s.cat, s.worstRank, true),
      action: recommendedAction(s.cat ?? "", s.worstRank),
    });
  }
  for (const label of baselineWatchlist) {
    if (locationWatchlist.length >= 5) break;
    if (overlapsUsed(label)) continue;
    usedLocations.add(label.toLowerCase());
    locationWatchlist.push({
      location: label,
      why: whyForLocation(null, 0, false),
      action: recommendedAction("", 0),
    });
  }

  // --- Polestar View (assessed judgement) ------------------------------------
  let polestarView: string;
  if (windowItems.length === 0) {
    polestarView = `With no fresh reporting this period, Polestar holds the standing assessment for ${config.countryName}: the established risk pattern persists and the quiet period is read as a coverage signal, not an improvement. Maintain current precautions, and treat any return of reporting — particularly higher-severity or casualty-bearing incidents — as the trigger to reassess. Do not read the absence of reporting as confirmed calm.`;
  } else {
    const assessment =
      trajectory === "worsening"
        ? "Risk stepped up this period"
        : trajectory === "easing"
          ? "Risk eased a little this period, though from a high baseline"
          : "Risk held to its usual pattern this period";
    const action =
      curWorstRank >= 4
        ? "tighten movement security and site protection at the exposed locations listed above"
        : "keep current precautions in place and vary movement routines";
    const escTrigger = topProvs[0]
      ? `incidents spread beyond ${topProvs[0]}, or higher-severity, casualty-bearing violence is confirmed`
      : "higher-severity, casualty-bearing violence is confirmed, or reporting spreads to new districts";
    polestarView = `${assessment}, with ${leadCatPhrase}${leadProvClause} leading the reporting. For the week ahead, ${action}. Concern would rise if ${escTrigger}. A single quiet week should not be read as an all-clear: open-source coverage here is uneven, and an absence of reporting is not an absence of risk.`;
  }

  // --- Reporting Confidence --------------------------------------------------
  let reportingConfidence: ReportingConfidence;
  if (windowItems.length === 0) {
    reportingConfidence = {
      level: "Low",
      rationale:
        "No fresh open-source reporting was identified this period, so this assessment rests on standing context rather than current signals.",
    };
  } else {
    const sourceCount = new Set(windowItems.map((it) => it.source).filter(Boolean)).size;
    const locShare = windowItems.filter((it) => it.province).length / windowItems.length;
    const level: ReportingConfidence["level"] =
      sourceCount <= 1 || locShare < 0.34
        ? "Low"
        : sourceCount >= 4 && locShare >= 0.6 && windowItems.length >= 4
          ? "High"
          : "Moderate";
    const sourceBit =
      sourceCount <= 1
        ? "reporting rests on a single outlet"
        : sourceCount >= 4
          ? "multiple outlets report the picture"
          : "a few outlets report the picture";
    const locBit =
      locShare >= 0.6
        ? "most incidents carry a specific location"
        : locShare >= 0.34
          ? "some incidents lack a specific location"
          : "many incidents lack a specific location";
    reportingConfidence = { level, rationale: `${capitaliseFirst(sourceBit)}, and ${locBit}.` };
  }

  return {
    periodLabel,
    bluf,
    executiveSummary,
    whatChanged,
    topThree,
    buckets,
    otherNational,
    otherNationalHadFeatured,
    otherBucketLabel: config.otherBucketLabel,
    emptyLocationFallback: config.emptyLocationFallback,
    featuredAboveNote: PNG_FEATURED_ABOVE_NOTE,
    businessImpactEmptyNote: config.businessImpactEmptyNote,
    businessImpact,
    locationWatchlist,
    outlook,
    polestarView,
    reportingConfidence,
    windowItems,
  };
}

export function buildPngReportDataset(args: BuildArgs): PngReportDataset {
  return buildStructuredReportDataset(args, PNG_REPORT_CONFIG);
}

export function buildWestPapuaReportDataset(args: BuildArgs): PngReportDataset {
  return buildStructuredReportDataset(args, WEST_PAPUA_REPORT_CONFIG);
}

export function buildIndonesiaReportDataset(args: BuildArgs): PngReportDataset {
  return buildStructuredReportDataset(args, INDONESIA_REPORT_CONFIG);
}

export function buildJakartaReportDataset(args: BuildArgs): PngReportDataset {
  return buildStructuredReportDataset(args, JAKARTA_REPORT_CONFIG);
}
