import { canonicalTopic } from "../reportNaming";
import { buildTopicRows } from "../publicationCalendar";
import {
  buildRegionalDevelopments,
  buildRegionalWatchlist,
  curateRegionalWeeklyIncidents,
  isRegionalWeeklyTopic,
  selectRegionalKeyDevelopments,
} from "../regionalWeekly";

function incident(
  id: number,
  country: string,
  severity: string,
  occurredAt: string,
  title = "Port disruption affects cargo operations",
) {
  return {
    id,
    country,
    severity,
    occurredAt,
    title,
    summary: "Operational security and continuity impact reported.",
  };
}

describe("regional weekly products", () => {
  it("recognizes both first-class regional topics and keeps weekly cadence", () => {
    expect(isRegionalWeeklyTopic("apac_weekly")).toBe(true);
    expect(isRegionalWeeklyTopic("middle_east_weekly")).toBe(true);
    expect(canonicalTopic("apac_weekly").cadence).toBe("Weekly");
    expect(canonicalTopic("middle_east_weekly").cadence).toBe("Weekly");
  });

  it("keeps only material moderate-plus incidents in the seven-day regional window", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "Indonesia", "high", "2026-09-17"),
        incident(2, "Indonesia", "low", "2026-09-17"),
        incident(3, "Indonesia", "high", "2026-09-10"),
        incident(4, "Iran", "extreme", "2026-09-16"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows.map((row) => row.id)).toEqual([1]);
  });

  it("caps key developments at eight and keeps the Middle East boundary", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      incident(index, "Iran", "moderate", "2026-09-17"),
    );
    const curated = curateRegionalWeeklyIncidents(rows, "middle_east_weekly", "2026-09-17");
    expect(selectRegionalKeyDevelopments(curated)).toHaveLength(8);
    expect(
      curateRegionalWeeklyIncidents(
        [incident(99, "Indonesia", "high", "2026-09-17")],
        "middle_east_weekly",
        "2026-09-17",
      ),
    ).toHaveLength(0);
  });

  it("builds evidence-safe, fully labelled development cards", () => {
    const [development] = buildRegionalDevelopments([
      incident(1, "Indonesia", "high", "2026-09-17", "Port closure after security incident"),
    ]);
    expect(development).toMatchObject({
      country: "Indonesia",
      title: "Port closure after security incident",
      severity: "High",
      whatHappened: "Operational security and continuity impact reported.",
      whyItMatters: expect.stringContaining("transport"),
      outlook: expect.stringContaining("next seven days"),
    });
    expect(Object.keys(development)).toEqual([
      "country",
      "title",
      "severity",
      "whatHappened",
      "whyItMatters",
      "outlook",
    ]);
  });

  it("builds structured watch rows from development evidence and caps at eight", () => {
    const developments = Array.from({ length: 10 }, (_, index) => ({
      country: `Country ${index}`,
      title: `Issue ${index}`,
      severity: "Extreme" as const,
      whatHappened: "Confirmed event summary.",
      whyItMatters: "Operational implication remains evidence-safe.",
      outlook: "Watch for confirmed follow-on developments over the next seven days.",
    }));
    const [first] = buildRegionalWatchlist(developments);
    const rows = buildRegionalWatchlist(developments);
    expect(rows).toHaveLength(8);
    expect(first).toEqual({
      location: "Country 0",
      issue: "Issue 0",
      currentSeverity: "Extreme",
      whatWeAreWatching: "Watch for confirmed follow-on developments over the next seven days.",
    });
  });

  it("uses the weekly cadence for calendar due dates", () => {
    const rows = buildTopicRows(
      [
        {
          key: "topic-1",
          kind: "topic",
          typeLabel: "Topic Report",
          title: "Polestar APAC Weekly",
          topicKey: "apac_weekly",
          topicLabel: "Polestar APAC Weekly",
          country: null,
          region: "APAC",
          date: "2026-09-17",
          status: "published",
          href: "/reports/1",
        },
      ],
      new Date("2026-09-17T00:00:00Z"),
      ["apac_weekly"],
    );
    expect(rows[0].nextDue).toBe("2026-09-24");
  });
});