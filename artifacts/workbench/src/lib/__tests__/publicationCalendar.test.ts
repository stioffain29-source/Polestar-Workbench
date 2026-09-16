import { hideExpiredSpotReports, type PubItem } from "../publicationCalendar";

function item(kind: PubItem["kind"], date: string, key: string): PubItem {
  return {
    key,
    kind,
    typeLabel: kind,
    title: key,
    topicKey: null,
    topicLabel: null,
    country: null,
    region: "Global",
    date,
    status: "draft",
    href: `/${key}`,
  };
}

describe("publication calendar spot-report retention", () => {
  it("keeps spot reports for seven days and removes them on day eight", () => {
    const today = new Date(2026, 8, 17);
    const visible = hideExpiredSpotReports(
      [
        item("spot", "2026-09-17", "today"),
        item("spot", "2026-09-10", "seven-days"),
        item("spot", "2026-09-09", "eight-days"),
        item("topic", "2026-08-01", "old-topic"),
        item("country", "2026-08-01", "old-country"),
      ],
      today,
    );

    expect(visible.map((entry) => entry.key)).toEqual([
      "today",
      "seven-days",
      "old-topic",
      "old-country",
    ]);
  });
});