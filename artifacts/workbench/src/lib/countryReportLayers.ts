// Multi-window incident layering for the Country Report builder.
//
// Country reports must not depend only on incidents in the 7-day
// reporting window. This module partitions a wider (90-day) incident
// pull into three labelled buckets and computes a watchlist
// breakdown so the report can read against named geographies even
// when the current window is thin.

import { parseISO, subDays } from "date-fns";
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

