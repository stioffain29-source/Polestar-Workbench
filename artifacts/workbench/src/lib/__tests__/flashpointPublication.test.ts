import {
  assertFlashpointPublication,
  finalizeFlashpointPublication,
  validateFlashpointFinalEvidenceAudit,
} from "../flashpointPublication";
import { resolveFlashpointRenderedModel } from "../flashpointReportDataset";
import type { FlashpointReportIncident } from "../flashpointReportDataset";
import { validFlashpointSemantic } from "../../../../../test-utils/flashpointTestFixtures";
import { buildProtestScheduleModel } from "../protestScheduleModel";

const ISSUE = "2026-08-05";
let id = 1;
function incident(
  title: string,
  over: Partial<FlashpointReportIncident> = {},
): FlashpointReportIncident {
  const row: FlashpointReportIncident = {
    id: id++,
    title,
    summary: "Residents gathered and marched through the city centre.",
    topic: "flashpoint",
    severity: "moderate",
    occurredAt: "2026-08-03T10:00:00Z",
    country: "India",
    location: "Delhi",
    source: "Example News",
    ...over,
  };
  return { ...row, ...validFlashpointSemantic(row) };
}

describe("Flashpoint shared publication architecture", () => {
  it("passes the shared evidence audit on canonical auto prose", () => {
    const bundle = finalizeFlashpointPublication({
      incidents: [
        incident("Workers march in Seoul over wages", { country: "South Korea", location: "Seoul" }),
        incident("Traders protest in Dhaka over tax rules", { country: "Bangladesh", location: "Dhaka" }),
      ],
      issueDate: ISSUE,
    });
    expect(bundle.auditIssues).toEqual([]);
  });

  it("does not crown one country when incident counts tie", () => {
    const bundle = finalizeFlashpointPublication({
      incidents: [
        incident("Seoul rally one", { country: "South Korea", location: "Seoul" }),
        incident("Seoul rally two", { country: "South Korea", location: "Seoul" }),
        incident("Dhaka rally one", { country: "Bangladesh", location: "Dhaka" }),
        incident("Dhaka rally two", { country: "Bangladesh", location: "Dhaka" }),
      ],
      issueDate: ISSUE,
    });
    const card = bundle.model.fastFacts.find((item) => item.label === "Most Affected Country")?.value ?? "";
    expect(card).toMatch(/South Korea/);
    expect(card).toMatch(/Bangladesh/);
    expect(bundle.model.dataset.autoExecutiveSummary).toMatch(/share the heaviest volume|share the lead on volume|clustered in/);
    expect(bundle.auditIssues.map((issue) => issue.code)).not.toContain("RANKING_TIE");
  });

  it("names the unrest table's max severity, not a lower-severity geography", () => {
    const bundle = finalizeFlashpointPublication({
      incidents: [
        incident("Police clash with protesters in Kathmandu", {
          country: "Nepal",
          location: "Kathmandu",
          severity: "high",
          summary: "Riot police used tear gas after public disorder in the square.",
        }),
        incident("March through Dhaka over wage arrears", {
          country: "Bangladesh",
          location: "Dhaka",
          severity: "moderate",
        }),
      ],
      issueDate: ISSUE,
    });
    expect(bundle.model.prose.civilUnrestRead).toMatch(/Kathmandu|Nepal/i);
    expect(bundle.auditIssues.map((issue) => issue.code)).not.toContain("SEVERITY_PARITY");
  });

  it("replaces persisted generic Watch Next seed with canonical indicators", () => {
    const rows = [
      incident("Workers march in Seoul over wages", { country: "South Korea", location: "Seoul" }),
    ];
    const seeded = finalizeFlashpointPublication({
      incidents: rows,
      issueDate: ISSUE,
    });
    const bundle = finalizeFlashpointPublication({
      incidents: rows,
      issueDate: ISSUE,
      report: {
        datasetFingerprint: seeded.model.fingerprint,
        watchNext:
          "Watch for confirmed mobilisation, enforcement notices, transport disruption and changes to access conditions.\n\nWatch for police statements, union notices and any move that could affect staff routes in the week ahead.",
      },
    });
    expect(bundle.model.prose.watchNext).not.toMatch(/Watch for confirmed mobilisation/i);
    expect(bundle.auditIssues.map((issue) => issue.code)).not.toContain("WATCH_NEXT_UNGROUNDED");
  });

  it("uses the current publication window, removes older incidents, and keeps the conclusion plain", () => {
    const bundle = finalizeFlashpointPublication({
      incidents: [
        incident("Mob targeted TU Cricket Ground during Gen Z protests", {
          id: 9001,
          country: "Nepal",
          location: "Kathmandu",
          occurredAt: "2026-09-09T09:24:59Z",
          summary: "A crowd approached the cricket ground during earlier protests.",
        }),
        incident("Bangkok march affects a named road", {
          id: 9002,
          country: "Thailand",
          location: "Bangkok",
          occurredAt: "2026-09-14T10:00:00Z",
          summary: "A protest temporarily restricted access on a named road in Bangkok.",
        }),
      ],
      issueDate: "2026-09-20",
    });
    const renderedTitles = [
      ...bundle.model.dataset.activismRows,
      ...bundle.model.dataset.unrestRows,
    ].map((row) => row.title);
    expect(bundle.model.dataset.reportingPeriodLong).toMatch(/14 September 2026.*20 September 2026/i);
    expect(renderedTitles).not.toContain("Mob targeted TU Cricket Ground during Gen Z protests");
    expect(bundle.model.prose.whatMatters).toMatch(/main concern this week|Most reported activity|No single country/i);
    expect(bundle.model.prose.whatMatters).not.toMatch(/accepted activity by volume|operational relevance|mixed environment/i);
    expect(bundle.model.prose.polestarView).toMatch(/Keep normal regional operations/i);
    expect(bundle.model.prose.polestarView).not.toMatch(/No region-wide deterioration is established/i);
  });

  it("fails closed when persisted prose uses file/table narration", () => {
    const built = finalizeFlashpointPublication({
      incidents: [incident("Workers march in Delhi over wages")],
      issueDate: ISSUE,
    });
    const poisoned = resolveFlashpointRenderedModel({
      dataset: built.model.dataset,
      report: {
        forecastRead: "Confirmed upcoming events are listed in the table above.",
        datasetFingerprint: built.model.fingerprint,
      },
    });
    const issues = validateFlashpointFinalEvidenceAudit(poisoned);
    expect(issues.map((issue) => issue.code)).toContain("BACKEND_CONFIDENCE_LEAK");
  });

  it("does not block export when unrest most-serious is below a higher activism peak", () => {
    const bundle = finalizeFlashpointPublication({
      incidents: [
        incident("Police clash with protesters in Kathmandu", {
          country: "Nepal",
          location: "Kathmandu",
          severity: "high",
          summary: "Riot police used tear gas after public disorder in the square.",
        }),
        incident("Nationwide strike shuts ports in Seoul", {
          country: "South Korea",
          location: "Seoul",
          severity: "extreme",
          summary: "Workers blocked roads and halted operations during a general strike.",
        }),
      ],
      issueDate: ISSUE,
    });
    expect(bundle.auditIssues.map((issue) => issue.code)).not.toContain("SEVERITY_PARITY");
  });

  it("allows warning findings through the Flashpoint publication boundary", () => {
    const bundle = finalizeFlashpointPublication({
      incidents: [incident("Workers march in Delhi over wages")],
      issueDate: ISSUE,
    });
    expect(() =>
      assertFlashpointPublication({
        ...bundle,
        auditIssues: [
          {
            code: "VAGUE_CHANGE",
            section: "whatMatters",
            message: "Use a named development.",
            level: "WARNING",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("blocks only ERROR findings at the Flashpoint publication boundary", () => {
    const bundle = finalizeFlashpointPublication({
      incidents: [incident("Workers march in Delhi over wages")],
      issueDate: ISSUE,
    });
    expect(() =>
      assertFlashpointPublication({
        ...bundle,
        auditIssues: [
          {
            code: "VAGUE_CHANGE",
            section: "whatMatters",
            message: "Use a named development.",
            level: "ERROR",
          },
        ],
      }),
    ).toThrow(/VAGUE_CHANGE/);
  });

  it("adds schedule context to Watch Next without adding it to canonical incidents", () => {
    const incidentRows = [incident("Workers march in Delhi over wages")];
    const schedule = buildProtestScheduleModel(
      {
        confirmedPlanned: [{
          id: 900,
          sourceName: "schedule",
          sourceUrl: "https://example.test/protest",
          sourceTitle: "Union notice",
          sourcePublishedAt: "2026-08-05T00:00:00Z",
          eventDate: "2026-08-06T00:00:00Z",
          country: "Japan",
          city: "Tokyo",
          venue: "Station",
          eventType: "rally",
          issue: "wages",
          organiser: "Union",
          description: null,
          startTime: null,
          attendance: null,
          disruptionPotential: "Low",
          confidence: "Moderate",
          status: "Confirmed",
          collectedAt: "2026-08-05T00:00:00Z",
          searchCompletedAt: "2026-08-05T00:00:00Z",
          dedupKey: "900",
        }],
        possible: [],
        searchCompletedAt: "2026-08-05T00:00:00Z",
      },
    );
    const bundle = finalizeFlashpointPublication({
      incidents: incidentRows,
      issueDate: ISSUE,
      protestSchedule: schedule,
    });
    expect(bundle.model.prose.watchNext).toMatch(/Tokyo, Japan/);
    expect(bundle.model.dataset.canonical.periodRows).toHaveLength(1);
    expect(bundle.model.dataset.fastFacts.find((card) => card.label === "Distinct Incidents")?.value).toBe("1");
  });
});
