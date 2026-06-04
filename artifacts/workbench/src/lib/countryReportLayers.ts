// Multi-window incident layering for the Country Report builder.
//
// Country reports must not depend only on incidents in the 7-day
// reporting window. This module partitions a wider (90-day) incident
// pull into three labelled buckets and computes a watchlist
// breakdown so the report can read against named geographies even
// when the current window is thin.

import { endOfDay, format, parseISO, subDays } from "date-fns";
import { isCountryRelevant } from "./topicRelevance";
import { acceptedCountryTokens } from "./countryMatch";
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
 * Filter a country-matched incident set down to the records that are
 * relevant to a SECURITY country aggregate (drops economic/PR/sports
 * noise via `isCountryRelevant`). This is the single relevance gate for
 * the country report — used both to build the lookback layers AND to
 * date the report, so a newer IRRELEVANT record (e.g. a fuel-subsidy
 * story) can never drag the issue date onto an otherwise empty window.
 */
export function filterCountryRelevant<T extends CountryFastFactsIncident>(
  incidents: T[],
): T[] {
  return incidents.filter((i) =>
    isCountryRelevant({
      topic: i.topic,
      title: i.title,
      summary: i.summary ?? null,
      source: i.source ?? null,
      sourceUrl: i.sourceUrl ?? null,
      location: i.location ?? null,
    }),
  );
}

const CASUALTY_WORD = /^(killed|kills|dead|deaths?|wounded|injured|fatalit(?:y|ies)|massacred?|slain)$/;

// Build the distinctive "event signature" trigrams of a headline: contiguous
// 3-word phrases carrying BOTH a digit and a casualty word ("15 killed in",
// "after 23 dead"). Two records sharing such a phrase are describing the SAME
// concrete event. We require a digit (not a bare casualty word) so a generic
// "two killed in clash" can never collide with an unrelated incident — this is
// anchor-only logic, but precision still protects against back-dating a report.
function eventSignatureTrigrams(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/\s-\s[^-]*$/, "") // drop trailing " - Source" attribution
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) {
    const tri = [words[i], words[i + 1], words[i + 2]];
    const hasDigit = tri.some((w) => /\d/.test(w));
    const hasCasualty = tri.some((w) => CASUALTY_WORD.test(w));
    if (hasDigit && hasCasualty) out.add(tri.join(" "));
  }
  return out;
}

/**
 * Drop SYNDICATED REHASHES: aggregator items that re-report a much older
 * event with a fresh publication date (e.g. a 2026 wire repeating the
 * January 2024 "15 killed in riots" state-of-emergency). A record is a
 * rehash when an OLDER record (>=30 days earlier) shares one of its
 * distinctive event-signature trigrams.
 *
 * This is used ONLY to pick the report's date anchor — never to hide a
 * record from display — so a false positive can at worst date the report
 * one cluster earlier, never erase a genuine incident. Re-dating a stale
 * event as this week's news would be dishonest; that is what this prevents.
 */
export function dropSyndicatedRehashes<
  T extends { title: string; occurredAt: string },
