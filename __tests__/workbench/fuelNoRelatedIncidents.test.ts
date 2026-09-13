import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("Fuel Watch publication structure", () => {
  it("does not render or configure Related Incidents", () => {
    const preview = read(
      "artifacts/workbench/src/components/ReportPreview.tsx",
    );
    const pdf = read(
      "artifacts/workbench/src/lib/exportTopicReportPdf.ts",
    );
    const controls = read(
      "artifacts/workbench/src/lib/topicSectionOverrides.ts",
    );

    expect(preview).not.toContain("fuelRelatedRows");
    expect(pdf).not.toContain("fuelRelatedRows");

    const fuelControls = controls.match(
      /fuel:\s*\[([\s\S]*?)\n\s*\],\n\s*generic:/,
    )?.[1];
    expect(fuelControls).toBeDefined();
    expect(fuelControls).not.toContain("related-incidents");
    expect(fuelControls).not.toContain("Related Incidents");
  });
});