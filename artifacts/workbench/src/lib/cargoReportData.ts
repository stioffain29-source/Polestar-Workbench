// Shared Cargo Watch report extras — the SINGLE source for the report's
// USD cargo-loss Fast Fact, the "most stolen commodity" Fast Fact, and the
// weekly incident-trend series. Both the on-screen preview (ReportPreview.tsx)
// and the PDF exporter rasterise the same chart components so the screen and
// the PDF can never disagree.
//
// Honesty rules:
//  - USD totals are source-stated only (no FX, no estimates) — see parseUsdLoss.
//  - The commodity card never reads "Other" — mostStolenCommodity collapses
//    that to "General Cargo".

import { startOfWeek, addWeeks, parseISO, isValid, format } from "date-fns";
import {
  classifyCategory,
  mostStolenCommodity,
  totalUsdLoss,
  type CargoIncidentLike,
} from "./cargoAnalysis";

export interface CargoReportIncident extends CargoIncidentLike {
  occurredAt: string;
}

export interface CargoTrendPoint {
  /** ISO date of the week-start (Monday). */
  date: string;
  count: number;
}

export interface CargoReportExtras {
  usd: { total: number; count: number };
  /** Never "Other"; null only when there are no in-window records. */
  commodity: string | null;
  commodityCount: number;
  trend: CargoTrendPoint[];
}

// Bucket in-window cargo incidents into contiguous weekly bins (Monday-start)
// from the first to the last incident week. Empty intervening weeks are kept
// at zero so the trend line/bars read as a true time series, not a sparse plot.
function buildWeeklyTrend(incidents: CargoReportIncident[]): CargoTrendPoint[] {
  const dates = incidents
    .map((i) => parseISO(i.occurredAt))
    .filter((d) => isValid(d));
  if (dates.length === 0) return [];

  const times = dates.map((d) => d.getTime());
  const first = startOfWeek(new Date(Math.min(...times)), { weekStartsOn: 1 });
  const last = startOfWeek(new Date(Math.max(...times)), { weekStartsOn: 1 });

  const buckets = new Map<string, number>();
  const keys: string[] = [];
  let cur = first;
  // Cap at 26 weeks as a defensive guard against a stray far-future date.
  while (cur.getTime() <= last.getTime() && keys.length < 26) {
    const key = format(cur, "yyyy-MM-dd");
    buckets.set(key, 0);
    keys.push(key);
    cur = addWeeks(cur, 1);
  }

  for (const d of dates) {
    const key = format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return keys.map((k) => ({ date: k, count: buckets.get(k) ?? 0 }));
}

export function buildCargoReportExtras(
  incidents: CargoReportIncident[],
): CargoReportExtras {
  const usd = totalUsdLoss(incidents);
  const commodity = mostStolenCommodity(incidents);
  let commodityCount = 0;
  if (commodity) {
    for (const i of incidents) {
      if (classifyCategory(i) === commodity) commodityCount += 1;
    }
  }
  const trend = buildWeeklyTrend(incidents);
  return { usd, commodity, commodityCount, trend };
}

// Shared formatting so the preview and PDF print identical card values.
export function formatCargoUsd(usd: { total: number; count: number }): string {
  if (usd.count === 0) return "Not disclosed";
  return `$${Math.round(usd.total).toLocaleString("en-US")}`;
}

export function cargoUsdNote(usd: { total: number; count: number }): string {
  if (usd.count === 0) return "No source-stated USD figures";
  return `${usd.count} source-stated record${usd.count === 1 ? "" : "s"}`;
}

export function cargoCommodityNote(extras: CargoReportExtras): string | undefined {
  if (!extras.commodity) return undefined;
  if (extras.commodityCount === 0) return undefined;
  return `${extras.commodityCount} record${extras.commodityCount === 1 ? "" : "s"}`;
}

// Round the trend count axis up to a clean integer maximum with whole-number
// ticks. Shared by the SVG preview chart and the PDF chart so the two agree.
export function niceCargoCountMax(maxCount: number): number {
  if (maxCount <= 4) return Math.max(1, maxCount);
  return Math.ceil(maxCount / 4) * 4;
}
