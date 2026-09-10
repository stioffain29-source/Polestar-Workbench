/**
 * Sprint B class gates — held-out geographies, not the 10 Sep named stories.
 */
import { finalizeFlashpointPublication } from "../../artifacts/workbench/src/lib/flashpointPublication";
import {
  buildFlashpointReportDataset,
  validateFlashpointReportDataset,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";
import { validFlashpointSemantic } from "../../test-utils/flashpointTestFixtures";

const ISSUE = "2026-08-12";

let nextId = 1;
function inc(over: Partial<FlashpointReportIncident>): FlashpointReportIncident {
  const base = {
    id: nextId++,
    title: "Workers stage protest over wages",
    summary: "Union members marched through the city centre.",
    topic: "flashpoint",
    country: "Malaysia",
    location: "Kuala Lumpur",
    severity: "low",
    occurredAt: "2026-08-09T08:00:00Z",
    ...over,
  } as FlashpointReportIncident;
  return { ...base, ...validFlashpointSemantic(base), ...over };
}

const EDITORIAL_FAIL = [
  /\bmostly protests and organised action\b/i,
  /\bone reporting period\b/i,
  /\bconfirmed dates in Watch Next\b/i,
  /\bupcoming,\s*date confirmed\b/i,
  /\b(?:the )?(?:table|chart) (?:above|below)\b/i,
];

describe("Sprint B Flashpoint class gates", () => {
  it("does not crown a volume-tie winner (held-out countries)", () => {
    const bundle = finalizeFlashpointPublication({
      incidents: [
        inc({ title: "Kuala Lumpur teachers march on parliament", country: "Malaysia", location: "Kuala Lumpur" }),
        inc({ title: "Penang port workers walk out over safety", country: "Malaysia", location: "Penang" }),
        inc({ title: "Hanoi students rally against fee hikes", country: "Vietnam", location: "Hanoi" }),
        inc({ title: "Ho Chi Minh traders shut shops over tax", country: "Vietnam", location: "Ho Chi Minh City" }),
      ],
      issueDate: ISSUE,
    });
    const card = bundle.model.fastFacts.find((item) => item.label === "Most Affected Country")?.value ?? "";
    expect(card).toMatch(/Malaysia/);
    expect(card).toMatch(/Vietnam/);
    expect(bundle.model.dataset.autoExecutiveSummary).toMatch(/share the heaviest volume|share the lead on volume|clustered in/);
    expect(bundle.auditIssues.map((issue) => issue.code)).not.toContain("RANKING_TIE");
  });

  it("names unrest max severity from the unrest table, not a quieter volume lead", () => {
    const bundle = finalizeFlashpointPublication({
      incidents: [
        inc({
          title: "Police clash with protesters in Hanoi after tear gas is fired",
          summary: "Riot police used tear gas after public disorder in the square.",
          country: "Vietnam",
          location: "Hanoi",
          severity: "high",
        }),
        inc({
          title: "Kuala Lumpur union march over wages",
          country: "Malaysia",
          location: "Kuala Lumpur",
          severity: "moderate",
        }),
        inc({
          title: "Second Kuala Lumpur union rally over rostering",
          country: "Malaysia",
          location: "Kuala Lumpur",
          severity: "moderate",
        }),
      ],
      issueDate: ISSUE,
    });
    expect(bundle.model.prose.civilUnrestRead).toMatch(/Hanoi|Vietnam/i);
    expect(bundle.auditIssues.map((issue) => issue.code)).not.toContain("SEVERITY_PARITY");
  });

  it("keeps process rows out of the canonical set unless a live gathering is evidenced", () => {
    const ds = buildFlashpointReportDataset(
      [
        inc({
          title: "Human rights commission opens investigation into last month's protest deaths",
          summary: "The inquiry will take witness statements from officials.",
          country: "Mongolia",
          location: "Ulaanbaatar",
          severity: "high",
        }),
        inc({
          title: "Workers stage sit-in at city hall over unpaid wages",
          summary: "Demonstrators remained in a sit-in outside the municipal offices.",
          country: "Malaysia",
          location: "Kuala Lumpur",
          severity: "high",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    expect(ds.enriched.some((r) => /commission opens investigation/i.test(r.title))).toBe(false);
    expect(ds.enriched.some((r) => /sit-in/i.test(r.title))).toBe(true);
  });

  it("builds Activism Read from the activism table lead and Forecast from a forward indicator", () => {
    const ds = buildFlashpointReportDataset(
      [
        inc({
          title: "Union march through the commercial district over wages",
          summary: "Workers marched through the city centre and blocked one junction.",
          country: "Malaysia",
          location: "Kuala Lumpur",
          severity: "moderate",
        }),
        inc({
          title: "Civic groups announce planned protest for 20 August",
          summary: "Organisers say residents will march through the capital on 20 August.",
          country: "Vietnam",
          location: "Hanoi",
          severity: "moderate",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    expect(ds.activismRead).toContain(ds.activismRows[0].title);
    expect(ds.forecastRead).not.toMatch(/one reporting period/i);
    const firstForecast = ds.forecastRead.split(/\n+/)[0];
    expect(firstForecast.length).toBeGreaterThan(20);
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });

  it("locks What Matters, Implications and Watch Next as location-specific operational text (R27–R29)", () => {
    const ds = buildFlashpointReportDataset(
      [
        inc({
          title: "Police clash with protesters in Hanoi after tear gas is fired",
          summary: "Riot police used tear gas after public disorder in the square.",
          country: "Vietnam",
          location: "Hanoi",
          severity: "high",
        }),
        inc({
          title: "Kuala Lumpur union march over wages",
          country: "Malaysia",
          location: "Kuala Lumpur",
          severity: "moderate",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    const client = [ds.autoWhatMatters, ds.autoImplications, ds.autoWatchNext, ds.autoPolestarView].join("\n");
    expect(ds.autoWhatMatters).toMatch(/Hanoi|Vietnam|Kuala Lumpur|Malaysia/i);
    expect(ds.autoImplications).toMatch(/Hanoi|Vietnam|Kuala Lumpur|Malaysia|staff|journey|route|access/i);
    expect(ds.autoWatchNext).not.toMatch(/date confirmed/i);
    expect(ds.autoPolestarView).not.toMatch(/confirmed dates in Watch Next/i);
    for (const re of EDITORIAL_FAIL) {
      expect(client).not.toMatch(re);
    }
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });
});
