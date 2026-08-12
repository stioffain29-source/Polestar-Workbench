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
import { deriveThailandProvince, extractThailandItem } from "@workspace/ingest/thailandExtract";
import { derivePhilippinesProvince, extractPhilippinesItem } from "@workspace/ingest/philippinesExtract";
import {
  deriveJakartaArea,
  extractJakartaItem,
  isJakartaScoped,
} from "@workspace/ingest/jakartaExtract";
import {
  clusterSameStoryRows,
  incidentTypeKey,
  readableRepresentativeIndex,
  storySimilarity,
  type SameStoryRow,
  type StorySimInput,
} from "./countrySameStory";
import { subDays, format as formatDate } from "date-fns";
import { isLikelyNonEnglish, stripWireCruft } from "./incidentTitle";
import { buildUpcomingSignalRows, type UpcomingSignalRow } from "./upcomingSignals";
import { isNonKineticAssistanceItem, correctSeverity } from "./pngSeverityCorrection";
import { classifyFireCause } from "./countryFireCause";
import { applyTopThreeCuration } from "./countrySectionOverrides";
import { summariseLocationConfidence } from "./countryLocationConfidence";
import {
  compareIncidentValueClusters,
  scoreClusterValue,
} from "./countryTopValue";
import { compareIncidentSignificance } from "@workspace/country-engine";
import { buildJakartaBrief, jakartaThemeForCategory, type JakartaTheme, type JakartaTacticalBrief } from "./jakartaBrief";
import { buildJakartaCorridorStatuses } from "./jakartaCorridors";
import type { CountryFastFactsIncident } from "./countryFastFacts";

export type { PngCategory } from "@workspace/ingest/pngExtract";
import type { PngCategory } from "@workspace/ingest/pngExtract";
import {
  operatingRiskDisplayCategory,
  buildOperatingRiskPriorities,
} from "./operatingRiskProse";
import {
  buildCountryIncidentThemes,
} from "./countryIncidentThemes";
import { buildAssessedThemeGroups } from "./countryThemeSynthesis";
import {
  buildCountryNarrative,
  type CanonicalEvent,
  type CountryNarrative,
  type EngineResult,
} from "@workspace/country-engine";
import { getCountryEngineConfig } from "@workspace/country-engine/config";
import {
  runQualityGate,
  type MapPoint,
  type QualityGateResult,
  type QualityGateReport,
} from "@workspace/country-engine/gate";
import { runCountryEngine, toMapPoints } from "./countryEngineAdapter";

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
    // Source-anchored strip for a trailing " - <tail>" that is the publisher name
    // stored WITH a domain/suffix ("AsiaNews.it" source vs "AsiaNews" tail, or
    // "Xinhua Net" vs "Xinhua"): the tail's alphanumerics are wholly CONTAINED by
    // the source's. One-directional on purpose — the reverse (tail contains
    // source) would let a short source like "Jubi" strip a real "- Jubilee ..."
    // tail. The >=4-char gate avoids short-substring collisions.
    const normSrc = src.toLowerCase().replace(/[^a-z0-9]/g, "");
    const mSrc = t.match(/^(.*\S)\s[-–—|]\s([^-–—|]{2,40})$/);
    if (mSrc && normSrc) {
      const normTail = mSrc[2].trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normTail.length >= 4 && normSrc.includes(normTail)) return mSrc[1].trim();
    }
  }
  const m = t.match(/^(.*\S)\s[-–—|]\s([^-–—|]{2,40})$/);
  if (m) {
    const tail = m[2].trim();
    const wordCount = tail.split(/\s+/).length;
    const MASTHEAD_RE =
      /\b(news|times|post|herald|guardian|reuters|bloomberg|daily|tribune|gazette|journal|chronicle|observer|telegraph|press|wire|report|today|mail|express|standard|abc|bbc|cnn|afp|rnz|pngfm|loop|bulletin|review|insider|monitor|dispatch|courier|sun|star|globe|record|digest|radio|tv|online|media|emtv|national|jubi|antara|kompas|detik|tempo|tribun|suara|cendrawasih|tabloid)\b/i;
    // A masthead-type word anywhere in the raw tail, OR — for a camel-case
    // publisher glued together ("AsiaNews", "BenarNews") — as the FINAL token once
    // split. Requiring it LAST avoids stripping a name-prefixed token such as
    // "StarLink" (begins with a listed word but is not a masthead). Google News
    // RSS appends the original publisher ("- AsiaNews") while the stored source is
    // the feed name, so the source-anchored strip above cannot catch it.
    let looksLikeMasthead = MASTHEAD_RE.test(tail);
    if (!looksLikeMasthead) {
      const parts = tail.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/);
      if (parts.length >= 2 && MASTHEAD_RE.test(parts[parts.length - 1] ?? "")) looksLikeMasthead = true;
    }
    if (wordCount <= 6 && !/\d/.test(tail) && looksLikeMasthead) return m[1].trim();
  }
  return t;
}

