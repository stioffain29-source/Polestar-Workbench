import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("shared Conflict Watch client layout", () => {
  it("keeps preview and direct PDF in the specified reader order", () => {
    const structure = read("lib/conflictReportStructure.ts");
    const preview = read("components/ConflictReportPreview.tsx");
    const pdf = read("lib/exportConflictReportPdf.ts");
    const labels = [
      "fastFacts",
      "bluf",
      "topActivityAreas",
      "otherWatched",
      "whatMatters",
      "watchNext",
      "polestarView",
      "disclaimer",
    ];

    expect(structure).toContain('"cover"');
    for (const label of labels) {
      expect(preview.indexOf(`CONFLICT_CLIENT_SECTION_TITLES.${label}`)).toBeGreaterThan(-1);
      expect(pdf.indexOf(`CONFLICT_CLIENT_SECTION_TITLES.${label}`)).toBeGreaterThan(-1);
    }
    const previewPositions = labels.map((label) =>
      preview.indexOf(`CONFLICT_CLIENT_SECTION_TITLES.${label}`),
    );
    const pdfBody = pdf.slice(pdf.indexOf("// 1. Fast Facts."));
    const pdfPositions = labels.map((label) =>
      pdfBody.indexOf(`CONFLICT_CLIENT_SECTION_TITLES.${label}`),
    );
    expect(previewPositions).toEqual([...previewPositions].sort((a, b) => a - b));
    expect(pdfPositions).toEqual([...pdfPositions].sort((a, b) => a - b));

    // Related rows remain in the dataset/editor pipeline, not the client
    // surface. Supporting ReliefWeb context is likewise not client prose.
    expect(preview).not.toContain('title="Related Incidents"');
    expect(pdf).not.toContain('drawRelatedIncidents');
    expect(pdf).not.toContain("drawSituationalContextPdf");
  });

  it("guards subsection headings and keeps Polestar View together", () => {
    const preview = read("components/ConflictReportPreview.tsx");
    const pdf = read("lib/exportConflictReportPdf.ts");

    expect(preview).toContain('data-pdf-keep-with-next="true"');
    expect(preview).toContain('data-pdf-keep={keepTogether ? "true" : undefined}');
    expect(preview).toContain("keepTogether");
    expect(pdf).toContain("Math.min(lines.length, 3)");
    expect(pdf).toContain("drawSectionKeepTogether(");
    expect(pdf).toContain("firstNeed");
    expect(pdf).not.toContain("Related Incidents");
  });
});