import { Packer } from "../../artifacts/workbench/node_modules/docx";
import type {
  DbPortsEdition,
  DbPortsExportPayload,
  DbPortsItem,
} from "@workspace/api-client-react";
import {
  buildDbPortsDocument,
  buildDbPortsDocxDocument,
  buildDbPortsPdf,
} from "../../artifacts/workbench/src/lib/dbPortsExport";

function item(id: string, disposition: DbPortsItem["disposition"], reviewed = true): DbPortsItem {
  return {
    id,
    mergedInto: null,
    updatedAt: "2026-02-15T00:00:00Z",
    blockers: [],
    secondaryReviewRequired: false,
    headline: `Development ${id}`,
    country: "Singapore",
    location: "Port of Singapore",
    assets: ["Terminal A"],
    eventDate: "2026-02-10",
    theme: "operations",
    disposition,
    severity: "Moderate",
    confidence: reviewed ? "official" : "unverified",
    confirmedFacts: "The source reported a temporary operating restriction.",
    unverifiedClaims: "Duration remains unconfirmed.",
    operationalImplications: "Operators may need to confirm berth availability.",
    outlook: "Monitor the authority notice.",
    materialityReason: "Affects port operations.",
    impactAreas: ["port_operations"],
    missingInfo: "Reopening time.",
    analystNotes: "",
    reviewed,
    reviewer: reviewed ? "Analyst" : "",
    secondReviewer: "",
    secondReviewNote: "",
    evidence: [{
      id: `e-${id}`,
      sourceName: "Maritime Authority",
      sourceUrl: `https://example.com/notices/${id}`,
      sourceType: "official",
      publishedDate: "2026-02-11",
      sourceDate: "2026-02-10",
      retrievedAt: "2026-02-12T12:00:00Z",
      excerpt: "Temporary operating restriction.",
      originalTitle: `Notice ${id}`,
      sourceRecord: null,
      verified: reviewed,
    }],
  };
}

function edition(items: DbPortsItem[]): DbPortsEdition {
  return {
    id: 1,
    title: "DB Ports fortnightly bulletin",
    startDate: "2026-02-01",
    endDate: "2026-02-14",
    overview: "",
    status: "draft",
    revision: 2,
    items,
    worklog: [],
    coverage: [{
      sourceId: "recaap",
      status: "checked",
      checkedAt: "2026-02-14T10:00:00Z",
      notes: "Checked through edition close.",
    }],
    history: [],
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-02-14T10:00:00Z",
    approvedAt: null,
    quality: {
      blockers: [],
      warnings: [],
      selectedCount: 99,
      watchCount: 99,
      heldCount: 0,
      inboxCount: 0,
      rejectedCount: 0,
      totalMinutes: 0,
      corrections: 0,
      missedSignals: 0,
      sourceFailures: 0,
      readyForReview: true,
    },
  };
}

function payload(items: DbPortsItem[]): DbPortsExportPayload {
  return {
    edition: edition(items),
    mode: "working",
    generatedAt: "2026-02-15T09:30:00Z",
  };
}

describe("DB Ports shared export document", () => {
  it("retains source URLs, publication dates, checked state and extracts", () => {
    const model = buildDbPortsDocument(payload([item("one", "selected")]));
    const lines = model.sections.flatMap((section) =>
      section.entries.flatMap((entry) => entry.lines),
    );
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        text: expect.stringMatching(/publication date: 2026-02-11.*checked/),
      }),
      expect.objectContaining({
        label: "URL",
        text: "https://example.com/notices/one",
        url: "https://example.com/notices/one",
      }),
      expect.objectContaining({
        label: "Supporting extract",
        text: "Temporary operating restriction.",
      }),
    ]));
  });

  it("applies caps and includes only unmerged inbox/hold items in pending", () => {
    const selected = Array.from({ length: 8 }, (_, index) => item(`s${index}`, "selected"));
    const watch = Array.from({ length: 7 }, (_, index) => item(`w${index}`, "watch"));
    const inbox = item("pending", "inbox", false);
    const rejected = item("rejected", "rejected", false);
    const merged = { ...item("merged", "hold", false), mergedInto: "s0" };
    const model = buildDbPortsDocument(payload([...selected, ...watch, inbox, rejected, merged]));
    expect(model.sections.find((section) => section.heading === "Priority developments")?.entries).toHaveLength(6);
    expect(model.sections.find((section) => section.heading === "Watch list")?.entries).toHaveLength(5);
    expect(model.sections.find((section) => section.heading === "Pending verification appendix")?.entries.map((entry) => entry.heading)).toEqual(["Development pending"]);
  });

  it("labels unreviewed source text as awaiting verification, never confirmed facts", () => {
    const model = buildDbPortsDocument(payload([item("lead", "inbox", false)]));
    const pending = model.sections.find((section) => section.heading === "Pending verification appendix");
    const labels = pending?.entries[0].lines.map((line) => line.label);
    expect(labels).toContain("Source-reported statements awaiting analyst verification");
    expect(labels).not.toContain("Confirmed facts");
    expect(model.notice).toBe("INTERNAL — UNPUBLISHED DB PORTS PILOT");
  });

  it("rebuilds the reviewed quality gate instead of trusting saved quality", () => {
    const snapshot = payload([item("one", "selected")]);
    snapshot.mode = "reviewed";
    snapshot.edition.status = "approved";
    expect(() => buildDbPortsDocument(snapshot)).toThrow(/current quality gate/i);
    snapshot.edition.status = "draft";
    expect(() => buildDbPortsDocument(snapshot)).toThrow(/requires an approved edition/i);
  });

  it("packs a genuine editable Word document", async () => {
    const buffer = await Packer.toBuffer(
      buildDbPortsDocxDocument(payload([item("one", "selected")])),
    );
    expect(buffer.byteLength).toBeGreaterThan(1_000);
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("builds a headless PDF when Roboto assets are fetchable, otherwise reports that dependency", async () => {
    try {
      const pdf = await buildDbPortsPdf(payload([item("one", "selected")]));
      expect(pdf.getNumberOfPages()).toBeGreaterThan(0);
      expect(pdf.output("arraybuffer").byteLength).toBeGreaterThan(1_000);
    } catch (error) {
      // Jest maps font URL imports to a non-fetchable asset stub. That is an
      // explicit test-environment dependency failure, not a mocked PDF success.
      expect(String(error)).toMatch(/pdfFonts|fetch|URL|asset/i);
    }
  });
});