// Multi-window incident layering for the Country Report builder.
//
// Country reports must not depend only on incidents in the 7-day
// reporting window. This module partitions a wider (90-day) incident
// pull into three labelled buckets and computes a watchlist
// breakdown so the report can read against named geographies even
// when the current window is thin.

import { format, parseISO, subDays } from "date-fns";
import { isCountryRelevant } from "./topicRelevance";
import { resolveReportWindow } from "./reportWindow";
import type { CountryFastFactsIncident } from "./countryFastFacts";
import type { CountryBaseline } from "./countryBaselines";

const SEV_RANK: Record<string, number> = {
  insignificant: 1, low: 2, moderate: 3, high: 4, extreme: 5,
};
const SEV_LABEL: Record<string, string> = {
  insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme",
};

export interface CountryLayerBuckets {
  current: CountryFastFactsIncident[];   // 7-day reporting window
  thirtyDay: CountryFastFactsIncident[]; // last 30 days (inclusive of current)
  ninetyDay: CountryFastFactsIncident[]; // last 90 days (inclusive of current)
  windowLabel: string;                   // human-readable current window
}

export interface WatchlistRow {
  label: string;
  note: string;
  currentCount: number;
  thirtyDayCount: number;
  ninetyDayCount: number;
  worstSeverity: string;                 // highest severity seen across the 90-day pull
  worstSeverityLabel: string;
  latestOccurredAt: string | null;       // ISO string of newest record across 90-day pull
}

/**
 * Partition a pre-fetched incident set (typically the last 90 days)
 * into current / 30 / 90 day buckets. The input is filtered to
 * country-relevant records first so live blogs and obituaries do not
 * inflate the lookback counts.
 */
export function buildCountryLayers(
  incidents: CountryFastFactsIncident[],
  issueDate: string,
): CountryLayerBuckets {
  const relevant = incidents.filter((i) =>
    isCountryRelevant({
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    }),
  );

  const win = resolveReportWindow("country", issueDate);
  const end = win.end;
  const currentStart = win.start.getTime();
  const thirtyStart = subDays(end, 29).getTime();
  const ninetyStart = subDays(end, 89).getTime();
  const endMs = end.getTime();

  const current: CountryFastFactsIncident[] = [];
  const thirtyDay: CountryFastFactsIncident[] = [];
  const ninetyDay: CountryFastFactsIncident[] = [];

  for (const r of relevant) {
    let ms: number;
    try {
      const d = parseISO(r.occurredAt);
      if (isNaN(d.getTime())) continue;
      ms = d.getTime();
    } catch {
      continue;
    }
    if (ms > endMs) continue;
    if (ms >= ninetyStart) ninetyDay.push(r);
    if (ms >= thirtyStart) thirtyDay.push(r);
    if (ms >= currentStart) current.push(r);
  }

  return { current, thirtyDay, ninetyDay, windowLabel: win.label };
}

export type CountryWindowBasis = 7 | 30 | 90;

export interface ActiveCountryWindow {
  basisDays: CountryWindowBasis;
  // Client-facing label for the active reporting basis.
  basisLabel: string; // "7-day" | "30-day" | "90-day context"
  // Bare basis name without the "context" suffix, for inline prose.
  basisShort: string; // "7-day" | "30-day" | "90-day"
  incidents: CountryFastFactsIncident[];
  // True when the 7-day window was empty and the report fell back to a wider window.
  expanded: boolean;
  periodLabel: string; // "1 March 2026 - 30 May 2026"
  periodShortLabel: string; // "1 Mar - 30 May 2026"
}

function countryRangeLabels(end: Date, days: number): { label: string; shortLabel: string } {
  const start = subDays(end, days - 1);
  return {
    label: `${format(start, "d MMMM yyyy")} - ${format(end, "d MMMM yyyy")}`,
    shortLabel: `${format(start, "d MMM")} - ${format(end, "d MMM yyyy")}`,
  };
}