// Photo-GALLERY framing on a headline ("More photos of …", "Photos of …",
// "In pictures: …", "Gallery: …"). Publishing photographs is not itself a
// security development, so a brief must never headline on the gallery (spec §4).
// Strip the framing so the underlying event is described; display-only, never
// drops the row. If nothing distinct survives, the original is kept unchanged.
function stripGalleryFraming(title: string): string {
  const cleaned = title
    .replace(/^\s*(?:more\s+)?photos?\s+of\s+(?:the\s+)?/i, "")
    .replace(/^\s*(?:in\s+(?:pictures|photos|images)|photo\s+gallery|gallery)\s*[:\-–—]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === title.trim()) return title;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// A headline that plainly describes a LEGACY wartime / unexploded-ordnance
// ACCIDENTAL blast (e.g. "World War II bomb remnant explosion"). Such an event
// is not an attack, so it must not be filed — or read — as terrorism (spec §4).
// Guarded by a deliberate-attack veto so a genuine bombing is never rewritten.
const LEGACY_ORDNANCE_RE =
  /\b(?:world war|wwii|ww2|second world war|wartime|war-era|colonial-era|japanese-era|unexploded|leftover|legacy)\b[^.]*\b(?:bomb|ordnance|shell|munition|mortar|grenade|explosiv|device|remnant)\b|\b(?:uxo|erw|unexploded ordnance|explosive remnants? of war|bomb remnant|ordnance remnant)\b/i;
const DELIBERATE_ATTACK_RE =
  /\b(?:attack|detonat|planted|ied|improvised explosive|suicide|bomber|militant|terror|insurgent|rebel|separatist|assault|ambush)\b/i;
function isLegacyOrdnanceExplosion(
  title: string | null | undefined,
  summary: string | null | undefined,
): boolean {
  const hay = `${title ?? ""} ${summary ?? ""}`;
  return LEGACY_ORDNANCE_RE.test(hay) && !DELIBERATE_ATTACK_RE.test(hay);
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
  // Registry slug for the shared @workspace/country-engine config (§1). Drives
  // the SAME engine used by the api-server owner routes. Unset → the engine
  // resolves a generic config from the country name.
  engineSlug?: string;
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
  // When true, the same-story clusterer treats sibling sub-provinces of this ONE
  // theatre as clusterable, so the same event tagged to different Papua
  // sub-provinces (Papua Pegunungan / Papua Tengah / Papua) is not blocked by the
  // exact-province gate. Set ONLY on the compact single-theatre reports (PNG /
  // West Papua); the nationwide multi-region reports (Indonesia / Jakarta) leave
  // it unset so distinct cities are never merged.
  crossProvinceDedup?: boolean;
  // PNG-only. When true, the "Incident Details" section lists each theme's
  // incidents as compact per-item cards (own place + honest date) beneath the
  // theme paragraph. Set ONLY on PNG_REPORT_CONFIG — West Papua, Indonesia and
  // Jakarta stay paragraph-only (inert), so high-volume theatres never explode
  // the brief into hundreds of pages.
  perIncidentDetailCards?: boolean;
  // Optional Customer Relevance audience. Names who the brief is most relevant
  // to ("Most relevant to <audience>."); the period's main issues are derived
  // from the incident mix, not from this field. Unset → a generic audience.
  audienceProfile?: { audience: string };
  // PNG-only. When true, the window is stripped of low-value development /
  // promotional wire copy (infrastructure ribbon-cutting, aviation partnerships,
  // scholarships, "brings hope/joy" items, "tidbits") BEFORE any narrative
  // surface reads it, so the brief leads with genuine security reporting rather
  // than development PR. STRICT under-filter bias — never drops Moderate+
  // severity or any item carrying a security / hazard term (see
  // isDevelopmentWireItem). Set ONLY on PNG_REPORT_CONFIG; every other theatre
  // is byte-identical because the filter is inert when the flag is unset.
  filterDevelopmentWire?: boolean;
  // PNG-only. When true, non-kinetic assistance / prevention / ceremonial PR
  // items (e.g. "trained to stop sorcery violence", "helped displaced victims")
  // are DEMOTED to Low severity at item build, so the brief no longer leads with
  // — or asserts High severity from — development PR while real crime sits below
  // it. STRICT no-fabrication: only ever demotes, never up-rates, and is
  // veto-guarded against demoting genuine kinetic events (see
  // isNonKineticAssistanceItem). Set ONLY on PNG_REPORT_CONFIG; every other
  // theatre is byte-identical because the correction is inert when unset.
  demoteNonKineticWire?: boolean;
  // Indonesia-only. When true, the Outlook section additionally renders a
  // "Reported Upcoming Activity" table of forward-looking protest signals
  // extracted from the period's reporting (shared upcomingSignals authority,
  // same rows the live Protests monitor shows). STRICT no-fabrication: the
  // table shows the ANNOUNCEMENT date + source, never a guessed event date, and
  // is empty when nothing is reported. Set ONLY on INDONESIA_REPORT_CONFIG;
  // every other theatre leaves `upcomingSignals` empty so their render is
  // byte-identical.
  showUpcomingSignals?: boolean;
}

export const PNG_REPORT_CONFIG: StructuredTheatreConfig = {
  countryName: "Papua New Guinea",
  engineSlug: "papua-new-guinea",
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
  filterDevelopmentWire: true,
  demoteNonKineticWire: true,
  crossProvinceDedup: true,
  perIncidentDetailCards: true,
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
  engineSlug: "papua",
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
  crossProvinceDedup: true,
  deriveProvince: deriveWestPapuaProvince,
  extractItem: extractWestPapuaItem,
};

export const INDONESIA_REPORT_CONFIG: StructuredTheatreConfig = {
  countryName: "Indonesia",
  engineSlug: "indonesia",
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
  showUpcomingSignals: true,
};

export const THAILAND_REPORT_CONFIG: StructuredTheatreConfig = {
  countryName: "Thailand",
  engineSlug: "thailand",
  buckets: [
    {
      key: "bangkokMetro",
      label: "Bangkok Metropolitan Region",
      provinces: [
        "Bangkok",
        "Nonthaburi",
        "Pathum Thani",
        "Samut Prakan",
        "Nakhon Pathom",
        "Samut Sakhon",
      ],
    },
    {
      key: "central",
      label: "Central Thailand",
      provinces: [
        "Phra Nakhon Si Ayutthaya",
        "Ang Thong",
        "Lopburi",
        "Sing Buri",
        "Chai Nat",
        "Saraburi",
        "Nakhon Nayok",
        "Suphan Buri",
        "Samut Songkhram",
        "Kanchanaburi",
        "Ratchaburi",
        "Phetchaburi",
        "Prachuap Khiri Khan",
      ],
    },
    {
      key: "northern",
      label: "Northern Thailand",
      provinces: [
        "Chiang Mai",
        "Chiang Rai",
        "Lamphun",
        "Lampang",
        "Uttaradit",
        "Phrae",
        "Nan",
        "Phayao",
        "Mae Hong Son",
        "Tak",
        "Sukhothai",
        "Phitsanulok",
        "Phichit",
        "Kamphaeng Phet",
        "Phetchabun",
        "Nakhon Sawan",
        "Uthai Thani",
      ],
    },
    {
      key: "northeastern",
      label: "Northeastern Thailand (Isan)",
      provinces: [
        "Nakhon Ratchasima",
        "Buriram",
        "Surin",
        "Sisaket",
        "Ubon Ratchathani",
        "Yasothon",
        "Chaiyaphum",
        "Amnat Charoen",
        "Nong Bua Lamphu",
        "Khon Kaen",
        "Udon Thani",
        "Loei",
        "Nong Khai",
        "Maha Sarakham",
        "Roi Et",
        "Kalasin",
        "Sakon Nakhon",
        "Nakhon Phanom",
        "Mukdahan",
        "Bueng Kan",
      ],
    },
    {
      key: "eastern",
      label: "Eastern Thailand",
      provinces: [
        "Chonburi",
        "Rayong",
        "Chanthaburi",
        "Trat",
        "Chachoengsao",
        "Prachinburi",
        "Sa Kaeo",
      ],
    },
    {
      key: "southern",
      label: "Southern Thailand",
      provinces: [
        "Nakhon Si Thammarat",
        "Krabi",
        "Phang Nga",
        "Phuket",
        "Surat Thani",
        "Ranong",
        "Chumphon",
        "Songkhla",
        "Satun",
        "Trang",
        "Phatthalung",
        "Pattani",
        "Yala",
        "Narathiwat",
      ],
    },
  ],
  otherBucketLabel: "Other National Security-Relevant Activity",
  emptyLocationFallback: PNG_EMPTY_LOCATION_FALLBACK,
  businessImpactEmptyNote:
    "No fresh incident-driven business impact was identified this period. Standing exposures — urban and tourist-area crime in the major cities, periodic political demonstrations in Bangkok, the long-running separatist insurgency in the Deep South (Pattani, Yala, Narathiwat), and recurrent natural-hazard disruption (flooding, seasonal storms) — continue to apply.",
  emptyOutlook:
    "With no fresh reporting this period, expect the standing risk pattern to persist: opportunistic and organised urban crime, episodic political protest in the capital, militant violence in the southern border provinces, and natural-hazard disruption to transport and operations. Maintain current movement and continuity precautions and re-test them as fresh reporting comes through.",
  outlookVolatilityClause:
    "political mobilisation in Bangkok, southern-border security operations, and seasonal flooding and storm episodes",
  audienceProfile: {
    audience:
      "multi-site operators, logistics teams, manufacturing and industrial-estate sites, tourism operators, field travel, warehousing and staff movement between provinces",
  },
  deriveProvince: deriveThailandProvince,
  extractItem: extractThailandItem,
  proseVariant: "operating-risk",
  topIncidentsHeading: "Priority Incidents This Week",
  showUpcomingSignals: true,
};

export const PHILIPPINES_REPORT_CONFIG: StructuredTheatreConfig = {
  countryName: "Philippines",
  engineSlug: "philippines",
  buckets: [
    {
      key: "metroManila",
      label: "Metro Manila (NCR)",
      provinces: ["Metro Manila"],
    },
    {
      key: "luzon",
      label: "Luzon (outside Metro Manila)",
      provinces: [
        "Cordillera Administrative Region",
        "Ilocos Region",
        "Cagayan Valley",
        "Central Luzon",
        "Calabarzon",
        "Mimaropa",
        "Bicol Region",
      ],
    },
    {
      key: "visayas",
      label: "Visayas",
      provinces: [
        "Western Visayas",
        "Central Visayas",
        "Eastern Visayas",
      ],
    },
    {
      key: "mindanao",
      label: "Mindanao",
      provinces: [
        "Zamboanga Peninsula",
        "Northern Mindanao",
        "Davao Region",
        "Soccsksargen",
        "Caraga",
        "Bangsamoro",
      ],
    },
  ],
  otherBucketLabel: "Other National Security-Relevant Activity",
  emptyLocationFallback: PNG_EMPTY_LOCATION_FALLBACK,
  businessImpactEmptyNote:
    "No fresh incident-driven business impact was identified this period. Standing exposures — urban crime in Metro Manila and the major cities, periodic political demonstrations, communist (NPA) and Islamist militant activity concentrated in parts of Mindanao and the Bangsamoro region, and recurrent natural-hazard disruption (typhoons, flooding, seismic and volcanic activity) — continue to apply.",
  emptyOutlook:
    "With no fresh reporting this period, expect the standing risk pattern to persist: opportunistic and organised urban crime, episodic political protest, localised insurgent and militant violence in Mindanao, and natural-hazard disruption to transport and operations. Maintain current movement and continuity precautions and re-test them as fresh reporting comes through.",
  outlookVolatilityClause:
    "political mobilisation, security operations in Mindanao and the Bangsamoro region, and the typhoon and seismic-hazard calendar",
  audienceProfile: {
    audience:
      "multi-site operators, logistics teams, BPO and office sites, manufacturing and export-zone sites, field travel, warehousing and staff movement between islands",
  },
  deriveProvince: derivePhilippinesProvince,
  extractItem: extractPhilippinesItem,
  proseVariant: "operating-risk",
  topIncidentsHeading: "Priority Incidents This Week",
  showUpcomingSignals: true,
};

export const JAKARTA_REPORT_CONFIG: StructuredTheatreConfig = {
  countryName: "Jakarta",
  engineSlug: "jakarta",
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
  // Original-language (pre-translation) headline, masthead/wire-cruft stripped
  // but NOT substituted by display_title. `title` above resolves to the English
  // display_title when one exists, so bilingual copies of one story diverge on
  // `title`; clusterSameStory feeds this raw title to the additive cross-language
  // merge paths so those copies still cluster (and lead with the English member).
  rawTitle?: string;
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
  // True when the incident's OWN event date fell BEFORE the current reporting
  // window even though it was REPORTED inside it (an older event resurfacing
  // with fresh findings). Such rows still appear in the cards + Top 3 (with both
  // dates stated) but are EXCLUDED from the period's trend / severity aggregates
  // so a week-old killing reported today never inflates this week's picture.
  // Requires BuildArgs.windowStart; false for every theatre that omits it
  // (byte-identical render) and for any row without an extracted incidentDate.
  occurredOutOfWindow: boolean;
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

export interface PngReportDataset {
  periodLabel: string;
  // Bottom Line Up Front — a single short paragraph at the very top giving the
  // week's trajectory, the lead concern and the principal business risk.
  bluf: string;
  executiveSummary: string;
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
  // Forward-looking "Reported Upcoming Activity" rows shown inside the Outlook
  // section. Populated ONLY for theatres with config.showUpcomingSignals
  // (Indonesia); empty [] everywhere else so their render is byte-identical.
  upcomingSignals: UpcomingSignalRow[];
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
  reportingConfidence: ReportingConfidence;
  windowItems: PngReportItem[];
  // Incidents to analyse in "Incident Details" — every windowItem NOT promoted
  // into the Top 3 story clusters above.
  incidentDetailsItems: PngReportItem[];
  // PNG-only (config.perIncidentDetailCards). When true, the renderer lists each
  // theme's incidents as compact per-item cards beneath the theme paragraph.
  // False for every other theatre, leaving their Incident Details paragraph-only
  // rendering byte-identical.
  showPerIncidentCards: boolean;
  // Grouped recommended actions (Movement security, Site security, …), built
  // from this period's incident mix and the location watchlist.
  recommendedActions: RecommendedActionGroup[];
  // Analyst prose overrides (country_reports.section_overrides): edited
  // Current Situation theme paragraphs (by theme key) and Recommended Actions
  // bullets (by group key, newline-separated). Carried on the dataset so BOTH
  // renderers (PngCountryReportBody + the headless structured renderer) apply
  // them through the shared override helpers — preview == PDF by construction.
  briefProseOverrides?: {
    themeParagraphs?: Record<string, string>;
    actionGroups?: Record<string, string>;
  } | null;
  // Jakarta-only overrides (set behind config.jakartaProse). When present the
  // renderer prefers these over the generic Incident-Details theme groups and
  // Operational-Impact bullets; unset for every other theatre, leaving their
  // rendering byte-identical.
  // `items` is always absent for the Jakarta paragraph-only override; it is
  // declared optional only so the field is structurally compatible with the
  // generic `CountryIncidentThemeGroup[]` (which carries per-incident `items`)
  // at the `?? buildCountryIncidentThemes(...)` merge point in both consumers.
  incidentThemesOverride?: {
    key: string;
    heading: string;
    paragraph: string;
    items?: PngReportItem[];
  }[];
  operationalImpactOverride?: string[];
  // Jakarta-only layout hint: render the closing Polestar View keep-together so
  // the complete assessment paragraph never splits across a page boundary
  // (spec §5). Unset for every other theatre — no markup change.
  keepPolestarTogether?: boolean;
  // --- Shared country-engine wiring (owner brief §14–23, §33, §36) ---------
  // The full engine run for this window (ALL canonical events + included /
  // held / excluded splits + stats). Drives the admin review panel and the
  // map/gate below. INCLUDED events only ever reach a rendered surface.
  engineResult: EngineResult;
  // The engine-built narrative — the authoritative source of the section TEXT
  // (bluf, executiveSummary, outlook, polestarView, topThree, operational
  // impact, recommendations). Sparse periods (§27) omit sections rather than
  // pad, so the renderer skips empty ones.
  engineNarrative: CountryNarrative;
  // Credible, plottable map points for INCLUDED events only (§23). Never
  // includes Unknown / Country-only / foreign / excluded / held rows.
  mapPoints: MapPoint[];
  // §33 fail-closed pre-publication quality gate. When gate.passed is false on
  // a critical check the page BLOCKS the Download PDF action and shows the
  // failure panel (owner-only surface).
  gate: QualityGateResult;
  // The exact input the gate was run against. Kept on the dataset so the page
  // can RE-RUN the gate over the final effective narrative (after an explicit
  // analyst edit overlays a section) — the rendered/exported text is always the
  // text that was validated, never a pre-overlay snapshot.
  gateReport: QualityGateReport;
  // Jakarta-only tactical operating brief (Movement & Access Impact, Business
  // District / Port exposure tables, Airport-Hotel-Office, Route & Timing, and
  // the map area summary). Consumed ONLY by the canonical Jakarta brief
  // (PngCountryReportBody + renderStructuredBrief, gated on this field); unset
  // for every other theatre, leaving their rendering byte-identical.
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
  // Start instant of the current reporting window (startOfDay of issueDate-6).
  // OPTIONAL: when supplied, a row whose extracted incidentDate falls before it
  // is flagged occurredOutOfWindow and dropped from the period's trend/severity
  // aggregates. Omitted → occurredOutOfWindow is always false (render unchanged).
  windowStart?: Date;
  // True when computeCountryCoverageStatus determined the weekly window is a
  // coverage problem (state "coverage-problem"). Every empty-week surface then
  // reads "Not Assessed" instead of implying a confirmed quiet week. Omitted →
  // false (render unchanged).
  coverageUnconfirmed?: boolean;
  // Analyst-edited theme paragraphs / recommended-action bullets (see the
  // dataset field of the same name). Copied through verbatim.
  briefProseOverrides?: {
    themeParagraphs?: Record<string, string>;
    actionGroups?: Record<string, string>;
  } | null;
  // Analyst Top 3 Developments curation (country_reports.section_overrides):
  // pinned incident ids lead the section (pin order); excluded ids drop an
  // automatic pick from the section only (the incident falls back to the
  // Incident Details buckets). Omitted → automatic selection unchanged.
  top3Curation?: {
    pinnedIds?: string[];
    excludedIds?: string[];
    // Analyst-authored free-text developments (missed / just-come-through).
    // Rendered as Top-3 cards AHEAD of pinned/auto picks, clearly attributed
    // ("Analyst entry"). NEVER folded into any aggregate, chart, watchlist or
    // prose grounding — they exist only as Top-3 tiles.
    customItems?: Array<{
      id: string;
      title: string;
      detail?: string;
      location?: string;
      severity?: string;
      date?: string;
    }>;
  };
}

// Build a PngReportItem card from an analyst-typed free-text development. The
// card is display-only: it joins topThree AFTER every aggregate is computed,
// so it can never inflate trends, severity mixes or the watchlist.
function customTop3Card(
  c: NonNullable<NonNullable<BuildArgs["top3Curation"]>["customItems"]>[number],
): PngReportItem {
  const sev = (c.severity ?? "moderate").trim().toLowerCase();
  const severity = SEV_RANK[sev] != null ? sev : "moderate";
  let reportedDate = new Date();
  if (c.date) {
    const parsed = new Date(`${c.date}T00:00:00Z`);
    if (!isNaN(parsed.getTime())) reportedDate = parsed;
  }
  return {
    id: c.id,
    title: c.title,
    summary: c.detail ?? "",
    province: c.location?.trim() || null,
    location: c.location?.trim() || null,
    category: "Other security",
    displayCategory: "Analyst entry",
    businessImpact: c.detail?.trim() ?? "",
    severity,
    severityLabel: SEV_LABEL[severity] ?? severity,
    severityRank: SEV_RANK[severity] ?? 0,
    reportedDate,
    incidentDate: null,
    occurredEarlier: false,
    occurredOutOfWindow: false,
    source: "Analyst entry",
    url: null,
    confidence: "Analyst-reported",
  };
}

// Prepend the analyst's free-text developments to a final Top-3 selection
// (additive — never displaces pins or autos; id-deduped defensively).
function withCustomTop3<T extends { id: string }>(
  selection: T[],
  curation: BuildArgs["top3Curation"],
): T[] {
  const customs = (curation?.customItems ?? []).filter((c) => c.title?.trim());
  if (customs.length === 0) return selection;
  const existing = new Set(selection.map((it) => String(it.id)));
  const cards = customs
    .filter((c) => !existing.has(String(c.id)))
    .map((c) => customTop3Card(c) as unknown as T);
  return [...cards, ...selection];
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

function toItem(
  i: PngSourceIncident,
  config: StructuredTheatreConfig,
  windowStart?: Date,
): PngReportItem {
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
  let category: PngCategory =
    i.category && i.businessImpact
      ? (i.category as PngCategory)
      : ext?.category ?? DEFAULT_CATEGORY;
  let impact =
    i.category && i.businessImpact
      ? i.businessImpact
      : ext?.businessImpact ?? DEFAULT_BUSINESS_IMPACT;
  // Display-layer category correction (no-fabrication): the keyword classifier
  // sometimes files a plainly ACCIDENTAL legacy-ordnance blast (a "World War II
  // bomb remnant explosion") as "Terrorism / militancy". Re-file it as an
  // accidental explosion so it never reads as an attack, never carries a
  // terrorism recommendation, and — being an incidental hazard — never leads the
  // brief (spec §4). Veto-guarded so a genuine bombing is untouched.
  if (
    category === "Terrorism / militancy" &&
    isLegacyOrdnanceExplosion(`${i.displayTitle ?? ""} ${i.title ?? ""}`, i.summary)
  ) {
    category = "Explosive remnants of war / accidental explosion";
    impact =
      "Localised blast damage and casualties from accidental wartime ordnance, not an attack; cordon the area, heed official guidance and confirm site safety before approach.";
  }
  // Display-layer severity correction (no-fabrication, demote-only), promoted
  // from PNG-only to EVERY theatre (opt-out): the stored severity mis-rates
  // assistance / prevention PR as High; cap those at Low here so it flows
  // consistently into severityLabel, severityRank, every sort, both prose
  // severity flags and clustering. STRICT: only ever demotes non-kinetic
  // assistance/PR (veto-guarded), never up-rates. A theatre can opt out with
  // demoteNonKineticWire: false.
  const rawSev = (i.severity ?? "").toLowerCase();
  const sev =
    config.demoteNonKineticWire !== false &&
    isNonKineticAssistanceItem(i.title, i.summary)
      ? correctSeverity(rawSev)
      : rawSev;
  const reportedDate = new Date(i.occurredAt);
  const incidentDate = i.incidentDate ? new Date(i.incidentDate) : null;
  const title = stripGalleryFraming(
    stripWireCruft(
      i.displayTitle && i.displayTitle.trim()
        ? cleanTitle(i.displayTitle.trim(), i.source)
        : cleanTitle(i.title, i.source),
    ),
  );
  // Original-language headline: same cleaning as `title` but WITHOUT the
  // display_title substitution, so cross-language duplicates of one story share
  // it (see PngReportItem.rawTitle / clusterSameStory).
  const rawTitle = stripGalleryFraming(stripWireCruft(cleanTitle(i.title, i.source)));
  return {
    id: String(i.id ?? `${i.title}-${i.occurredAt}`),
    title,
    rawTitle,
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
    occurredOutOfWindow:
      incidentDate != null && windowStart != null && incidentDate < windowStart,
    source: (i.source ?? "").trim(),
    url: (i.resolvedUrl ?? i.sourceUrl ?? null) || null,
    confidence: (i.confidence ?? "").trim().toLowerCase() || "unrated",
  };
}

// Low-value development / promotional wire copy that dilutes a security brief
// (infrastructure ribbon-cutting, aviation partnerships, scholarships, "brings
// hope/joy" community items, "tidbits" round-ups). Substring match; the strict
// severity + security gating below is the real safety net.
//
// Two homonym-driven PR classes were leaking into the PNG "Protest & civil
// unrest" theme and are added here (both Low, both carry no security term, so the
// severity + veto gating below keeps every genuine event):
//   * AWARDS / RECOGNITION human-interest ("declines WOW Awards Nomination…",
//     summarised as "a powerful demonstration of selfless leadership") — the
//     bare metaphor "demonstration of <virtue>" is deliberately spared upstream
//     so genuine "demonstration of people power" survives, so it must be caught
//     here as PR, not as a protest.
//   * JOINT MILITARY EXERCISE PR ("U.S., Papua New Guinea launch Tamiok Strike
//     26", "Exercise Tamiok Strike 2026", "Exercise Pitch Black") — the exercise
//     name "…Strike…" is a labour-strike homonym; a friendly readiness exercise
//     is not a security incident. Named-exercise anchors (tamiok strike / exercise
//     pitch black) are used so the darkness metaphor "pitch black" cannot match.
const DEVELOPMENT_WIRE_RE =
  /(brings hope|brings joy|tidbits|partnership|inaugural|scholarship|cadet program|flight subsid|aviation network|expansion project|moves forward|contract signing|countdown begins|in the air|links communities|connect isolated|community engagement|memorandum of understanding|invests in|investment|benefit from|celebrat|upgrade|groundbreaking|ceremony|renovat|classroom|farewell|new era|inflation|bursar|\b5g\b|designer|new collection|enduring relationship|strengthen(s|ing)? (its |the )?(relationship|partnership|ties|bond)|\baward(s|ed|ing)?\b|\bnominat(e|es|ed|ion|ions|ing)?\b|\baccolade|\bprize\b|pageant|tamiok strike|exercise pitch black|(joint|bilateral|combined|multinational|military) (military )?exercise|war ?games)/i;
// A security / risk / hazard term anywhere in the text VETOES the drop, even
// when the promotional lexicon also matches, so a genuine low-severity crime,
// court, unrest or natural-hazard item is never removed. A veto only ever KEEPS
// an item, so this list can be liberal without risking data loss.
const SECURITY_TERM_RE =
  /(robber|murder|homicide|killed|killing| kill |manslaughter|attack|assault|shoot|shot|gunman|gunmen| gun |firearm|weapon|knife|stab|violence|riot|unrest|protest|clash|tribal|sorcery|gender-based|abuse|smuggl|theft|stolen|steal|robbed|raid|kidnap|hostage|hijack|carjack|extort| gang|militant|insurg|separatist|rape|arson|bomb|explos|terror|convict|arrest|manhunt|fugitive|casualt|fatal|injur|wound| dead|death|police|earthquake|volcano|eruption|flood|landslide|outage|fire|blaze|crash|kebakaran|penembakan|pembunuhan|perampokan|narkoba|penyelundupan|kekerasan|penyerangan|penculikan|polisi)/i;

// STRUCTURAL non-incident titles: recurring newspaper round-up / column names
// that are categorically never a single security event (e.g. Post-Courier PNG's
// weekly "PC Online Tidbits" miscellany). These are dropped REGARDLESS of
// severity — a deliberate, narrow deviation from the severityRank >= 3 guardrail
// below, justified because a round-up column carries no discrete event to lose.
// The true defect is upstream severity misclassification (the live row is
// mis-rated Moderate); this marker is the durable display-side hedge because the
// column recurs weekly. Keep this set to structural column/round-up names only —
// do NOT grow it into a second general lexicon.
const HARD_NON_INCIDENT_TITLE_RE = /\btidbits\b/i;

// NON-EVENT editorial classes that carry security vocabulary BY THEIR NATURE, so
// the SECURITY_TERM_RE veto below would keep them forever and the severityRank
// backstop cannot help (they arrive mis-rated High). Each is an editorial /
// promotional artefact, never a discrete security event:
//   * ANALYSIS / OPINION think-pieces ("Beyond tribal violence: everyday crime
//     and insecurity in PNG — Devpolicy Blog") — a Development Policy Centre essay
//     ABOUT violence, not a violence report.
//   * SPORTS FIXTURES ("Consistency in Selection Ahead of Blackhawks Clash",
//     "Flying Fijians name powerful side for Wales opener", "Chelsea, AC Milan
//     to Bring Star Players for Indonesia Super Cup Clash") — the sports
//     "clash" is a homonym that trips SECURITY_TERM_RE; a team-selection or
//     fixture-promotion preview is not an incident. Anchored on non-event
//     ACTIONS (team selection, bringing star players), never team names —
//     "Vipers" appears in a genuine attempted-murder conviction.
//   * PUBLIC-AWARENESS CAMPAIGNS ("…Robust Awareness Initiative Transforms Local
//     Wards") — an advocacy drive against violence, not a violent event.
// These anchors are EMPIRICALLY precision-gated: verified against the full live
// PNG corpus (2.5 months) to match ONLY these non-event rows and zero genuine
// incidents, which is why they may safely bypass the security-term veto. Keep any
// addition to that same standard (confirm it hits no real event before adding).
// Deliberately EXCLUDES the "community leaders trained to stop violence" training
// class: "trained to stop" can co-occur with a real casualty ("officer trained to
// stop riots shot dead"), so it stays veto-protected — the durable fix for those
// is upstream severity/category reclassification, not a veto bypass here.
const NON_EVENT_TITLE_RE =
  /(\bdevpolicy\b|development policy centre|everyday crime and insecurity|\bname[sd]?\s+(?:a\s+)?(?:powerful\s+)?side\b|consistency in selection|selection ahead of|\bbring(?:ing|s)?\s+star\s+players\b|\bawareness\s+(?:initiative|campaign|programme|program|drive|week|month)\b)/i;

// Photo-PUBLICATION headlines ("More photos of victims"; Bahasa "Foto korban" /
// "Foto-foto para korban"). Per spec: the publication of photographs is NOT a
// security development, so such a headline must never lead as an incident. Like
// NON_EVENT it is dropped WITHOUT the security-term veto — "victims"/"korban"
// inherently names casualties, which would otherwise veto the drop. TITLE-ONLY
// and deliberately NARROW: it does NOT match "korban … diidentifikasi" (victims
// identified — a genuine investigative development). Exported for unit tests.
const PHOTO_PUBLICATION_TITLE_RE =
  /(\bfoto(?:-foto)?\s+(?:para\s+)?korban\b|\b(?:more\s+)?photos?\s+of\s+(?:the\s+)?victims\b)/i;

// Pure predicate: is this a low-value development / promotional wire item that a
// security brief should exclude? Exported for unit tests. Strict under-filter
// bias — a security / hazard term always vetoes the drop.
//
// Three paths:
//  0. NON-EVENT editorial classes (NON_EVENT_TITLE_RE) are dropped at any severity
//     WITHOUT the security-term veto, because they inherently name security topics
//     (analysis of violence, a rugby "clash", an anti-violence campaign) yet carry
//     no discrete event. Safe only because each anchor is empirically verified to
//     match no genuine incident in the live corpus.
//  1. STRUCTURAL round-up columns (HARD_NON_INCIDENT_TITLE_RE) are dropped at any
//     severity. The security-term veto here is TITLE-ONLY, matching the carve-out
//     "a 'Tidbits: gunmen raid store' edition stays": these columns are always
//     bare-titled after the column, never a specific event, while their grab-bag
//     summary routinely mentions unrelated crime — so a summary-scoped veto would
//     make the marker permanently inert. A title that names a real event is kept.
//  2. GENERIC development / PR wire is dropped only when Low (severityRank < 3),
//     and a security / hazard term ANYWHERE (title or summary) vetoes the drop, so
//     a genuine low-severity crime, court, unrest or natural-hazard item stays.
export function isDevelopmentWireItem(item: PngReportItem): boolean {
  const hay = `${item.title} ${item.summary}`.toLowerCase();
  if (NON_EVENT_TITLE_RE.test(hay)) return true;
  if (PHOTO_PUBLICATION_TITLE_RE.test(item.title)) return true;
  if (HARD_NON_INCIDENT_TITLE_RE.test(item.title)) {
    return !SECURITY_TERM_RE.test(item.title.toLowerCase());
  }
  if (SECURITY_TERM_RE.test(hay)) return false;
  if (item.severityRank >= 3) return false;
  return DEVELOPMENT_WIRE_RE.test(hay);
}

// Retrospective / anniversary REFLECTION headlines ("28 years since the Biak
// massacre, conflict in West Papua escalates"; "on this day"; "decades later").
// A look-back piece is never a CURRENT development, yet it routinely carries a
// high stored severity (the historical event it commemorates), so the
// severity-gated development-wire filter above cannot remove it and it wrongly
// leads the Top 3. Digit-anchored ("28 years since/after/ago/on") plus a short
// list of unambiguous retrospective phrases. Deliberately does NOT match a bare
// "anniversary": a protest or ceremony held ON an anniversary date is a genuine
// current event and must stay. Exported for unit tests.
const RETROSPECTIVE_TITLE_RE =
  /(\b\d{1,3}\s+years?\s+(since|after|ago|on)\b|\bdecades?\s+(since|ago|later|on)\b|\ba\s+(year|decade)\s+(on|since|ago|later)\b|\bon this day\b|\blooking back\b|\bflashback\b|\bin memoriam\b|\blest we forget\b|\byears\s+later\b)/i;

export function isRetrospectiveItem(item: PngReportItem): boolean {
  return (
    RETROSPECTIVE_TITLE_RE.test(item.title) ||
    RETROSPECTIVE_TITLE_RE.test(item.rawTitle ?? "")
  );
}

function sortBySeverityThenRecency(a: PngReportItem, b: PngReportItem): number {
  return compareIncidentSignificance(
    {
      severity: ["", "insignificant", "low", "moderate", "high", "extreme"][a.severityRank] ?? "",
      title: a.title,
      summary: a.summary,
      occurredAt: (a.incidentDate ?? a.reportedDate).toISOString(),
    },
    {
      severity: ["", "insignificant", "low", "moderate", "high", "extreme"][b.severityRank] ?? "",
      title: b.title,
      summary: b.summary,
      occurredAt: (b.incidentDate ?? b.reportedDate).toISOString(),
    },
  );
}

// Categories that are NOT a conflict/security development: accidental blasts,
// fires, natural hazards and environmental incidents. However many casualties
// such an event carries, a security brief must NOT lead on it ahead of genuine
// armed-conflict, violent-crime or unrest reporting (spec §2/§4: the Yahukimo
// separatist clash must lead; the accidental Biak wartime-ordnance blast, though
// Extreme by casualties, is localised and must never lead). This is demote-only
// — it re-orders the lead, it never drops the item, which still appears in a
// lower Top-3 slot or in the Fire/explosion Incident Details theme.
const NON_SECURITY_LEAD_CATEGORIES: ReadonlySet<string> = new Set([
  "Explosive remnants of war / accidental explosion",
  "Fire",
  "Natural hazard",
  "Environmental / haze",
]);
function leadSecurityTier(it: PngReportItem): number {
  return NON_SECURITY_LEAD_CATEGORIES.has(it.category) ? 0 : 1;
}

// Rank clusters by ANALYST VALUE (casualties, disruption, deployment) with
// severity-then-recency as the tie-break. This decides WHICH stories make the
// Top-3 — the most significant distinct events, incidental hazards included — so
// a deadly accidental blast is still SHOWN. It deliberately does NOT weigh
// security-vs-hazard here; that governs only the #1 LEAD slot and is enforced
// separately at display time (see selectTopStoryClusters), so the hazard is never
// dropped, it simply never leads.
function compareClusterByValue(a: PngReportItem[], b: PngReportItem[]): number {
  const incidentDelta = compareIncidentValueClusters(a, b);
  if (incidentDelta !== 0) return incidentDelta;
  return sortBySeverityThenRecency(a[0], b[0]);
}

// A cluster's representative headline + date, for selection-time story matching.
function clusterStoryInput(c: PngReportItem[]): StorySimInput {
  const it = c[0];
  return { title: it.title, dateMs: (it.incidentDate ?? it.reportedDate).getTime() };
}

// Two clusters describe the SAME real-world story (Top-3 diversity threshold):
// a shared strong distinctive entity, high token overlap, or a shared
// distinctive place + event class within three days. Broader than the ingest
// clusterer's merge floor because outlets that filed one event under different
// categories / sub-provinces survived as two clusters.
function isSameTopStory(a: PngReportItem[], b: PngReportItem[]): boolean {
  const s = storySimilarity(clusterStoryInput(a), clusterStoryInput(b));
  return s.sharedStrong || s.jaccard >= 0.4 || s.sharedPlaceClass;
}

// STRONG same-story evidence — safe to fold a skipped duplicate's members into
// the Top-3 id set so the event never reappears in a location bucket. Weaker
// evidence (0.4 <= jaccard < 0.5 or place+class only) leaves the members in the
// buckets, so a possibly-distinct event is shown once, never silently dropped.
// The fold REMOVES data, so it is gated on the SAME 3-day window the ingest
// clusterer requires to merge: formulaic PNG tribal-violence headlines let two
// genuinely distinct clashes weeks apart hit jaccard>=0.5 (or share a strong
// entity), and folding the later one out on that alone would silently drop a
// real incident. Outside the window the event stays visible in its bucket.
function isStrongSameTopStory(a: PngReportItem[], b: PngReportItem[]): boolean {
  const s = storySimilarity(clusterStoryInput(a), clusterStoryInput(b));
  return (s.sharedStrong || s.jaccard >= 0.5) && s.within3d;
}

// Top-3 development selection for EVERY theatre. The input clusters are already
// value-sorted. A STORY-diversity guard (all theatres) skips a candidate whose
// representative is the same real-world story as one already picked, so the three
// developments shown are three DISTINCT events even when a syndicated story
// survived the conservative ingest clusterer as two clusters. For Jakarta
// (config.jakartaProse) an additional theme-diversity pass and an all-Low guard
// run on top, unchanged. Returns the picked clusters plus the member ids of
// STRONG-evidence duplicates to fold out of the location buckets. Pure; never
// mutates cluster members.
export function selectTopStoryClusters(
  clusters: PngReportItem[][],
  opts: { jakarta: boolean },
): { top: PngReportItem[][]; foldMemberIds: Set<string> } {
  const foldMemberIds = new Set<string>();
  if (clusters.length <= 1) {
    return { top: clusters.slice(0, 3), foldMemberIds };
  }
  const picked: PngReportItem[][] = [];
  const usedThemes = new Set<JakartaTheme>();
  const distinctStory = (c: PngReportItem[]) => !picked.some((p) => isSameTopStory(p, c));
  // (a) Greedy pick over the value-sorted clusters: story-distinct always, plus
  // Jakarta theme-distinct when applicable.
  for (const c of clusters) {
    if (picked.length >= 3) break;
    if (!distinctStory(c)) continue;
    if (opts.jakarta) {
      const theme = jakartaThemeForCategory(c[0].category);
      if (usedThemes.has(theme)) continue;
      usedThemes.add(theme);
    }
    picked.push(c);
  }
  // (b) Fill remaining slots with the next story-distinct clusters, relaxing the
  // Jakarta theme constraint (window too quiet for three distinct themes). Story
  // distinctness is NEVER relaxed — if fewer than three distinct stories exist,
  // fewer than three developments are shown rather than repeating one.
  if (picked.length < 3) {
    for (const c of clusters) {
      if (picked.length >= 3) break;
      if (picked.includes(c)) continue;
      if (!distinctStory(c)) continue;
      picked.push(c);
    }
  }
  // (c) All-Low guard, EVERY theatre: if every chosen development is
  // Low-or-below but a story-distinct Moderate-or-worse cluster exists, swap
  // the weakest chosen Low for the most serious available candidate
  // (preferring a same-theme swap so theme diversity is preserved). This used
  // to be gated to Jakarta only, which let non-Jakarta theatres (PNG, etc.)
  // lead an entire Top 3 with duplicate Low-severity infrastructure stories
  // while genuinely serious, distinct incidents sat unshown in the window —
  // in a high-risk theatre that reads as the report missing the story.
  // jakartaThemeForCategory is a total function over every PngCategory (safe
  // fallback to "crime"), so the same-theme preference works for any theatre.
  const isLowOrBelow = (c: PngReportItem[]) => c[0].severityRank <= 2;
  if (picked.length > 0 && picked.every(isLowOrBelow)) {
    const candidate = clusters
      .filter(
        (c) => !picked.includes(c) && c[0].severityRank >= 3 && distinctStory(c),
      )
      .sort((a, b) => {
        const incidentDelta = compareIncidentValueClusters(a, b);
        if (incidentDelta !== 0) return incidentDelta;
        return sortBySeverityThenRecency(a[0], b[0]);
      })[0];
    if (candidate) {
      const candTheme = jakartaThemeForCategory(candidate[0].category);
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
  // (d) Fold STRONG-evidence duplicates of any picked cluster out of the location
  // buckets, so a syndicated re-run of a Top-3 story never reappears lower down.
  for (const c of clusters) {
    if (picked.includes(c)) continue;
    if (picked.some((p) => isStrongSameTopStory(p, c))) {
      for (const it of c) foldMemberIds.add(it.id);
    }
  }
  // Display order: SEVERITY TIER FIRST, analyst value only breaks a tie within
  // the same tier — WITH a lead-only security guard. Selection (above) still
  // picks the three most operationally significant DISTINCT stories by analyst
  // value, so a Low-severity closure/evacuation story can still earn a Top-3
  // slot. But once the three are chosen, a Moderate-or-worse story must never
  // display BELOW a Low/Insignificant one just because the Low item matched
  // more keyword signals (e.g. a school closure outranking two High-severity
  // incidents). Within the same severity tier, analyst value still governs
  // order, and recency remains the final tie-break via compareClusterByValue.
  // The #1 slot must additionally be a genuine security / conflict story: an
  // incidental hazard (accidental blast, fire, natural hazard) must never LEAD
  // a security brief even when its casualty count is higher (spec §2/§4). If
  // the top slot is a non-security category, promote the best-ranked security
  // cluster to the front; the hazard keeps its place immediately below and is
  // never dropped (e.g. the deadly-but-accidental Biak wartime-ordnance blast
  // sits at #2 while the Yahukimo separatist clash leads).
  const compareClusterForDisplay = (a: PngReportItem[], b: PngReportItem[]): number => {
    const sevDelta = b[0]!.severityRank - a[0]!.severityRank;
    if (sevDelta !== 0) return sevDelta;
    return compareClusterByValue(a, b);
  };
  const ordered = picked.slice().sort(compareClusterForDisplay);
  if (ordered.length > 1 && leadSecurityTier(ordered[0]![0]) === 0) {
    const securityIdx = ordered.findIndex((c) => leadSecurityTier(c[0]) === 1);
    if (securityIdx > 0) {
      const [security] = ordered.splice(securityIdx, 1);
      ordered.unshift(security!);
    }
  }
  const top = ordered;
  return { top, foldMemberIds };
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
function clusterSameStory(
  items: PngReportItem[],
  crossProvince: boolean,
): PngReportItem[][] {
  const rows: SameStoryRow[] = items.map((it) => ({
    title: it.title,
    province: it.province ?? null,
    typeKey: incidentTypeKey(it.title, it.category),
    dateMs: (it.incidentDate ?? it.reportedDate).getTime(),
    severityRank: it.severityRank,
    category: it.category,
    displayCategory: it.displayCategory,
    // Original-language headline. `title` above is already resolved to the
    // English display_title, so a translated copy and its still-untranslated
    // sibling of the SAME story diverge and never match on `title`. The raw
    // title lets clusterSameStoryRows' additive cross-language paths merge them
    // (then readableRepresentativeIndex below leads with the English member).
    rawTitle: it.rawTitle ?? null,
  }));
  return clusterSameStoryRows(rows, { crossProvince }).map((cluster) => {
    // The cluster seed order makes cluster[0] the "highest severity, then
    // newest" member — but the newest row of a still-unfolding foreign-language
    // story is the one whose English display_title has not landed yet. Put the
    // newest ENGLISH-rendering member of the same top severity tier first so the
    // Top-3 headline never reads in Bahasa while an English version of the SAME
    // story exists; every other member is kept so syndicated re-runs stay
    // excluded from the lower sections. items[i].title already prefers the
    // English display_title (see toItem), so a still-foreign title means no
    // translation exists for that member.
    const repIdx = readableRepresentativeIndex(
      cluster,
      (i) => isLikelyNonEnglish(items[i].title),
      (i) => rows[i].severityRank,
      (i) => rows[i].dateMs,
    );
    const ordered =
      repIdx === cluster[0]
        ? cluster
        : [repIdx, ...cluster.filter((i) => i !== repIdx)];
    return ordered.map((i) => items[i]);
  });
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
  "explosive remnants of war / accidental explosion": "wartime-ordnance explosions",
  "environmental / haze": "haze and environmental incidents",
  "power / utilities": "power and utility disruption",
  "telecoms / connectivity": "telecoms and connectivity disruption",
  "government stability": "governance and political developments",
  "other security": "other security incidents",
};
function categoryPhrase(label: string): string {
  const k = label.toLowerCase();
  return CATEGORY_PHRASE[k] ?? k.replace(/\s*\/\s*/g, " and ");
}

// British-style short date for prose ("2 Jul 2026"). Kept deterministic (no
// locale/timezone drift) so headless-PDF and screen renders match byte-for-byte.
function formatBriefDate(d: Date): string {
  return formatDate(d, "d MMM yyyy");
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
  // PNG-only: drop low-value development / promotional wire copy so every
  // narrative surface (Top 3, Executive Summary, BLUF, Outlook, watchlist,
  // location sections) leads with genuine security reporting rather than
  // development PR. Inert for every other theatre (flag unset → byte-identical).
  // Never lets the filter empty a non-empty window, which would falsely trip the
  // "no fresh reporting" branch below.
  const applyWireFilter = (items: PngReportItem[]): PngReportItem[] => {
    // Promoted from PNG-only to EVERY theatre (opt-out): the filter is
    // conservative (drops only low-value promotional/development wire copy and
    // vetoes any crime, fire or hazard item), so all six briefs lead with
    // genuine security reporting. A theatre can still opt out by setting
    // filterDevelopmentWire: false explicitly.
    if (config.filterDevelopmentWire === false) return items;
    const kept = items.filter((it) => !isDevelopmentWireItem(it));
    return kept.length > 0 ? kept : items;
  };
  // Drop retrospective / anniversary reflection pieces from EVERY narrative
  // surface (Top 3, Executive Summary, BLUF, Outlook, location sections). A
  // look-back article is never a current development; removal-only, applied to
  // all theatres regardless of the wire opt-out, and never empties a non-empty
  // window (which would falsely trip the "no fresh reporting" branch below).
  const applyRetrospectiveFilter = (items: PngReportItem[]): PngReportItem[] => {
    const kept = items.filter((it) => !isRetrospectiveItem(it));
    return kept.length > 0 ? kept : items;
  };
  // Deduped-but-unfiltered window, kept so the syndication (dedup-strength)
  // signal below measures collapse only — never conflating the wire filter with
  // syndication.
  // Previous window starts a further 7 days back; when no windowStart is
  // supplied both stay undefined so occurredOutOfWindow is universally false.
  const prevWindowStart =
    args.windowStart != null ? subDays(args.windowStart, 7) : undefined;
  const dedupedWindowItems = dedupeByTitle(
    windowIncidents.map((i) => toItem(i, config, args.windowStart)),
  );
  const windowItems = applyRetrospectiveFilter(applyWireFilter(dedupedWindowItems));
  // Prior 7-day window, deduped the same way, for the week-on-week delta. Empty
  // when the caller supplies none (delta degrades to a "limited history" note).
  const previousWindowItems = applyRetrospectiveFilter(
    applyWireFilter(
      dedupeByTitle(
        (previousWindowIncidents ?? []).map((i) => toItem(i, config, prevWindowStart)),
      ),
    ),
  );
  // Distinguish "no previous window supplied at all" (week-on-week comparison
  // impossible — never assert a trend) from "previous window supplied but quiet"
  // (a valid comparison against a calm prior week).
  const hasPreviousWindow = previousWindowIncidents !== undefined;

  // --- Shared country-engine narrative (owner brief §14–23, §30, §33, §36) --
  // The SAME engine the api-server owner routes use. It re-derives canonical
  // events from the window items, then composes every analytical section as
  // controlled, banned-phrase-free, count-free prose. This is the AUTHORITATIVE
  // source of the section TEXT below — the old uncontrolled generators are
  // overridden with it (no silent fallback: excluded/held events never reach a
  // rendered section, map, count or Top-3). Prior-period events (the preceding
  // window of equal length) enable trend wording (§16); absent → trends barred.
  const engineSlug = config.engineSlug ?? config.countryName;
  const engineResult: EngineResult = runCountryEngine(windowItems, engineSlug);
  const priorEngineResult: EngineResult | null = hasPreviousWindow
    ? runCountryEngine(previousWindowItems, engineSlug)
    : null;
  const engineNarrative: CountryNarrative = buildCountryNarrative(
    engineResult.included,
    {
      countryName: config.countryName,
      priorPeriodEvents: priorEngineResult ? priorEngineResult.included : null,
      windowStart: args.windowStart ? args.windowStart.toISOString() : null,
      coverageUnconfirmed: args.coverageUnconfirmed ?? false,
    },
  );
  // Credible map points for INCLUDED events only (§23). Never Unknown /
  // Country-only / foreign / excluded / held.
  const mapPoints: MapPoint[] = toMapPoints(engineResult.included);

  // Trend / severity AGGREGATES read the in-window subset only: a row REPORTED
  // this period but whose own event date fell before the window (occurredOutOfWindow)
  // must not inflate this week's volume or worst-severity picture. Such rows are
  // still shown in the cards + Top 3 (with both dates). GUARD: if every window
  // row is out-of-window the aggregates would go empty and falsely read as "no
  // fresh reporting", so fall back to the full set (windowItems.length === 0 stays
  // the sole genuine-empty gate below). Inert for theatres without windowStart
  // (occurredOutOfWindow is universally false → aggregateItems === windowItems).
  const inWindow = windowItems.filter((it) => !it.occurredOutOfWindow);
  const aggregateItems = inWindow.length > 0 ? inWindow : windowItems;
  const prevInWindow = previousWindowItems.filter((it) => !it.occurredOutOfWindow);
  const prevAggregateItems = prevInWindow.length > 0 ? prevInWindow : previousWindowItems;

  // Shared week-on-week signals (qualitative — counts never reach the prose).
  const curWorstRank = aggregateItems.reduce((m, it) => Math.max(m, it.severityRank), 0);
  const prevWorstRank = prevAggregateItems.reduce((m, it) => Math.max(m, it.severityRank), 0);
  const curWorstLabel = SEV_LABEL[Object.keys(SEV_RANK).find((k) => SEV_RANK[k] === curWorstRank) ?? ""] ?? "";
  const prevWorstLabel = SEV_LABEL[Object.keys(SEV_RANK).find((k) => SEV_RANK[k] === prevWorstRank) ?? ""] ?? "";
  const topCats = topLabels(aggregateItems, (it) => it.category, 3).map((c) => c.toLowerCase());
  // Natural-prose forms of the same categories. Raw bucket labels read as word
  // salad in a sentence, so every narrative section uses these instead.
  const topCatPhrases = topCats.map(categoryPhrase);
  const topProvs = topLabels(aggregateItems.filter((it) => it.province), (it) => it.province as string, 3);
  const prevTopProv = topLabels(prevAggregateItems.filter((it) => it.province), (it) => it.province as string, 1)[0] ?? null;
  const prevTopCat = (topLabels(prevAggregateItems, (it) => it.category, 1)[0] ?? "").toLowerCase() || null;


  // Volume trajectory bucket: "up" / "down" / "level" (>=2-incident swing to
  // register as a move; otherwise level), and "nohistory" when the prior week
  // has no comparable reporting.
  const volumeTrend: "up" | "down" | "level" | "nohistory" = !hasPreviousWindow
    ? "nohistory"
    : aggregateItems.length - prevAggregateItems.length >= 2
      ? "up"
      : prevAggregateItems.length - aggregateItems.length >= 2
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
  const storyClusters = clusterSameStory(windowItems, config.crossProvinceDedup ?? false);
  // Rank by ANALYST VALUE (casualties, evacuation, a major fire, transport or
  // road disruption, a security deployment, protest disruption, regulatory
  // action with business impact, commercial proximity) rather than by the bare
  // worst severity rating, so the three developments shown are the ones a client
  // would actually act on. Severity-then-recency only breaks value ties.
  storyClusters.sort(compareClusterByValue);
  const topSelection = selectTopStoryClusters(storyClusters, {
    jakarta: config.jakartaProse ?? false,
  });
  const topClusters = topSelection.top;
  let topThree = topClusters.map((c) => c[0]);
  const topThreeMemberIds = new Set(topClusters.flatMap((c) => c.map((it) => it.id)));
  // Fold STRONG-evidence syndication duplicates of a Top-3 story out of the
  // location buckets so one real-world event never appears both in Top 3 and
  // lower down (weak-evidence duplicates stay in the buckets, shown once).
  for (const id of topSelection.foldMemberIds) topThreeMemberIds.add(id);
  // Analyst Top-3 curation (pin/remove). A pinned incident joins the section
  // (and leaves the Incident Details buckets); a section-excluded automatic
  // pick drops from Top 3 AND releases its whole story cluster back to the
  // buckets so the incident still appears lower down rather than vanishing.
  const top3Curation = args.top3Curation;
  if (top3Curation && ((top3Curation.pinnedIds?.length ?? 0) > 0 || (top3Curation.excludedIds?.length ?? 0) > 0)) {
    // (Free-text customItems are prepended LAST, once the selection is final —
    // see the withCustomTop3 calls below — so they never affect member ids.)
    const excludedTopIds = new Set((top3Curation.excludedIds ?? []).map(String));
    for (const cluster of topClusters) {
      if (excludedTopIds.has(String(cluster[0].id))) {
        for (const member of cluster) topThreeMemberIds.delete(member.id);
      }
    }
    topThree = applyTopThreeCuration(topThree, windowItems, {
      top3PinnedIds: top3Curation.pinnedIds,
      top3ExcludedIds: top3Curation.excludedIds,
    });
    for (const it of topThree) topThreeMemberIds.add(it.id);
  }
  // Collapse same-story SYNDICATION among the remaining (non-Top-3) records so a
  // single real-world event never appears as two Incident Details cards
  // (reviewer: "two entries covering the same Sambio massacre arrests"). The
  // windowItems set ran only EXACT title dedup, so non-exact copies survived — a
  // massacre and the arrests over it, or the same bust reworded across outlets.
  // clusterSameStory folds each cluster to ONE representative (English-preferred,
  // highest severity, then newest); crossProvince follows the theatre config so
  // multi-city briefs (Jakarta / Indonesia) never merge distinct cities.
  const nonTopItems = windowItems.filter((it) => !topThreeMemberIds.has(it.id));
  const bucketableItems = clusterSameStory(
    nonTopItems,
    config.crossProvinceDedup ?? false,
  ).map((cluster) => cluster[0]);
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

  // --- Assessed themes (shared lead for the whole brief) --------------------
  // The Incident Details section and Key Developments lead with two-to-three
  // ASSESSED themes (selected by assessed value, count-free). Compute them here,
  // AHEAD of the Executive Summary and BLUF, so those top-of-report paragraphs
  // open by naming the SAME themes — every brief then reads consistently from
  // the first line down. Empty window → no themes → no lead sentence (honest
  // silence, never a fabricated theme).
  // --- Executive summary -----------------------------------------------------
  // Legacy deterministic generator deleted (owner: "no old path remains"). The
  // engine narrative block below is the SOLE author of this section text.
  let executiveSummary = "";

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
  // Legacy deterministic outlook generator deleted — the engine narrative block
  // below is the sole author of the Outlook prose.
  let outlook = "";

  // --- Reported upcoming activity (advance warning) --------------------------
  // Forward-looking protest signals extracted via the shared upcomingSignals
  // authority — the SAME rows the live Protests monitor surfaces. Fed from the
  // 30-day source set so the authority's own 7-day announcement window applies
  // (never a fabricated event date). Gated to Indonesia; every other theatre
  // gets [] so its render is byte-identical. Detection reads the translated
  // displayTitle when present so English keyword cues fire on Bahasa headlines.
  const upcomingSignals: UpcomingSignalRow[] = config.showUpcomingSignals
    ? buildUpcomingSignalRows(
        (args.thirtyDay ?? []).map((i) => ({
          title: i.displayTitle ?? i.title,
          summary: i.summary ?? null,
          country: config.countryName,
          occurredAt: i.occurredAt,
          sourceUrl: (i.resolvedUrl ?? i.sourceUrl ?? null) || null,
        })),
      )
    : [];

  const leadCat = topCats[0] ?? "security-relevant activity";
  const leadCatPhrase = topCatPhrases[0] ?? "security incidents";

  // --- BLUF (Bottom Line Up Front) ------------------------------------------
  // Legacy deterministic BLUF generator deleted — the engine narrative block
  // below is the sole author of the BLUF prose.
  let bluf = "";

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
      prevAggregateItems.filter((it) => it.province),
      (it) => it.province as string,
      3,
    );
    const wentQuiet = prevProvs.filter((p) => !aggregateItems.some((it) => it.province === p));
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
  // Legacy generator deleted — the engine narrative block below is the sole
  // author (grouped from the approved engine menu, §20).
  let recommendedActions: RecommendedActionGroup[] = [];

  // --- Polestar View ----------------------------------------------------------
  // Legacy builder deleted — the engine narrative block below is the sole
  // author of the Polestar View prose.
  let polestarView = "";
  // Jakarta carries a separate consolidated tactical payload; the generic
  // section overrides remain available to the other structured theatres.
  let incidentThemesOverride: { key: string; heading: string; paragraph: string }[] | undefined;
  let operationalImpactOverride: string[] | undefined;
  let jakartaTacticalBrief: JakartaTacticalBrief | undefined;
  // The Polestar View closes the brief and must never straddle a page break
  // in the DOM-rasterised PDF (owner feedback) — keep it together everywhere.
  let keepPolestarTogether = true;

  // --- Operating-risk prose variant (Indonesia / Jakarta only) ---------------
  // Override the BLUF, Executive Summary, Priorities This Week and Polestar View
  // with the business-language operating-risk builders. Scoped behind the config
  // flag, so the PNG / West Papua path above is left byte-identical. Categories
  // use the display-mapped labels (it.displayCategory) here.
  if (config.proseVariant === "operating-risk") {
    // Legacy operating-risk BLUF / Executive-Summary generators deleted — the
    // engine narrative block below authors those sections. Only the rendered
    // Priorities-This-Week list (businessImpact) is still built here.
    const empty = windowItems.length === 0;
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

  // --- Jakarta analyst-brief overrides ---------------------------------------
  // Replace the generic operating-risk sections with Jakarta-specific,
  // operationally-framed prose. Gated behind config.jakartaProse (set ONLY on
  // JAKARTA_REPORT_CONFIG) so Indonesia / PNG / West Papua are untouched. Pure,
  // deterministic, count-free, present-theme-gated (no fabrication). Runs AFTER
  // the operating-risk + polestar blocks so it has the final say on the sections
  // it owns.
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
      previousWindowItems,
      hasBaseline: hasPreviousWindow,
      coverageUnconfirmed: args.coverageUnconfirmed ?? false,
    });
    // NOTE: the Jakarta BLUF / Executive Summary / Outlook / Polestar builders
    // are no longer consumed — the engine narrative block below is the sole
    // author of those sections for every theatre, Jakarta included.
    businessImpact = jakarta.tactical.recommendedActions;
    topThree = jakarta.topThree;
    jakartaTacticalBrief = jakarta.tactical;
  }

  // --- Reporting Confidence --------------------------------------------------
  let reportingConfidence: ReportingConfidence;
  if (windowItems.length === 0) {
    reportingConfidence = {
      level: "Low",
      rationale: args.coverageUnconfirmed
        ? "Collection coverage could not be confirmed this period, so current conditions are Not Assessed; this assessment rests on standing context only."
        : "No fresh open-source reporting was identified this period, so this assessment rests on standing context rather than current signals.",
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
    const distinctShare = rawWindowCount > 0 ? dedupedWindowItems.length / rawWindowCount : 1;
    const heavilySyndicated = rawWindowCount > dedupedWindowItems.length && distinctShare <= 0.6;

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
  // Lead the rendered Incident Details section with the assessed themes drawn
  // from the REMAINING incidents (those not promoted into the Top 3), so every
  // theatre reads as two-to-three assessed themes rather than a flat per-category
  // list. Jakarta keeps its own tactical-brief themes (set above); every other
  // theatre (PNG, West Papua, Indonesia, Thailand, Philippines) gets the shared
  // assessed synthesis here.
  // Gate the assessed-theme override on the same meaningfulness threshold the
  // fallback theme builder applies: when the only leftover reporting is a lone,
  // lower-severity incident that clears no meaningful theme, leave the override
  // undefined so both consumers fall through to the honest "did not warrant
  // separate detail" empty-note (no-fabrication) rather than manufacturing a
  // theme paragraph from an immaterial break-in.
  if (
    !incidentThemesOverride &&
    buildCountryIncidentThemes(incidentDetailsItems).length > 0
  ) {
    incidentThemesOverride = buildAssessedThemeGroups(
      incidentDetailsItems,
      previousWindowItems,
      { hasBaseline: hasPreviousWindow },
    );
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
        ? "Further casualty-bearing or higher-severity violence close to staffed premises"
        : "Any move to casualty-bearing or higher-severity incidents",
    );
    escalationIndicators.push(
      escLeadLocs.length
        ? `Spread of incidents beyond ${joinList(escLeadLocs)} into new districts`
        : "A spread of incidents into new districts, or a single dominant centre emerging",
    );
    // Owner rule: only indicators tied to this period's actual themes — the
    // generic standing-volatility clause (elections, anniversaries, student
    // mobilisation …) is NOT data-grounded and must not appear here.
  }

  // --- Apply the engine narrative as the AUTHORITATIVE section TEXT (§36) ----
  // The old uncontrolled generators above are overridden here; nothing silently
  // falls back to them. Sparse periods (§27) leave the analytical sections empty
  // so PngCountryReportBody omits them rather than padding with filler.
  let gate: QualityGateResult;
  let gateReport: QualityGateReport;
  {
    const n = engineNarrative;
    if (n.isSparse) {
      // §27 — reporting was limited: the short-report text is the only prose;
      // every analytical section is emptied so the renderer skips it.
      bluf = n.shortReport ?? config.emptyLocationFallback;
      executiveSummary = "";
      outlook = "";
      polestarView = "";
      topThree = [];
      operationalImpactOverride = [];
      recommendedActions = [];
      incidentThemesOverride = [];
    } else {
      bluf = n.bluf;
      executiveSummary = n.currentSituation;
      outlook = n.outlook;
      polestarView = n.polestarView;
      // Top-3 SELECTION comes from the engine; reorder the already-built
      // PngReportItem cards to match (engine eventId === PngReportItem.id) so the
      // card render keeps working while the choice is the engine's. Any engine
      // top event without a matching card is dropped (never fabricated).
      const cardById = new Map(windowItems.map((it) => [it.id, it]));
      const engineTop = n.topThree
        .map((td) => {
          const card = cardById.get(td.eventId);
          if (!card) return undefined;
          // Carry the engine's assessed "what this means" sentence onto the
          // card body so the Top-3 tiles read as analysis, not headlines. The
          // sentence is evidence-linked in the engine (confirmed effect,
          // assessed relevance, or a category-derived implication); when the
          // engine has nothing to say the card keeps its deterministic line.
          return td.businessSentence
            ? { ...card, businessImpact: td.businessSentence }
            : card;
        })
        .filter((it): it is PngReportItem => Boolean(it));
      // If the engine's representative ids do not line up with the card ids (a
      // clustering divergence), keep the previously selected Top-3 rather than
      // showing nothing — but never widen beyond the engine's three.
      topThree = engineTop.length > 0 ? engineTop : topThree.slice(0, n.topThree.length);
      // Re-apply the analyst Top-3 curation AFTER the engine replaces the
      // selection, so pins/removals survive the engine path too (the engine
      // never sees the curation). Pool is the full window card set.
      if (top3Curation) {
        topThree = applyTopThreeCuration(topThree, windowItems, {
          top3PinnedIds: top3Curation.pinnedIds,
          top3ExcludedIds: top3Curation.excludedIds,
        });
      }
      // Operational Impact — per-category engine text (only event-linked, §19).
      operationalImpactOverride =
        n.operationalImpact.length > 0
          ? n.operationalImpact.map((op) => op.text)
          : [];
      // Recommended Actions — grouped from the approved engine menu (§20).
      const recByGroup = new Map<string, string[]>();
      for (const rec of n.recommendations) {
        const arr = recByGroup.get(rec.group) ?? [];
        arr.push(rec.text);
        recByGroup.set(rec.group, arr);
      }
      recommendedActions = [...recByGroup.entries()].map(([heading, actions]) => ({
        key: heading.toLowerCase().replace(/\s+/g, "-"),
        heading,
        actions,
      }));
    }
    // §33 fail-closed gate — re-validate the finished report against the
    // canonical dataset. Attached to the dataset; the page blocks the PDF when
    // a critical check fails.
    gateReport = {
      events: engineResult.events,
      included: engineResult.included,
      narrative: n,
      mapPoints,
      sectionWordCounts: n.sectionWordCounts,
      hasPriorData: priorEngineResult != null,
      // Physical-country integrity check (§33 DATA) must compare against the
      // ENGINE's canonical country name for this slug, not the display label:
      // "West Papua" (display) runs under engine country "Papua", and "Jakarta"
      // (city display) runs under "Indonesia". Comparing against the display
      // label would flag every valid included event as foreign and fail-close
      // the gate for those theatres. Display names stay UI-only.
      countryName: getCountryEngineConfig(engineSlug).countryName,
      // Re-run the same locality predicate used by the source-row selection as
      // a fail-closed backstop. Canonical `city` is resolved from that source
      // location signal; all country reports leave localityScope undefined.
      ...(engineSlug === "jakarta"
        ? {
            localityScope: {
              label: "Jakarta",
              // The canonical eventTitle can be a merged/translated title that
              // no longer carries a Jakarta token even though the underlying
              // SOURCE row passed isJakartaScoped on its raw fields (every row
              // fed to the jakarta engine already did — CountryReport.tsx /
              // countryReportData.ts select on raw title+summary+location). So
              // check the canonical fields first, then fall back to the source
              // row's raw fields before failing the event out of scope.
              isInScope: (e: CanonicalEvent) => {
                if (
                  isJakartaScoped(
                    e.eventTitle,
                    e.eventSummary,
                    e.district ?? e.city ?? e.provinceOrState,
                  )
                ) {
                  return true;
                }
                const src = windowItems.find((it) => String(it.id) === String(e.eventId));
                return src
                  ? isJakartaScoped(
                      src.rawTitle?.trim() || src.title,
                      src.summary,
                      src.location ?? src.province,
                    )
                  : false;
              },
            },
          }
        : {}),
      reportingWindow: args.windowStart
        ? {
            start: args.windowStart.toISOString(),
            end: (() => {
              const end = new Date(args.windowStart!.getTime());
              end.setDate(end.getDate() + 7);
              return end.toISOString();
            })(),
          }
        : null,
    };
    gate = runQualityGate(gateReport);
  }

  return {
    periodLabel,
    bluf,
    executiveSummary,
    escalationIndicators,
    jakartaTacticalBrief,
    whatChanged,
    topThree: (() => {
      // Reconcile the FINAL Top-3 selection (initial pick, engine replacement,
      // or analyst curation) with Incident Details: one incident must never
      // render both as a Top-3 tile and as a location-bucket card. The bucket
      // arrays were built from the INITIAL selection's member ids, so prune
      // them against the final selection here (removal-only, never re-adds).
      // Analyst free-text developments join HERE, once the selection is final
      // for BOTH the deterministic and engine paths (and even a sparse week —
      // an analyst-entered item still renders). Additive and display-only.
      topThree = withCustomTop3(topThree, top3Curation);
      const finalTopIds = new Set(topThree.map((it) => it.id));
      const prune = (arr: PngReportItem[]) => {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (finalTopIds.has(arr[i].id)) arr.splice(i, 1);
        }
      };
      for (const b of buckets) {
        prune(b.items);
        if (b.strands) {
          prune(b.strands.confirmed);
          prune(b.strands.police);
          prune(b.strands.trend);
        }
      }
      prune(otherNational);
      prune(incidentDetailsItems);
      return topThree;
    })(),
    buckets,
    otherNational,
    otherNationalHadFeatured,
    otherNationalTruncated,
    otherBucketLabel: config.otherBucketLabel,
    emptyLocationFallback: args.coverageUnconfirmed
      ? `${config.emptyLocationFallback} Collection coverage for the period could not be confirmed, so this absence is Not Assessed rather than confirmed quiet.`
      : config.emptyLocationFallback,
    featuredAboveNote: PNG_FEATURED_ABOVE_NOTE,
    businessImpactEmptyNote: config.businessImpactEmptyNote,
    businessImpact,
    locationWatchlist,
    outlook,
    upcomingSignals,
    topIncidentsHeading: config.topIncidentsHeading,
    proseVariant: config.proseVariant,
    polestarView,
    reportingConfidence,
    windowItems,
    incidentDetailsItems,
    showPerIncidentCards: config.perIncidentDetailCards ?? false,
    recommendedActions,
    incidentThemesOverride,
    briefProseOverrides: args.briefProseOverrides ?? null,
    operationalImpactOverride,
    keepPolestarTogether,
    engineResult,
    engineNarrative,
    mapPoints,
    gate,
    gateReport,
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

export function buildThailandReportDataset(args: BuildArgs): PngReportDataset {
  return buildStructuredReportDataset(args, THAILAND_REPORT_CONFIG);
}

export function buildPhilippinesReportDataset(args: BuildArgs): PngReportDataset {
  return buildStructuredReportDataset(args, PHILIPPINES_REPORT_CONFIG);
}

export function buildJakartaReportDataset(args: BuildArgs): PngReportDataset {
  return buildStructuredReportDataset(args, JAKARTA_REPORT_CONFIG);
}
