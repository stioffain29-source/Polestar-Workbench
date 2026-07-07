import {
  parseCsv,
  parsePowerMw,
  parseEnrichmentFile,
  normaliseFacilityName,
  matchRecordToFacilities,
  computeFacilityDiff,
  buildFieldCoverage,
  runDataCentreEnrichment,
  GENERIC_PROFILE,
  getProviderProfile,
  type MatchableFacility,
  type DiffableFacility,
  type EnrichmentRecord,
} from "@workspace/ingest";
import type { DataCentreFacility } from "@workspace/db";

// Full facility fixture — only the fields under test vary.
function facility(overrides: Partial<DataCentreFacility>): DataCentreFacility {
  return {
    id: 1,
    name: "Jakarta JK1",
    operator: null,
    country: "Indonesia",
    region: null,
    city: null,
    latitude: null,
    longitude: null,
    status: "Unknown",
    planningRisk: "Unknown",
    facilityType: "Unknown / not reported",
    capacityMw: null,
    itLoadMw: null,
    announcedDate: null,
    expectedOnlineDate: null,
    commissionedDate: null,
    notes: null,
    sourceUrl: null,
    linkedIncidentId: null,
    statusChanged: false,
    previousStatus: null,
    statusChangedAt: null,
    enrichmentSources: null,
    enrichmentLocks: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("parseCsv", () => {
  it("handles quoted fields, escaped quotes, commas and CRLF", () => {
    const csv = 'name,notes\r\n"Site, A","he said ""hi"""\r\nSite B,plain\r\n';
    expect(parseCsv(csv)).toEqual([
      ["name", "notes"],
      ["Site, A", 'he said "hi"'],
      ["Site B", "plain"],
    ]);
  });
});

describe("parsePowerMw (strict, no-fabrication)", () => {
  it("accepts a bare number and MW/kW units", () => {
    expect(parsePowerMw("50")).toBe(50);
    expect(parsePowerMw("50 MW")).toBe(50);
    expect(parsePowerMw("50MW")).toBe(50);
    expect(parsePowerMw("2500 kW")).toBe(2.5);
  });
  it("rejects prose / ranges / approximations", () => {
    expect(parsePowerMw("up to 50MW")).toBeNull();
    expect(parsePowerMw("~50")).toBeNull();
    expect(parsePowerMw("50-100")).toBeNull();
    expect(parsePowerMw("0")).toBeNull();
    expect(parsePowerMw("-5")).toBeNull();
    expect(parsePowerMw("")).toBeNull();
  });
});

describe("normaliseRecord + coverage — unmappable vocab", () => {
  const csv = [
    "name,country,status,facility_type,capacity_mw",
    "Jakarta JK1,Indonesia,Operational,Hyperscale,50",
    "Batam B2,Indonesia,mothballed,quantum,not sure",
  ].join("\n");

  it("maps known vocab but leaves unknown vocab unwritten and counted", () => {
    const recs = parseEnrichmentFile(csv, GENERIC_PROFILE);
    expect(recs).toHaveLength(2);
    const [jk1, b2] = recs;
    expect(jk1.status).toBe("Operational");
    expect(jk1.facilityType).toBe("Hyperscale");
    expect(jk1.capacityMw).toBe(50);
    // "mothballed" / "quantum" are not in the conservative value maps.
    expect(b2.status).toBeNull();
    expect(b2.rawStatus).toBe("mothballed");
    expect(b2.facilityType).toBeNull();
    expect(b2.rawFacilityType).toBe("quantum");
    expect(b2.capacityMw).toBeNull();

    const coverage = buildFieldCoverage(recs);
    const statusCov = coverage.find((c) => c.field === "status")!;
    expect(statusCov.present).toBe(1);
    expect(statusCov.unmappable).toBe(1);
    const typeCov = coverage.find((c) => c.field === "facilityType")!;
    expect(typeCov.unmappable).toBe(1);
  });

  it("never resolves a prototype key (constructor / __proto__) as a value", () => {
    const proto = [
      "name,country,status,facility_type",
      "Proto Site,Indonesia,constructor,__proto__",
    ].join("\n");
    const [r] = parseEnrichmentFile(proto, GENERIC_PROFILE);
    expect(r.status).toBeNull();
    expect(r.facilityType).toBeNull();
    // Counted as unmappable, never written.
    const cov = buildFieldCoverage([r]);
    expect(cov.find((c) => c.field === "status")!.unmappable).toBe(1);
    expect(cov.find((c) => c.field === "facilityType")!.unmappable).toBe(1);
  });
});

describe("matchRecordToFacilities", () => {
  const facilities: MatchableFacility[] = [
    { id: 1, name: "Jakarta JK1", country: "Indonesia", city: "Jakarta", latitude: -6.2, longitude: 106.8 },
    { id: 2, name: "Jakarta JK1", country: "Indonesia", city: "Bekasi", latitude: -6.24, longitude: 107.0 },
  ];
  const rec = (o: Partial<EnrichmentRecord>): EnrichmentRecord => ({
    name: "Jakarta JK1",
    operator: null,
    country: "Indonesia",
    city: null,
    latitude: null,
    longitude: null,
    status: null,
    rawStatus: null,
    facilityType: null,
    rawFacilityType: null,
    capacityMw: null,
    itLoadMw: null,
    sourceRef: null,
    asOf: null,
    ...o,
  });

  it("matches on normalised name + country", () => {
    const r = matchRecordToFacilities(rec({ name: "jakarta-jk1" }), [facilities[0]]);
    expect(r.kind).toBe("matched");
  });

  it("returns ambiguous when two rows survive every tie-break", () => {
    const r = matchRecordToFacilities(rec({}), facilities);
    expect(r.kind).toBe("ambiguous");
  });

  it("breaks the tie by coordinate proximity", () => {
    const r = matchRecordToFacilities(
      rec({ latitude: -6.2001, longitude: 106.8001 }),
      facilities,
    );
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.facility.id).toBe(1);
  });

  it("does not match a different country", () => {
    const r = matchRecordToFacilities(rec({ country: "Singapore" }), facilities);
    expect(r.kind).toBe("unmatched");
  });
});

describe("computeFacilityDiff — no-fabrication + idempotency", () => {
  const record: EnrichmentRecord = {
    name: "Jakarta JK1",
    operator: null,
    country: "Indonesia",
    city: null,
    latitude: null,
    longitude: null,
    status: "Operational",
    rawStatus: "Operational",
    facilityType: "Hyperscale",
    rawFacilityType: "Hyperscale",
    capacityMw: 50,
    itLoadMw: null,
    sourceRef: "https://example.test/jk1",
    asOf: "2026-01-01",
  };

  it("proposes only the fields the source states", () => {
    const diffs = computeFacilityDiff(record, {
      id: 1,
      name: "Jakarta JK1",
      status: "Unknown",
      facilityType: "Unknown / not reported",
      capacityMw: null,
      itLoadMw: null,
      enrichmentSources: null,
      enrichmentLocks: null,
    });
    const fields = diffs.map((d) => d.field).sort();
    expect(fields).toEqual(["capacityMw", "facilityType", "status"]);
    // itLoadMw is absent from the source -> never proposed.
    expect(fields).not.toContain("itLoadMw");
  });

  it("re-run is a no-op once the exact value was imported (idempotent)", () => {
    const facility: DiffableFacility = {
      id: 1,
      name: "Jakarta JK1",
      status: "Operational",
      facilityType: "Hyperscale",
      capacityMw: 50,
      itLoadMw: null,
      enrichmentSources: {
        status: { provider: "Generic", sourceRef: null, asOf: null, value: "Operational" },
        facilityType: { provider: "Generic", sourceRef: null, asOf: null, value: "Hyperscale" },
        capacityMw: { provider: "Generic", sourceRef: null, asOf: null, value: 50 },
      },
      enrichmentLocks: null,
    };
    expect(computeFacilityDiff(record, facility)).toHaveLength(0);
  });

  it("respects a later analyst override of a previously imported value", () => {
    // Source once wrote "Proposed"; analyst has since set "Operational". Because
    // the stamp still records "Proposed" (not the current value), and the source
    // still says "Operational" == current, nothing is re-proposed.
    const facility: DiffableFacility = {
      id: 1,
      name: "Jakarta JK1",
      status: "Operational",
      facilityType: "Unknown / not reported",
      capacityMw: null,
      itLoadMw: null,
      enrichmentSources: {
        status: { provider: "Generic", sourceRef: null, asOf: null, value: "Proposed" },
      },
      enrichmentLocks: null,
    };
    const statusDiffs = computeFacilityDiff(record, facility).filter(
      (d) => d.field === "status",
    );
    expect(statusDiffs).toHaveLength(0);
  });

  it("never proposes a change to an analyst-LOCKED field", () => {
    // The desk manually set status="Decommissioned" and locked it. Even though
    // the source states a different, otherwise-importable value, the lock wins.
    const facility: DiffableFacility = {
      id: 1,
      name: "Jakarta JK1",
      status: "Decommissioned",
      facilityType: "Unknown / not reported",
      capacityMw: null,
      itLoadMw: null,
      enrichmentSources: null,
      enrichmentLocks: { status: { lockedAt: "2026-02-01T00:00:00.000Z" } },
    };
    const diffs = computeFacilityDiff(record, facility);
    const fields = diffs.map((d) => d.field).sort();
    // status is locked -> skipped; the other stated fields still flow.
    expect(fields).toEqual(["capacityMw", "facilityType"]);
    expect(fields).not.toContain("status");
  });
});

describe("runDataCentreEnrichment (injected facilities, dry-run)", () => {
  const csv = [
    "name,country,status,facility_type,capacity_mw,source_ref",
    "Jakarta JK1,Indonesia,Operational,Hyperscale,50,https://src.test/1",
    "Ghost Site,Indonesia,Operational,Edge,5,https://src.test/2",
  ].join("\n");

  it("matches existing rows, reports unmatched, and never writes on dry-run", async () => {
    const summary = await runDataCentreEnrichment({
      profile: GENERIC_PROFILE,
      fileContent: csv,
      commit: false,
      facilities: [facility({ id: 1, name: "Jakarta JK1", country: "Indonesia" })],
    });
    expect(summary.totalRecords).toBe(2);
    expect(summary.matched).toBe(1);
    expect(summary.unmatched).toBe(1);
    expect(summary.unmatchedRecords[0].name).toBe("Ghost Site");
    expect(summary.updatedRows).toBe(0);
    expect(summary.fieldWrites).toBe(0);
    expect(summary.diffs.length).toBe(3);
  });
});

describe("getProviderProfile", () => {
  it("resolves the generic profile case-insensitively", () => {
    expect(getProviderProfile("Generic")?.name).toBe("Generic");
    expect(getProviderProfile("nope")).toBeUndefined();
  });
});

describe("normaliseFacilityName", () => {
  it("strips punctuation and collapses whitespace", () => {
    expect(normaliseFacilityName("  Jakarta_JK1 (main) ")).toBe("jakarta jk1 main");
  });
});