/**
 * The single active reporting window for a country report.
 *
 * Country reports are WEEKLY by contract. The 7-day window is ALWAYS the
 * headline — even when it holds zero records. A zero-record week is a
 * data-quality signal (see {@link computeCountryCoverageStatus}), NOT
 * evidence that nothing happened, so older 30/90-day records are never
 * promoted into the weekly headline. The 30/90-day buckets are surfaced
 * separately as clearly labelled CONTEXT (see {@link summariseLookback}
 * and the context sections in the report).
 *
 * The chosen window drives Fast Facts, the map, charts, the related-incidents
 * table AND the drafted prose, so the whole report reads against one window.
 */
export function resolveActiveCountryWindow(
  layers: CountryLayerBuckets,
  issueDate: string,
): ActiveCountryWindow {
  let end: Date;
  try { end = parseISO(issueDate); } catch { end = new Date(); }
  if (isNaN(end.getTime())) end = new Date();

  const { label, shortLabel } = countryRangeLabels(end, 7);
  return {
    basisDays: 7,
    basisLabel: "7-day",
    basisShort: "7-day",
    incidents: layers.current,
    // Retained for type/back-compat; the weekly window never "expands" now.
    expanded: false,
    periodLabel: label,
    periodShortLabel: shortLabel,
  };
}

/**
 * For each watchlist entry on the country baseline, count how many
 * records in each bucket matched the entry's tokens. Matching is
 * case-insensitive substring match against incident.location, with
 * a fallback to incident.title so records that name a city in the
 * headline but not the location field still count.
 */
export function buildWatchlistBreakdown(
  baseline: CountryBaseline,
  layers: CountryLayerBuckets,
): WatchlistRow[] {
  return baseline.locationWatchlist.map((entry) => {
    const tokens = entry.match.map((m) => m.toLowerCase()).filter((m) => m.length > 0);
    const match = (r: CountryFastFactsIncident): boolean => {
      const loc = (r.location ?? "").toLowerCase();
      const title = (r.title ?? "").toLowerCase();
      const summary = (r.summary ?? "").toLowerCase();
      return tokens.some((t) => loc.includes(t) || title.includes(t) || summary.includes(t));
    };
    const matched90 = layers.ninetyDay.filter(match);
    const matched30 = layers.thirtyDay.filter(match);
    const matchedNow = layers.current.filter(match);

    let worstRank = 0;
    let worstKey = "";
    let latestIso: string | null = null;
    let latestMs = -Infinity;
    for (const r of matched90) {
      const k = (r.severity ?? "").toLowerCase();
      const rank = SEV_RANK[k] ?? 0;
      if (rank > worstRank) {
        worstRank = rank;
        worstKey = k;
      }
      try {
        const ms = parseISO(r.occurredAt).getTime();
        if (!isNaN(ms) && ms > latestMs) {
          latestMs = ms;
          latestIso = r.occurredAt;
        }
      } catch {
        // skip
      }
    }

    return {
      label: entry.label,
      note: entry.note,
      currentCount: matchedNow.length,
      thirtyDayCount: matched30.length,
      ninetyDayCount: matched90.length,
      worstSeverity: worstKey,
      worstSeverityLabel: worstKey ? (SEV_LABEL[worstKey] ?? worstKey) : "—",
      latestOccurredAt: latestIso,
    };
  });
}

/**
 * Short, client-safe context line drawn from the 30 and 90-day
 * buckets. Used at the top of the "30-Day Context" / "Background
 * Operating Picture" sections. Never references internal source
 * health or coverage gaps — that information stays on the Sources
 * page and the screen-only Source Coverage block.
 */
