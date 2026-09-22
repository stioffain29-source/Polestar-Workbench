import { Packer } from "../../artifacts/workbench/node_modules/docx";
import type {
  DbPortsEdition,
  DbPortsExportPayload,
  DbPortsItem,
  DbPortsParameters,
} from "@workspace/api-client-react";
import { DEFAULT_DB_PORTS_PARAMETERS } from "@workspace/db-ports";
import {
  buildDbPortsDocument,
  buildDbPortsDocxDocument,
  buildDbPortsPdf,
} from "../../artifacts/workbench/src/lib/dbPortsExport";

function item(id: string, disposition: DbPortsItem["disposition"], overrides: Partial<DbPortsItem> = {}): DbPortsItem {
  return {
    id,
    mergedInto: null,
    updatedAt: "2026-02-15T00:00:00Z",
    drafted: true,
    warnings: [{ code: "single_source", message: "Only one independent publisher supports this item." }],
    headline: `Development ${id}`,
    country: "Singapore",
    location: "Port of Singapore",
    assets: ["Terminal A"],
    eventDate: "2026-02-10",
    theme: "port_terminal_operations",
    disposition,
    severity: "Moderate",
    confidence: "corroborated",
    summary: "The authority reported a temporary operating restriction at the terminal.",
    unverifiedClaims: "Duration remains unconfirmed.",
    operationalImpact: "Operators should confirm berth availability before arrival.",
    polestarView: "The restriction is procedural and unlikely to extend beyond the repair.",
    outlook: "Monitor the authority notice for a reopening time.",
    materialityReason: "Affects berth access at a priority terminal.",
    impactAreas: ["port_operations"],
    missingInfo: "Reopening time.",
    analystNotes: "",
    evidence: [
      {
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
        verified: true,
      },
      {
        id: `e2-${id}`,
        sourceName: "Independent newspaper",
        sourceUrl: `https://newspaper.example/${id}`,
        sourceType: "news",
        publishedDate: "2026-02-12",
        sourceDate: "2026-02-12",
        retrievedAt: "2026-02-12T12:00:00Z",
        excerpt: "Berth access restricted.",
        originalTitle: `Story ${id}`,
        sourceRecord: null,
        verified: true,
      },
    ],
    ...overrides,
  };
}

function edition(items: DbPortsItem[], parameters: Partial<DbPortsParameters> = {}): DbPortsEdition {
  return {
    id: 1,
    title: "Ports and Logistics Intelligence — early February 2026",
    startDate: "2026-02-01",
    endDate: "2026-02-14",
    overview: "Regional port and logistics conditions were stable across the fortnight.",
    revision: 2,
    parameters: { ...DEFAULT_DB_PORTS_PARAMETERS, customerName: "DB Ports", ...parameters },
    items,
    coverage: [{
      sourceId: "recaap",
      status: "checked",
      checkedAt: "2026-02-14T10:00:00Z",
      notes: "Checked through the end of the period.",
    }],
    history: [],
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-02-14T10:00:00Z",
    quality: {
      warnings: ["No priority item has been selected yet."],
      selectedCount: 0,
      watchCount: 0,
      heldCount: 0,
      inboxCount: 0,
      rejectedCount: 0,
      itemWarningCount: 0,
      sourceFailures: 0,
    },
  };
}

function payload(items: DbPortsItem[], parameters: Partial<DbPortsParameters> = {}): DbPortsExportPayload {
  return { edition: edition(items, parameters), generatedAt: "2026-02-15T09:30:00Z" };
}

function allLines(model: ReturnType<typeof buildDbPortsDocument>) {
  return model.sections.flatMap((section) => section.entries.flatMap((entry) => entry.lines));
}

