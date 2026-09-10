import {
  backfillFlashpointValidity,
  flashpointEvidenceSnapshotMatches,
  isFlashpointBackfillCandidate,
  type FlashpointBackfillDependencies,
  type IncidentSnapshot,
} from "../../lib/ingest/src/backfillFlashpointValidity";
import { flashpointContentFingerprint } from "../../lib/ingest/src/flashpointFingerprint";
import { FLASHPOINT_VALIDITY_VERSION } from "@workspace/relevance";

const now = new Date("2026-09-09T12:00:00.000Z");
const row = {
  id: 7,
  topic: "flashpoint",
  title: "Workers begin strike in Manila",
  displayTitle: null,
  summary: "Union members began a strike in Manila.",
  source: "Wire",
  sourceUrl: "https://example.test/7",
  country: "Philippines",
  location: "Manila",
  occurredAt: new Date("2026-09-09T10:00:00.000Z"),
  incidentDate: new Date("2026-09-09T00:00:00.000Z"),
  validityVersion: null,
  validityReason: null,
  validityEvaluatedAt: null,
} as IncidentSnapshot;
const result = {
  version: FLASHPOINT_VALIDITY_VERSION,
  verdict: "valid" as const,
  reason: "validated",
  eventOccurred: true,
  actor: "workers",
  activity: "strike",
  physicalLocation: "Manila",
  country: "Philippines",
  eventType: "labour_strike" as const,
  eventDate: "2026-09-09",
  currentness: "current" as const,
  assignedCountrySupported: true,
  confidence: { event: .9, classification: .9, geography: .9, date: .9 },
  contradictions: [],
};

function dependencies(overrides: Partial<FlashpointBackfillDependencies> = {}): FlashpointBackfillDependencies {
  return {
    now: () => now,
    selectCandidates: jest.fn(async () => [row]),
    validate: jest.fn(async () => result),
    compareAndSet: jest.fn(async () => true),
    recordAudit: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe("bounded Flashpoint semantic backfill", () => {
  it("selects stale versions immediately and retries transient failures after five minutes", () => {
    expect(isFlashpointBackfillCandidate({ ...row, validityVersion: "semantic.3" }, now)).toBe(true);
    expect(isFlashpointBackfillCandidate({
      ...row,
      validityVersion: FLASHPOINT_VALIDITY_VERSION,
      validityReason: "semantic validator timeout",
      validityEvaluatedAt: new Date(now.getTime() - 299_999),
    }, now)).toBe(false);
    expect(isFlashpointBackfillCandidate({
      ...row,
      validityVersion: FLASHPOINT_VALIDITY_VERSION,
      validityReason: "semantic validator timeout",
      validityEvaluatedAt: new Date(now.getTime() - 300_000),
    }, now)).toBe(true);
    expect(isFlashpointBackfillCandidate({
      ...row,
      validityVersion: FLASHPOINT_VALIDITY_VERSION,
      validityReason: "unsupported_event_type",
      validityEvaluatedAt: new Date(now.getTime() - 86_400_000),
    }, now)).toBe(false);
  });

  it("clamps work to 100 and supplies the five-minute cutoff", async () => {
    const deps = dependencies();
    await backfillFlashpointValidity(999, deps);
    expect(deps.selectCandidates).toHaveBeenCalledWith(
      100,
      new Date(now.getTime() - 300_000),
    );
  });

  it("reports zero updates when compare-and-set detects a concurrent edit", async () => {
    const concurrentRow = { ...row, incidentDate: new Date("2026-09-08T00:00:00.000Z") };
    const deps = dependencies({
      compareAndSet: jest.fn(async (snapshot) =>
        flashpointEvidenceSnapshotMatches(snapshot, concurrentRow)),
    });
    await expect(backfillFlashpointValidity(1, deps)).resolves.toEqual({
      considered: 1,
      updated: 0,
    });
    expect(deps.recordAudit).toHaveBeenCalledTimes(1);
    expect(flashpointEvidenceSnapshotMatches(row, { ...row })).toBe(true);
  });

  it("keeps incidentDate distinct from publication date in cache fingerprints", () => {
    const evidence = {
      topic: row.topic, title: row.title, displayTitle: row.displayTitle,
      summary: row.summary, source: row.source, sourceUrl: row.sourceUrl,
      country: row.country, location: row.location, occurredAt: row.occurredAt,
    };
    expect(flashpointContentFingerprint({ ...evidence, incidentDate: row.incidentDate }))
      .not.toBe(flashpointContentFingerprint({
        ...evidence,
        incidentDate: new Date("2026-09-08T00:00:00.000Z"),
      }));
  });

  it("appends transient then recovery outcomes and leaves the row at the latest verdict", async () => {
    let clock = now;
    const current = { ...row };
    const audits: Array<{ verdict: string; reason: string }> = [];
    const transient = {
      ...result,
      verdict: "needs_review" as const,
      reason: "semantic validator timeout",
      eventOccurred: null,
      actor: null,
      activity: null,
      physicalLocation: null,
      country: null,
      eventType: null,
      eventDate: null,
      currentness: null,
      assignedCountrySupported: false,
      confidence: { event: 0, classification: 0, geography: 0, date: 0 },
    };
    const deps = dependencies({
      now: () => clock,
      selectCandidates: jest.fn(async () => [current]),
      validate: jest.fn()
        .mockResolvedValueOnce(transient)
        .mockResolvedValueOnce(result),
      compareAndSet: jest.fn(async (_snapshot, outcome, evaluatedAt) => {
        Object.assign(current, {
          validityStatus: outcome.verdict,
          validityReason: outcome.reason,
          validityVersion: outcome.version,
          validityEvaluatedAt: evaluatedAt,
          validityGates: outcome,
        });
        return true;
      }),
      recordAudit: jest.fn(async (_snapshot, outcome) => {
        audits.push({ verdict: outcome.verdict, reason: outcome.reason });
      }),
    });

    await backfillFlashpointValidity(1, deps);
    clock = new Date(clock.getTime() + 3_600_000);
    await backfillFlashpointValidity(1, deps);

    expect(audits).toEqual([
      { verdict: "needs_review", reason: "semantic validator timeout" },
      { verdict: "valid", reason: "validated" },
    ]);
    expect(current.validityStatus).toBe("valid");
    expect(current.validityReason).toBe("validated");
    expect(current.validityGates).toEqual(result);
  });
});