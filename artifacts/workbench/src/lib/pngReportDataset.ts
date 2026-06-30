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
import { clusterSameStoryRows, incidentTypeKey, type SameStoryRow } from "./countrySameStory";
import { stripWireCruft } from "./incidentTitle";
import { summariseFireCauses, classifyFireCause } from "./countryFireCause";
import { summariseLocationConfidence } from "./countryLocationConfidence";
import { scoreClusterValue } from "./countryTopValue";
import { buildJakartaBrief, jakartaThemeForCategory, type JakartaTheme, type JakartaTacticalBrief } from "./jakartaBrief";
import { buildJakartaCorridorStatuses } from "./jakartaCorridors";
import type { CountryFastFactsIncident } from "./countryFastFacts";

export type { PngCategory } from "@workspace/ingest/pngExtract";
import type { PngCategory } from "@workspace/ingest/pngExtract";
import {
  operatingRiskDisplayCategory,
  operatingRiskCategoryPhrase,
  operatingRiskAction,
  buildOperatingRiskBluf,
  buildOperatingRiskExecutiveSummary,
  buildOperatingRiskPriorities,
} from "./operatingRiskProse";
import {
  COUNTRY_INCIDENT_THEMES,
  themeForCategory,
  type CountryIncidentTheme,
} from "./countryIncidentThemes";
import {
  buildPolestarView,
  type PolestarDirection,
  type PolestarViewParts,
} from "./countryPolestarView";
import {
  buildCustomerRelevance,
  driverPhrasesForThemes,
  exposureLabelsForThemes,
  scenarioForThemes,
} from "./countryCustomerRelevance";

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
  // Prose variant. When "operating-risk", the BLUF, Executive Summary,
  // Priorities This Week and Polestar View are built by operatingRiskProse, and
  // per-item categories are display-mapped to the eleven business labels. Unset
  // → the default PNG / West Papua prose path (byte-identical).
  proseVariant?: "operating-risk";
  // Jakarta-only switch. When true, buildStructuredReportDataset replaces the
  // generic operating-risk sections with the Jakarta analyst-brief builders
  // (jakartaBrief.ts) after the operating-risk + polestar blocks. Set ONLY on
  // JAKARTA_REPORT_CONFIG, so every other theatre is byte-identical.
  jakartaProse?: boolean;
  // Heading for the priority-incidents section. Falls back in the renderer to
  // the default "Top 3 Incidents This Week" when unset.
  topIncidentsHeading?: string;
  // Optional Customer Relevance audience. Names who the brief is most relevant
  // to ("Most relevant to <audience>."); the period's main issues are derived
  // from the incident mix, not from this field. Unset → a generic audience.
  audienceProfile?: { audience: string };
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
  audienceProfile: {
    audience:
      "field operations, project sites, secure movement, aviation-dependent travel, remote logistics and staff based near affected districts",
  },
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
  audienceProfile: {
    audience:
      "field operations, project sites, secure movement, aviation-dependent travel, remote logistics and staff based near affected districts",
  },
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
  audienceProfile: {
    audience:
      "multi-site operators, logistics teams, manufacturing sites, field travel, warehousing, cash movement and staff movement between cities",
  },
  deriveProvince: deriveIndonesiaProvince,
  extractItem: extractIndonesiaItem,
  proseVariant: "operating-risk",
  topIncidentsHeading: "Priority Incidents This Week",
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
  audienceProfile: {
    audience:
      "office operations, staff commuting, hotel-based visitors, drivers, facilities teams and business continuity leads",
  },
  deriveProvince: deriveJakartaArea,
  extractItem: extractJakartaItem,
  proseVariant: "operating-risk",
  jakartaProse: true,
  topIncidentsHeading: "Priority Incidents This Week",
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface PngReportItem {
  id: string;
  title: string;
  // Jakarta-only: an analyst-rewritten Top-3 development title (theme + area
  // lead) that replaces the raw headline on the card. Set behind
  // config.jakartaProse; unset for every other theatre, so ItemCard falls back
  // to `title` and PNG / West Papua / Indonesia rendering is unchanged.
  developmentTitle?: string;
  // The incident's own reported summary text. Carried through so the AI
  // per-incident analyst summary can be grounded on title + summary, and used as
  // the fingerprint/grounding input for the prose engine.
  summary: string;
  province: string | null;
  // Raw free-form source location text, carried ALONGSIDE the resolved province
  // bucket so location-confidence scoring (§16 / map plotting) reads the same
  // sub-city precision signal the map uses, not the coarse province label (a
  // province centroid must never be mistaken for a precise, plottable point).
  location: string | null;
  category: PngCategory;
  // Client-facing category label. For the operating-risk theatres (Indonesia /
  // Jakarta) this is the display-mapped business label; for every other theatre
  // it equals `category` (so PNG / West Papua rendering is unchanged).
  displayCategory: string;
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
  // True when this location had MORE incidents this period than the few shown
  // here — the section is capped to the most serious so it reads as a brief, not
  // an exhaustive incident list. The renderer then shows a count-free "more
  // reporting" note. Aggregate prose/watchlist still draw on the full set.
  truncated: boolean;
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

// One grouped Recommended Actions block (Movement security, Site security, …).
// Only groups SUPPORTED by this period's incident mix / watchlist are emitted,
// so the section never pads with irrelevant advice.
export interface RecommendedActionGroup {
  key: string;
  heading: string;
  actions: string[];
}

// Assessed confidence in this period's open-source picture. Level drives a chip
// colour in the renderer; rationale explains the call qualitatively (source
// breadth + location detail), never with raw counts.
export interface ReportingConfidence {
  level: "High" | "Moderate" | "Low";
  rationale: string;
}

// One themed "Key Development" group: the period's incidents grouped by their
// client-facing display category (e.g. "Protest / civil unrest"). Carries the
// tile/severity cards for that theme and a deterministic business-impact line.
export interface KeyDevelopmentGroup {
  key: string;
  heading: string;
  items: PngReportItem[];
  businessImpact: string;
}

export interface PngReportDataset {
  periodLabel: string;
  // Bottom Line Up Front — a single short paragraph at the very top giving the
  // week's trajectory, the lead concern and the principal business risk.
  bluf: string;
  executiveSummary: string;
  // "What Matters This Week" framing bullets — the dominant risk themes this
  // period as short, count-free lines. Empty-window → a single standing caveat.
  whatMattersBullets: string[];
  // Themed developments (incidents grouped by display category, severity-ranked),
  // each closing with a business-impact line. Drives the operating-risk layout.
  keyDevelopments: KeyDevelopmentGroup[];
  // "Escalation indicators" for the Outlook: what would raise concern in the
  // coming week. Deterministic, derived from the period's categories/severity.
  escalationIndicators: string[];
  // Week-on-week delta (volume / severity / focus / type / quiet areas),
  // described qualitatively against the previous 7-day window.
  whatChanged: string;
  topThree: PngReportItem[];
  buckets: StructuredLocationBucket[];
  otherNational: PngReportItem[];
  // True when the "Other" catch-all had incident(s) this period but all were
  // promoted into Top 3 above (see StructuredLocationBucket.hadFeatured).
  otherNationalHadFeatured: boolean;
  // True when the "Other" catch-all had more incidents than the few shown (capped
  // like the location buckets). Drives the same count-free "more reporting" note.
  otherNationalTruncated: boolean;
  otherBucketLabel: string;
  emptyLocationFallback: string;
  featuredAboveNote: string;
  // "Priorities This Week": the few most serious real events this period as
  // readable, severity-ranked lines (what happened, where, what to do). The field
  // name is retained for compatibility; content is built by watchLine().
  businessImpactEmptyNote: string;
  businessImpact: string[];
  // Locations to watch, ranked by this-period volume / severity / repeat
  // reporting, backstopped by the curated baseline watchlist.
  locationWatchlist: LocationWatchlistEntry[];
  outlook: string;
  // Optional heading override for the priority-incidents section (operating-risk
  // theatres set "Priority Incidents This Week"; unset → renderer default).
  topIncidentsHeading?: string;
  // Prose variant, mirrored from the config so the renderer can gate display
  // behaviour (e.g. suppressing the "Location not specified" label). Unset for
  // PNG / West Papua.
  proseVariant?: "operating-risk";
  // Polestar's assessed judgement: what the pattern means, the practical
  // adjustment for the week, and what would raise concern. Rendered as one
  // flowing paragraph composed from the seven structured parts below.
  polestarView: string;
  // The seven Polestar View components (direction / driver / exposed geography /
  // exposed activity / likely next disruption / what would change / practical
  // judgement). Optional/default-safe — the renderer prints `polestarView`.
  polestarViewParts?: PolestarViewParts;
  // Customer Relevance prose: who the brief matters to plus the period's main
  // issues, derived from the incident mix. Optional/default-safe — the renderer
  // shows the section only when present.
  customerRelevance?: string;
  reportingConfidence: ReportingConfidence;
  windowItems: PngReportItem[];
  // Incidents to analyse in "Incident Details" — every windowItem NOT promoted
  // into the Top 3 story clusters above.
  incidentDetailsItems: PngReportItem[];
  // Grouped recommended actions (Movement security, Site security, …), built
  // from this period's incident mix and the location watchlist.
  recommendedActions: RecommendedActionGroup[];
  // Jakarta-only overrides (set behind config.jakartaProse). When present the
  // renderer prefers these over the generic Incident-Details theme groups and
  // Operational-Impact bullets; unset for every other theatre, leaving their
  // rendering byte-identical.
  incidentThemesOverride?: { key: string; heading: string; paragraph: string }[];
  operationalImpactOverride?: string[];
  // Jakarta-only layout hint: render the closing Polestar View keep-together so
  // the complete assessment paragraph never splits across a page boundary
  // (spec §5). Unset for every other theatre — no markup change.
  keepPolestarTogether?: boolean;
  // Jakarta-only tactical operating brief (Movement & Access Impact, Business
  // District / Port exposure tables, Airport-Hotel-Office, Route & Timing, and
  // the map area summary). Consumed ONLY by JakartaReportBody; unset for every
  // other theatre, leaving their rendering byte-identical.
  jakartaTacticalBrief?: JakartaTacticalBrief;
}

export interface BuildArgs {
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
  const title = stripWireCruft(
    i.displayTitle && i.displayTitle.trim() ? i.displayTitle.trim() : cleanTitle(i.title, i.source),
  );
  return {
    id: String(i.id ?? `${i.title}-${i.occurredAt}`),
    title,
    summary: (i.summary ?? "").trim(),
    province,
    location: (i.location ?? "").trim() || null,
    category,
    displayCategory:
      config.proseVariant === "operating-risk" ? operatingRiskDisplayCategory(category) : category,
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

// Jakarta-only Top-3 selection (gated by config.jakartaProse; the generic path
// just takes the three highest analyst-value clusters). The input clusters are
// already value-sorted. On top of that value ordering we (a) enforce Jakarta-
// theme diversity so two same-theme developments — most visibly two separate
// fires — never both lead unless the window is too quiet to fill three distinct
// themes, and (b) apply an all-Low guard so the Top 3 never defaults to three
// Low items when a credible Moderate-or-worse development exists. Pure; returns
// the existing cluster arrays (never mutates members).
function selectJakartaTopClusters(clusters: PngReportItem[][]): PngReportItem[][] {
  if (clusters.length <= 1) return clusters.slice(0, 3);
  // (a) Greedy theme-diverse pick over the value-sorted clusters.
  const picked: PngReportItem[][] = [];
  const usedThemes = new Set<JakartaTheme>();
  for (const c of clusters) {
    if (picked.length >= 3) break;
    const theme = jakartaThemeForCategory(c[0].category);
    if (usedThemes.has(theme)) continue;
    usedThemes.add(theme);
    picked.push(c);
  }
  // Fill any remaining slots (window too quiet for three distinct themes) with
  // the next best clusters regardless of theme.
  if (picked.length < 3) {
    for (const c of clusters) {
      if (picked.length >= 3) break;
      if (!picked.includes(c)) picked.push(c);
    }
  }
  // (b) All-Low guard: if every chosen development is Low-or-below but a
  // Moderate-or-worse cluster exists, swap the weakest chosen Low for the most
  // serious available candidate (preferring a swap that keeps theme diversity).
  const isLowOrBelow = (c: PngReportItem[]) => c[0].severityRank <= 2;
  if (picked.length > 0 && picked.every(isLowOrBelow)) {
    const candidate = clusters
      .filter((c) => !picked.includes(c) && c[0].severityRank >= 3)
      .sort((a, b) => {
        if (b[0].severityRank !== a[0].severityRank) return b[0].severityRank - a[0].severityRank;
        return scoreClusterValue(b) - scoreClusterValue(a);
      })[0];
    if (candidate) {
      const candTheme = jakartaThemeForCategory(candidate[0].category);
      // Prefer replacing a same-theme pick (keeps diversity); otherwise replace
      // the lowest-value Low, which is last in the value-sorted picks.
      let replaceIdx = picked.length - 1;
      for (let i = picked.length - 1; i >= 0; i--) {
        if (jakartaThemeForCategory(picked[i]![0].category) === candTheme) {
          replaceIdx = i;
          break;
        }
      }
      picked[replaceIdx] = candidate;
    }
  }
  // Display strongest analyst value first (severity-then-recency breaks ties),
  // matching the generic path's ordering intent.
  return picked.sort((a, b) => {
    const v = scoreClusterValue(b) - scoreClusterValue(a);
    if (v !== 0) return v;
    return sortBySeverityThenRecency(a[0], b[0]);
  });
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

// --- Same-story clustering (Top 3 de-duplication) --------------------------
// Delegated to the shared, tested same-story authority (`countrySameStory.ts`)
// so the report builder and the page-level chart/map/Fast-Facts feed consolidate
// IDENTICALLY. It merges syndicated re-runs AND the same NAMED-PREMISES event
// reported across a few days (e.g. a factory fire reported by several outlets on
// different days), while staying conservative enough that two genuinely distinct
// incidents are never collapsed. Items are processed worst-severity-then-newest
// first, so each returned cluster's first member is its representative.
function clusterSameStory(items: PngReportItem[]): PngReportItem[][] {
  const rows: SameStoryRow[] = items.map((it) => ({
    title: it.title,
    province: it.province ?? null,
    typeKey: incidentTypeKey(it.title, it.category),
    dateMs: (it.incidentDate ?? it.reportedDate).getTime(),
    severityRank: it.severityRank,
    category: it.category,
    displayCategory: it.displayCategory,
  }));
  return clusterSameStoryRows(rows).map((cluster) => cluster.map((i) => items[i]));
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
// recommended action. Returns a standing-precautions default so a row is never
// left without an action. Used by recommendedAction (Location Watchlist / Polestar
// View) and watchLine (Priorities This Week).
function baseAction(catLower: string): string {
  if (/(polic|arrest|detention|corrections|custody|operation|patrol)/.test(catLower))
    return "Expect security-force activity; confirm road and checkpoint status before movement.";
  if (/(protest|unrest|demonstration|riot|strike|blockad|march)/.test(catLower))
    return "Avoid gatherings and choke points; build in extra transit time and keep routes flexible.";
  if (/(tribal|communal|clash|violen|attack|arson|insurg|militant|armed|gun|shoot|ambush|kidnap)/.test(catLower))
    return "Avoid affected areas; review journey plans and confirm secure routing and site security before any essential movement.";
  if (/(robbery|hold-up|holdup|carjack|theft|break-in|burglar|crime|assault|hijack)/.test(catLower))
    return "Harden movement and premises security; vary routines and avoid predictable timings.";
  return "Maintain standard movement and continuity precautions; monitor for operational follow-on.";
}

// Severity-aware wrapper: a high/extreme worst-case prefixes a priority cue.
function recommendedAction(catLower: string, worstRank: number): string {
  const base = baseAction(catLower);
  return worstRank >= 4 ? `Treat as priority. ${base}` : base;
}

// One readable "Priorities This Week" line for a single incident: severity label,
// the real event headline, where it happened, and the category-appropriate action.
// Drawn entirely from the incident — no fabrication, no counts.
function watchLine(it: PngReportItem): string {
  const headline =
    it.title.trim().replace(/\s+/g, " ").replace(/[.;,]+$/, "") || "Security-relevant incident reported";
  const prov = it.province?.trim();
  const loc = prov && !headline.toLowerCase().includes(prov.toLowerCase()) ? ` (${prov})` : "";
  const label = it.severityLabel?.trim();
  const lead = label ? `${label}: ` : "";
  const head = `${headline}${loc}`;
  // Factual priority line only — the response actions now live in the grouped
  // Recommended Actions section, so they are no longer repeated per incident.
  const sep = /[?!]$/.test(head) ? "" : ".";
  return `${lead}${head}${sep}`;
}

// A short "why it matters" line for a watchlist location, from its dominant
// category this period and whether the worst entry was high-severity. Counts are
// deliberately omitted (user preference) — direction and severity LABELS only.
function whyForLocation(dominantCatLower: string | null, worstRank: number, fresh: boolean): string {
  if (!fresh)
    return "Standing watch location; no fresh open-source reporting this period, so standing risks remain relevant.";
  const sev =
    worstRank >= 5 ? "extreme-severity " : worstRank >= 4 ? "high-severity " : "";
  const cat = dominantCatLower ? categoryPhrase(dominantCatLower) : "security-relevant activity";
  return `Fresh ${sev}reporting of ${cat} this period.`;
}

// Build the grouped Recommended Actions from this period's incident mix and the
// location watchlist. Deterministic, count-free, British English. Only groups
// with at least one applicable action are returned; an empty window yields none.
function buildRecommendedActions(
  windowItems: PngReportItem[],
  locationWatchlist: LocationWatchlistEntry[],
  worstRank: number,
): RecommendedActionGroup[] {
  if (windowItems.length === 0) return [];
  const cats = windowItems.map((it) => it.category.toLowerCase());
  const has = (re: RegExp) => cats.some((c) => re.test(c));
  const protest = has(/(protest|unrest|demonstration|riot|strike|blockad|march|labour)/);
  const armed = has(
    /(tribal|communal|clash|violen|attack|arson|insurg|militant|armed|gun|shoot|ambush|kidnap|terror|homicide)/,
  );
  const crime = has(/(robbery|hold-up|holdup|carjack|theft|break-in|burglar|crime|assault|hijack)/);
  const natural = has(/(natural|hazard|flood|quake|earthquake|landslide|storm|cyclone|volcan|haze|environment)/);
  const fire = has(/(fire|explos)/);
  const transport = has(/(aviation|airport|maritime|port|road|highway|power|utilit|telecom|connectivity)/);
  const hasWatch = locationWatchlist.length > 0;
  const groups: RecommendedActionGroup[] = [];

  const movement: string[] = [];
  if (protest || armed || crime || hasWatch)
    movement.push(
      "Vary routes and timings, avoid predictable patterns, and confirm route status before travel.",
    );
  if (protest)
    movement.push("Route around gatherings, rallies and choke points, and build in extra transit time.");
  if (armed)
    movement.push(
      "Treat areas with confirmed violence as no-go for non-essential travel; use secure transport for any essential movement.",
    );
  if (movement.length) groups.push({ key: "movement", heading: "Movement security", actions: movement });

  const site: string[] = [];
  if (armed || crime || protest)
    site.push("Maintain premises protection: access control, guarding and after-hours security at exposed sites.");
  if (fire) {
    // Cause-aware fire advice. A deliberate (arson / attack / unrest) fire only
    // registers here when the source STATED it, so the security line never
    // appears on an accidental or unexplained blaze.
    const fs = summariseFireCauses(windowItems);
    if (fs.security > 0)
      site.push(
        "Treat fires reported as deliberate or attack-related as a security matter: review site protection and access control around affected premises.",
      );
    site.push(
      "Confirm site fire status, fire-safety provision and evacuation readiness before approach.",
    );
  }
  if (site.length) groups.push({ key: "site", heading: "Site security", actions: site });

  const staff: string[] = [];
  if (crime || protest || armed)
    staff.push("Brief staff and travellers on current risks, local reporting lines and areas to avoid.");
  if (crime) staff.push("Remind staff to keep a low profile with cash, devices and valuables in public.");
  if (staff.length) groups.push({ key: "staff", heading: "Staff awareness", actions: staff });

  const journey: string[] = [];
  if (transport || protest || natural)
    journey.push("Confirm road, air and port status before travel and hold viable alternates.");
  if (natural) journey.push("Check weather and hazard conditions before movement and allow for delays.");
  if (journey.length) groups.push({ key: "journey", heading: "Journey planning", actions: journey });

  groups.push({
    key: "escalation",
    heading: "Escalation triggers",
    actions: [
      worstRank >= 4
        ? "Activate contingency and movement-restriction plans if higher-severity or casualty-bearing incidents reach or near operating sites."
        : "Be ready to tighten precautions if incidents rise in severity or spread to new districts.",
    ],
  });

  groups.push({
    key: "monitoring",
    heading: "Local monitoring",
    actions: [
      hasWatch
        ? "Track local reporting and official advisories for the locations on the watchlist, and reassess as fresh reporting comes through."
        : "Track local reporting and official advisories, and reassess as fresh reporting comes through.",
    ],
  });

  return groups;
}

// Generic config-driven builder. The PNG and West Papua entry points below are
// thin wrappers that pass their theatre config.
export function buildStructuredReportDataset(
  args: BuildArgs,
  config: StructuredTheatreConfig,
): PngReportDataset {
  const { windowIncidents, previousWindowIncidents, baselineWatchlist, periodLabel } = args;
  // Raw (pre-dedup) window size — kept so Reporting Confidence can read how much
  // syndication the dedup pass collapsed (dedup strength, spec §16).
  const rawWindowCount = windowIncidents.length;
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

  // Headline highlights: the three most significant STORIES this period. Feeds
  // syndicate the same event under several near-identical headlines, so we first
  // cluster same-story items (title overlap + same place + same/adjacent date +
  // compatible category) and take the worst-severity, newest representative of
  // each of the top three clusters. EVERY member of those clusters is then
  // EXCLUDED from the location buckets and Incident Details below, so a
  // syndicated re-run of a Top 3 story never reappears lower down. Aggregate
  // sections (Executive Summary, Outlook, diagnostics) still use full windowItems.
  const storyClusters = clusterSameStory(windowItems);
  // Rank by ANALYST VALUE (casualties, evacuation, a major fire, transport or
  // road disruption, a security deployment, protest disruption, regulatory
  // action with business impact, commercial proximity) rather than by the bare
  // worst severity rating, so the three developments shown are the ones a client
  // would actually act on. Severity-then-recency only breaks value ties.
  storyClusters.sort((a, b) => {
    const va = scoreClusterValue(a);
    const vb = scoreClusterValue(b);
    if (vb !== va) return vb - va;
    return sortBySeverityThenRecency(a[0], b[0]);
  });
  const topClusters = config.jakartaProse
    ? selectJakartaTopClusters(storyClusters)
    : storyClusters.slice(0, 3);
  let topThree = topClusters.map((c) => c[0]);
  const topThreeMemberIds = new Set(topClusters.flatMap((c) => c.map((it) => it.id)));
  const bucketableItems = windowItems.filter((it) => !topThreeMemberIds.has(it.id));
  // Incident Details analyses every remaining (non-Top-3) incident.
  const incidentDetailsItems = bucketableItems;

  // Cap the per-location incident cards: each location section (and the "Other"
  // catch-all) shows only the most serious few, sorted severity-then-recency, so
  // the brief never reads as an exhaustive incident list. Aggregate sections
  // (Executive Summary, Watchlist, Priorities, Outlook) still use all windowItems.
  const MAX_LOCATION_ITEMS = 3;
  // Police-activity and crime-trend strands are secondary CONTEXT in the
  // augmented (district) sections, so they get a tighter cap than the primary
  // confirmed-incidents list to keep those sections brief too.
  const MAX_SECONDARY_STRAND_ITEMS = 2;

  // Location buckets from the theatre config; each bucket owns one or more
  // provinces (no overlap). "Other" captures everything not in any bucket.
  const bucketProvinces = new Set<string>();
  for (const b of config.buckets) for (const p of b.provinces) bucketProvinces.add(p);
  const buckets: StructuredLocationBucket[] = config.buckets.map((b) => {
    const provSet = new Set(b.provinces);
    const inBucket = (it: PngReportItem) => it.province != null && provSet.has(it.province);
    const sorted = bucketableItems.filter(inBucket).sort(sortBySeverityThenRecency);
    const augmentation = config.locationAugmentations?.[b.key];
    let strands: StructuredLocationBucket["strands"];
    let truncated: boolean;
    if (augmentation) {
      const grouped = {
        confirmed: [] as PngReportItem[],
        police: [] as PngReportItem[],
        trend: [] as PngReportItem[],
      };
      for (const it of sorted) grouped[strandForItem(it)].push(it);
      // Cap EACH strand independently (deliberately NOT an overall cap then
      // re-grouped): a strand is shown empty ONLY when it genuinely had zero
      // items, so the "no police activity reported" / "no crime-trend signals"
      // notes can never become false (no-fabrication). Confirmed incidents are
      // the primary list; police/arrests and crime-trend signals are secondary
      // context with a tighter cap, so the section stays brief, not exhaustive.
      strands = {
        confirmed: grouped.confirmed.slice(0, MAX_LOCATION_ITEMS),
        police: grouped.police.slice(0, MAX_SECONDARY_STRAND_ITEMS),
        trend: grouped.trend.slice(0, MAX_SECONDARY_STRAND_ITEMS),
      };
      truncated =
        grouped.confirmed.length > strands.confirmed.length ||
        grouped.police.length > strands.police.length ||
        grouped.trend.length > strands.trend.length;
    } else {
      truncated = sorted.length > MAX_LOCATION_ITEMS;
    }
    return {
      key: b.key,
      label: b.label,
      // Capped to the most serious few so the section reads as a brief, not a
      // full incident list (aggregate sections still use the full windowItems).
      items: sorted.slice(0, MAX_LOCATION_ITEMS),
      hadFeatured: windowItems.some((it) => topThreeMemberIds.has(it.id) && inBucket(it)),
      truncated,
      augmentation,
      strands,
    };
  });
  const inOther = (it: PngReportItem) => !it.province || !bucketProvinces.has(it.province);
  const otherSorted = bucketableItems.filter(inOther).sort(sortBySeverityThenRecency);
  const otherNational = otherSorted.slice(0, MAX_LOCATION_ITEMS);
  const otherNationalTruncated = otherSorted.length > MAX_LOCATION_ITEMS;
  const otherNationalHadFeatured = windowItems.some(
    (it) => topThreeMemberIds.has(it.id) && inOther(it),
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
    const p1 = `The security picture in ${config.countryName} this period was dominated by ${catText}.${provText}${sevText}`;
    const p2 = `The picture is operational rather than a single dramatic event: the priority for business users is movement security, premises protection and continuity at exposed sites while this picture holds.`;
    executiveSummary = `${p1}\n\n${p2}`;
  }

  // --- Business impact (de-duplicated impact lines for the categories present)-
  // Priorities This Week: the few most serious real events this period, ranked by
  // severity then recency, each as a readable line (what happened, where, what to
  // do). Quiet periods fall back to the standing-exposures empty note.
  const seenWatch = new Set<string>();
  let businessImpact: string[] = [];
  for (const it of [...windowItems].sort(sortBySeverityThenRecency)) {
    const line = watchLine(it);
    const key = line.toLowerCase();
    if (seenWatch.has(key)) continue;
    seenWatch.add(key);
    businessImpact.push(line);
    if (businessImpact.length >= 4) break;
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
    const deEscalation = `Concern would ease with a sustained quiet stretch across ${keyLocs}, no further high-severity or casualty-bearing incidents, and no spread to new districts.`;
    const worseImpact =
      curWorstRank >= 4
        ? "Were the picture to deteriorate, expect direct disruption to movement and site access at the affected locations, with knock-on delays to staff travel and logistics."
        : "Were the picture to deteriorate, expect localised disruption to movement and access, with possible delays to staff travel and logistics.";
    outlook = `${mostLikely} ${locLine}\n\n${escLine}\n\n${deEscalation} ${worseImpact}`;
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
    bluf = `No fresh open-source reporting emerged for ${config.countryName} this period, so the picture is best read as a gap in coverage rather than a genuine improvement; standing exposures are unchanged. Risk stays concentrated where it has historically sat, and the trajectory is steady rather than easing. For business users this means existing movement and continuity precautions remain appropriate, with a fresh review warranted as soon as reporting resumes.`;
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
    bluf = `The operating picture for ${config.countryName} this period ${trendWord}: the bulk of reporting concerns ${leadCatPhrase}${leadProvClause}. For business users, ${bizRisk}.`;
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
            ? `Most reporting clustered in ${topProvs[0]}.`
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

  // --- Recommended Actions (grouped) -----------------------------------------
  const recommendedActions = buildRecommendedActions(windowItems, locationWatchlist, curWorstRank);

  // --- Polestar View + Customer Relevance ------------------------------------
  // Both are computed AFTER the operating-risk variant block below (which can
  // refine the lead categories/locations), from one shared source of truth so
  // the standard and operating-risk paths stay consistent. Declared here.
  let polestarView = "";
  let polestarViewParts: PolestarViewParts | undefined;
  let customerRelevance: string | undefined;
  // Jakarta-only section overrides (assigned in the Jakarta block below; left
  // undefined for every other theatre so the renderer uses its generic path).
  let incidentThemesOverride: { key: string; heading: string; paragraph: string }[] | undefined;
  let operationalImpactOverride: string[] | undefined;
  let jakartaEscalationIndicators: string[] | undefined;
  let jakartaTacticalBrief: JakartaTacticalBrief | undefined;
  let keepPolestarTogether = false;

  // --- Operating-risk prose variant (Indonesia / Jakarta only) ---------------
  // Override the BLUF, Executive Summary, Priorities This Week and Polestar View
  // with the business-language operating-risk builders. Scoped behind the config
  // flag, so the PNG / West Papua path above is left byte-identical. Categories
  // use the display-mapped labels (it.displayCategory) here.
  if (config.proseVariant === "operating-risk") {
    const empty = windowItems.length === 0;
    const leadDisplayCats = topLabels(windowItems, (it) => it.displayCategory, 3);
    // Lead locations as friendly bucket labels, deduplicated (two provinces can
    // share one bucket label, e.g. Kalimantan).
    const seenLoc = new Set<string>();
    const leadLocations: string[] = [];
    for (const p of topProvs) {
      const lbl = provinceLabel.get(p) ?? p;
      const k = lbl.toLowerCase();
      if (seenLoc.has(k)) continue;
      seenLoc.add(k);
      leadLocations.push(lbl);
      if (leadLocations.length >= 4) break;
    }
    const orInput = {
      countryName: config.countryName,
      empty,
      trajectory,
      leadDisplayCats,
      leadLocations,
      worstRank: curWorstRank,
    };
    bluf = buildOperatingRiskBluf(orInput);
    executiveSummary = buildOperatingRiskExecutiveSummary(orInput);
    if (!empty) {
      const groups = scoredProvinces.map(({ prov, s, score }) => ({
        location: provinceLabel.get(prov) ?? prov,
        dominantDisplayCat: operatingRiskDisplayCategory(s.cat ?? ""),
        score,
      }));
      const nationalItems = windowItems.filter((it) => !it.province);
      if (nationalItems.length) {
        const domRaw = topLabels(nationalItems, (it) => it.category, 1)[0] ?? "";
        const worst = nationalItems.reduce((m, it) => Math.max(m, it.severityRank), 0);
        groups.push({
          location: "Nationally",
          dominantDisplayCat: operatingRiskDisplayCategory(domRaw),
          score: nationalItems.length + (worst >= 4 ? 3 : worst >= 3 ? 1 : 0),
        });
      }
      groups.sort((a, b) => b.score - a.score);
      const orPriorities = buildOperatingRiskPriorities(groups);
      if (orPriorities.length) businessImpact = orPriorities;
    }
  }

  // --- Polestar View (7-part judgement) + Customer Relevance -----------------
  // Built from the deduped incident mix for EVERY variant, so the standard and
  // operating-risk paths share one source of truth. Present incident themes
  // (most prominent first) drive the drivers, exposed activities and the most-
  // likely-disruption scenario; the theatre config supplies the audience.
  {
    const empty = windowItems.length === 0;
    const themeCounts = new Map<CountryIncidentTheme, number>();
    for (const it of windowItems) {
      const k = themeForCategory(it.category);
      themeCounts.set(k, (themeCounts.get(k) ?? 0) + 1);
    }
    const presentThemeKeys = COUNTRY_INCIDENT_THEMES.map((d) => d.key)
      .filter((k) => (themeCounts.get(k) ?? 0) > 0)
      .sort((a, b) => (themeCounts.get(b) ?? 0) - (themeCounts.get(a) ?? 0));

    // Lead locations as friendly bucket labels (raw province fallback for
    // generic countries with no buckets), deduplicated, capped to three.
    const seenPL = new Set<string>();
    const polestarLocations: string[] = [];
    for (const p of topProvs) {
      const lbl = provinceLabel.get(p) ?? p;
      const k = lbl.toLowerCase();
      if (seenPL.has(k)) continue;
      seenPL.add(k);
      polestarLocations.push(lbl);
      if (polestarLocations.length >= 3) break;
    }

    const direction: PolestarDirection =
      trajectory === "worsening"
        ? "deteriorating"
        : trajectory === "easing"
          ? "easing"
          : curWorstRank >= 4
            ? "elevated"
            : "stable";

    const action =
      curWorstRank >= 4
        ? "tighten movement planning and site protection at the exposed locations and keep contingency arrangements under active review"
        : "keep standard movement and continuity precautions in place and vary routines around the exposed locations";
    const trigger = `larger-scale incidents, casualty-bearing violence or sustained disruption emerge around ${config.outlookVolatilityClause}`;

    const parts = buildPolestarView({
      countryName: config.countryName,
      empty,
      direction,
      drivers: driverPhrasesForThemes(presentThemeKeys),
      exposedAreas: polestarLocations,
      exposedActivities: exposureLabelsForThemes(presentThemeKeys),
      likelyDisruption: scenarioForThemes(presentThemeKeys),
      trigger,
      action,
    });
    polestarView = parts.paragraph;
    polestarViewParts = parts;

    const audience =
      config.audienceProfile?.audience ??
      `organisations with staff, sites, travel and supply exposure in ${config.countryName}`;
    customerRelevance = buildCustomerRelevance({ audience, presentThemeKeys, empty });
  }

  // --- Jakarta analyst-brief overrides ---------------------------------------
  // Replace the generic operating-risk sections with Jakarta-specific,
  // operationally-framed prose. Gated behind config.jakartaProse (set ONLY on
  // JAKARTA_REPORT_CONFIG) so Indonesia / PNG / West Papua are untouched. Pure,
  // deterministic, count-free, present-theme-gated (no fabrication). Runs AFTER
  // the operating-risk + polestar blocks so it has the final say on the sections
  // it owns; polestarViewParts is kept consistent with the overridden paragraph.
  if (config.jakartaProse) {
    // Per-area corridor statuses for the live-aware tactical sections. Derived
    // from the SAME window incidents the rest of the brief reads; the derivation
    // is count-free (only the SET of elevated areas and their hazards matters),
    // so it agrees with the deduped corridor map regardless of syndication.
    const corridorIncidents: CountryFastFactsIncident[] = windowIncidents.map((i) => ({
      topic: "jakarta",
      title: i.title,
      displayTitle: i.displayTitle ?? null,
      severity: i.severity,
      occurredAt: i.occurredAt,
      location: i.location ?? null,
    }));
    const { statuses } = buildJakartaCorridorStatuses(corridorIncidents);
    const jakarta = buildJakartaBrief({
      windowItems,
      incidentDetailsItems,
      topThree,
      corridorStatuses: statuses,
    });
    bluf = jakarta.bluf;
    executiveSummary = jakarta.executiveSummary;
    outlook = jakarta.outlook;
    businessImpact = jakarta.recommendedActions;
    polestarView = jakarta.polestarView;
    polestarViewParts = jakarta.polestarViewParts;
    operationalImpactOverride = jakarta.operationalImpact;
    jakartaEscalationIndicators = jakarta.escalationIndicators;
    incidentThemesOverride = jakarta.incidentThemes;
    topThree = jakarta.topThree;
    jakartaTacticalBrief = jakarta.tactical;
    keepPolestarTogether = true;
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

    // §16 inputs beyond outlet/location share:
    //  - location PRECISION: how many incidents we can actually plot vs. only
    //    place-count. Vague map points must block a High rating (no false
    //    precision from a city/province centroid).
    const locPrecision = summariseLocationConfidence(
      windowItems.map((it) => ({ title: it.title, location: it.location })),
    );
    const plottableShare = locPrecision.total ? locPrecision.plottable / locPrecision.total : 0;
    //  - CAUSE clarity: a major (High/Extreme) fire or explosion whose cause the
    //    source has not stated keeps the headline picture uncertain → never High.
    const majorCauseGap = windowItems.some((it) => {
      if (it.severityRank < 4) return false;
      const fc = classifyFireCause({ title: it.title, summary: it.summary, category: it.category });
      return fc.isFire && !fc.causeStated;
    });
    //  - DEDUP strength: how much syndication the dedup pass collapsed. Heavy
    //    syndication corroborated by more than one outlet is a positive signal;
    //    it is reported in the rationale, never inflated into a count in prose.
    const distinctShare = rawWindowCount > 0 ? windowItems.length / rawWindowCount : 1;
    const heavilySyndicated = rawWindowCount > windowItems.length && distinctShare <= 0.6;

    const level: ReportingConfidence["level"] =
      sourceCount <= 1 || locShare < 0.34
        ? "Low"
        : sourceCount >= 4 &&
            locShare >= 0.6 &&
            plottableShare >= 0.5 &&
            windowItems.length >= 4 &&
            !majorCauseGap
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
    const precisionBit =
      plottableShare >= 0.5
        ? "most locations are precise enough to map"
        : "several locations are too broad to map precisely and are counted rather than plotted";
    const causeClause = majorCauseGap
      ? " A major incident's cause is not yet reported, which holds confidence below high."
      : "";
    const dedupClause =
      heavilySyndicated && sourceCount >= 2
        ? " The picture consolidates heavily syndicated reporting."
        : "";
    reportingConfidence = {
      level,
      rationale: `${capitaliseFirst(sourceBit)}, ${locBit}, and ${precisionBit}.${causeClause}${dedupClause}`,
    };
  }

  // --- Key Developments (themed groups) --------------------------------------
  // Group the period's incidents by their client-facing DISPLAY category so the
  // brief reads as themed developments rather than a flat list. Works for every
  // theatre: operatingRiskDisplayCategory maps the granular categories onto the
  // business labels (and passes unmapped labels through unchanged). Each theme
  // keeps the tile/severity cards and closes with a deterministic business line.
  const kdGroupMap = new Map<string, PngReportItem[]>();
  for (const it of windowItems) {
    const label = operatingRiskDisplayCategory(it.category);
    const arr = kdGroupMap.get(label) ?? [];
    arr.push(it);
    kdGroupMap.set(label, arr);
  }
  const kdScored = Array.from(kdGroupMap.entries()).map(([label, items]) => {
    const worst = items.reduce((m, it) => Math.max(m, it.severityRank), 0);
    return {
      label,
      items: [...items].sort(sortBySeverityThenRecency),
      worst,
      score: items.length + (worst >= 4 ? 4 : worst >= 3 ? 1 : 0),
    };
  });
  kdScored.sort((a, b) => b.score - a.score);
  const keyDevelopments: KeyDevelopmentGroup[] = kdScored.slice(0, 5).map((g) => ({
    key: g.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "other",
    heading: g.label,
    // Cap per theme so the section reads as a brief, not an exhaustive list.
    items: g.items.slice(0, 4),
    businessImpact: operatingRiskAction(g.label),
  }));

  // --- What Matters This Week (framing bullets) ------------------------------
  // One short, count-free line per dominant theme: the theme phrase, where it
  // clustered, and a qualitative severity flag. Empty window → standing caveat.
  const whatMattersBullets: string[] = [];
  if (windowItems.length === 0) {
    whatMattersBullets.push(
      "No fresh open-source reporting was identified this period; standing exposures continue to apply and the quiet stretch is read as a coverage signal, not an improvement.",
    );
  } else {
    for (const g of kdScored.slice(0, 4)) {
      const phrase = capitaliseFirst(operatingRiskCategoryPhrase(g.label));
      const locs = topLabels(
        g.items.filter((it) => it.province),
        (it) => provinceLabel.get(it.province as string) ?? (it.province as string),
        2,
      );
      const locBit = locs.length ? `, concentrated in ${joinList(locs)}` : "";
      const sevBit =
        g.worst >= 5
          ? ", including extreme-severity reporting"
          : g.worst >= 4
            ? ", including high-severity reporting"
            : "";
      whatMattersBullets.push(`${phrase}${locBit}${sevBit}.`);
    }
  }

  // --- Escalation indicators (Outlook) ---------------------------------------
  // What would raise concern in the coming week — deterministic, drawn from the
  // period's categories, worst severity and lead locations. No counts.
  const escalationIndicators: string[] = [];
  if (windowItems.length === 0) {
    escalationIndicators.push(
      "Any return of open-source reporting, particularly higher-severity or casualty-bearing incidents",
      `A confirmed cluster of incidents around ${config.outlookVolatilityClause}`,
    );
  } else {
    const escLeadLocs = topProvs.slice(0, 2).map((p) => provinceLabel.get(p) ?? p);
    const displayCatSet = new Set(
      windowItems.map((it) => operatingRiskDisplayCategory(it.category).toLowerCase()),
    );
    if (displayCatSet.has("protest / civil unrest") || displayCatSet.has("labour action"))
      escalationIndicators.push(
        "Larger or coordinated protest mobilisation, or labour action spreading to key sites and corridors",
      );
    escalationIndicators.push(
      curWorstRank >= 4
        ? "Further casualty-bearing or higher-severity violence at or near operating sites"
        : "Any move to casualty-bearing or higher-severity incidents",
    );
    escalationIndicators.push(
      escLeadLocs.length
        ? `Spread of incidents beyond ${joinList(escLeadLocs)} into new districts`
        : "A spread of incidents into new districts, or a single dominant centre emerging",
    );
    escalationIndicators.push(`Flashpoints around ${config.outlookVolatilityClause}`);
  }

  return {
    periodLabel,
    bluf,
    executiveSummary,
    whatMattersBullets,
    keyDevelopments,
    escalationIndicators: jakartaEscalationIndicators ?? escalationIndicators,
    jakartaTacticalBrief,
    whatChanged,
    topThree,
    buckets,
    otherNational,
    otherNationalHadFeatured,
    otherNationalTruncated,
    otherBucketLabel: config.otherBucketLabel,
    emptyLocationFallback: config.emptyLocationFallback,
    featuredAboveNote: PNG_FEATURED_ABOVE_NOTE,
    businessImpactEmptyNote: config.businessImpactEmptyNote,
    businessImpact,
    locationWatchlist,
    outlook,
    topIncidentsHeading: config.topIncidentsHeading,
    proseVariant: config.proseVariant,
    polestarView,
    polestarViewParts,
    customerRelevance,
    reportingConfidence,
    windowItems,
    incidentDetailsItems,
    recommendedActions,
    incidentThemesOverride,
    operationalImpactOverride,
    keepPolestarTogether,
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
