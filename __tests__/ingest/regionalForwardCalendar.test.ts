import {
  collectMiddleEastForwardCalendarWithFetcher,
  parseRegionalHolidayCalendar,
} from "../../lib/ingest/src/regionalForwardCalendar";
import { mergeRegionalForwardCalendar } from "../../lib/ingest/src/regionalCollector";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Saudi Arabia Holidays
BEGIN:VEVENT
DESCRIPTION:National public holiday affecting normal staffing and services.
URL:https://www.officeholidays.com/holidays/saudi-arabia/saudi-national-day
DTSTART;VALUE=DATE:20250923
DTEND;VALUE=DATE:20250924
DTSTAMP:20250901T081500Z
SUMMARY;LANGUAGE=en-us:Saudi Arabia: National Day
END:VEVENT
BEGIN:VEVENT
DESCRIPTION:A minor optional observance.
URL:https://www.officeholidays.com/minor
DTSTART;VALUE=DATE:20250924
DTEND;VALUE=DATE:20250925
DTSTAMP:20250901T081500Z
SUMMARY:Optional holiday observance
END:VEVENT
BEGIN:VEVENT
DESCRIPTION:An older public holiday.
URL:https://www.officeholidays.com/old
DTSTART;VALUE=DATE:20250920
DTEND;VALUE=DATE:20250921
DTSTAMP:20250901T081500Z
SUMMARY:Older holiday
END:VEVENT
END:VCALENDAR`;

describe("regional forward public-holiday calendar", () => {
  it("retains real structured dates and only major holidays in the next seven days", () => {
    const sources = parseRegionalHolidayCalendar(
      ICS,
      { country: "Saudi Arabia", slug: "saudi-arabia" },
      "2025-09-22",
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      title: "Saudi Arabia: National Day",
      country: "Saudi Arabia",
      domain: "major_events",
      publishedAt: "2025-09-01T08:15:00.000Z",
      url: "https://www.officeholidays.com/holidays/saudi-arabia/saudi-national-day",
    });
    expect(sources[0].summary).toContain("Event date: 2025-09-23.");
    expect(sources[0].summary).toContain("Calendar DTSTART: 20250923.");
    expect(sources[0].summary).toContain("Calendar DTEND: 20250924.");
    expect(sources[0].summary).toContain("Calendar DTSTAMP: 20250901T081500Z.");
  });

  it("audits failed country calendars instead of declaring them checked", async () => {
    const result = await collectMiddleEastForwardCalendarWithFetcher(
      "2025-09-22",
      async (url) => {
        if (url.endsWith("/iraq")) throw new Error("calendar unavailable");
        return ICS.replaceAll("Saudi Arabia", "Jordan");
      },
      [
        { country: "Jordan", slug: "jordan" },
        { country: "Iraq", slug: "iraq" },
      ],
    );

    expect(result.coverage.status).toBe("not_run");
    expect(result.coverage.errors).toEqual([
      "Office Holidays — Iraq: calendar unavailable",
    ]);
    expect(result.sources).toHaveLength(1);
  });

  it("adds calendar evidence without masking a failed major-events RSS query", () => {
    const news = {
      sources: [],
      requiredDomains: ["major_events"],
      domains: [{
        domain: "major_events",
        status: "not_run" as const,
        sourceNames: ["Google News — major events"],
        itemsFetched: 0,
        candidatesAccepted: 0,
        errors: ["Google News — major events: timeout"],
      }],
      coverage: {
        domain: "aggregate",
        status: "not_run" as const,
        sourceNames: ["Google News — major events"],
        itemsFetched: 0,
        candidatesAccepted: 0,
        errors: ["Google News — major events: timeout"],
      },
    };
    const [calendarSource] = parseRegionalHolidayCalendar(
      ICS,
      { country: "Saudi Arabia", slug: "saudi-arabia" },
      "2025-09-22",
    );
    const merged = mergeRegionalForwardCalendar(news, {
      sources: [calendarSource],
      coverage: {
        domain: "major_events_calendar",
        status: "checked",
        sourceNames: ["Office Holidays — Saudi Arabia"],
        itemsFetched: 10,
        candidatesAccepted: 1,
        errors: [],
      },
    });

    expect(merged.sources).toEqual([calendarSource]);
    expect(merged.domains[0].status).toBe("not_run");
    expect(merged.domains[0].candidatesAccepted).toBe(1);
    expect(merged.coverage.status).toBe("not_run");
  });
});