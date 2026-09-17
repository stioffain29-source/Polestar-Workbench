import { canonicalTopic } from "../reportNaming";
import { buildTopicRows } from "../publicationCalendar";
import {
  buildRegionalBluf,
  buildRegionalDevelopments,
  buildRegionalDomainBriefs,
  buildRegionalOutlook,
  buildRegionalWatchlist,
  curateRegionalWeeklyIncidents,
  isRegionalWeeklyTopic,
  selectRegionalKeyDevelopments,
  validateRegionalWeeklyAssessment,
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

  it("keeps operationally material incidents across the seven-day regional window", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "Indonesia", "high", "2026-09-17"),
        incident(2, "Indonesia", "low", "2026-09-17", "Road closure disrupts factory access"),
        incident(3, "Indonesia", "high", "2026-09-10"),
        incident(4, "Iran", "extreme", "2026-09-16"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
  });

  it("caps key developments at ten and keeps the Middle East boundary", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      incident(index, "Iran", "moderate", "2026-09-17", `Port disruption affects cargo operations ${index}`),
    );
    expect(selectRegionalKeyDevelopments(rows)).toHaveLength(10);
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
      category: "Operational Disruption",
      whatHappened: "Operational security and continuity impact reported.",
      whyItMatters: expect.stringContaining("transport"),
      outlook: expect.stringContaining("next seven days"),
    });
    expect(Object.keys(development)).toEqual([
      "country",
      "title",
      "severity",
      "category",
      "whatHappened",
      "whyItMatters",
      "outlook",
    ]);
  });

  it("consolidates multiple reports of one event before selecting developments", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        { ...incident(1, "Philippines", "high", "2026-09-17", "Typhoon closes Cebu airport"), eventClusterKey: "typhoon-cebu" },
        { ...incident(2, "Philippines", "moderate", "2026-09-17", "Flights halted as storm reaches Cebu"), eventClusterKey: "typhoon-cebu" },
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it("classifies and retains political, regulatory, weather and cyber developments with operational relevance", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "Japan", "moderate", "2026-09-17", "Election policy may change energy regulation for business"),
        incident(2, "Singapore", "moderate", "2026-09-17", "New data regulation changes compliance requirements"),
        incident(3, "Philippines", "high", "2026-09-17", "Typhoon flooding disrupts airports and utilities"),
        incident(4, "Australia", "high", "2026-09-17", "Ransomware attack disrupts telecom infrastructure"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(buildRegionalDevelopments(rows).map((row) => row.category)).toEqual([
      "Weather & Natural Hazards",
      "Cyber",
      "Political",
      "Regulatory",
    ]);
  });

  it("builds structured watch rows from development evidence and caps at ten", () => {
    const developments = Array.from({ length: 12 }, (_, index) => ({
      country: `Country ${index}`,
      title: `Issue ${index}`,
      severity: "Extreme" as const,
      category: "Security" as const,
      whatHappened: "Confirmed event summary.",
      whyItMatters: "Operational implication remains evidence-safe.",
      outlook: "Watch for confirmed follow-on developments over the next seven days.",
    }));
    const [first] = buildRegionalWatchlist(developments);
    const rows = buildRegionalWatchlist(developments);
    expect(rows).toHaveLength(10);
    expect(first).toEqual({
      location: "Country 0",
      issue: "Issue 0",
      currentSeverity: "Extreme",
      whatWeAreWatching: "Watch for confirmed follow-on developments over the next seven days.",
    });
  });

  it("builds a cross-category operating outlook instead of a security-only quiet-week fallback", () => {
    const outlook = buildRegionalOutlook(buildRegionalDevelopments([
      incident(1, "Singapore", "moderate", "2026-09-17", "New data regulation changes compliance requirements"),
      incident(2, "Philippines", "high", "2026-09-17", "Typhoon flooding disrupts airports and utilities"),
    ]));
    expect(outlook).toContain("Regulatory");
    expect(outlook).toContain("Weather & Natural Hazards");
    expect(outlook).toContain("people, travel, sites, supply chains and compliance");
    expect(outlook).not.toContain("Nothing useful came through");
  });

  it("uses the dedicated discovery-pass domain instead of relabelling headline keywords", () => {
    const rows = curateRegionalWeeklyIncidents(
      [{
        ...incident(1, "Singapore", "moderate", "2026-09-17", "Government announces new obligations for cloud providers"),
        analystNotes: "auto-scraped:regional-weekly:cyber:Regional Weekly APAC cyber",
      }],
      "apac_weekly",
      "2026-09-17",
    );
    expect(buildRegionalDevelopments(rows)[0].category).toBe("Cyber");
  });

  it("produces six distinct domain assessments and a cross-domain BLUF", () => {
    const developments = buildRegionalDevelopments([
      {
        ...incident(1, "Singapore", "moderate", "2026-09-17", "New data regulation changes compliance requirements"),
        analystNotes: "auto-scraped:regional-weekly:regulatory:test",
      },
    ]);
    const briefs = buildRegionalDomainBriefs(developments);
    expect(briefs).toHaveLength(6);
    expect(briefs.find((brief) => brief.domain === "Regulatory")?.assessment).toContain("business relevance");
    expect(briefs.find((brief) => brief.domain === "Cyber")?.assessment).toBe(
      "NO MATERIAL REGIONAL CYBER DEVELOPMENT IDENTIFIED DURING THIS REPORTING PERIOD.",
    );
    expect(buildRegionalBluf(developments)).toContain("regional operating environment");
    expect(validateRegionalWeeklyAssessment(developments)).toEqual([]);
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