import { canonicalTopic } from "../reportNaming";
import { buildTopicRows } from "../publicationCalendar";
import {
  buildApacBusinessImplications,
  buildApacFutureEvents,
  buildApacWeeklyBluf,
  buildApacWeeklyOutlook,
  buildApacWeeklyDevelopments,
  buildApacWeeklyWatchlist,
  buildRegionalBluf,
  buildRegionalDevelopments,
  buildRegionalDomainBriefs,
  buildRegionalGlanceItems,
  buildRegionalMapPoints,
  buildRegionalBusinessImplicationsNarrative,
  buildRegionalOutlook,
  buildRegionalWatchlist,
  curateRegionalWeeklyIncidents,
  isRegionalWeeklyTopic,
  selectRegionalKeyDevelopments,
  validateRegionalWeeklyAssessment,
  validateRegionalCanonicalStructure,
  validateApacWeeklyAssessment,
  buildStructuredRegionalBluf,
  buildStructuredRegionalOutlook,
  regionalWeeklySeverity,
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
    incidentDate: occurredAt,
    title,
    summary: "Operational security and continuity impact reported.",
  };
}

describe("regional weekly products", () => {
  it("uses the source occurrence date when no separate incident date was extracted", () => {
    const row = incident(1, "Iraq", "high", "2026-09-17", "Port closure disrupts cargo operations");
    const [development] = buildRegionalDevelopments(
      [{ ...row, incidentDate: null }],
      "2026-09-17",
      "middle_east_weekly",
    );
    expect(development.eventDate).toBe("2026-09-17");
    expect(development.dateVerified).toBe(true);
  });

  it("rates deliberate armed attacks by consequence rather than geographic reach", () => {
    const pakistan = {
      ...incident(1, "Pakistan", "moderate", "2026-09-17", "Car-bomb attack targets security personnel near police facility"),
      summary: "A deliberate car bomb killed three security personnel near a police facility.",
    };
    const thailand = {
      ...incident(2, "Thailand", "moderate", "2026-09-17", "Bombing and small-arms attack targets security checkpoint"),
      summary: "Attackers detonated a bomb and opened fire with small arms at the checkpoint.",
    };
    expect(regionalWeeklySeverity(pakistan, "apac_weekly")).toBe("High");
    expect(regionalWeeklySeverity(thailand, "apac_weekly")).toBe("High");
  });

  it("rates a mass-casualty attack Extreme when the toll follows the casualty verb", () => {
    const pakistan = {
      ...incident(1, "Pakistan", "moderate", "2026-09-18", "Car-bomb attack targets police headquarters"),
      summary: "The death toll from the attack rose to 31 and earlier reporting said the blast injured 56.",
    };
    expect(regionalWeeklySeverity(pakistan, "apac_weekly")).toBe("Extreme");
  });

  it("does not equate routine migration administration with a major armed attack", () => {
    const australia = {
      ...incident(1, "Australia", "moderate", "2026-09-17", "Migration policy changes visa eligibility and documentation rules"),
      summary: "The binding rules change compliance requirements for affected visa applicants and employers.",
    };
    expect(regionalWeeklySeverity(australia, "apac_weekly")).toBe("Moderate");
  });

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

  it("caps key developments at eight and keeps the Middle East boundary", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      incident(index, "Iran", "moderate", "2026-09-17", `Port disruption affects cargo operations ${index}`),
    );
    const selected = selectRegionalKeyDevelopments(rows);
    expect(selected.length).toBeLessThanOrEqual(8);
    expect(validateRegionalWeeklyAssessment(
      buildRegionalDevelopments(rows, "2026-09-17", "middle_east_weekly"),
      "middle_east_weekly",
    )).toEqual([]);
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
      whatChanged: "Operational security and continuity impact reported.",
      operationalSignificance: expect.stringContaining("Port closure"),
      whatToWatch: "",
      watchDate: null,
    });
    expect(Object.keys(development)).toEqual([
      "country",
      "title",
      "severity",
      "category",
      "whatChanged",
      "operationalSignificance",
      "watchDate",
      "whatToWatch",
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
        incident(1, "Japan", "moderate", "2026-09-17", "Election policy implemented new energy regulation requirements for business"),
        incident(2, "Singapore", "moderate", "2026-09-17", "New data regulation changes compliance requirements"),
        incident(3, "Philippines", "high", "2026-09-17", "Typhoon flooding disrupts airports and utilities"),
        incident(4, "Australia", "high", "2026-09-17", "Ransomware attack disrupts telecom infrastructure"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(buildRegionalDevelopments(rows).map((row) => row.category).sort()).toEqual([
      "Weather & Natural Hazards",
      "Cyber",
      "Political",
      "Regulatory",
    ].sort());
  });

  it("builds only forward-dated watch rows and caps them at five", () => {
    const developments = Array.from({ length: 12 }, (_, index) => ({
      country: `Country ${index}`,
      title: `Issue ${index}`,
      severity: "Extreme" as const,
      category: "Security" as const,
      whatChanged: "Confirmed event summary.",
      operationalSignificance: "The scheduled event affects airport access.",
      watchDate: `2026-09-${String(18 + index).padStart(2, "0")}`,
      whatToWatch: "The airport is scheduled to reopen after the security review.",
    }));
    const [first] = buildRegionalWatchlist(developments);
    const rows = buildRegionalWatchlist(developments);
    expect(rows).toHaveLength(5);
    expect(first).toEqual({
      date: "2026-09-18",
      location: "Country 0",
      trigger: "Issue 0",
      whyItMatters: "The scheduled event affects airport access.",
      whatToWatch: "The airport is scheduled to reopen after the security review.",
    });
    expect(buildRegionalWatchlist([{ ...developments[0], watchDate: null, whatToWatch: "" }])).toEqual([]);
  });

  it("builds a cross-category operating outlook instead of a security-only quiet-week fallback", () => {
    const outlook = buildRegionalOutlook(buildRegionalDevelopments([
      incident(1, "Singapore", "moderate", "2026-09-17", "New data regulation changes compliance requirements"),
      incident(2, "Philippines", "high", "2026-09-17", "Typhoon flooding disrupts airports and utilities"),
    ]));
    expect(outlook).toContain("Singapore:");
    expect(outlook).toContain("Philippines:");
    expect(outlook).toContain("staff movement");
    expect(outlook).not.toContain("Nothing useful came through");
  });

  it("does not trust a discovery label without cyber evidence", () => {
    const rows = curateRegionalWeeklyIncidents(
      [{
        ...incident(1, "Singapore", "moderate", "2026-09-17", "Government implemented new obligations for cloud providers"),
        analystNotes: "auto-scraped:regional-weekly:cyber:Regional Weekly APAC cyber",
      }],
      "apac_weekly",
      "2026-09-17",
    );
    expect(buildRegionalDevelopments(rows, "2026-09-17", "apac_weekly")[0].category).toBe("Regulatory");
  });

  it("rejects diplomatic meetings and visa-free announcements without an operating consequence", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(11, "Iran", "high", "2026-09-17", "Iranian and Turkish ministers discuss cross-border security"),
        incident(12, "Israel", "moderate", "2026-09-17", "Kazakhstan and Israel move toward visa-free travel"),
      ],
      "middle_east_weekly",
      "2026-09-17",
    );
    expect(rows).toEqual([]);
  });

  it("does not classify a maritime attack as Cyber because its collector lane was cyber", () => {
    const rows = curateRegionalWeeklyIncidents(
      [{
        ...incident(13, "Oman", "high", "2026-09-17", "Oman tows products tanker to port after fatal weekend attack"),
        analystNotes: "auto-scraped:regional-weekly:cyber:Regional Weekly cyber",
      }],
      "middle_east_weekly",
      "2026-09-17",
    );
    expect(buildRegionalDevelopments(rows, "2026-09-17", "middle_east_weekly")[0]?.category)
      .toBe("Operational Disruption");
  });

  it("rejects a multi-story Philippines feed dump instead of extracting a development", () => {
    const rows = curateRegionalWeeklyIncidents(
      [incident(14, "Philippines", "high", "2026-09-17", "Philippines news roundup: protests, airport updates and crime in one digest")],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows).toEqual([]);
  });

  it("classifies explicit cyber evidence with operational consequence as Cyber", () => {
    const rows = curateRegionalWeeklyIncidents(
      [{
        ...incident(2, "Singapore", "high", "2026-09-17", "Ransomware attack disrupts telecom network operations"),
        analystNotes: "auto-scraped:regional-weekly:cyber:Regional Weekly APAC cyber",
      }],
      "apac_weekly",
      "2026-09-17",
    );
    expect(buildRegionalDevelopments(rows)[0].category).toBe("Cyber");
  });

  it("omits empty domain filler and produces a cross-domain BLUF", () => {
    const developments = buildRegionalDevelopments([
      {
        ...incident(1, "Singapore", "moderate", "2026-09-17", "New data regulation changes compliance requirements"),
        analystNotes: "auto-scraped:regional-weekly:regulatory:test",
      },
    ]);
    const briefs = buildRegionalDomainBriefs(developments);
    expect(briefs).toHaveLength(9);
    expect(briefs.find((brief) => brief.domain === "Regulatory")?.assessment).toContain("Singapore");
    expect(briefs.find((brief) => brief.domain === "Cyber")?.assessment).toMatch(/NO MATERIAL/);
    expect(buildRegionalBluf(developments)).toContain("regional operating environment");
    expect(buildRegionalBluf(developments)).not.toMatch(/\b\d+\s+(?:priority|material)\s+developments\b/i);
    expect(briefs.map((brief) => brief.assessment).join(" ")).not.toMatch(/highest-rated|main business relevance/i);
    expect(validateRegionalWeeklyAssessment(developments)).toEqual([]);
    expect(buildRegionalGlanceItems(developments)).toHaveLength(1);
    expect(buildRegionalBluf(developments).split(/\s+/).length).toBeLessThanOrEqual(150);
    expect(buildRegionalOutlook(developments).split(/\s+/).length).toBeLessThanOrEqual(200);
  });

  it("rejects retrospectives, charity coverage and isolated local crime", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "Indonesia", "moderate", "2026-09-17", "Anniversary retrospective on an old terror attack at an airport"),
        incident(2, "Philippines", "moderate", "2026-09-17", "Charity donation follows last year's flood disruption"),
        incident(3, "India", "moderate", "2026-09-17", "Local murder investigation after isolated stabbing"),
        incident(4, "Japan", "high", "2026-09-17", "Typhoon closes airport and disrupts power supply"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows.map((row) => row.id)).toEqual([4]);
  });

  it("extracts a future date instead of turning every past incident into a watch item", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        {
          ...incident(1, "Singapore", "moderate", "2026-09-17", "New data regulation changes compliance requirements"),
          summary: "The regulation takes effect on 2026-09-22 and changes compliance requirements for cloud providers.",
        },
        incident(2, "Philippines", "high", "2026-09-17", "Typhoon flooding disrupts airports and utilities"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    const developments = buildRegionalDevelopments(rows, "2026-09-17", "apac_weekly");
    expect(developments.map((row) => ({
      country: row.country,
      watchDate: row.watchDate,
      whatToWatch: row.whatToWatch,
    }))).toEqual([
      {
        country: "Philippines",
        watchDate: null,
          whatToWatch: "Track official warnings, river levels, road or airport closures and confirmed reopening times.",
      },
      {
        country: "Singapore",
        watchDate: "2026-09-22",
        whatToWatch: "The regulation takes effect on 2026-09-22 and changes compliance requirements for cloud providers.",
      },
    ]);
    expect(buildRegionalWatchlist(developments)).toHaveLength(1);
    expect(buildRegionalWatchlist(developments)[0]).toMatchObject({
      date: "2026-09-22",
      location: "Singapore",
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

  it("APAC selects at most eight real developments and never pads a short evidence set", () => {
    const short = [
      incident(1, "Indonesia", "high", "2026-09-17", "Port closure disrupts cargo operations"),
      incident(2, "Japan", "moderate", "2026-09-17", "Typhoon closes airport and disrupts power supply"),
    ];
    expect(selectRegionalKeyDevelopments(short, "apac_weekly")).toHaveLength(2);
    expect(selectRegionalKeyDevelopments(
      Array.from({ length: 14 }, (_, index) =>
        incident(index, ["Indonesia", "Japan", "Singapore", "Australia", "India", "Malaysia", "Thailand"][index % 7], "moderate", "2026-09-17", `Port closure disrupts cargo operations ${index}`),
      ),
      "apac_weekly",
    )).toHaveLength(8);
  });

  it("APAC keeps all six intelligence domains visible, rejects source slop, and exposes distinct editorial fields", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "Australia", "high", "2026-09-17", "Australia migration policy changes visa compliance for employers"),
        incident(2, "Singapore", "moderate", "2026-09-17", "New data regulation changes compliance requirements"),
        incident(3, "Japan", "high", "2026-09-17", "Typhoon closes airport and disrupts power supply"),
        incident(4, "India", "moderate", "2026-09-17", "Government official gives speech about terrorism"),
        incident(5, "Philippines", "moderate", "2026-09-17", "READ: charity donation drive follows old flood"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows.map((row) => row.id)).toEqual([3, 1, 2]);
    const developments = buildApacWeeklyDevelopments(rows, "2026-09-17");
    expect(buildRegionalDomainBriefs(developments, "apac_weekly").every((brief) => brief.assessment.trim())).toBe(true);
    const domains = buildRegionalDomainBriefs(developments, "apac_weekly");
    expect(domains).toHaveLength(6);
    expect(domains.map((brief) => brief.domain)).toEqual([
      "Security",
      "Political",
      "Regulatory",
      "Weather & Natural Hazards",
      "Cyber",
      "Operational Disruption",
    ]);
    expect(domains.find((brief) => brief.domain === "Cyber")?.assessment).toMatch(
      /No material regional cyber development/i,
    );
    expect(developments.every((row) => row.operationalImpact && row.polestarView && row.outlook7Days !== undefined)).toBe(true);
  });

  it("fails closed when a required regional section or map is missing", () => {
    const developments = buildApacWeeklyDevelopments([
      incident(1, "Japan", "high", "2026-09-17", "Typhoon closes airport and disrupts power supply"),
    ], "2026-09-17");
    const base = {
      schemaVersion: "regional-weekly-canonical-v1" as const,
      topic: "apac_weekly" as const,
      issueDate: "2026-09-17",
      developments,
      regionalOutlook: "Regional outlook.",
      polestarOutlook: "Polestar outlook.",
      riskPicture: "Risk picture.",
      domainBriefs: buildRegionalDomainBriefs(developments, "apac_weekly"),
      businessImplications: [],
      businessImplicationsNarrative: "Business implications.",
      watchItems: [{
        date: "2026-09-18",
        location: "Japan",
        trigger: "Typhoon",
        whyItMatters: "Airport access may be affected.",
        whatToWatch: "Official closure notices.",
      }],
      glanceMetrics: [],
      mapPoints: [{ lat: 35, lng: 139, label: "Japan", title: "Typhoon", severity: "High" as const, eventDate: "2026-09-17", summary: "Airport closure." }],
      visualSummary: { byCategory: [], byCountry: [] },
      coverageManifest: {} as never,
    };
    expect(validateRegionalCanonicalStructure(base)).toEqual([]);
    expect(validateRegionalCanonicalStructure({ ...base, mapPoints: [] })).toContain(
      "Regional report requires a risk map with at least one verified point.",
    );
    expect(validateRegionalCanonicalStructure({
      ...base,
      domainBriefs: base.domainBriefs.filter((brief) => brief.domain !== "Cyber"),
    })).toContain("Missing required intelligence domain: Cyber.");
  });

  it("APAC metrics and business implication blocks derive from the selected set", () => {
    const developments = buildApacWeeklyDevelopments([
      incident(1, "Indonesia", "high", "2026-09-17", "Port closure disrupts cargo operations"),
      incident(2, "Singapore", "moderate", "2026-09-17", "New data regulation changes compliance requirements"),
      incident(3, "Japan", "high", "2026-09-17", "Typhoon closes airport and disrupts power supply"),
    ], "2026-09-17");
    const bluf = buildApacWeeklyBluf(developments);
    expect(bluf.split(/\s+/).length).toBeGreaterThan(20);
    expect(buildApacBusinessImplications(developments).length).toBeGreaterThan(0);
    expect(validateApacWeeklyAssessment(developments)).not.toContain("Duplicate APAC developments remain.");
  });

  it("APAC retains one development and source evidence for differently worded policy reports", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "Australia", "moderate", "2026-09-17", "Australian immigration crackdown targets visas for international students and backpackers"),
        incident(2, "Australia", "high", "2026-09-17", "Australia migration overhaul tightens rules on visa hopping"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows).toHaveLength(1);
    expect(buildApacWeeklyDevelopments(rows)[0].sourceCount).toBe(2);
    expect(buildApacWeeklyDevelopments(rows)[0].sourceEvidence).toHaveLength(2);
  });

  it("APAC reassesses stored severity from current operational consequence", () => {
    const developments = buildApacWeeklyDevelopments([
      incident(1, "Australia", "high", "2026-09-17", "Australia tightens backpacker visa eligibility and employer paperwork"),
      incident(2, "Thailand", "high", "2026-09-17", "Bomb and shooting attack targets territorial defence volunteers in Narathiwat in the southern border province; no casualties reported"),
    ], "2026-09-17");
    expect(developments.find((row) => row.country === "Australia")?.severity).toBe("Moderate");
    expect(developments.find((row) => row.country === "Thailand")?.category).toBe("Armed Conflict");
    expect(developments.find((row) => row.country === "Thailand")?.severity).toBe("High");
    expect(
      validateApacWeeklyAssessment(developments).some((error) =>
        /armed attack severity requires review/i.test(error),
      ),
    ).toBe(false);
  });

  it("APAC rejects a proposed bill without a binding operational effect", () => {
    const rows = curateRegionalWeeklyIncidents([
      incident(1, "Philippines", "high", "2026-09-17", "Proposed SAGIP BATA bill takes aim at online recruitment into violence"),
    ], "apac_weekly", "2026-09-17");
    expect(rows).toHaveLength(0);
  });

  it("APAC rejects drills, false event claims and terrorism speeches", () => {
    const rows = curateRegionalWeeklyIncidents([
      incident(1, "India", "low", "2026-09-17", "Airport conducts bomb threat mock drill"),
      incident(2, "Myanmar", "low", "2026-09-17", "AI-manipulated image falsely linked to drone attack at airport"),
      incident(3, "India", "low", "2026-09-17", "Prime minister states policy against terrorism and expresses condolences"),
    ], "apac_weekly", "2026-09-17");
    expect(rows).toHaveLength(0);
  });

  it("APAC accepts externally supplied next-seven-day events without inventing past watch rows", () => {
    const items = buildApacWeeklyWatchlist(
      [],
      [{
        date: "2026-09-21",
        location: "Manila",
        trigger: "Scheduled transport strike",
        whyItMatters: "The action may restrict employee movement and airport access.",
        currentSeverity: "High",
      }, {
        date: "2026-09-30",
        location: "Manila",
        trigger: "Outside the watch window",
        whyItMatters: "This should not appear yet.",
        currentSeverity: "Low",
      }],
      "2026-09-17",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      date: "2026-09-21",
      location: "Manila",
      currentSeverity: "High",
    });
  });

  it("retains an in-region forward event even when its country has no Key Development", () => {
    const developments = buildApacWeeklyDevelopments([
      incident(1, "Australia", "moderate", "2026-09-17", "New visa rules change workforce access"),
    ]);
    const items = buildApacWeeklyWatchlist(
      developments,
      [{
        date: "2026-09-21",
        location: "Manila, Philippines",
        trigger: "Scheduled transport strike",
        whyItMatters: "The action may restrict employee movement and airport access.",
        currentSeverity: "High",
      }],
      "2026-09-17",
    );
    expect(items.some((item) => item.location === "Manila, Philippines")).toBe(true);
  });

  it("does not repeat current developments in the 7 Day Watch or publish an unqualified National location", () => {
    const developments = buildApacWeeklyDevelopments([
      {
        ...incident(1, "Pakistan", "high", "2026-09-17", "Attack affects police headquarters"),
        summary: "Further attacks remain possible.",
      },
    ], "2026-09-17");
    developments[0].watchDate = "2026-09-20";
    developments[0].whatToWatch = "Track further attacks.";
    const items = buildApacWeeklyWatchlist(
      developments,
      [{
        date: "2026-09-20",
        location: "National",
        trigger: "Temporary migration rules tighten",
        whyItMatters: "Hiring assumptions may change.",
        currentSeverity: "Moderate",
      }],
      "2026-09-17",
    );
    expect(items).toEqual([]);
  });

  it("keeps APAC development fields materially distinct for recurring report shapes", () => {
    const developments = buildApacWeeklyDevelopments([
      {
        ...incident(1, "Australia", "moderate", "2026-09-17", "Australia migration overhaul changes visa rules"),
        summary: "The government announced a migration overhaul that changes visa eligibility and employer obligations for international students and skilled workers.",
      },
      {
        ...incident(2, "China", "high", "2026-09-17", "Deadly floods prompt China-Nepal climate attribution"),
        summary: "Flooding killed people in the border area after intense rainfall, while officials attributed the conditions to a changing climate pattern.",
      },
      {
        ...incident(3, "Myanmar", "high", "2026-09-17", "Drone activity shuts Mandalay airport"),
        summary: "Mandalay airport suspended flights after a drone incident; operators were advised to use alternate routing while security checks continued.",
      },
      {
        ...incident(4, "Myanmar", "high", "2026-09-17", "Arakan Army offensive affects the border"),
        summary: "The Arakan Army offensive intensified near the border, prompting new security restrictions and disrupting movement on affected routes.",
      },
    ], "2026-09-17");

    for (const development of developments) {
      const fields = [
        development.whatChanged,
        development.operationalImpact,
        development.polestarView,
        development.outlook7Days,
      ].map((field) => field?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "");
      expect(new Set(fields).size).toBe(fields.length);
      expect(fields[1]).not.toBe(fields[0]);
      expect(fields[2]).not.toBe(fields[0]);
      expect(fields[3]).not.toBe(fields[0]);
      expect(fields[2]).not.toBe(fields[1]);
      expect(fields[3]).not.toBe(fields[1]);
      expect(fields[3]).not.toBe(fields[2]);
    }
    expect(validateApacWeeklyAssessment(developments)
      .filter((error) => error.startsWith("Semantically repeated narrative fields"))).toEqual([]);
  });

  it("projects only material scheduled events into distinct operating fields", () => {
    const [event] = buildApacFutureEvents(
      [
        {
          eventDate: "2026-09-20T00:00:00Z",
          country: "Japan",
          city: "Tokyo",
          eventType: "community gathering",
          sourceTitle: "Local charity community gathering",
          description: "A small neighbourhood donation event.",
          status: "Possible",
          confidence: "Low",
        },
        {
          eventDate: "2026-09-21T00:00:00Z",
          country: "Philippines",
          city: "Manila",
          eventType: "transport strike",
          sourceTitle: "Metro Manila transport strike",
          description: "Drivers plan a citywide walkout affecting routes.",
          disruptionPotential: "High",
          status: "Planned",
          confidence: "High",
        },
      ],
      "2026-09-17",
    );
    expect(event).toMatchObject({
      date: "2026-09-21",
      location: "Manila, Philippines",
      trigger: "Metro Manila transport strike",
      currentSeverity: "High",
    });
    expect(event.whyItMatters).not.toBe(event.trigger);
    expect(event.whatToWatch).not.toBe(event.trigger);
    expect(event.whyItMatters).not.toContain(event.trigger);
    expect(event.whatToWatch).not.toContain(event.trigger);
    expect(buildApacFutureEvents(
      [{
        eventDate: "2026-09-20T00:00:00Z",
        country: "Japan",
        city: "Tokyo",
        eventType: "community gathering",
        sourceTitle: "Local charity community gathering",
        description: "A small neighbourhood donation event.",
        status: "Possible",
        confidence: "Low",
      }],
      "2026-09-17",
    )).toEqual([]);
  });

  it("cleans source prose from future-event triggers without ellipsis", () => {
    const [event] = buildApacFutureEvents(
      [{
        eventDate: "2026-09-21T00:00:00Z",
        country: "India",
        city: "Mumbai",
        eventType: "march",
        sourceTitle: "Maratha reservation mobilisation and campaign. Related actions are expected to concentrate in Mumbai The scheduled route may affect traffic.",
        description: "A planned march may affect roads.",
        disruptionPotential: "High",
        status: "Planned",
        confidence: "High",
      }],
      "2026-09-17",
    );
    expect(event.trigger).toBe("Maratha reservation mobilisation and campaign");
    expect(event.trigger).not.toMatch(/Related actions|The scheduled|concentrate in Mumbai/i);
    expect(event.trigger).not.toContain("...");
  });

  it("APAC excludes polling-place human-interest items and future-only protest commentary", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "Philippines", "low", "2026-09-17", "Islamic school-turned-evacuation site now BARMM polling center"),
        incident(2, "Philippines", "high", "2026-09-17", "Manila groups plan to hold a Sept. 21 protest"),
        incident(3, "Philippines", "high", "2026-09-17", "Manila protest blocks roads and police deploy crowd-control units"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows.map((row) => row.id)).toEqual([3]);
  });

  it("APAC strips datelines, source names and raw truncation from What Changed", () => {
    const [development] = buildApacWeeklyDevelopments([{
      ...incident(1, "Myanmar", "high", "2026-09-17", "Mandalay airport shut after drone attack"),
      summary: "MANDALAY, Myanmar - Flights were suspended after a drone attack disrupted airport operations... Reuters",
    }], "2026-09-17");
    expect(development.whatChanged).not.toMatch(/MANDALAY|Reuters|\.\.\./i);
    expect(development.whatChanged).not.toBe("Mandalay airport shut after drone attack");
    expect(validateApacWeeklyAssessment([development])).not.toContain(
      "Raw scrape fragments, source domains or rejected feed prose remain.",
    );
    expect(validateApacWeeklyAssessment([development])).not.toContain(
      "Truncation ellipses or generic impact templates remain.",
    );
  });

  it("APAC clusters India windfall and export fuel tax variants with source evidence", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        {
          ...incident(1, "India", "moderate", "2026-09-17", "Centre slashes windfall tax on export of petrol, diesel and aviation turbine fuel Business Today"),
          source: "Business Today",
        },
        {
          ...incident(2, "India", "high", "2026-09-17", "Fuel exporters to pay less: Government cuts windfall tax on export of petrol, diesel, ATF Mathrubhumi English"),
          source: "Mathrubhumi English",
        },
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows).toHaveLength(1);
    const [development] = buildApacWeeklyDevelopments(rows, "2026-09-17");
    expect(development.sourceCount).toBe(2);
    expect(development.sourceEvidence).toEqual(expect.arrayContaining(["Business Today", "Mathrubhumi English"]));
    expect(development.whatChanged).not.toMatch(/Reporting indicates that|Business Today|Mathrubhumi|a operational/i);
    expect(development.whatChanged).toContain("India reduced export-linked fuel taxation");
  });

  it("APAC BLUF stays concise and evidence-specific", () => {
    const developments = buildApacWeeklyDevelopments([
      incident(1, "India", "high", "2026-09-17", "Government cuts windfall tax on export of petrol, diesel and ATF"),
      incident(2, "Japan", "high", "2026-09-17", "Typhoon closes airport and disrupts power supply"),
      incident(3, "Myanmar", "high", "2026-09-17", "Drone activity shuts Mandalay airport"),
      incident(4, "Australia", "moderate", "2026-09-17", "Australia migration overhaul changes visa rules"),
    ], "2026-09-17");
    const outlook = buildApacWeeklyBluf(developments);
    expect(outlook.split(/\s+/).filter(Boolean).length).toBeGreaterThan(10);
    expect(outlook.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(120);
  });

  it("APAC rejects local egg-truck robbery and casualty aftermath without ongoing disruption", () => {
    const rejected = curateRegionalWeeklyIncidents(
      [
        incident(1, "Bangladesh", "moderate", "2026-09-17", "Pickup loaded with eggs robbed in Narsingdi: 5 arrested, goods recovered"),
        incident(2, "Philippines", "high", "2026-09-17", "Philippine ferry fire death toll reaches 35"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rejected).toHaveLength(0);
  });

  it("APAC keeps an ongoing transport disruption after a casualty event", () => {
    const rows = curateRegionalWeeklyIncidents(
      [{
        ...incident(1, "Philippines", "high", "2026-09-17", "Ferry service remains suspended after fire as investigation continues"),
        summary: "The ferry service remains suspended and the port authority has restricted departures pending a safety review.",
      }],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows).toHaveLength(1);
  });

  it("APAC outlook envelopes remain distinct and contain no recorded-a boilerplate", () => {
    const developments = buildApacWeeklyDevelopments([
      incident(1, "India", "high", "2026-09-17", "Government cuts windfall tax on export of petrol, diesel and ATF"),
      incident(2, "Japan", "high", "2026-09-17", "Typhoon closes airport and disrupts power supply"),
      incident(3, "Myanmar", "high", "2026-09-17", "Drone activity shuts Mandalay airport"),
      incident(4, "Australia", "moderate", "2026-09-17", "Australia migration overhaul changes visa rules"),
    ], "2026-09-17");
    const regionalOutlook = buildApacWeeklyBluf(developments);
    const finalOutlook = buildApacWeeklyOutlook(developments);
    expect(regionalOutlook.split(/\s+/).filter(Boolean).length).toBeGreaterThan(10);
    expect(regionalOutlook.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(120);
    expect(finalOutlook.split(/\s+/).filter(Boolean).length).toBeGreaterThan(10);
    expect(finalOutlook.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(120);
    expect(`${regionalOutlook} ${finalOutlook}`).not.toMatch(/recorded a operational|recorded a (?:security|regulatory|weather|operational)/i);
    expect(`${regionalOutlook} ${finalOutlook}`).not.toMatch(/operators should|assessment remains|selected developments|confirmed recovery evidence/i);
  });

  it("APAC rejects an egg robbery even when the feed mentions goods, cargo and supply chain", () => {
    const developments = buildApacWeeklyDevelopments([{
      ...incident(1, "Bangladesh", "moderate", "2026-09-17", "Pickup loaded with eggs robbed in Narsingdi"),
      summary: "A pickup loaded with eggs was robbed; goods were recovered and the local supply chain was unaffected.",
    }], "2026-09-17");
    expect(developments).toHaveLength(0);
  });

  it("keeps trivial truck/liquor incidents and off-region Manchester aviation out of APAC", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "Bangladesh", "high", "2026-09-17", "Truck accident spills liquor; looters take bottles"),
        incident(2, "India", "high", "2026-09-17", "Manchester airline emergency diverts flights"),
        incident(3, "Oman", "high", "2026-09-17", "Cargo vessel struck off Oman coast; route access restricted"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows.map((row) => row.id)).toEqual([]);
    const oman = {
      ...incident(4, "Oman", "high", "2026-09-17", "Cargo vessel struck off Oman coast; route access restricted"),
      analystNotes: "auto-scraped:regional-weekly:cyber:Regional Weekly cyber",
    };
    expect(buildRegionalDevelopments([oman], "2026-09-17", "middle_east_weekly")[0]?.category)
      .toBe("Operational Disruption");
  });

  it("APAC selected What Changed fields contain no reported or recorded category fallbacks", () => {
    const developments = buildApacWeeklyDevelopments([
      incident(1, "India", "high", "2026-09-17", "Government cuts windfall tax on export of petrol, diesel and ATF"),
      incident(2, "Myanmar", "high", "2026-09-17", "Arakan Army offensive affects the border"),
      incident(3, "Japan", "high", "2026-09-17", "Typhoon closes airport and disrupts power supply"),
    ], "2026-09-17");
    for (const development of developments) {
      expect(development.whatChanged).not.toMatch(/\b(?:reported|recorded) an? (?:security|regulatory|weather|operational|political|cyber) change\b/i);
    }
  });

  it("APAC rejects generic diplomatic condemnations and applies event-family precedence", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "India", "low", "2026-09-17", "India, Israel unequivocally condemn terrorism in all its forms and manifestations"),
        incident(2, "Philippines", "low", "2026-09-17", "Manibela starts 2-day transport strike vs oil price hikes"),
        incident(3, "India", "low", "2026-09-17", "Government cuts export duty across the board on petrol, diesel and aviation turbine fuel"),
        incident(4, "Papua New Guinea", "moderate", "2026-09-17", "Panguna Landowners Interim Council condemn arson attack on LMEL Machinery in Panguna"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows.map((row) => row.id)).not.toContain(1);
    const developments = buildApacWeeklyDevelopments(rows, "2026-09-17");
    const strike = developments.find((row) => row.country === "Philippines");
    const fuel = developments.find((row) => row.country === "India" && row.category === "Energy");
    const arson = developments.find((row) => row.title.includes("Panguna"));
    expect(strike?.operationalImpact).toMatch(/public transport|employee movement/i);
    expect(strike?.operationalImpact).not.toMatch(/fuel pricing|trade economics/i);
    expect(fuel?.operationalImpact).toMatch(/fuel.export pricing|trade economics/i);
    expect(fuel?.operationalImpact).not.toMatch(/passenger movement and air cargo/i);
    expect(arson?.operationalImpact).toMatch(/site assets|investigation/i);
    expect(arson?.outlook7Days).toMatch(/investigation|site-access/i);
  });

  it("APAC keeps complete titles and sentence-complete BLUF and Outlook", () => {
    const developments = buildApacWeeklyDevelopments([
      incident(1, "Australia", "high", "2026-09-17", "Australia migration overhaul: Crackdown on visa hopping, tighter rules for student families and visitor visas with implementation guidance"),
      incident(2, "India", "high", "2026-09-17", "Government cuts export duty across the board on petrol, diesel and aviation turbine fuel"),
      incident(3, "Myanmar", "high", "2026-09-17", "Drone activity shuts Mandalay airport"),
    ], "2026-09-17");
    expect(developments.find((row) => row.country === "Australia")?.title).not.toMatch(/…|\.\.\./);
    const bluf = buildApacWeeklyBluf(developments);
    const outlook = buildApacWeeklyOutlook(developments);
    expect(bluf).not.toMatch(/…|\.\.\./);
    expect(outlook).not.toMatch(/…|\.\.\./);
    expect(bluf.trim()).toMatch(/[.!?]$/);
    expect(outlook.trim()).toMatch(/[.!?]$/);
  });

  it("APAC keeps airline bankruptcy outside the India fuel-policy family", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        {
          ...incident(1, "India", "high", "2026-09-17", "Centre slashes windfall tax on export of petrol, diesel and aviation turbine fuel"),
          source: "Business Today",
        },
        {
          ...incident(2, "India", "high", "2026-09-17", "Fuel exporters to pay less: Government cuts windfall tax on export of petrol, diesel, ATF"),
          source: "Mathrubhumi English",
        },
        incident(3, "Latvia", "high", "2026-09-17", "AirBaltic seeks bankruptcy protection as jet fuel costs surge"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].country).toBe("India");
    const developments = buildApacWeeklyDevelopments([
      ...rows,
      { ...incident(4, "India", "high", "2026-09-17", "AirBaltic seeks bankruptcy protection as jet fuel costs surge") },
    ], "2026-09-17");
    expect(developments.filter((row) => /AirBaltic/i.test(row.title))).toHaveLength(0);
    expect(developments.filter((row) => /fuel taxation/i.test(row.whatChanged))).toHaveLength(1);
  });

  it("APAC rejects declarations, local protests and retrospective commendations without operating effects", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "India", "low", "2026-09-17", "BRICS New Delhi Declaration adopted: Terrorism, conflict resolution, tariff concerns addressed"),
        incident(2, "Philippines", "moderate", "2026-09-17", "Groups hold anti-Pax Silica protest in Angeles City"),
        incident(3, "South Korea", "moderate", "2026-09-17", "U.S. NCIS Commends Busan Police for Port Intrusion Arrests"),
        incident(4, "India", "high", "2026-09-17", "Government cuts export duty on petrol, diesel and aviation turbine fuel"),
      ],
      "apac_weekly",
      "2026-09-17",
    );
    expect(rows.map((row) => row.id)).toEqual([4]);
  });

  it("APAC fuel policy takes precedence over aviation in Polestar View and Outlook", () => {
    const [development] = buildApacWeeklyDevelopments([
      incident(1, "India", "high", "2026-09-17", "Government cuts export duty on petrol, diesel and aviation turbine fuel"),
    ], "2026-09-17");
    expect(development.polestarView).toMatch(/policy-and-pricing|fuel markets/i);
    expect(development.polestarView).not.toMatch(/aviation assessment|access constraint/i);
    expect(development.outlook7Days).toMatch(/export-duty schedule|fuel-market pricing/i);
    expect(development.outlook7Days).not.toMatch(/airport status|flight cancellations/i);
  });

  it("Middle East uses the structured weekly editorial model without padding", () => {
    const rows = curateRegionalWeeklyIncidents(
      [
        incident(1, "Syria", "high", "2026-09-17", "Armed clashes restrict border access"),
        incident(2, "Iraq", "moderate", "2026-09-17", "New customs regulation changes import compliance"),
        incident(3, "Yemen", "high", "2026-09-17", "Port closure disrupts shipping and cargo"),
        incident(4, "Iran", "moderate", "2026-09-17", "Earthquake disrupts roads and electricity"),
        incident(5, "Saudi Arabia", "low", "2026-09-17", "Routine local police patrol"),
      ],
      "middle_east_weekly",
      "2026-09-17",
    );
    expect(rows.map((row) => row.country)).toEqual(
      expect.arrayContaining(["Syria", "Iraq", "Yemen", "Iran"]),
    );
    const developments = buildRegionalDevelopments(rows, "2026-09-17", "middle_east_weekly");
    expect(developments.length).toBeLessThanOrEqual(6);
    expect(developments.every((row) => row.operationalImpact && row.polestarView && row.outlook7Days !== undefined)).toBe(true);
    expect(buildRegionalMapPoints(rows, "middle_east_weekly")).toHaveLength(rows.length);
    expect(buildRegionalGlanceItems(developments, "middle_east_weekly").length).toBeLessThanOrEqual(5);
  });

  it("Middle East prose uses regional wording, including the empty-week outlook", () => {
    const developments = buildRegionalDevelopments([
      incident(1, "Syria", "high", "2026-09-17", "Armed clashes restrict border access"),
      incident(2, "Qatar", "moderate", "2026-09-17", "New visa regulation changes compliance"),
    ], "2026-09-17", "middle_east_weekly");
    expect(buildStructuredRegionalBluf(developments, "middle_east_weekly")).toMatch(/Middle East/i);
    expect(buildStructuredRegionalOutlook(developments, "middle_east_weekly")).toMatch(/Middle East/i);
    expect(buildStructuredRegionalOutlook([], "middle_east_weekly")).toMatch(/Middle East/);
  });

  it("Middle East business implications synthesise non-travel channels", () => {
    const developments = buildRegionalDevelopments([
      {
        ...incident(1, "Iraq", "high", "2026-09-17", "Port closure disrupts cargo operations"),
        summary: "The port closure affects cargo logistics, facility access and supply-chain continuity.",
      },
      {
        ...incident(2, "Saudi Arabia", "moderate", "2026-09-17", "New customs regulation changes import compliance"),
        summary: "The regulation changes customs compliance and market-access obligations for importers.",
      },
    ], "2026-09-17", "middle_east_weekly");
    const narrative = buildRegionalBusinessImplicationsNarrative(developments);
    expect(narrative).toMatch(/operations and assets/i);
    expect(narrative).toMatch(/supply-chain and logistics/i);
    expect(narrative).toMatch(/regulatory and market-access/i);
    expect(narrative).toMatch(/continuity/i);
    expect(narrative).not.toMatch(/No changed regional travel/i);
  });
});