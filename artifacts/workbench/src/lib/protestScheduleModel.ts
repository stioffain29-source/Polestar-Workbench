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

const WORD_STOPLIST = new Set([
  "a",
  "an",
  "and",
  "at",
  "be",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "will",
  "planned",
  "plan",
  "protest",
  "protests",
  "protesting",
  "rally",
  "rallies",
  "march",
  "marches",
  "demonstration",
  "demonstrations",
  "mobilisation",
  "mobilization",
  "event",
  "scheduled",
  "schedule",
]);

const OPERATIONAL_WORDS =
  /\b(?:blockade|blocked|closure|closures|disruption|disruptive|roadblock|roadblocks|shutdown|strike|strikes|walkout|walkouts|mass|national|route|march|marches|convoy|sit[- ]?in|occupation|airport|port|station|terminal|border|highway|motorway)\b/i;
const HIGH_IMPACT_WORDS =
  /\b(?:extreme|critical|riot|riots|blockade|shutdown|nationwide|national strike|general strike|mass protest)\b/i;
const MULTI_STAGE_WORDS =
  /\b(?:from .{2,100}\bto\b|between .{2,100}\band\b|throughout|over (?:the )?(?:next|several|\d+)\s+days?|multi[- ]?day|day\s+\d+|stage\s+\d+|daily)\b/i;
const EVENT_IDENTITY_GENERIC = new Set([
  "activity", "arrive", "arriving", "begin", "begins", "city", "event",
  "government", "main", "march", "marches", "mobilisation", "mobilization",
  "movement", "multi", "news", "planned", "protest", "protests", "rally",
  "route", "scheduled", "source", "stage", "staged", "strike", "supporter",
  "supporters", "toward", "towards",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "sept",
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function semanticWords(value: string | null | undefined): Set<string> {
  return new Set(
    normalizeText(value)
      .split(/\s+/u)
      .filter((word) => word.length > 2 && !WORD_STOPLIST.has(word) && !/^\d+$/u.test(word)),
  );
}

function hasWordOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = semanticWords(a);
  const right = semanticWords(b);
  for (const word of left) if (right.has(word)) return true;
  return false;
}

function eventIdentityWords(row: ProtestEvent): Set<string> {
  const out = semanticWords(rowText(row));
  for (const generic of EVENT_IDENTITY_GENERIC) out.delete(generic);
  for (const geographic of [
    ...semanticWords(row.country),
    ...semanticWords(row.city),
  ]) {
    out.delete(geographic);
  }
  return out;
}

function sharedEventIdentityCount(a: ProtestEvent, b: ProtestEvent): number {
  const left = eventIdentityWords(a);
  const right = eventIdentityWords(b);
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared;
}

function stableFieldMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = semanticWords(a);
  const right = semanticWords(b);
  if (left.size === 0 || right.size === 0) return false;
  if (normalizeText(a) === normalizeText(b)) return true;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const shorter = Math.min(left.size, right.size);
  return shared >= 2 && shared === shorter;
}

function rowText(row: ProtestEvent): string {
  return [
    row.eventType,
    row.issue,
    row.organiser,
    row.description,
    row.sourceTitle,
  ]
    .filter(Boolean)
    .join(" ");
}

function routeText(row: ProtestEvent): string {
  const text = rowText(row);
  const route =
    text.match(/\b(?:from|between)\s+(.{2,100}?)\s+(?:to|and|via|through)\s+(.{2,100}?)(?:[.,;]|$)/iu) ??
    text.match(/\bvia\s+(.{2,100}?)(?:[.,;]|$)/iu);
  return normalizeText(route ? route.slice(1).join(" ") : "");
}

