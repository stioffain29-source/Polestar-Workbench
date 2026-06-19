// PNG (Papua New Guinea) structured country-brief dataset builder.
//
// Builds the nine-section Papua New Guinea security brief from the live
// incident feed. PNG only: this module is invoked exclusively for the PNG
// country report, so its broadened scope and derived attributes never leak
// into any other country report or the topic monitors.
//
// Per-item extraction (province / category / business impact / occurred-vs-
// reported date) is IMPORTED from the canonical server-side rulebook in
// `lib/ingest/src/pngExtract.ts` via its pure `@workspace/ingest/pngExtract`
// subpath (no server deps), so the rulebook lives in ONE place and the client
// can no longer drift from ingest. Server-extracted columns from the incidents
// API are authoritative; when they are null (non-PNG or not-yet-backfilled
// rows, e.g. prod before a republish + ingest) the report falls back to the
// SAME shared rulebook, so it renders identical output regardless of whether
// the nullable DB columns have been backfilled yet.

import {
  extractPngItem,
  derivePngProvince,
  derivePngIncidentDate,
} from "@workspace/ingest/pngExtract";

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
  // Server-extracted PNG enrichment (see lib/ingest/src/pngExtract.ts), surfaced
  // through the incidents API. When present these are authoritative and the
  // client derivation below is skipped; when null (non-PNG / not-yet-backfilled
  // rows, e.g. prod before a republish+ingest) the client falls back to the
  // mirrored rulebook so the report renders identically either way.
  province?: string | null;
  category?: string | null;
  businessImpact?: string | null;
  incidentDate?: string | null;
}

// Generic word-boundary helper — used only by the watchlist-gap check further
// down. Province / category / occurred-date derivation all come from the shared
// @workspace/ingest/pngExtract rulebook imported above (no duplicated copy).
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
    const looksLikeMasthead = /\b(news|times|post|herald|guardian|reuters|bloomberg|daily|tribune|gazette|journal|chronicle|observer|telegraph|press|wire|report|today|mail|express|standard|abc|bbc|cnn|afp|rnz|pngfm|loop|bulletin|review|insider|monitor|dispatch|courier|sun|star|globe|record|digest|radio|tv|online|media|emtv|national)\b/i.test(tail);
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

// Empty-location fallback — EXACT wording required by the brief spec.
export const PNG_EMPTY_LOCATION_FALLBACK =
  "No fresh publicly reported protest, theft, robbery or major crime incident identified in open sources for this location during the reporting period.";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface PngReportItem {
  id: string;
  title: string;
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

export interface PngReportDataset {
  periodLabel: string;
  executiveSummary: string;
  topThree: PngReportItem[];
  ncd: PngReportItem[];
  morobe: PngReportItem[];
  westernHighlands: PngReportItem[];
  otherNational: PngReportItem[];
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

function toItem(i: PngSourceIncident): PngReportItem {
  const text = `${i.title ?? ""} ${i.summary ?? ""}`;
  // Prefer the server-extracted enrichment from the incidents API; fall back to
  // the SAME shared @workspace/ingest/pngExtract rulebook only when the API value
  // is absent (non-PNG or not-yet-backfilled rows). province / category /
  // businessImpact / incidentDate are all additive and nullable, so this is a
  // clean prefer-server-else-derive against one canonical rulebook.
  const derived = extractPngItem(i.title ?? "", i.summary ?? "", i.location ?? null);
  const province = i.province ?? derived.province;
  let category: PngCategory;
  let impact: string;
  if (i.category && i.businessImpact) {
    // category + businessImpact are written together by the ingest rulebook, so
    // they are present or absent as a pair; trust them as a unit when present.
    category = i.category as PngCategory;
    impact = i.businessImpact;
  } else {
    category = derived.category;
    impact = derived.businessImpact;
  }
  const sev = (i.severity ?? "").toLowerCase();
  const reportedDate = new Date(i.occurredAt);
  const incidentDate = i.incidentDate
    ? new Date(i.incidentDate)
    : derivePngIncidentDate(text, reportedDate);
  const title =
    i.displayTitle && i.displayTitle.trim() ? i.displayTitle.trim() : cleanTitle(i.title, i.source);
  return {
    id: String(i.id ?? `${i.title}-${i.occurredAt}`),
    title,
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

export function buildPngReportDataset(args: BuildArgs): PngReportDataset {
  const { windowIncidents, thirtyDay, ninetyDay, baselineWatchlist, periodLabel } = args;
  const windowItems = dedupeByTitle(windowIncidents.map(toItem));

  const ncd = windowItems
    .filter((it) => it.province === "National Capital District")
    .sort(sortBySeverityThenRecency);
  const morobe = windowItems.filter((it) => it.province === "Morobe").sort(sortBySeverityThenRecency);
  const westernHighlands = windowItems
    .filter((it) => it.province === "Western Highlands")
    .sort(sortBySeverityThenRecency);
  const regionalProvinces = new Set(["National Capital District", "Morobe", "Western Highlands"]);
  const otherNational = windowItems
    .filter((it) => !it.province || !regionalProvinces.has(it.province))
    .sort(sortBySeverityThenRecency);

  const topThree = [...windowItems].sort(sortBySeverityThenRecency).slice(0, 3);

  // --- Executive summary (deterministic, event-led, no parenthetical counts) -
  let executiveSummary: string;
  if (windowItems.length === 0) {
    executiveSummary = `${PNG_EMPTY_LOCATION_FALLBACK} The standing operating picture for Papua New Guinea carries over from the preceding period; treat the absence of fresh reporting as a coverage signal, not as an improvement in conditions.`;
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
    const p1 = `Open-source reporting for Papua New Guinea this period was led by ${catText}.${provText}${sevText}`;
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
    outlook = `With no fresh reporting this period, expect the standing risk pattern to persist: opportunistic crime in urban centres, periodic tribal and communal flare-ups in the Highlands, and intermittent road, power and connectivity disruption. Maintain current movement and continuity precautions and re-test them as fresh reporting comes through.`;
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
    outlook = `Looking to the week ahead, ${provClause}${catClause}. Conditions can shift quickly around paydays, court rulings, election cycles and tribal-payback events, so treat any single quiet week as provisional.${watchClause}`;
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
    const prov = derivePngProvince(loc, loc);
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
    ncd,
    morobe,
    westernHighlands,
    otherNational,
    businessImpact,
    outlook,
    diagnostics,
    windowItems,
  };
}