export function summariseLookback(
  layers: CountryLayerBuckets,
  baseline: CountryBaseline | null,
  countryName: string,
): { thirtyDay: string; ninetyDay: string } {
  const name = countryName || "this country";
  const thirty = layers.thirtyDay.length;
  const ninety = layers.ninetyDay.length;
  const current = layers.current.length;

  const thirtyDelta = thirty - current;
  const ninetyDelta = ninety - thirty;

  // Client-safe wording only. Any framing around source health,
  // coverage gaps or feed staleness lives in the internal Source
  // Coverage screen-only block — never in client-facing prose.
  const baselineRef30 = "";
  const baselineRef90 = "";

  const thirtyDay =
    thirty === 0
      ? `No incidents are on file for ${name} across the rolling 30-day context window.${baselineRef30}`
      : thirty === current
        ? `The 30-day context window holds the same ${thirty} record${thirty === 1 ? "" : "s"} as the current cycle — no additional reporting beyond the live window.${baselineRef30}`
        : `Across the rolling 30-day context window ${name} carries ${thirty} record${thirty === 1 ? "" : "s"}, with ${thirtyDelta} record${thirtyDelta === 1 ? "" : "s"} sitting outside the current 7-day cycle.${baselineRef30}`;

  const ninetyDay =
    ninety === 0
      ? `No incidents are on file for ${name} across the rolling 90-day background window.${baselineRef90}`
      : ninety === thirty
        ? `The 90-day background window holds the same ${ninety} record${ninety === 1 ? "" : "s"} as the 30-day context — no older records on file.${baselineRef90}`
        : `Across the rolling 90-day background window ${name} carries ${ninety} record${ninety === 1 ? "" : "s"}, ${ninetyDelta} of which sit beyond the 30-day context. Use them to size the background operating picture rather than to direct current movement decisions.`;

  return { thirtyDay, ninetyDay };
}

// ---------------------------------------------------------------------------
// Coverage status — turns a zero-record weekly window into an explicit
// data-quality determination instead of letting it read as "nothing
// happened". Distinguishes a genuinely quiet week (feeds healthy AND
// current, simply no qualifying incident) from a coverage problem (feeds
// failing/stale, or no source attributable to the country at all).
// ---------------------------------------------------------------------------

export type CountryCoverageState = "active" | "genuine-quiet" | "coverage-problem";

/** Minimal source shape needed for the coverage determination. */
export interface CoverageSourceLike {
  topic: string;
  status: string;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
}

export interface CountryCoverageStatus {
  state: CountryCoverageState;
  /** True when a banner should render (i.e. the 7-day window is empty). */
  showBanner: boolean;
  /** Short uppercase-able heading for the banner. */
  title: string;
  /** Client-safe explanation (no raw feed names or error blobs). */
  detail: string;
}

// Statuses that, on their own, mean a feed is not delivering.
const UNHEALTHY_STATUS = new Set(["failing", "blocked", "stale", "not_configured"]);
// A feed whose last success is older than this is treated as stale even if
// its status field still reads "operational".
const FEED_STALE_DAYS = 10;
// Beyond this, a held record is too old to lend confidence to a quiet read.
const RECORD_STALE_DAYS = 14;
const DAY_MS = 86_400_000;

