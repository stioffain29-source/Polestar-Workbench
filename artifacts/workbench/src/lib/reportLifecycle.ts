/**
 * Shared lifecycle rules for report lists.
 *
 * Reports use updatedAt as their activity signal when available. Legacy rows
 * have null updatedAt and fall back to createdAt. The stored issueDate is
 * always the date shown to analysts; list code must not substitute a live-data
 * effective date for it.
 */

export type ReportLifecycleRecord = {
  id: number;
  status?: string | null;
  issueDate?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

/** In-progress rows inactive for this long are saved history, not current work. */
export const REPORT_STALE_AFTER_DAYS = 30;

function localCalendarDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function currentReportDate(now = new Date()): string {
  return localCalendarDate(now);
}

function ymd(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return localCalendarDate(value);
  return String(value).slice(0, 10);
}

function timestamp(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

/**
 * Activity is updatedAt for edited rows and createdAt for legacy rows.
 * A report can be current even when its stored issue date is historical:
 * issueDate is report metadata, not an activity timestamp.
 */
export function reportActivityTimestamp(report: ReportLifecycleRecord): number {
  return timestamp(report.updatedAt) || timestamp(report.createdAt);
}

export function isInProgressReport(report: ReportLifecycleRecord): boolean {
  return report.status === "draft" || report.status === "review";
}

export function isCurrentReport(
  report: ReportLifecycleRecord,
  now = new Date(),
): boolean {
  return (
    isInProgressReport(report) &&
    reportActivityTimestamp(report) >=
      now.getTime() - REPORT_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
  );
}

/** Newest activity first, then stored issue date, then the immutable id. */
export function sortReportsByLifecycle<T extends ReportLifecycleRecord>(
  reports: readonly T[],
): T[] {
  return [...reports].sort((a, b) => {
    const activity = reportActivityTimestamp(b) - reportActivityTimestamp(a);
    if (activity !== 0) return activity;
    const issue = ymd(b.issueDate).localeCompare(ymd(a.issueDate));
    if (issue !== 0) return issue;
    return b.id - a.id;
  });
}

export function splitReportsByLifecycle<T extends ReportLifecycleRecord>(
  reports: readonly T[],
  now = new Date(),
): { current: T[]; older: T[]; completed: T[] } {
  const sorted = sortReportsByLifecycle(reports);
  return {
    current: sorted.filter((report) => isCurrentReport(report, now)),
    older: sorted.filter(
      (report) => isInProgressReport(report) && !isCurrentReport(report, now),
    ),
    completed: sorted.filter((report) => !isInProgressReport(report)),
  };
}
