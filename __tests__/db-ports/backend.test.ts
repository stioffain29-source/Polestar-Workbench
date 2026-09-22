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
  validateParameters,
  validateSettings,
} from "../../artifacts/api-server/src/lib/dbPortsValidation";
import {
  DEFAULT_DB_PORTS_PARAMETERS,
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
    operationalImpact: "Use the alternate gate.",
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
  return { ...body, id, mergedInto: null, updatedAt: now, drafted: false, warnings: assessDbPortsItem(body, window) };
}

const row = {
  id: 1,
  ...window,
  title: "Report",
  overview: "",
  revision: 1,
  parameters: DEFAULT_DB_PORTS_PARAMETERS,
  items: [] as DbPortsItem[],
  coverage: [],
  history: [],
  createdAt: now,
  updatedAt: now,
};

describe("Ports report backend validation and provenance", () => {
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

  test("configuration values are rejected with a reason rather than silently clamped", () => {
    expect(validateParameters(DEFAULT_DB_PORTS_PARAMETERS)).toBeNull();
    expect(validateParameters({ ...DEFAULT_DB_PORTS_PARAMETERS, reportTitle: "  " })).toContain("title");
    expect(validateParameters({ ...DEFAULT_DB_PORTS_PARAMETERS, publicationDate: "2026-02-30" })).toContain("real calendar");
    expect(validateParameters({ ...DEFAULT_DB_PORTS_PARAMETERS, targetItems: 0 })).toContain("between 1 and");
    expect(validateParameters({ ...DEFAULT_DB_PORTS_PARAMETERS, includedCountries: [] })).toContain("at least one country");
    expect(validateParameters({ ...DEFAULT_DB_PORTS_PARAMETERS, includedCountries: ["Atlantis"] })).toContain("Unrecognised country");
    expect(validateParameters({ ...DEFAULT_DB_PORTS_PARAMETERS, includedThemes: [] })).toContain("at least one intelligence theme");
    expect(validateParameters({ ...DEFAULT_DB_PORTS_PARAMETERS, itemWordTarget: 120 })).toContain("150-word floor");
    expect(validateParameters({ ...DEFAULT_DB_PORTS_PARAMETERS, overviewWordTarget: 300 })).toContain("between 150 and 250");
  });

  test("enforces hard item and settings caps", () => {
    expect(() => assertDispositionCaps(Array.from({ length: 41 }, (_, i) => item(String(i), "selected")))).toThrow("40");
    expect(() => assertDispositionCaps(Array.from({ length: 6 }, (_, i) => item(String(i), "watch")))).toThrow("5");
    expect(() => assertDispositionCaps(Array.from({ length: 5 }, (_, i) => item(String(i), "watch")))).not.toThrow();
    expect(validateSettings({
      sources: Array.from({ length: 151 }, (_, i) => ({ ...DEFAULT_DB_PORTS_SETTINGS.sources[0]!, id: String(i) })),
      watchlist: [],
    })).toContain("150");
  });

  test("optional source-roster check metadata is retained and validated when present", () => {
    const source = {
      ...DEFAULT_DB_PORTS_SETTINGS.sources[0]!,
      expectedCadence: "Check each weekday while a report is open.",
      reliability: "intermittent" as const,
      manualReviewRequired: true,
      lastSuccessfulCheckAt: now,
      lastRelevantItemDate: "2026-09-21",
      lastRelevantItemUrl: "https://authority.example/notices/21",
    };
    expect(validateSettings({ sources: [source], watchlist: [] })).toBeNull();
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

  test("an imported source keeps its provenance; a replacement is added, never swapped in place", () => {
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
    const updated = updateItemPreservingEvidence(previous, corrected, row, now);
    expect(updated.evidence[0]).toMatchObject({
      originalTitle: "Original upstream title",
      sourceRecord: "incident:1",
      sourceDate: "2026-09-21",
      sourceName: "Correct publisher",
    });
    expect(updated.id).toBe("i1");
    expect(updated.updatedAt).toBe(now);
    expect(Array.isArray(updated.warnings)).toBe(true);
    expect(() => updateItemPreservingEvidence(previous, {
      ...corrected,
      evidence: [{ ...corrected.evidence[0]!, sourceUrl: "https://replacement.example/" }],
    }, row, now)).toThrow("cannot be substituted");
    expect(() => updateItemPreservingEvidence(previous, {
      ...corrected,
      evidence: [{ ...corrected.evidence[0]!, originalTitle: "Rewritten upstream title" }],
    }, row, now)).toThrow("cannot be changed");
    const added = updateItemPreservingEvidence(previous, {
      ...corrected,
      evidence: [corrected.evidence[0]!, {
        ...corrected.evidence[0]!,
        id: "analyst-added",
        sourceUrl: "https://second.example/corroboration",
        sourceRecord: null,
      }],
    }, row, now);
    expect(added.evidence).toHaveLength(2);
  });
});

describe("Ports report route surface", () => {
  const root = path.resolve(__dirname, "../..");
  const routeSource = fs.readFileSync(path.join(root, "artifacts/api-server/src/routes/dbPorts.ts"), "utf8");
  const serviceSource = fs.readFileSync(path.join(root, "artifacts/api-server/src/lib/dbPortsEditions.ts"), "utf8");
  const indexSource = fs.readFileSync(path.join(root, "artifacts/api-server/src/routes/index.ts"), "utf8");

  test("all report writes use id-and-revision CAS and settings first-save is conflict safe", () => {
    expect(serviceSource).toContain("eq(dbPortsEditionsTable.id, id), eq(dbPortsEditionsTable.revision, revision)");
    expect(routeSource).toContain("eq(dbPortsSettingsTable.id, 1), eq(dbPortsSettingsTable.revision, body.revision)");
    expect(routeSource).toContain("onConflictDoNothing");
  });

  test("the router is mounted below the owner gate and not behind an admin-token gate", () => {
    expect(indexSource.indexOf("router.use(requireOwner)")).toBeLessThan(indexSource.indexOf("router.use(dbPortsRouter)"));
    expect(routeSource).not.toContain("requireAdminToken");
  });

  test("drafting, editing and export routes exist for every editor action", () => {
    for (const route of [
      '"/db-ports/editions/:id/generate"',
      '"/db-ports/editions/:id/overview"',
      '"/db-ports/editions/:id/items/:itemId/regenerate"',
      '"/db-ports/editions/:id/reorder"',
      '"/db-ports/editions/:id/items"',
      '"/db-ports/editions/:id/items/:itemId"',
      '"/db-ports/editions/:id/merge"',
      '"/db-ports/editions/:id/export"',
    ]) {
      expect(routeSource).toContain(route);
    }
    expect(routeSource).toContain('router.delete("/db-ports/editions/:id/items/:itemId"');
  });

  test("worklog, review and approval surfaces are gone from the API", () => {
    for (const removed of ["worklog", "blocker", "readyForReview", "requestReview", "in_review", "approve", "missedSignal", "correction"]) {
      expect(routeSource.toLowerCase()).not.toContain(removed.toLowerCase());
    }
  });
});
