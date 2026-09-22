import { createHash } from "node:crypto";
import { fetchBody } from "./feedFetch";
import type {
  RegionalCoverageCheck,
  RegionalForwardSource,
} from "./regionalCollector";

export interface RegionalCalendarDefinition {
  country: string;
  slug: string;
}

export type RegionalCalendarFetcher = (url: string) => Promise<string>;

export interface RegionalForwardCalendarResult {
  sources: RegionalForwardSource[];
  coverage: RegionalCoverageCheck;
}

// Office Holidays exposes public-holiday iCalendar feeds at these verified
// endpoints. UAE's working slug is "uae", not "united-arab-emirates".
export const MIDDLE_EAST_PUBLIC_HOLIDAY_CALENDARS: readonly RegionalCalendarDefinition[] = [
  { country: "Bahrain", slug: "bahrain" },
  { country: "Egypt", slug: "egypt" },
  { country: "Iran", slug: "iran" },
  { country: "Iraq", slug: "iraq" },
  { country: "Israel", slug: "israel" },
  { country: "Jordan", slug: "jordan" },
  { country: "Kuwait", slug: "kuwait" },
  { country: "Lebanon", slug: "lebanon" },
  { country: "Oman", slug: "oman" },
  { country: "Palestine", slug: "palestine" },
  { country: "Qatar", slug: "qatar" },
  { country: "Saudi Arabia", slug: "saudi-arabia" },
  { country: "Syria", slug: "syria" },
  { country: "Turkey", slug: "turkey" },
  { country: "United Arab Emirates", slug: "uae" },
  { country: "Yemen", slug: "yemen" },
] as const;

interface CalendarEvent {
  dtStart: string;
  dtEnd: string;
  dtStamp: string;
  summary: string;
  description: string;
  url: string;
}

