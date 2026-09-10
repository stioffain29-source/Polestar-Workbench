import {
  finalizeFlashpointPublication,
  validateFlashpointFinalEvidenceAudit,
} from "../flashpointPublication";
import { resolveFlashpointRenderedModel } from "../flashpointReportDataset";
import type { FlashpointReportIncident } from "../flashpointReportDataset";
import { validFlashpointSemantic } from "../../../../../test-utils/flashpointTestFixtures";

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
});
