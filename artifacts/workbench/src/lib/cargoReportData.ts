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

import { startOfWeek, addWeeks, addDays, parseISO, isValid, format } from "date-fns";
import {
  classifyCategory,
  mostStolenCommodity,
  totalUsdLoss,
  type CargoIncidentLike,
} from "./cargoAnalysis";
import { resolveReportWindow, type ReportWindow } from "./reportWindow";

export interface CargoReportIncident extends CargoIncidentLike {
  occurredAt: string;
}

export interface CargoTrendPoint {
  /** ISO date of the week-start (Monday). */
  date: string;
  count: number;
  /** True when the labelled week is clipped to the report window (partial week). */
  partial?: boolean;
  /** Display range clipped to the report window, e.g. "12 Jul–13 Jul*". */
  label?: string;
  /** Chart value — raw count for full weeks, incidents-per-day for partial weeks. */
  displayCount?: number;
}

export interface CargoReportExtras {
  usd: { total: number; count: number };
  /** Never "Other"; null only when there are no in-window records. */
  commodity: string | null;
  commodityCount: number;
  trend: CargoTrendPoint[];
}

function weekEffectiveDays(
  point: Pick<CargoTrendPoint, "date" | "partial">,
  win: ReportWindow,
): number {
  if (!point.partial) return 7;
  const weekStart = parseISO(point.date);
  const weekEnd = addDays(weekStart, 6);
  const start = weekStart.getTime() < win.start.getTime() ? win.start : weekStart;
  const end = weekEnd.getTime() > win.end.getTime() ? win.end : weekEnd;
  const days =
    Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, Math.min(7, days));
}

/** Attach chart display values so partial weeks plot incidents-per-day, not raw totals. */
export function attachTrendDisplayCounts(
  trend: CargoTrendPoint[],
  issueDate?: string,
): CargoTrendPoint[] {
  if (!issueDate) return trend.map((p) => ({ ...p, displayCount: p.count }));
  const win = resolveReportWindow("cargo_watch", issueDate);
  const hasPartial = trend.some((p) => p.partial);
  return trend.map((p) => {
    const days = weekEffectiveDays(p, win);
    if (hasPartial) return { ...p, displayCount: p.count / days };
    return { ...p, displayCount: p.count };
  });
}

// Bucket in-window cargo incidents into contiguous weekly bins (Monday-start)
// clipped to the Cargo Watch report window so the trend caption cannot claim
// days before the reporting period starts. Empty intervening weeks stay at
// zero. Partial first/last weeks are flagged.
function buildWeeklyTrend(
  incidents: CargoReportIncident[],
  issueDate?: string,
): CargoTrendPoint[] {
  const dates = incidents
    .map((i) => parseISO(i.occurredAt))
    .filter((d) => isValid(d));
  if (dates.length === 0) return [];

  const times = dates.map((d) => d.getTime());
  let first = startOfWeek(new Date(Math.min(...times)), { weekStartsOn: 1 });
  let last = startOfWeek(new Date(Math.max(...times)), { weekStartsOn: 1 });
  let winStart: Date | null = null;
  let winEnd: Date | null = null;
  if (issueDate) {
    const win = resolveReportWindow("cargo_watch", issueDate);
    winStart = win.start;
    winEnd = win.end;
    const winFirst = startOfWeek(win.start, { weekStartsOn: 1 });
    const winLast = startOfWeek(win.end, { weekStartsOn: 1 });
    if (first.getTime() < winFirst.getTime()) first = winFirst;
    if (last.getTime() > winLast.getTime()) last = winLast;
  }

  const buckets = new Map<string, number>();
  const keys: string[] = [];
  let cur = first;
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

  return keys.map((k) => {
    const weekStart = parseISO(k);
    const weekEnd = addDays(weekStart, 6);
    let partial = false;
    let label = format(weekStart, "dd MMM");
    if (winStart && winEnd) {
      const clippedStart =
        weekStart.getTime() < winStart.getTime() ? winStart : weekStart;
      const clippedEnd =
        weekEnd.getTime() > winEnd.getTime() ? winEnd : weekEnd;
      partial =
        weekStart.getTime() < winStart.getTime() ||
        weekEnd.getTime() > winEnd.getTime();
      const a = format(clippedStart, "dd MMM");
      const b = format(clippedEnd, "dd MMM");
      label = a === b ? a : `${a}\u2013${b}`;
      if (partial) label = `${label}*`;
    }
    return {
      date: k,
      count: buckets.get(k) ?? 0,
      partial,
      label,
    };
  });
}

export function buildCargoReportExtras(
  incidents: CargoReportIncident[],
  issueDate?: string,
): CargoReportExtras {
  const usd = totalUsdLoss(incidents);
  const commodity = mostStolenCommodity(incidents);
  let commodityCount = 0;
  if (commodity) {
    for (const i of incidents) {
      if (classifyCategory(i) === commodity) commodityCount += 1;
    }
  }
  const trend = attachTrendDisplayCounts(buildWeeklyTrend(incidents, issueDate), issueDate);
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
