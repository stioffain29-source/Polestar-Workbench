import type { InsertReport, Report } from "@workspace/db";
import {
  buildRegionalRebuildValues,
  matchesExpectedReportVersion,
} from "../src/lib/regionalReportRebuild";

describe("regional same-ID rebuild", () => {
  it("preserves analyst prose, provenance, status, and unrelated facts", () => {
    const target = {
      id: 42,
      status: "published",
      title: "Analyst custom title",
      hardNumbers: {
        retainedAudit: {
          owner: "analyst",
          nested: { retained: true, replaced: "old" },
        },
        regionalCanonicalReport: {
          editorialVersion: "regional-facts-v1",
          staleHiddenEngineField: true,
        },
        regionalEvidenceSnapshot: {
          facts: ["old"],
          staleHiddenEngineField: true,
        },
      },
      sectionOverrides: { hiddenSections: ["outlook"] },
      executiveSummary: "Analyst-authored assessment",
      proseProvenance: {
        executiveSummary: { kind: "ANALYST_EDITED" },
      },
    } as unknown as Report;
    const rebuilt = {
      title: "APAC Weekly",
      topic: "apac_weekly",
      issueDate: "2026-09-18",
      status: "draft",
      executiveSummary: "Generated replacement",
      hardNumbers: {
        retainedAudit: { nested: { replaced: "new" } },
        regionalCanonicalReport: {
          editorialVersion: "regional-facts-v2",
          facts: ["new"],
        },
        regionalEvidenceSnapshot: { facts: ["new"] },
      },
    } as InsertReport;

    const values = buildRegionalRebuildValues(target, rebuilt);

    expect(values.status).toBe("published");
    expect(values.title).toBe("Analyst custom title");
    expect(values.executiveSummary).toBe("Analyst-authored assessment");
    expect(values.proseProvenance).toBe(target.proseProvenance);
    expect(values.hardNumbers).toMatchObject({
      retainedAudit: {
        owner: "analyst",
        nested: { retained: true, replaced: "new" },
      },
    });
    expect((values.hardNumbers as Record<string, unknown>).regionalCanonicalReport)
      .toEqual({
        editorialVersion: "regional-facts-v2",
        facts: ["new"],
      });
    expect((values.hardNumbers as Record<string, unknown>).regionalEvidenceSnapshot)
      .toEqual({ facts: ["new"] });
    expect(values).not.toHaveProperty("id");
    expect(values).not.toHaveProperty("sectionOverrides");
  });

  it("rejects a stale optimistic-concurrency timestamp", () => {
    const submitted = new Date("2026-09-18T10:00:00.000Z");
    expect(matchesExpectedReportVersion(new Date(submitted), submitted)).toBe(true);
    expect(
      matchesExpectedReportVersion(
        new Date("2026-09-18T10:00:01.000Z"),
        submitted,
      ),
    ).toBe(false);
    expect(matchesExpectedReportVersion(null, submitted)).toBe(false);
  });
});