function dateDay(row: ProtestEvent): string {
  const raw = row.eventDate?.trim() ?? "";
  if (!raw) return "";
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return raw.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function dateDistance(a: ProtestEvent, b: ProtestEvent): number | null {
  const left = eventTime(a);
  const right = eventTime(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left === Number.MAX_SAFE_INTEGER || right === Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return Math.abs(left - right) / (24 * 60 * 60 * 1000);
}

function sameTime(a: ProtestEvent, b: ProtestEvent): boolean {
  const left = normalizeText(a.startTime);
  const right = normalizeText(b.startTime);
  return !!left && !!right && left === right;
}

/**
 * Schedule feeds often contain one notice for the launch, another for the
 * route, and a third for the same mobilisation's later stage.  Do not use a
 * broad date/city key here: two unrelated rallies in the same city and on the
 * same day are operationally different events.  A cluster needs stable
 * semantic evidence in addition to the date (or an explicit multi-stage
 * signal when dates differ).
 */
function sameUnderlyingMobilisation(a: ProtestEvent, b: ProtestEvent): boolean {
  if (a.dedupKey && a.dedupKey === b.dedupKey) return true;
  if (normalizeText(a.country) !== normalizeText(b.country)) return false;

  const leftDay = dateDay(a);
  const rightDay = dateDay(b);
  const sameDay = !!leftDay && leftDay === rightDay;
  const distance = dateDistance(a, b);
  const routeA = routeText(a);
  const routeB = routeText(b);
  const sameRoute = !!routeA && !!routeB && stableFieldMatch(routeA, routeB);
  const sameCity =
    !!a.city &&
    !!b.city &&
    normalizeText(a.city) === normalizeText(b.city);
  const sameVenue =
    !!a.venue &&
    !!b.venue &&
    stableFieldMatch(a.venue, b.venue);
  const sameOrganiser =
    !!a.organiser && !!b.organiser && hasWordOverlap(a.organiser, b.organiser);
  const samePurpose = !!a.issue && !!b.issue && hasWordOverlap(a.issue, b.issue);
  const sameActivity =
    (!!a.eventType && !!b.eventType && hasWordOverlap(a.eventType, b.eventType)) ||
    hasWordOverlap(a.description, b.description);
  const sharedIdentity = sharedEventIdentityCount(a, b);
  const multiStage =
    MULTI_STAGE_WORDS.test(rowText(a)) || MULTI_STAGE_WORDS.test(rowText(b));

  // Different named venues are a strong signal that same-day events are
  // separate.  A shared route is the exception: route notices commonly name
  // a start point in one row and a destination in another.
  if (sameDay) {
    if (
      a.startTime &&
      b.startTime &&
      !sameTime(a, b) &&
      !sameRoute &&
      !multiStage
    ) {
      return false;
    }
    if (a.venue && b.venue && !sameVenue && !sameRoute) return false;
    if (sameCity && (sameVenue || sameRoute) && (sameOrganiser || samePurpose || sameActivity)) {
      return true;
    }
    // When no venue is supplied, require two independent semantic fields.
    if (sameCity && !a.venue && !b.venue && sameOrganiser && (samePurpose || sameActivity)) {
      return true;
    }
    // A publisher may omit the venue even when another notice names it.  In
    // that case the organiser, purpose and activity must all agree; this is
    // still stricter than a city/date key and does not merge two named sites.
    if (
      sameCity &&
      (!a.venue || !b.venue) &&
      sameActivity &&
      (
        (sameOrganiser && samePurpose) ||
        sharedIdentity >= 1
      )
    ) {
      return true;
    }
    return sameRoute && (sameOrganiser || samePurpose) && (sameActivity || samePurpose);
  }

  // A date discrepancy is only tolerated for a clearly multi-stage/range
  // notice with a stable route or organiser + purpose.  This prevents two
  // ordinary same-week rallies from being silently collapsed.
  if (
    distance != null &&
    distance <= 7 &&
    multiStage &&
    (
      (
        (sameRoute || (sameVenue && sameCity)) &&
        sameOrganiser &&
        (samePurpose || sameActivity)
      ) ||
      (
        sameCity &&
        sharedIdentity >= 2 &&
        sameActivity
      )
    )
  ) {
    return true;
  }
  return false;
}

function analystOverrideKey(row: ProtestEvent): string {
  return [
    dateDay(row),
    normalizeText(row.country),
    normalizeText(row.city),
    normalizeText(row.eventType),
  ].join("|");
}

function applyAnalystOverrides(rows: readonly ProtestEvent[]): ProtestEvent[] {
  const analystRows = rows.filter((row) => row.sourceName !== "google_news_protest_schedule");
  return rows.filter(
    (row) =>
      row.sourceName !== "google_news_protest_schedule" ||
      !analystRows.some(
        (analyst) =>
          analystOverrideKey(analyst) === analystOverrideKey(row) &&
          sameUnderlyingMobilisation(analyst, row),
      ),
  );
}

function confidenceRank(row: ProtestEvent): number {
  return row.confidence === "High" ? 3 : row.confidence === "Moderate" ? 2 : 1;
}

function disruptionRank(row: ProtestEvent): number {
  return row.disruptionPotential === "Extreme"
    ? 4
    : row.disruptionPotential === "High"
      ? 3
      : row.disruptionPotential === "Moderate"
        ? 2
        : 1;
}

function operationalRank(row: ProtestEvent): number {
  const text = rowText(row);
  return (HIGH_IMPACT_WORDS.test(text) ? 3 : 0) + (OPERATIONAL_WORDS.test(text) ? 1 : 0);
}

function completenessRank(row: ProtestEvent): number {
  return [
    row.eventDate,
    row.country,
    row.city,
    row.venue,
    row.eventType,
    row.issue,
    row.organiser,
    row.description,
    row.startTime,
    row.attendance != null ? String(row.attendance) : null,
    row.disruptionPotential,
    row.sourceUrl,
  ].filter((value) => value != null && String(value).trim() !== "").length;
}

function representativeCompare(a: ProtestEvent, b: ProtestEvent): number {
  const statusA = STATUS_ORDER[a.status] ?? 99;
  const statusB = STATUS_ORDER[b.status] ?? 99;
  const left = [
    statusA,
    operationalRank(a),
    disruptionRank(a),
    a.attendance ?? -1,
    confidenceRank(a),
    completenessRank(a),
    a.sourceName === "google_news_protest_schedule" ? 0 : 1,
  ];
  const right = [
    statusB,
    operationalRank(b),
    disruptionRank(b),
    b.attendance ?? -1,
    confidenceRank(b),
    completenessRank(b),
    b.sourceName === "google_news_protest_schedule" ? 0 : 1,
  ];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return a.id - b.id;
}

function clusterScheduleRows(rows: readonly ProtestEvent[]): ProtestEvent[] {
  const clusters: ProtestEvent[][] = [];
  for (const row of rows) {
    const cluster = clusters.find((candidate) =>
      candidate.some((member) => sameUnderlyingMobilisation(member, row)),
    );
    if (cluster) cluster.push(row);
    else clusters.push([row]);
  }
  return clusters.map((cluster) => [...cluster].sort(representativeCompare)[0]);
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
  const clustered = clusterScheduleRows([...confirmedPlanned, ...possible]);
  const schedule = clustered
    .filter((row) => row.status === "Confirmed" || row.status === "Planned")
    .sort(chronological);
  const watchlist = clustered
    .filter((row) => row.status === "Possible")
    .sort(chronological);
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

/** One clean activity label shared by the editor, preview and PDF. */
export function protestScheduleActivity(row: ProtestEvent): string {
  const raw =
    row.description?.trim() ||
    [row.eventType, row.issue].filter(Boolean).join(" — ").trim() ||
    row.sourceTitle.trim() ||
    "Planned protest activity";
  // Collected headlines sometimes append a publisher label after a pipe.
  // The source remains available through sourceTitle/sourceUrl; it does not
  // belong in the report's Scheduled activity column.
  return raw.replace(/\s*\|\s*[^|]+$/u, "").trim();
}

const EMPTY_FORECAST_PROSE_RE =
  /\b(?:no unsupported forecast|no (?:significant )?(?:confirmed|planned|forecast)|no confirmed forward dates|does not (?:show|present) (?:a )?forecast)\b/i;

/**
 * A populated schedule must never be followed by prose saying that no
 * forecast or planned activity exists. Genuine analyst assessment is kept.
 */
export function reconcileProtestForecastRead(
  text: string,
  model: ProtestScheduleModel,
): string {
  const value = text.trim();
  const hasRows = model.schedule.length > 0 || model.watchlist.length > 0;
  return hasRows && EMPTY_FORECAST_PROSE_RE.test(value) ? "" : value;
}

function turnoutRank(row: ProtestEvent): number {
  if (row.attendance != null && Number.isFinite(row.attendance)) {
    return Math.min(5, Math.max(0, Math.round(Math.log10(Math.max(1, row.attendance)))));
  }
  const text = rowText(row);
  if (/\b(?:thousands?|tens of thousands|mass|nationwide|national|general strike)\b/i.test(text)) return 4;
  if (/\b(?:hundreds?|large turnout|major)\b/i.test(text)) return 3;
  if (/\b(?:dozens?|small)\b/i.test(text)) return 1;
  return 0;
}

function exposureRank(row: ProtestEvent): number {
  const text = `${row.city ?? ""} ${row.venue ?? ""} ${rowText(row)}`;
  let rank = 0;
  if (row.venue) rank += 1;
  if (routeText(row)) rank += 2;
  if (/\b(?:airport|port|station|terminal|border|highway|motorway|central business|downtown|capital)\b/i.test(text)) {
    rank += 2;
  }
  if (/\b(?:road|roads|traffic|access|closure|blocked|blockade|shutdown)\b/i.test(text)) rank += 1;
  return Math.min(5, rank);
}

function durationRank(row: ProtestEvent): number {
  const text = rowText(row);
  if (/\b(?:week|weeks|month|months|indefinite|ongoing|continuous)\b/i.test(text)) return 3;
  if (MULTI_STAGE_WORDS.test(text) || /\b\d+\s*(?:day|days)\b/i.test(text)) return 2;
  return 0;
}

function watchNextCompare(a: ProtestEvent, b: ProtestEvent): number {
  const severity = (row: ProtestEvent): number => {
    const text = rowText(row);
    return disruptionRank(row) + (HIGH_IMPACT_WORDS.test(text) ? 2 : 0);
  };
  // Date is intentionally absent from the operational tuple. It is only
  // consulted after all operational dimensions, so an important later
  // mobilisation is not hidden behind a low-impact event happening sooner.
  const left = [
    severity(a),
    disruptionRank(a),
    turnoutRank(a),
    exposureRank(a),
    durationRank(a),
    confidenceRank(a),
  ];
  const right = [
    severity(b),
    disruptionRank(b),
    turnoutRank(b),
    exposureRank(b),
    durationRank(b),
    confidenceRank(b),
  ];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return chronological(a, b);
}

function rankedWatchNextRows(model: ProtestScheduleModel): ProtestEvent[] {
  const candidates = [...model.schedule, ...model.watchlist].sort(watchNextCompare);
  const selected: ProtestEvent[] = [];
  for (const candidate of candidates) {
    // This is normally already guaranteed by buildProtestScheduleModel, but
    // retaining the semantic guard here protects callers that construct a
    // model themselves and prevents repeated same-event/theme lines.
    if (selected.some((row) => sameUnderlyingMobilisation(row, candidate))) continue;
    selected.push(candidate);
  }
  return selected;
}

/** Conservative Watch Next lines derived only from schedule context. */
export function buildProtestScheduleWatchNext(
  model: ProtestScheduleModel,
): string {
  const lines = rankedWatchNextRows(model).slice(0, 8).map((row) => {
    const place = [row.city, row.country].filter(Boolean).join(", ");
    const date = row.eventDate
      ? new Intl.DateTimeFormat("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(row.eventDate))
      : "the next seven days";
    return row.status === "Possible"
      ? `Possible mobilisation${place ? ` in ${place}` : ""} may affect access; monitor for confirmation before changing plans.`
      : `Monitor ${row.status.toLowerCase()} protest activity${place ? ` in ${place}` : ""} on ${date}; verify route and access conditions close to the event.`;
  });
  return lines.join("\n");
}