>(incidents: T[]): T[] {
  const enriched = incidents.map((i) => ({
    i,
    ms: Number.isNaN(Date.parse(i.occurredAt)) ? 0 : Date.parse(i.occurredAt),
    sig: eventSignatureTrigrams(i.title),
  }));
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  return enriched
    .filter((rec) => {
      if (rec.sig.size === 0) return true;
      for (const other of enriched) {
        if (other === rec) continue;
        if (other.ms > rec.ms - THIRTY_DAYS) continue; // must be >=30d older
        for (const phrase of rec.sig) {
          if (other.sig.has(phrase)) return false; // rehash of an older event
        }
      }
      return true;
    })
    .map((rec) => rec.i);
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
  const relevant = filterCountryRelevant(incidents);

  const win = resolveReportWindow("country", issueDate);
  const end = win.end;
  const currentStart = win.start.getTime();
  const thirtyStart = subDays(end, 29).getTime();
  const ninetyStart = subDays(end, 89).getTime();
  // The issue date marks the END of the window, so records ON that calendar
  // day (stored with a real wall-clock time, e.g. 08:00) must be included.
  // Using the bare midnight boundary excludes them — which silently drops the
  // very record the issue date was clamped to, emptying an otherwise-live week.
  const endMs = endOfDay(end).getTime();

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
 * Country reports are a WEEKLY brief, so the headline basis is FIXED to the
 * rolling 7-day window — it never widens to 30/90-day. The user was explicit
 * that "30 days is too long for a rolling weekly report", so a 30/90-day window
 * must never be promoted to the active reporting basis. When the 7-day window
 * has records they drive the headline; when it is EMPTY the headline stays
 * honestly empty and the coverage banner ({@link computeCountryCoverageStatus})
 * fires — the 30/90-day buckets are shown ONLY as clearly-labelled context /
 * background sections, never as the current week.
 *
 * The 7-day window drives Fast Facts, the map, charts, the related-incidents
 * table AND the drafted prose, so the whole headline reads against one window.
 */
export function resolveActiveCountryWindow(
  layers: CountryLayerBuckets,
  issueDate: string,
): ActiveCountryWindow {
  let end: Date;
  try { end = parseISO(issueDate); } catch { end = new Date(); }
  if (isNaN(end.getTime())) end = new Date();

  // Headline basis is ALWAYS the rolling 7-day window — never widened. A quiet
  // week renders an honest empty headline (the coverage banner explains it) and
  // the 30/90-day buckets stay as labelled context sections; they are never
  // promoted to the active basis.
  const basisDays: CountryWindowBasis = 7;
  const { label, shortLabel } = countryRangeLabels(end, basisDays);
  return {
    basisDays,
    basisLabel: "7-day",
    basisShort: "7-day",
    incidents: layers.current,
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
      : current === 0
        ? `All ${thirty} record${thirty === 1 ? "" : "s"} in the 30-day context window landed earlier in the month, with none in the most recent week — read this as background standing volume rather than current activity.${baselineRef30}`
        : thirty === current
          ? `All ${thirty} record${thirty === 1 ? "" : "s"} in the 30-day context window landed in the most recent week.${baselineRef30}`
          : `Of the ${thirty} record${thirty === 1 ? "" : "s"} in the 30-day context window, ${current} landed in the most recent week and ${thirtyDelta} earlier in the month.${baselineRef30}`;

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
// happened". An empty week always resolves to a coverage problem, with the
// detail line explaining which way: feeds failing/stale, no source
// attributable to the country, healthy-but-silent collection, or no
// qualifying incident clearing healthy feeds. There is no "quiet" outcome.
// ---------------------------------------------------------------------------

// A country report's empty week is either "active" (window has records, no
// banner) or "coverage-problem". There is deliberately NO "genuine-quiet"
// outcome: in a high-threat operating environment an empty week is always a
// collection signal, never a confirmation of calm.
export type CountryCoverageState = "active" | "coverage-problem";

/** Minimal source shape needed for the coverage determination. */
export interface CoverageSourceLike {
  name: string;
  topic: string;
  status: string;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
}

// Regional / wire feeds that materially cover a country but whose source
// NAME carries no country token (so name-token matching alone misses them).
// Keyed by the country-group key used in countryMatch.ts; each entry is
// matched case-insensitively as a substring of the source name. This is what
// scopes a country's coverage health to the feeds that actually serve it —
// specialist, non-country feeds (e.g. the cargo-theft trackers) are
// intentionally absent here and so can never trip a country's coverage
// warning. Keep these names in sync with the catalogued sources table.
const COUNTRY_COVERAGE_WIRES: Record<string, string[]> = {
  "papua new guinea": ["rnz pacific", "abc news australia", "benar news"],
  papua: ["rnz pacific", "abc news australia", "benar news", "jubi"],
};

/**
 * True when a catalogued source materially covers the named country: either
 * its name carries one of the country's accepted tokens (e.g.
 * "Post-Courier (PNG)", "Jubi.id (West Papua)", "Google News — Nepal") or it
 * is one of the regional wires explicitly mapped to that country. Coverage
 * health is scoped to these feeds ONLY — never to every feed that happens to
 * share the report's record topic.
 */
function sourceCoversCountry(sourceName: string, countryName: string): boolean {
  const hay = (sourceName ?? "").toLowerCase();
  if (!hay) return false;
  for (const t of acceptedCountryTokens(countryName)) {
    if (t && hay.includes(t)) return true;
  }
  const key = (countryName ?? "").trim().toLowerCase();
  return (COUNTRY_COVERAGE_WIRES[key] ?? []).some((w) => hay.includes(w));
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

// A feed is "unhealthy" if its status says so, its last success is older than
// FEED_STALE_DAYS, or its most recent attempt was a failure. Module-level so
// the empty-week determination and the internal separate-signals summary
// apply the SAME definition of a working feed.
function isFeedUnhealthy(s: CoverageSourceLike, endMs: number): boolean {
  if (UNHEALTHY_STATUS.has((s.status ?? "").toLowerCase())) return true;
  const succ = msOrNull(s.lastSuccessAt);
  if (succ === null) return true;
  if (endMs - succ > FEED_STALE_DAYS * DAY_MS) return true;
  const fail = msOrNull(s.lastFailureAt);
  return fail !== null && fail > succ;
}

/**
 * Classify an empty WEEKLY (7-day) country window as a coverage problem, using
 * the health of the country's own collection sources + the staleness of the
 * newest record on file to pick the explanation. The country report is a weekly
 * brief whose headline basis is fixed to the 7-day window, so the banner is
 * keyed to weekly emptiness — NOT 30-day emptiness. Returns `state: "active"`
 * (no banner) whenever the 7-day headline window holds records.
 */
export function computeCountryCoverageStatus(opts: {
  layers: CountryLayerBuckets;
  sources: CoverageSourceLike[];
  issueDate: string;
  countryName: string;
}): CountryCoverageStatus {
  const { layers, sources, issueDate, countryName } = opts;
  const name = countryName || "this country";

  // The 7-day (weekly) headline window has records → render normally, no banner.
  // A zero-record weekly window is NEVER asserted as quiet, so when the week is
  // empty we always fall through to a coverage-problem explanation below.
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

  // Relevant feeds: the catalogued sources that actually cover THIS country,
  // matched by source NAME (country token or mapped regional wire). Scoping
  // by record topic was the defect — it pulled in every flashpoint/cargo feed
  // (and a hard-coded fallback set), so one failing, unrelated feed could trip
  // every country's coverage warning. Name scoping confines the determination
  // to the feeds that genuinely serve the country in question.
  const relevant = sources.filter((s) => sourceCoversCountry(s.name, name));

  const unhealthy = relevant.filter((s) => isFeedUnhealthy(s, endMs));

  // No feed attributable to the country at all → coverage cannot be confirmed.
  if (relevant.length === 0) {
    return {
      state: "coverage-problem",
      showBanner: true,
      title: "Coverage warning",
      detail: `No active collection source is currently attributed to ${name}, so an empty 7-day window cannot be read as quiet. Treat the operating picture as unconfirmed and widen local-source coverage. The 30 / 90-day context sections below carry the standing risk pattern.`,
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
      detail: `${n} of ${of} collection source${of === 1 ? "" : "s"} feeding ${name} ${n === 1 ? "is" : "are"} currently failing or out of date, so the empty 7-day window reflects a coverage problem rather than confirmed quiet. The operating picture is unconfirmed; read the 30 / 90-day context sections below for the standing risk pattern.`,
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
      detail: `Collection sources feeding ${name} report healthy, but ${ageClause}, so the empty 7-day window cannot be confirmed as quiet. Treat the operating picture as unconfirmed; read the 30 / 90-day context sections below for the standing risk pattern.`,
    };
  }

  // Feeds report healthy and we hold a recent record, yet nothing cleared the
  // wire across the 7-day week. In a high-threat operating environment an empty
  // week is NEVER asserted as calm — it is treated as a collection gap with the
  // operating picture unconfirmed. There is deliberately no "genuinely quiet"
  // outcome for a country report.
  return {
    state: "coverage-problem",
    showBanner: true,
    title: "Coverage warning",
    detail: `All collection sources feeding ${name} report healthy, but no qualifying incident cleared the wire in the 7-day window. In a high-threat operating environment an empty week is read as a collection gap, not a quiet one — the operating picture is unconfirmed. Work the standing pattern in the 30 / 90-day context sections below.`,
  };
}

export interface SourceHealthSignal {
  total: number;
  healthy: number;
  unhealthy: number;
  unhealthyNames: string[];
}

// Topics whose feeds make up the news-wire basis a country report draws on.
const COUNTRY_TOPIC_FEEDS = new Set(["flashpoint", "protests"]);
// Topics whose feeds are specialist trackers, NOT part of country coverage.
const SPECIALIST_TOPIC_FEEDS = new Set(["cargo_watch"]);

function summariseHealth(
  feeds: CoverageSourceLike[],
  endMs: number,
): SourceHealthSignal {
  const unhealthy = feeds.filter((s) => isFeedUnhealthy(s, endMs));
  return {
    total: feeds.length,
    healthy: feeds.length - unhealthy.length,
    unhealthy: unhealthy.length,
    unhealthyNames: unhealthy.map((s) => s.name),
  };
}

/**
 * Report country-coverage health, topic-feed health, and specialist-feed health
 * as three SEPARATE signals so the analyst can tell them apart. A down
 * specialist feed (e.g. a cargo-theft tracker) shows only in `specialist`, never
 * inflating the country signal. Screen-only — for the internal Workbench strip.
 *
 * The three sets may overlap (a flashpoint wire that also covers the country
 * appears in both `country` and `topic`); this is intentional — they are
 * independent diagnostics, never summed into one metric, so do NOT dedupe them.
 */
export function computeCountrySourceSignals(opts: {
  sources: CoverageSourceLike[];
  issueDate: string;
  countryName: string;
}): { country: SourceHealthSignal; topic: SourceHealthSignal; specialist: SourceHealthSignal } {
  const { sources, issueDate, countryName } = opts;
  let end: Date;
  try { end = parseISO(issueDate); } catch { end = new Date(); }
  if (isNaN(end.getTime())) end = new Date();
  const endMs = end.getTime();

  const country = summariseHealth(
    sources.filter((s) => sourceCoversCountry(s.name, countryName || "this country")),
    endMs,
  );
  const topic = summariseHealth(
    sources.filter((s) => COUNTRY_TOPIC_FEEDS.has((s.topic ?? "").toLowerCase())),
    endMs,
  );
  const specialist = summariseHealth(
    sources.filter((s) => SPECIALIST_TOPIC_FEEDS.has((s.topic ?? "").toLowerCase())),
    endMs,
  );
  return { country, topic, specialist };
}

