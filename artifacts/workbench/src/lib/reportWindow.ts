import { format, parseISO, subDays } from "date-fns";
import { latestRecordDate } from "./reportDataStatus";

// Central window rules for every report builder (topic reports + country reports).
// Dashboard pages, archive views, map views and the full database are NOT subject
// to these caps — only report OUTPUTS (in-app preview + PDF export).

export type Cadence = "weekly" | "monthly";

export function reportCadence(topic: string): Cadence {
  // Cargo Watch is the only monthly product; everything else is weekly.
  return topic === "cargo_watch" ? "monthly" : "weekly";
}

// Default report window.
//   weekly  → last 7 days
//   monthly → last 30 days
export function reportWindowDefaultDays(topic: string): number {
  return reportCadence(topic) === "monthly" ? 30 : 7;
}

// Hard cap. Reports must never include records older than this.
//   weekly  → 10 days
//   monthly → 35 days
export function reportWindowMaxDays(topic: string): number {
  return reportCadence(topic) === "monthly" ? 35 : 10;
}

// Related-incidents table row limits.
// Spec: every report shows 10-15 rows, newest first. Monthly products keep
// the same 15-row cap (older detail remains available in the Workbench).
export function relatedIncidentsLimit(_topic: string): { min: number; max: number } {
  return { min: 10, max: 15 };
}

export interface ReportWindow {
  start: Date;
  end: Date;
  days: number;
  cadence: Cadence;
  // Bare date range, e.g. "14 May 2026 - 23 May 2026". Callers prepend
  // their own "Reporting period: " / "REPORTING PERIOD: " prefix so the
  // label is never duplicated on the cover or in preview chrome.
  label: string;
  // "14 May - 23 May 2026"
  shortLabel: string;
}

export function resolveReportWindow(topic: string, issueDate: string): ReportWindow {
  let end: Date;
  try { end = parseISO(issueDate); } catch { end = new Date(); }
  if (isNaN(end.getTime())) end = new Date();
  const days = reportWindowDefaultDays(topic);
  // Inclusive window: a 7-day report covers the issue date and the 6 prior days,
  // so the start is `days - 1` before the end. Without this, the inclusive
  // filter below would silently widen the window to `days + 1` records.
  const start = subDays(end, days - 1);
  return {
    start, end, days,
    cadence: reportCadence(topic),
    label: `${format(start, "d MMMM yyyy")} - ${format(end, "d MMMM yyyy")}`,
    shortLabel: `${format(start, "d MMM")} - ${format(end, "d MMM yyyy")}`,
  };
}

// Option A — honest dating for topics with no live feed.
// A report's window must never extend past the latest real record for its
// data topic. A draft auto-advanced to "today" on a static/import-only topic
// (whose data stops earlier) would otherwise present an empty or stale window
// as current. Clamping the issue date down to the newest available record
// dates the report to the period its data actually covers, so the cover,
// prose, every incident table and the data-status line all describe ONE
// window. Returns `issueDate` unchanged when the topic's data is already
// current (latest record on/after the issue date) or when no records exist.
export function clampIssueDateToLatestRecord<
  T extends { occurredAt: string; topic?: string },
>(issueDate: string, incidents: T[], scopeTopic?: string): string {
  const issueStr = issueDate.slice(0, 10);
  const latest = latestRecordDate(incidents, scopeTopic);
  if (!latest) return issueStr;
  const latestStr = format(latest, "yyyy-MM-dd");
  return latestStr < issueStr ? latestStr : issueStr;
}

export function filterIncidentsToWindow<T extends { occurredAt: string; topic?: string }>(
  incidents: T[],
  topic: string,
  issueDate: string,
  opts: { byTopic?: boolean } = {},
): T[] {
  const { start, end } = resolveReportWindow(topic, issueDate);
  const startMs = start.getTime();
  const endMs = end.getTime();
  return incidents.filter((i) => {
    if (opts.byTopic && i.topic !== topic) return false;
    try {
      const d = parseISO(i.occurredAt);
      if (isNaN(d.getTime())) return false;
      const ms = d.getTime();
      return ms >= startMs && ms <= endMs;
    } catch { return false; }
  });
}