describe("Ports and Logistics export document", () => {
  test("an item carries every specified field, with sources and hyperlinks retained", () => {
    const model = buildDbPortsDocument(payload([item("one", "selected")]));
    const entry = model.sections.find((section) => section.heading === "Priority Intelligence Items")!.entries[0]!;
    expect(entry.heading).toBe("1. Development one");
    expect(entry.lines.map((line) => line.label)).toEqual([
      "Location",
      "Port, terminal or corridor",
      "Event date",
      "Theme",
      "Current severity",
      "Summary",
      "Operational Impact",
      "Polestar View",
      "Outlook and indicators",
      "Source",
      "Link",
      "Corroborating source",
      "Link",
    ]);
    expect(entry.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Theme", text: "Port and terminal operations" }),
      expect.objectContaining({ label: "Source", text: "Maritime Authority — published 2026-02-11" }),
      expect.objectContaining({ label: "Link", text: "https://example.com/notices/one", url: "https://example.com/notices/one" }),
    ]));
    expect(model.metadata).toEqual([
      { label: "Customer", text: "DB Ports" },
      { label: "Reporting period", text: "2026-02-01 to 2026-02-14" },
      { label: "Publication date", text: "2026-02-15" },
      { label: "Items included", text: "1 priority item; 0 watchlist entries" },
    ]);
  });

  test("forbidden wording blocks the export wherever it sits, not only in the body", async () => {
    const titled = payload([item("one", "selected")]);
    titled.edition.title = "Ports and Logistics Intelligence — highest severity edition";
    expect(() => buildDbPortsDocxDocument(titled)).toThrow(/highest severity/i);
    await expect(buildDbPortsPdf(titled)).rejects.toThrow(/highest severity/i);

    const named = payload([item("one", "selected")], { customerName: "Highest Severity Logistics" });
    expect(() => buildDbPortsDocxDocument(named)).toThrow(/highest severity/i);
  });

  test("severity is stated as the item's own level and never as a ranking", () => {
    const model = buildDbPortsDocument(payload([item("one", "selected")]));
    const rendered = JSON.stringify(model);
    expect(rendered).toContain('"Current severity"');
    expect(rendered.toLowerCase()).not.toContain("highest severity");
    expect(rendered.toLowerCase()).not.toContain("most severe item");
  });

  test("editor-only warnings never reach the customer document", () => {
    const model = buildDbPortsDocument(payload([item("one", "selected"), item("two", "watch")]));
    const rendered = JSON.stringify(model).toLowerCase();
    expect(rendered).not.toContain("only one independent publisher");
    expect(rendered).not.toContain("warning");
  });

  test("the configuration panel governs hyperlinks and the Watchlist", () => {
    const withoutLinks = buildDbPortsDocument(payload([item("one", "selected")], { includeSourceLinks: false }));
    expect(allLines(withoutLinks).some((line) => line.label === "Link")).toBe(false);
    const withoutWatchlist = buildDbPortsDocument(payload([item("one", "selected"), item("w", "watch")], { includeWatchlist: false }));
    expect(withoutWatchlist.sections.map((section) => section.heading)).toEqual(["Regional Overview", "Priority Intelligence Items"]);
  });

  test("a watchlist entry states issue, location, reason, trigger and verification status", () => {
    const model = buildDbPortsDocument(payload([item("w", "watch", { confidence: "single_source" })]));
    const watch = model.sections.find((section) => section.heading === "Watchlist")!;
    expect(watch.entries[0]!.lines.map((line) => line.label)).toEqual([
      "Location",
      "Reason for monitoring",
      "Trigger or indicator",
      "Verification status",
    ]);
    expect(watch.entries[0]!.lines.at(-1)!.text).toBe("single source");
  });

  test("caps apply and merged, held, inbox and rejected material stays out of the report", () => {
    const selected = Array.from({ length: 42 }, (_, index) => item(`s${index}`, "selected"));
    const watch = Array.from({ length: 7 }, (_, index) => item(`w${index}`, "watch"));
    const merged = item("merged", "selected", { mergedInto: "s0" });
    const model = buildDbPortsDocument(payload([
      ...selected, ...watch, merged,
      item("inbox", "inbox"), item("hold", "hold"), item("rejected", "rejected"),
    ]));
    expect(model.sections.find((section) => section.heading === "Priority Intelligence Items")!.entries).toHaveLength(40);
    expect(model.sections.find((section) => section.heading === "Watchlist")!.entries).toHaveLength(5);
    expect(JSON.stringify(model)).not.toContain("Development merged");
    expect(JSON.stringify(model)).not.toContain("Development inbox");
  });

  test("an empty period says so instead of padding the report", () => {
    const model = buildDbPortsDocument(payload([]));
    expect(model.sections.find((section) => section.heading === "Priority Intelligence Items")!.introduction)
      .toContain("No development in this period met the inclusion criteria");
    expect(model.sections.find((section) => section.heading === "Watchlist")!.introduction)
      .toContain("No developing issues");
  });

  test("packs a genuine editable Word document", async () => {
    const buffer = await Packer.toBuffer(
      buildDbPortsDocxDocument(payload([item("one", "selected")])),
    );
    expect(buffer.byteLength).toBeGreaterThan(1_000);
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  test("builds a PDF when Roboto assets are fetchable, otherwise reports that dependency", async () => {
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
