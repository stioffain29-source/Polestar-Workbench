import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CENTCOM_HEALTH_NAME,
  CMF_HEALTH_NAME,
  JMIC_HEALTH_NAME,
  OFFICIAL_M15_HEALTH_TOPIC,
  UKMTO_HEALTH_NAME,
} from "../../lib/ingest/src/m15/health";
import { OFFICIAL_M15_GROUP } from "../../artifacts/api-server/src/lib/maritimeSources";
import { scanIngestForSpotReportWrites } from "./spotReportGuardLib";

const REPO = process.cwd();

function readRepoFile(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

describe("M1.5 end-to-end smoke + hardening (Step 13)", () => {
  it("ingestRunner includes CENTCOM + UKMTO + partner official passes in one run", () => {
    const src = readRepoFile("artifacts/api-server/src/lib/ingestRunner.ts");
    expect(src).toContain("runUkmtoIngest({ commit: true })");
    expect(src).toContain("runCentcomIngest({ commit: true })");
    expect(src).toContain("runMaritimePartnerProductsIngest({ commit: true })");
    expect(src).toContain("ukmtoOfficial");
    expect(src).toContain("centcomOfficial");
    expect(src).toContain("partnerOfficial");
  });

  it("official ingest modules write only to official_military_maritime_sources", () => {
    for (const file of [
      "lib/ingest/src/centcomIngest.ts",
      "lib/ingest/src/ukmtoIngest.ts",
      "lib/ingest/src/maritimePartnerProducts.ts",
    ]) {
      const src = readRepoFile(file);
      expect(src).toContain("officialMilitaryMaritimeSourcesTable");
      expect(src).not.toMatch(/insert\(\s*incidentsTable/);
      expect(src).not.toMatch(/insert\(\s*spotReportsTable/);
    }
  });

  it("Source Health topic registers CENTCOM and UKMTO under Primary Military group", () => {
    expect(OFFICIAL_M15_HEALTH_TOPIC).toBe("official_military_maritime");
    expect(OFFICIAL_M15_GROUP).toBe("Primary Military and Maritime Sources");
    expect(CENTCOM_HEALTH_NAME).toBe("CENTCOM Press Releases");
    expect(UKMTO_HEALTH_NAME).toBe("UKMTO Official Products");
    expect(JMIC_HEALTH_NAME).toBe("JMIC Official Products");
    expect(CMF_HEALTH_NAME).toBe("CMF Official Products");

    const maritime = readRepoFile("artifacts/api-server/src/lib/maritimeSources.ts");
    expect(maritime).toContain('key: "centcom"');
    expect(maritime).toContain('key: "ukmto"');
    expect(maritime).toContain('key: "jmic"');
    expect(maritime).toContain('key: "cmf"');
    expect(maritime).toContain(OFFICIAL_M15_GROUP);
  });

  it("integration status surfaces Primary Military and Maritime Sources", () => {
    const integration = readRepoFile("artifacts/api-server/src/lib/integrationStatus.ts");
    expect(integration).toContain("officialMilitaryMaritimeStatus");
    expect(integration).toContain("Primary Military and Maritime Sources");
  });

  it("Spot Report guard still passes — ingest never writes spot_reports (P1-D5)", () => {
    expect(scanIngestForSpotReportWrites()).toEqual([]);
  });

  it("Conflict and Shipping watches mount official-source panels (M1.5-T14)", () => {
    const conflict = readRepoFile("artifacts/workbench/src/pages/Conflict.tsx");
    const shipping = readRepoFile("artifacts/workbench/src/pages/Shipping.tsx");
    expect(conflict).toContain("OfficialMilitaryMaritimeWatchPanel");
    expect(conflict).toContain('source: "centcom"');
    expect(conflict).toContain('watch: "conflict"');
    expect(conflict).toContain("Partner Escalation Advisories");
    expect(conflict).toContain('source: "partner"');
    expect(shipping).toContain("OfficialMilitaryMaritimeWatchPanel");
    expect(shipping).toContain('source: "ukmto"');
    expect(shipping).toContain('watch: "shipping"');
    expect(shipping).toContain("Partner Maritime Context");
    expect(shipping).toContain('source: "jmic"');
    expect(shipping).toContain('source: "cmf"');
  });

  it("analyst queue route and Spot Report prefill are wired (M1.5-T12/T13)", () => {
    const app = readRepoFile("artifacts/workbench/src/App.tsx");
    const editor = readRepoFile("artifacts/workbench/src/pages/SpotReportEditor.tsx");
    expect(app).toContain("/sources/official-queue");
    expect(app).toContain("OfficialSourcesQueue");
    expect(editor).toContain("officialSourceId");
    expect(editor).toContain("fetchOfficialMilitaryMaritimeSource");
  });
});
