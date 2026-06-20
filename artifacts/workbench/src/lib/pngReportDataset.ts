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

import { derivePngProvince } from "@workspace/ingest/pngExtract";
import { deriveWestPapuaProvince } from "@workspace/ingest/westPapuaExtract";

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

export interface PngDiagnostics {
  totalInWindow: number;
  bySource: Array<{ source: string; count: number }>;
  byConfidence: Array<{ confidence: string; count: number }>;
  occurredEarlierCount: number;
  watchlistGaps: string[];
  thirtyDayCount: number;
  ninetyDayCount: number;
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

export interface PngReportDataset {
  periodLabel: string;
  executiveSummary: string;
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
  outlook: string;
  diagnostics: PngDiagnostics;
  windowItems: PngReportItem[];
}

interface BuildArgs {
  windowIncidents: PngSourceIncident[];
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

function toItem(i: PngSourceIncident): PngReportItem {
  // Read the per-incident enrichment STRAIGHT from the incidents API. The
  // columns are populated server-side (ingest + backfill + onlyNull enrichment
  // pass) for every tagged row, so the client no longer recomputes them.
  // category + businessImpact are written together by the ingest rulebook, so
  // they are present or absent as a pair.
  const province = i.province ?? null;
  const category: PngCategory =
    i.category && i.businessImpact ? (i.category as PngCategory) : DEFAULT_CATEGORY;
  const impact = i.category && i.businessImpact ? i.businessImpact : DEFAULT_BUSINESS_IMPACT;
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

// Generic config-driven builder. The PNG and West Papua entry points below are
// thin wrappers that pass their theatre config.
function buildStructuredReportDataset(
  args: BuildArgs,
  config: StructuredTheatreConfig,
): PngReportDataset {
  const { windowIncidents, thirtyDay, ninetyDay, baselineWatchlist, periodLabel } = args;
  const windowItems = dedupeByTitle(windowIncidents.map(toItem));

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
    const catText = cats.length ? joinList(cats) : "security-relevant activity";
    const provText = provs.length ? ` Reporting clustered around ${joinList(provs)}.` : "";
    const sevText =
      worst && worst.severityRank >= 4
        ? ` The most serious entry reached ${worst.severityLabel.toLowerCase()} severity.`
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

  // --- Outlook (forward-looking, anchored to recurring provinces/categories) -
  let outlook: string;
  if (windowItems.length === 0) {
    outlook = config.emptyOutlook;
  } else {
    const recurringProv = topLabels(
      windowItems.filter((it) => it.province),
      (it) => it.province as string,
      2,
    );
    const recurringCat = topLabels(windowItems, (it) => it.category, 2).map((c) => c.toLowerCase());
    const provClause = recurringProv.length
      ? `${joinList(recurringProv)} remain the locations to watch`
      : "the main urban centres remain the locations to watch";
    const catClause = recurringCat.length
      ? `, with ${joinList(recurringCat)} the most likely repeat pattern`
      : "";
    const watchClause = baselineWatchlist.length
      ? ` Keep the curated location watchlist (${joinList(baselineWatchlist.slice(0, 4))}) under active review.`
      : "";
    outlook = `Looking to the week ahead, ${provClause}${catClause}. Conditions can shift quickly around ${config.outlookVolatilityClause}, so treat any single quiet week as provisional.${watchClause}`;
  }

  // --- Diagnostics (Source confidence & reporting gaps) ----------------------
  const bySourceMap = new Map<string, number>();
  for (const it of windowItems) {
    const s = it.source || "Unattributed";
    bySourceMap.set(s, (bySourceMap.get(s) ?? 0) + 1);
  }
  const bySource = Array.from(bySourceMap.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  const byConfMap = new Map<string, number>();
  for (const it of windowItems) {
    byConfMap.set(it.confidence, (byConfMap.get(it.confidence) ?? 0) + 1);
  }
  const byConfidence = Array.from(byConfMap.entries())
    .map(([confidence, count]) => ({ confidence, count }))
    .sort((a, b) => b.count - a.count);

  const coveredProvinces = new Set(windowItems.map((it) => it.province).filter(Boolean) as string[]);
  const watchlistGaps = baselineWatchlist.filter((loc) => {
    const prov = config.deriveProvince(loc, loc);
    if (prov) return !coveredProvinces.has(prov);
    return ![...coveredProvinces].some((p) => hasWord(loc, p.toLowerCase()));
  });

  const diagnostics: PngDiagnostics = {
    totalInWindow: windowItems.length,
    bySource,
    byConfidence,
    occurredEarlierCount: windowItems.filter((it) => it.occurredEarlier).length,
    watchlistGaps,
    thirtyDayCount: thirtyDay.length,
    ninetyDayCount: ninetyDay.length,
  };

  return {
    periodLabel,
    executiveSummary,
    topThree,
    buckets,
    otherNational,
    otherNationalHadFeatured,
    otherBucketLabel: config.otherBucketLabel,
    emptyLocationFallback: config.emptyLocationFallback,
    featuredAboveNote: PNG_FEATURED_ABOVE_NOTE,
    businessImpactEmptyNote: config.businessImpactEmptyNote,
    businessImpact,
    outlook,
    diagnostics,
    windowItems,
  };
}

export function buildPngReportDataset(args: BuildArgs): PngReportDataset {
  return buildStructuredReportDataset(args, PNG_REPORT_CONFIG);
}

export function buildWestPapuaReportDataset(args: BuildArgs): PngReportDataset {
  return buildStructuredReportDataset(args, WEST_PAPUA_REPORT_CONFIG);
}