function msOrNull(iso: string | null | undefined): number | null {
  if (!iso) return null;
  try {
    const ms = parseISO(iso).getTime();
    return isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

/**
 * Decide whether an empty 7-day country window is a genuinely quiet week
 * or a coverage problem, using feed health + the staleness of the newest
 * record on file. Returns `state: "active"` (no banner) whenever the
 * weekly window holds records.
 */
export function computeCountryCoverageStatus(opts: {
  layers: CountryLayerBuckets;
  sources: CoverageSourceLike[];
  issueDate: string;
  countryName: string;
}): CountryCoverageStatus {
  const { layers, sources, issueDate, countryName } = opts;
  const name = countryName || "this country";

  // Weekly window has records → render normally, no coverage banner.
  if (layers.current.length > 0) {
    return { state: "active", showBanner: false, title: "", detail: "" };
  }

  let end: Date;
  try { end = parseISO(issueDate); } catch { end = new Date(); }
  if (isNaN(end.getTime())) end = new Date();
  const endMs = end.getTime();

  // Newest record we hold for this country across the 90-day pull.
  let latestMs = -Infinity;
  for (const r of layers.ninetyDay) {
    const ms = msOrNull(r.occurredAt);
    if (ms !== null && ms > latestMs) latestMs = ms;
  }
  const daysSinceLatest =
    latestMs === -Infinity ? null : Math.floor((endMs - latestMs) / DAY_MS);

  // Relevant feeds: the topics this country's recent records come from,
  // falling back to the flashpoint/protest feeds that drive country reports
  // when we hold nothing at all on file.
  const topicsPresent = new Set(
    layers.ninetyDay.map((r) => (r.topic ?? "").toLowerCase()).filter(Boolean),
  );
  const relevantTopics =
    topicsPresent.size > 0 ? topicsPresent : new Set(["flashpoint", "protests"]);
  const relevant = sources.filter((s) =>
    relevantTopics.has((s.topic ?? "").toLowerCase()),
  );

  const feedStale = (s: CoverageSourceLike): boolean => {
    const ms = msOrNull(s.lastSuccessAt);
    if (ms === null) return true;
    return endMs - ms > FEED_STALE_DAYS * DAY_MS;
  };
  const failingNow = (s: CoverageSourceLike): boolean => {
    const fail = msOrNull(s.lastFailureAt);
    if (fail === null) return false;
    const succ = msOrNull(s.lastSuccessAt);
    return succ === null ? true : fail > succ;
  };
  const unhealthy = relevant.filter(
    (s) =>
      UNHEALTHY_STATUS.has((s.status ?? "").toLowerCase()) ||
      feedStale(s) ||
      failingNow(s),
  );

  // No feed attributable to the country at all → coverage cannot be confirmed.
  if (relevant.length === 0) {
    return {
      state: "coverage-problem",
      showBanner: true,
      title: "Coverage warning",
      detail: `No active collection source is currently attributed to ${name}, so an empty week cannot be read as quiet. Treat the operating picture as unconfirmed and widen local-source coverage. The 30 and 90-day context sections below carry the standing risk pattern.`,
    };
  }

  // One or more relevant feeds are failing or stale → coverage problem.
  if (unhealthy.length > 0) {
    const n = unhealthy.length;
    const of = relevant.length;
    return {
      state: "coverage-problem",
      showBanner: true,
      title: "Coverage warning",
      detail: `${n} of ${of} collection source${of === 1 ? "" : "s"} feeding ${name} ${n === 1 ? "is" : "are"} currently failing or out of date, so the empty 7-day window reflects a coverage problem rather than confirmed quiet. The operating picture is unconfirmed; read the 30 and 90-day context sections below for the standing risk pattern.`,
    };
  }

  // Feeds report healthy, but the newest record we hold is itself stale (or we
  // hold nothing at all). Healthy-but-silent collection cannot confirm a quiet
  // week, so this is a coverage problem, not genuine quiet.
  if (daysSinceLatest === null || daysSinceLatest > RECORD_STALE_DAYS) {
    const ageClause =
      daysSinceLatest === null
        ? `no record is on file for ${name} across the 90-day window`
        : `the most recent record on file for ${name} is ${daysSinceLatest} days old`;
    return {
      state: "coverage-problem",
      showBanner: true,
      title: "Coverage warning",
      detail: `Collection sources feeding ${name} report healthy, but ${ageClause}, so the empty 7-day window cannot be confirmed as quiet. Treat the operating picture as unconfirmed; read the 30 and 90-day context sections below for the standing risk pattern.`,
    };
  }

  // Feeds report healthy and we hold a recent record, yet nothing cleared the
  // wire this week. In a high-threat operating environment an empty week is
  // NEVER asserted as calm — it is treated as a collection gap with the
  // operating picture unconfirmed. There is deliberately no "genuinely quiet"
  // outcome for a country report.
  return {
    state: "coverage-problem",
    showBanner: true,
    title: "Coverage warning",
    detail: `All collection sources feeding ${name} report healthy, but no qualifying incident cleared the wire in the 7-day window. In a high-threat operating environment an empty week is read as a collection gap, not a quiet one — the operating picture is unconfirmed. Work the standing pattern in the 30 and 90-day context sections below.`,
  };
}

