import { describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

jest.mock("@workspace/db", () => ({
  db: {},
  dbPortsEditionsTable: {},
  dbPortsSettingsTable: {},
  incidentsTable: {},
  gdeltStructuredItemsTable: {},
}));

import {
  assertDispositionCaps,
  updateItemPreservingEvidence,
} from "../../artifacts/api-server/src/lib/dbPortsEditions";
import {
  isPositiveInteger,
  validateCalendarDate,
  validateItemContent,
  validateSettings,
} from "../../artifacts/api-server/src/lib/dbPortsValidation";
import {
  DEFAULT_DB_PORTS_SETTINGS,
  assessDbPortsItem,
  emptyDbPortsItem,
  type DbPortsItem,
  type DbPortsItemContent,
} from "../../lib/db-ports/src";

const now = "2026-09-22T06:00:00.000Z";
const window = { startDate: "2026-09-09", endDate: "2026-09-22" };

function content(overrides: Partial<DbPortsItemContent> = {}): DbPortsItemContent {
  return {
    ...emptyDbPortsItem(),
    headline: "Terminal gate closed for repair",
    country: "Singapore",
    location: "Named terminal",
    eventDate: "2026-09-21",
    disposition: "inbox",
    severity: "Low",
    confidence: "unverified",
    materialityReason: "Affects landside access.",
    impactAreas: ["landside_access"],
    operationalImplications: "Use the alternate gate.",
    outlook: "Watch for reopening.",
    evidence: [{
      id: "evidence-incident-1",
      sourceName: "Discovery publisher",
      sourceUrl: "https://publisher.example/original",
      sourceType: "discovery",
      publishedDate: null,
      sourceDate: "2026-09-21",
      retrievedAt: now,
      excerpt: "",
      originalTitle: "Original upstream title",
      sourceRecord: "incident:1",
      verified: false,
    }],
    ...overrides,
  };
}

function item(id: string, disposition: DbPortsItem["disposition"] = "inbox"): DbPortsItem {
  const body = content({ disposition });
  return { ...body, id, mergedInto: null, updatedAt: now, ...assessDbPortsItem(body, window) };
}

const row = {
  id: 1,
  ...window,
  title: "Edition",
  overview: "",
  status: "draft" as const,
  revision: 1,
  items: [] as DbPortsItem[],
  worklog: [],
  coverage: [],
  history: [],
  createdAt: now,
  updatedAt: now,
  approvedAt: null,
};

describe("DB Ports backend validation and provenance", () => {
  test("refines generated numeric/date shapes instead of accepting malformed values", () => {
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(1.5)).toBe(false);
    expect(validateCalendarDate("2026-02-30")).toContain("real calendar");
    expect(validateItemContent(content({ eventDate: "2026-02-30" }))).toContain("real calendar");
    expect(validateItemContent(content({ evidence: [{
      ...content().evidence[0]!,
      sourceUrl: "file:///etc/passwd",
    }] }))).toContain("HTTP");
  });

  test("enforces hard item and settings caps", () => {
    expect(() => assertDispositionCaps(Array.from({ length: 7 }, (_, i) => item(String(i), "selected")))).toThrow("six");
    expect(() => assertDispositionCaps(Array.from({ length: 6 }, (_, i) => item(String(i), "watch")))).toThrow("five");
    expect(validateSettings({
      sources: Array.from({ length: 151 }, (_, i) => ({ ...DEFAULT_DB_PORTS_SETTINGS.sources[0]!, id: String(i) })),
      watchlist: [],
    })).toContain("150");
  });

  test("optional source-roster check metadata is retained and validated when present", () => {
    const source = {
      ...DEFAULT_DB_PORTS_SETTINGS.sources[0]!,
      expectedCadence: "Check each weekday during an active edition.",
      reliability: "intermittent" as const,
      manualReviewRequired: true,
      lastSuccessfulCheckAt: now,
      lastRelevantItemDate: "2026-09-21",
      lastRelevantItemUrl: "https://authority.example/notices/21",
    };
    expect(validateSettings({ sources: [source], watchlist: [] })).toBeNull();
    expect(source).toMatchObject({
      reliability: "intermittent",
      manualReviewRequired: true,
      lastRelevantItemDate: "2026-09-21",
    });
    expect(validateSettings({
      sources: [{ ...source, lastRelevantItemDate: "2026-02-30" }],
      watchlist: [],
    })).toContain("invalid last relevant item date");
    expect(validateSettings({
      sources: [{ ...source, lastRelevantItemUrl: "file:///private/notice" }],
      watchlist: [],
    })).toContain("public HTTP or HTTPS");
    expect(validateSettings({
      sources: [{ ...source, lastSuccessfulCheckAt: "21 September 2026" }],
      watchlist: [],
    })).toContain("invalid last successful check timestamp");
  });

  test("retains imported provenance while auditing permitted metadata corrections", () => {
    const previous = item("i1");
    const corrected = content({
      evidence: [{
        ...previous.evidence[0]!,
        sourceName: "Correct publisher",
        sourceType: "news",
        publishedDate: "2026-09-21",
        excerpt: "Publisher confirms the closure.",
        verified: true,
      }],
    });
    const result = updateItemPreservingEvidence(previous, corrected, row, now);
    expect(result.item.evidence[0]).toMatchObject({
      originalTitle: "Original upstream title",
      sourceRecord: "incident:1",
      sourceDate: "2026-09-21",
      retrievedAt: now,
    });
    expect(result.correctionSummary).toContain("sourceName");
    expect(() => updateItemPreservingEvidence(previous, {
      ...corrected,
      evidence: [{ ...corrected.evidence[0]!, sourceUrl: "https://replacement.example/" }],
    }, row, now)).toThrow("cannot be substituted");
    expect(() => updateItemPreservingEvidence(previous, { ...corrected, evidence: [] }, row, now)).toThrow("cannot be removed");
  });
});

describe("DB Ports route invariants", () => {
  const root = path.resolve(__dirname, "../..");
  const routeSource = fs.readFileSync(path.join(root, "artifacts/api-server/src/routes/dbPorts.ts"), "utf8");
  const serviceSource = fs.readFileSync(path.join(root, "artifacts/api-server/src/lib/dbPortsEditions.ts"), "utf8");
  const indexSource = fs.readFileSync(path.join(root, "artifacts/api-server/src/routes/index.ts"), "utf8");

  test("all edition writes use id-and-revision CAS and settings first-save is conflict safe", () => {
    expect(serviceSource).toContain("eq(dbPortsEditionsTable.id, id), eq(dbPortsEditionsTable.revision, revision)");
    expect(routeSource).toContain("eq(dbPortsSettingsTable.id, 1), eq(dbPortsSettingsTable.revision, body.revision)");
    expect(routeSource).toContain("onConflictDoNothing");
  });

  test("the router is mounted below the owner gate and not behind an admin-token gate", () => {
    expect(indexSource.indexOf("router.use(requireOwner)")).toBeLessThan(indexSource.indexOf("router.use(dbPortsRouter)"));
    expect(routeSource).not.toContain("requireAdminToken");
  });

  test("approval and reviewed export both independently enforce current quality", () => {
    expect(routeSource).toContain('row.status !== "in_review"');
    expect(routeSource).toContain("candidate.quality.readyForReview");
    expect(routeSource).toContain('edition.status !== "approved" || !quality.readyForReview');
  });
});