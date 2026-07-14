import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  routeOfficialSource,
  assignAnalystFlags,
  simulateOfficialSourceIngest,
} from "../../lib/ingest/src/m15";
import { scanIngestForSpotReportWrites } from "./spotReportGuardLib";

const REPO = process.cwd();

function readRepoFile(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

/** Hormuz / Strait of Hormuz scenario — three official source families (M1.5-T15). */
const HORMUZ_CENTCOM = {
  title: "U.S. Forces Complete Strikes in the Strait of Hormuz Region",
  body: "U.S. Central Command forces conducted precision strikes near the Strait of Hormuz in response to Iran-backed militant activity. Merchant vessels and commercial shipping in the Red Sea and Gulf of Oman faced elevated risk during the operation.",
};

const HORMUZ_UKMTO = {
  title: "003-26 Update 002 - ADVISORY",
  body: `UKMTO is aware of elevated maritime security activity across the Arabian Gulf, Gulf of Oman, and the Strait of Hormuz.
Significant Iranian military activity contributes to elevated threat to commercial shipping.`,
};

const HORMUZ_JMIC_THREAT = {
  title: "JMIC Advisory Note: 012-26 | Southern Corridor Available",
  body: `Provider: JMIC
Region: Strait of Hormuz
Threat level: SUBSTANTIAL

JMIC guidance to mariners on transit procedures for the Strait of Hormuz southern route.`,
};

const HORMUZ_JMIC_ESCALATION = {
  title: "JMIC Escalation Advisory — Arabian Gulf",
  body: "JMIC reports elevated threat to commercial shipping amid regional military activity and kinetic incidents near the Strait of Hormuz.",
};

describe("M1.5 Hormuz walkthrough — routing (M1.5-T15)", () => {
  it("CENTCOM Hormuz release routes to Conflict + Shipping", () => {
    const routed = routeOfficialSource({
      source: "centcom",
      ...HORMUZ_CENTCOM,
    });
    expect(routed.primaryWatch).toBe("conflict");
    expect(routed.watchTags).toEqual(expect.arrayContaining(["conflict", "shipping"]));
  });

  it("UKMTO Hormuz escalation advisory routes to Shipping + Conflict", () => {
    const routed = routeOfficialSource({
      source: "ukmto",
      ...HORMUZ_UKMTO,
    });
    expect(routed.primaryWatch).toBe("shipping");
    expect(routed.watchTags).toEqual(expect.arrayContaining(["shipping", "conflict"]));
  });

  it("JMIC threat-level product stays on Shipping context", () => {
    const routed = routeOfficialSource({
      source: "partner",
      ...HORMUZ_JMIC_THREAT,
    });
    expect(routed.primaryWatch).toBe("shipping");
    expect(routed.watchTags).toEqual(["shipping"]);
  });

  it("JMIC escalation advisory routes to Shipping + Conflict", () => {
    const routed = routeOfficialSource({
      source: "partner",
      ...HORMUZ_JMIC_ESCALATION,
    });
    expect(routed.primaryWatch).toBe("shipping");
    expect(routed.watchTags).toEqual(expect.arrayContaining(["shipping", "conflict"]));
  });

  it("simulateOfficialSourceIngest never touches incidents or spot_reports", () => {
    const result = simulateOfficialSourceIngest({
      source: "partner",
      ...HORMUZ_JMIC_ESCALATION,
      hasOfficialUrl: true,
      hasPdf: false,
    });
    expect(result.primaryWatch).toBe("shipping");
    expect(result.watchTags).toContain("conflict");
    expect(scanIngestForSpotReportWrites()).toEqual([]);
  });

  it("partner persist uses routeOfficialSource + assignAnalystFlags at boundary", () => {
    const src = readRepoFile("lib/ingest/src/maritimePartnerProducts.ts");
    expect(src).toContain('source: "partner"');
    expect(src).toContain("routeOfficialSource");
    expect(src).toContain("assignAnalystFlags");
    expect(src).toContain("officialMilitaryMaritimeSourcesTable");
    expect(src).not.toMatch(/spotReportsTable/);
  });
});

describe("M1.5 Hormuz walkthrough — watch UI wiring (M1.5-T14/T15)", () => {
  it("Shipping mounts UKMTO + partner JMIC/CMF context panels", () => {
    const shipping = readRepoFile("artifacts/workbench/src/pages/Shipping.tsx");
    expect(shipping).toContain('source: "ukmto"');
    expect(shipping).toContain('watch: "shipping"');
    expect(shipping).toContain("Partner Maritime Context");
    expect(shipping).toContain('source: "partner"');
    expect(shipping).toContain('source: "jmic"');
    expect(shipping).toContain('source: "cmf"');
  });

  it("Conflict mounts CENTCOM + partner escalation panels", () => {
    const conflict = readRepoFile("artifacts/workbench/src/pages/Conflict.tsx");
    expect(conflict).toContain('source: "centcom"');
    expect(conflict).toContain('watch: "conflict"');
    expect(conflict).toContain("Partner Escalation Advisories");
    expect(conflict).toContain('source: "partner"');
  });

  it("analyst queue uses flag triage only in v1 (no review_status)", () => {
    const queue = readRepoFile(
      "artifacts/workbench/src/components/OfficialSourcesQueuePanel.tsx",
    );
    expect(queue).toContain("OFFICIAL_QUEUE_V1_TRIAGE_NOTE");
    expect(queue).not.toContain("reviewStatus");
    expect(queue).toContain("Review for Spot Report");
  });
});

describe("M1.5 Hormuz walkthrough — analyst flags at ingest boundary", () => {
  it("flags CENTCOM Hormuz strike as significant + possible spot report candidate", () => {
    const flags = assignAnalystFlags({
      source: "centcom",
      ...HORMUZ_CENTCOM,
      hasOfficialUrl: true,
      hasPdf: false,
    });
    expect(flags.flagSignificantIncident).toBe(true);
    expect(flags.flagMaritimeDisruption).toBe(true);
    expect(flags.flagEvidenceAvailable).toBe(true);
    expect(flags.flagPossibleSpotReport).toBe(true);
  });

  it("flags partner escalation without auto spot report creation path in ingest", () => {
    const flags = assignAnalystFlags({
      source: "partner",
      ...HORMUZ_JMIC_ESCALATION,
      hasOfficialUrl: true,
      hasPdf: false,
    });
    expect(flags.flagEscalationIndicator).toBe(true);
    expect(flags.flagEvidenceAvailable).toBe(true);
    expect(scanIngestForSpotReportWrites()).toEqual([]);
  });
});
