import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("incident consumers preserve the shared relevance boundary", () => {
  it.each([
    "artifacts/workbench/src/pages/CargoWatch.tsx",
    "artifacts/workbench/src/pages/ReportEditor.tsx",
    "artifacts/workbench/src/pages/CountryReport.tsx",
  ])("%s never requests raw irrelevant incidents", (path) => {
    expect(source(path)).not.toContain("includeIrrelevant");
  });

  it("fails closed at the API boundary for unevaluated rows", () => {
    const apiGate = source("artifacts/api-server/src/lib/relevanceFilter.ts");
    expect(apiGate).toContain('eq(incidentsTable.relevanceStatus, "relevant")');
    expect(apiGate).not.toContain("isNull(incidentsTable.relevanceStatus)");
  });
});