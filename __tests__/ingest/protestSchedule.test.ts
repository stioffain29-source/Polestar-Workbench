jest.mock("@workspace/db", () => ({
  db: {},
  protestEventsTable: {},
}));

import { eventDateInWindow, makeProtestDedupeKey, parseProtestItem } from "../../lib/ingest/src/protestSchedule";

const feed = {
  country: "Indonesia",
  cities: ["Jakarta", "Surabaya"],
  locale: "en-ID",
  gl: "ID",
};

describe("forward-looking protest schedule parsing", () => {
  const now = new Date("2026-04-01T10:00:00.000Z");

  test("keeps event date separate and only records explicit attendance", () => {
    const row = parseProtestItem(
      {
        title: "Organisers plan Jakarta rally on 4 April 2026",
        contentSnippet: "A march over fuel prices will start at 09:00. 2,000 participants expected.",
        pubDate: "2026-03-30T08:00:00Z",
        link: "https://example.test/rally",
      },
      feed,
      now,
    );
    expect(row?.eventDate).toEqual(new Date("2026-04-04T00:00:00.000Z"));
    expect(row?.sourcePublishedAt).toEqual(new Date("2026-03-30T08:00:00.000Z"));
    expect(row?.attendance).toBe(2000);
    expect(row?.status).toBe("Planned");
  });

  test("stores a credible undated planning notice as Possible", () => {
    const row = parseProtestItem(
      {
        title: "Union calls for upcoming protest in Jakarta",
        contentSnippet: "Organisers say details will be announced soon.",
        link: "https://example.test/notice",
      },
      feed,
      now,
    );
    expect(row?.eventDate).toBeNull();
    expect(row?.status).toBe("Possible");
    expect(row?.attendance).toBeNull();
  });

  test("window and dedupe helpers are deterministic", () => {
    expect(eventDateInWindow(new Date("2026-04-08T23:59:00Z"), now)).toBe(true);
    expect(eventDateInWindow(new Date("2026-04-09T00:00:00Z"), now)).toBe(false);
    const a = makeProtestDedupeKey({
      eventDate: new Date("2026-04-04T00:00:00Z"),
      country: "Indonesia",
      city: "Jakarta",
      venue: "City Hall",
      organiser: "Union",
      issue: "fuel prices",
      description: "A rally",
    });
    const b = makeProtestDedupeKey({
      eventDate: new Date("2026-04-04T00:00:00Z"),
      country: "Indonesia",
      city: "Jakarta",
      venue: "City Hall",
      organiser: "Union",
      issue: "fuel prices",
      description: "A different rally",
    });
    expect(a).not.toBe(b);
  });
});