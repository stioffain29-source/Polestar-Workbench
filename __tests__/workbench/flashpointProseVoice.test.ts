/**
 * Sprint 1c — FP-14 editorial voice.
 * Steve Sep 2026: distinct sections, no dataset narration, no meta filler.
 */
import {
  buildFlashpointReportDataset,
  FLASHPOINT_BANNED_PROSE_RE,
  validateFlashpointReportDataset,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";
import { validFlashpointSemantic } from "../../test-utils/flashpointTestFixtures";

const ISSUE = "2026-09-07";

let nextId = 1;
function inc(over: Partial<FlashpointReportIncident>): FlashpointReportIncident {
  const base = {
    id: nextId++,
    title: "Workers stage protest over wages in Lahore",
    summary: "Union members marched through the city centre.",
    topic: "flashpoint",
    country: "Pakistan",
    location: "Lahore",
    severity: "low",
    occurredAt: "2026-09-04T08:00:00Z",
    ...over,
  } as unknown as FlashpointReportIncident;
  return { ...base, ...validFlashpointSemantic(base), ...over };
}

describe("Sprint 1c FP-14 editorial voice", () => {
  it("does not use Steve-flagged template narration in client-facing sections", () => {
    const rows = [
      inc({ title: "PTI supporters clash with police outside Adiala jail", severity: "high", country: "Pakistan" }),
      inc({ title: "Goods transporters' strike disrupts supply across Pakistan", country: "Pakistan", severity: "moderate" }),
      inc({ title: "Students rally against tuition hikes in Dhaka", country: "Bangladesh", location: "Dhaka" }),
      inc({ title: "Indian police fire tear gas to disperse youth protesters in Jharkhand", country: "India", severity: "high", location: "Jharkhand" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    const clientText = [
      ds.autoExecutiveSummary,
      ds.regionalCountryRead,
      ds.autoWhatMatters,
      ds.autoPolestarView,
    ].join("\n");
    for (const re of FLASHPOINT_BANNED_PROSE_RE) {
      expect(clientText).not.toMatch(re);
    }
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });

  it("keeps Executive Summary, Country View, What Matters and Polestar View distinct", () => {
    const rows = [
      inc({ title: "PTI supporters clash with police outside Adiala jail", severity: "high", country: "Pakistan" }),
      inc({ title: "Goods transporters' strike disrupts supply across Pakistan", country: "Pakistan", severity: "moderate" }),
      inc({ title: "Students rally against tuition hikes in Dhaka", country: "Bangladesh", location: "Dhaka" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.autoExecutiveSummary).not.toMatch(/sections follow/i);
    expect(ds.autoExecutiveSummary).not.toMatch(/Overall protest posture/i);
    expect(ds.regionalCountryRead).not.toMatch(/\bdriven by\b.{0,40}\bmostly\b/i);
    expect(ds.autoPolestarView).not.toMatch(/^Risk level:/i);
    expect(ds.autoWhatMatters).not.toMatch(/the practical risk this week was/i);
    expect(validateFlashpointReportDataset(ds)).toEqual([]);
  });

  it("Country View names operational lead items instead of issue taxonomy", () => {
    const rows = [
      inc({ title: "Farmers march to parliament over crop prices", country: "India", location: "Delhi", severity: "moderate" }),
      inc({ title: "Traders strike over new tax rules in Mumbai", country: "India", location: "Mumbai", severity: "low" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.regionalCountryRead).toMatch(/Lead item:/i);
    expect(ds.regionalCountryRead).not.toMatch(/mostly protests and organised action/i);
  });

  it("Polestar View leads with actionable movement guidance", () => {
    const rows = [
      inc({ title: "Goods transporters' strike disrupts supply across Pakistan", country: "Pakistan", severity: "moderate" }),
      inc({ title: "Students rally in Dhaka", country: "Bangladesh", location: "Dhaka", severity: "low" }),
    ];
    const ds = buildFlashpointReportDataset(rows, "flashpoint", ISSUE);
    expect(ds.autoPolestarView).toMatch(/freight|journey|transport|movement/i);
    expect(ds.autoPolestarView).not.toMatch(/Risk level:/i);
  });
});