function unfoldIcs(body: string): string[] {
  const physical = body.replace(/\r\n?/g, "\n").split("\n");
  const logical: string[] = [];
  for (const line of physical) {
    if (/^[ \t]/.test(line) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  return logical;
}

function property(line: string): { name: string; value: string } | null {
  const separator = line.indexOf(":");
  if (separator < 1) return null;
  return {
    name: line.slice(0, separator).split(";")[0].toUpperCase(),
    value: line.slice(separator + 1),
  };
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

function calendarDate(raw: string): string | null {
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T|$)/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === iso
    ? iso
    : null;
}

function calendarTimestamp(raw: string): string | null {
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  // Require the producer's explicit UTC marker. A floating timestamp has no
  // dependable timezone and is rejected rather than silently inventing one.
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseCalendar(body: string): { heading: string; events: CalendarEvent[] } {
  const lines = unfoldIcs(body);
  const heading = unescapeIcs(
    lines.map(property).find((entry) => entry?.name === "X-WR-CALNAME")?.value ?? "",
  );
  const events: CalendarEvent[] = [];
  let current: Partial<CalendarEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.dtStart && current.dtEnd && current.dtStamp
        && current.summary && current.description && current.url) {
        events.push(current as CalendarEvent);
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const field = property(line);
    if (!field) continue;
    if (field.name === "DTSTART") current.dtStart = field.value.trim();
    else if (field.name === "DTEND") current.dtEnd = field.value.trim();
    else if (field.name === "DTSTAMP") current.dtStamp = field.value.trim();
    else if (field.name === "SUMMARY") current.summary = unescapeIcs(field.value);
    else if (field.name === "DESCRIPTION") current.description = unescapeIcs(field.value);
    else if (field.name === "URL") current.url = field.value.trim();
  }
  return { heading, events };
}

function validIssueDate(issueDate: string): number {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(issueDate)
    ? Date.parse(`${issueDate}T00:00:00.000Z`)
    : Number.NaN;
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== issueDate) {
    throw new Error(`issueDate is not a valid calendar date: "${issueDate}"`);
  }
  return value;
}

function isMinorObservance(event: CalendarEvent): boolean {
  return /\b(?:observance|optional holiday|restricted holiday|commemoration only)\b/i
    .test(`${event.summary} ${event.description}`);
}

function eventId(country: string, event: CalendarEvent): string {
  return createHash("sha256")
    .update(`office-holidays\n${country}\n${event.dtStart}\n${event.summary}\n${event.url}`)
    .digest("hex")
    .slice(0, 24);
}

export function parseRegionalHolidayCalendar(
  body: string,
  definition: RegionalCalendarDefinition,
  issueDate: string,
): RegionalForwardSource[] {
  const issueMs = validIssueDate(issueDate);
  const firstDay = issueMs + 86_400_000;
  const lastDay = issueMs + 7 * 86_400_000;
  const parsed = parseCalendar(body);
  if (!parsed.heading || !/holidays?/i.test(parsed.heading)) {
    throw new Error(`Calendar heading missing or not a holiday calendar for ${definition.country}`);
  }

  return parsed.events.flatMap((event): RegionalForwardSource[] => {
    const eventDate = calendarDate(event.dtStart);
    const endDate = calendarDate(event.dtEnd);
    const publishedAt = calendarTimestamp(event.dtStamp);
    if (!eventDate || !endDate || !publishedAt || isMinorObservance(event)) return [];
    const eventMs = Date.parse(`${eventDate}T00:00:00.000Z`);
    if (eventMs < firstDay || eventMs > lastDay) return [];

    // Keep both normalized and raw structured dates in the evidence text.
    // This gives the downstream date validator an exact ISO source span while
    // preserving the calendar fields without pretending this is article copy.
    const evidence = [
      `Public holiday calendar: ${parsed.heading}.`,
      `Event date: ${eventDate}.`,
      `Calendar DTSTART: ${event.dtStart}.`,
      `Calendar DTEND: ${event.dtEnd}.`,
      `Calendar DTSTAMP: ${event.dtStamp}.`,
      event.description,
    ].join(" ");
    return [{
      id: eventId(definition.country, event),
      title: event.summary,
      summary: evidence,
      source: `Office Holidays — ${parsed.heading}`,
      url: event.url,
      // DTSTAMP is the calendar producer's supplied record timestamp. It is
      // never replaced with collection time and is not treated as eventDate.
      publishedAt,
      domain: "major_events",
      country: definition.country,
    }];
  });
}

async function defaultCalendarFetcher(url: string): Promise<string> {
  // iCalendar is not RSS/Atom and rss-parser cannot parse it. Reuse the shared
  // feed transport (browser UA, timeout and abort handling) at its body layer.
  return fetchBody(url, 20_000);
}

export async function collectMiddleEastForwardCalendarWithFetcher(
  issueDate: string,
  fetcher: RegionalCalendarFetcher,
  calendars: readonly RegionalCalendarDefinition[] = MIDDLE_EAST_PUBLIC_HOLIDAY_CALENDARS,
): Promise<RegionalForwardCalendarResult> {
  validIssueDate(issueDate);
  const outcomes: Array<{ definition: RegionalCalendarDefinition; count: number; sources: RegionalForwardSource[]; error?: string }> = [];
  const concurrency = 3;
  for (let offset = 0; offset < calendars.length; offset += concurrency) {
    await Promise.all(calendars.slice(offset, offset + concurrency).map(async (definition) => {
      try {
        const body = await fetcher(`https://www.officeholidays.com/ics/${definition.slug}`);
        const sources = parseRegionalHolidayCalendar(body, definition, issueDate);
        outcomes.push({ definition, count: parseCalendar(body).events.length, sources });
      } catch (error) {
        outcomes.push({
          definition,
          count: 0,
          sources: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));
  }
  const failures = outcomes.filter((outcome) => outcome.error);
  const sources = outcomes.flatMap((outcome) => outcome.sources);
  return {
    sources,
    coverage: {
      domain: "major_events_calendar",
      topic: "regional_research",
      query: calendars.map((calendar) => `https://www.officeholidays.com/ics/${calendar.slug}`).join(" | "),
      status: outcomes.length === calendars.length && failures.length === 0 ? "checked" : "not_run",
      sourceNames: outcomes.map((outcome) => `Office Holidays — ${outcome.definition.country}`),
      itemsFetched: outcomes.reduce((sum, outcome) => sum + outcome.count, 0),
      candidatesAccepted: sources.length,
      errors: failures.map((outcome) => `Office Holidays — ${outcome.definition.country}: ${outcome.error}`),
    },
  };
}

export function collectMiddleEastForwardCalendar(
  issueDate: string,
): Promise<RegionalForwardCalendarResult> {
  return collectMiddleEastForwardCalendarWithFetcher(issueDate, defaultCalendarFetcher);
}