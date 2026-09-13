import type { ProtestEvent, ProtestEventsResponse } from "@workspace/api-client-react";

export const PROTEST_FORECAST_HEADING = "PROTEST FORECAST — NEXT 7 DAYS";
export const PROTEST_WATCHLIST_HEADING =
  "WATCHLIST — POSSIBLE MOBILISATION";
export const PROTEST_EMPTY_SENTENCE =
  "No significant planned protest activity identified for the next seven days from currently available credible sources.";

export interface ProtestScheduleModel {
  /** Confirmed and Planned rows, in event-date order. */
  schedule: readonly ProtestEvent[];
  /** Possible rows, in event-date order. */
  watchlist: readonly ProtestEvent[];
  /** A completed empty search is distinct from a query that has not returned. */
  searchCompleted: boolean;
  empty: boolean;
}

const STATUS_ORDER: Record<string, number> = {
  Confirmed: 0,
  Planned: 1,
  Possible: 2,
};

function eventTime(row: ProtestEvent): number {
  if (!row.eventDate) return Number.MAX_SAFE_INTEGER;
  const time = Date.parse(row.eventDate);
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function chronological(a: ProtestEvent, b: ProtestEvent): number {
  return (
    eventTime(a) - eventTime(b) ||
    (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99) ||
    a.country.localeCompare(b.country) ||
    (a.city ?? "").localeCompare(b.city ?? "") ||
    a.id - b.id
  );
}

function analystOverrideKey(row: ProtestEvent): string {
  return [
    row.eventDate?.slice(0, 10) ?? "",
    row.country.trim().toLowerCase(),
    row.city?.trim().toLowerCase() ?? "",
    row.eventType?.trim().toLowerCase() ?? "",
  ].join("|");
}

function applyAnalystOverrides(rows: readonly ProtestEvent[]): ProtestEvent[] {
  const analystKeys = new Set(
    rows
      .filter((row) => row.sourceName !== "google_news_protest_schedule")
      .map(analystOverrideKey),
  );
  return rows.filter(
    (row) =>
      row.sourceName !== "google_news_protest_schedule" ||
      !analystKeys.has(analystOverrideKey(row)),
  );
}

/**
 * Builds the only forward-looking schedule representation consumed by the
 * editor, preview and PDF. Cancelled/postponed rows are filtered defensively
 * even though the API excludes them, so stale caches cannot publish them.
 */
export function buildProtestScheduleModel(
  response: ProtestEventsResponse | null | undefined,
): ProtestScheduleModel {
  const searchCompleted =
    response?.searchCompletedAt != null &&
    Number.isFinite(Date.parse(response.searchCompletedAt));
  const confirmedPlanned = applyAnalystOverrides(
    (response?.confirmedPlanned ?? []).filter(
      (row) => row.status === "Confirmed" || row.status === "Planned",
    ),
  );
  const possible = applyAnalystOverrides(
    (response?.possible ?? []).filter((row) => row.status === "Possible"),
  );
  const schedule = [...confirmedPlanned].sort(chronological);
  const watchlist = [...possible].sort(chronological);
  return {
    schedule,
    watchlist,
    searchCompleted,
    empty: searchCompleted && schedule.length === 0 && watchlist.length === 0,
  };
}

export function protestScheduleRows(
  model: ProtestScheduleModel,
): readonly ProtestEvent[] {
  return [...model.schedule, ...model.watchlist];
}

/** Conservative Watch Next lines derived only from schedule context. */
export function buildProtestScheduleWatchNext(
  model: ProtestScheduleModel,
): string {
  const lines = model.schedule.slice(0, 4).map((row) => {
    const place = [row.city, row.country].filter(Boolean).join(", ");
    const date = row.eventDate
      ? new Intl.DateTimeFormat("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(row.eventDate))
      : "the next seven days";
    return `Monitor ${row.status.toLowerCase()} protest activity${place ? ` in ${place}` : ""} on ${date}; verify route and access conditions close to the event.`;
  });
  lines.push(
    ...model.watchlist.slice(0, 4).map((row) => {
      const place = [row.city, row.country].filter(Boolean).join(", ");
      return `Possible mobilisation${place ? ` in ${place}` : ""} may affect access; monitor for confirmation before changing plans.`;
    }),
  );
  return lines.join("\n");
}
