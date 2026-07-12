import {
  decideSocialPromotion,
  buildSocialIncidentTitle,
  buildSocialIncidentSummary,
  socialPromoteMarker,
  markerSocialRawId,
  runSocialPromote,
  SOCIAL_PROMOTE_MARKER_PREFIX,
  type SocialPromoteInput,
} from "@workspace/ingest";
import type { IncidentCandidate } from "@workspace/ingest";
import { RELEVANCE_RULE_VERSION } from "@workspace/relevance";
import { db } from "@workspace/db";

// A minimal social_raw row fixture. Callers override the fields the test cares
// about. Defaults to a promotable Facebook local-media row.
function row(over: Partial<SocialPromoteInput> = {}): SocialPromoteInput {
  return {
    id: 42,
    sourceName: "facebook_osint",
    platform: "facebook",
    pageHandle: "@post_courier",
    pageName: "Post-Courier",
    sourceTier: "local_media",
    category: "Civil unrest / protest",
    detectedCredibleDomains: [],
    corroborated: false,
    corroborationReason: null,
    country: "Papua New Guinea",
    province: "National Capital District",
    location: "Port Moresby",
    caption: "Crowds gathered outside parliament to protest fuel prices.",
    businessImpact: "Roads around the CBD were blocked for several hours.",
    incidentDate: new Date("2026-07-01T00:00:00.000Z"),
    postedAt: new Date("2026-07-01T02:00:00.000Z"),
    createdAt: new Date("2026-07-01T03:00:00.000Z"),
    url: "https://facebook.com/postcourier/posts/1",
    ...over,
  };
}

// An incident candidate fixture for the corroboration / duplicate scorers.
function inc(over: Partial<IncidentCandidate> = {}): IncidentCandidate {
  return {
    id: 900,
    title: "Protest outside parliament over fuel prices in Port Moresby",
    summary: "Hundreds gathered to protest rising fuel prices.",
    country: "Papua New Guinea",
    province: "National Capital District",
    category: "Civil unrest / protest",
    occurredAt: new Date("2026-07-01T00:00:00.000Z"),
    incidentDate: new Date("2026-07-01T00:00:00.000Z"),
    ...over,
  };
}

describe("socialPromoteMarker / markerSocialRawId", () => {
  it("round-trips the source-row id", () => {
    const note = socialPromoteMarker(42, {
      platformLabel: "Facebook",
      pageHandle: "@post_courier",
      credibilityReason: "Monitored page is a declared local-media source",
    });
    expect(note.startsWith(`${SOCIAL_PROMOTE_MARKER_PREFIX}42`)).toBe(true);
    expect(markerSocialRawId(note)).toBe(42);
  });

  it("returns null for non-social notes", () => {
    expect(markerSocialRawId("gdelt_cloud:conflict_abc")).toBeNull();
    expect(markerSocialRawId("tapa_offline:deadbeef:0")).toBeNull();
    expect(markerSocialRawId(null)).toBeNull();
    expect(markerSocialRawId(SOCIAL_PROMOTE_MARKER_PREFIX)).toBeNull();
  });
});

describe("buildSocialIncidentTitle / buildSocialIncidentSummary", () => {
  it("prefers location, then province, then country for the title", () => {
    expect(
      buildSocialIncidentTitle(
        { location: "Port Moresby", province: "NCD", country: "PNG" },
        "Civil unrest / protest",
      ),
    ).toBe("Civil unrest / protest — Port Moresby");
    expect(
      buildSocialIncidentTitle(
        { location: null, province: "NCD", country: "PNG" },
        "Civil unrest / protest",
      ),
    ).toBe("Civil unrest / protest — NCD");
    expect(
      buildSocialIncidentTitle(
        { location: null, province: null, country: "PNG" },
        "Civil unrest / protest",
      ),
    ).toBe("Civil unrest / protest — PNG");
  });

  it("falls back to a generic summary when the caption is empty", () => {
    expect(
      buildSocialIncidentSummary({
        caption: null,
        location: "Port Moresby",
        province: null,
        country: "PNG",
        businessImpact: null,
      }),
    ).toBe("Security incident reported at Port Moresby.");
  });

  it("appends the business impact to the caption", () => {
    expect(
      buildSocialIncidentSummary({
        caption: "Crowds gathered.",
        location: "Port Moresby",
        province: null,
        country: "PNG",
        businessImpact: "Roads blocked.",
      }),
    ).toBe("Crowds gathered. Roads blocked.");
  });
});

describe("decideSocialPromotion", () => {
  it("refuses a non-security row", () => {
    const d = decideSocialPromotion(row({ category: "Other security" }), []);
    expect(d).toEqual({ promote: false, reason: "not-security" });
  });

  it("refuses an unverified OSINT row with no credible signal", () => {
    const d = decideSocialPromotion(
      row({ sourceTier: "osint", detectedCredibleDomains: [], corroborated: false }),
      [],
    );
    expect(d).toEqual({ promote: false, reason: "not-credible" });
  });

  it("promotes a declared local-media row into a relevant flashpoint incident", () => {
    const d = decideSocialPromotion(row(), []);
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.topic).toBe("flashpoint");
    expect(d.row.topic).toBe("flashpoint");
    expect(d.row.country).toBe("Papua New Guinea");
    expect(d.row.category).toBe("Civil unrest / protest");
    expect(d.row.title).toBe("Civil unrest / protest — Port Moresby");
    expect(d.row.source).toBe("Post-Courier (Facebook OSINT)");
    expect(d.row.confidence).toBe("low");
    expect(d.row.relevanceVersion).toBe(RELEVANCE_RULE_VERSION);
    expect(markerSocialRawId(d.row.analystNotes ?? null)).toBe(42);
  });

  it("files an armed-crime category under the conflict tracker", () => {
    const d = decideSocialPromotion(
      row({ category: "Tribal / communal violence", sourceTier: "official" }),
      [],
    );
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.topic).toBe("conflict");
    expect(d.row.topic).toBe("conflict");
  });

  it("labels an Instagram source as Instagram OSINT", () => {
    const d = decideSocialPromotion(
      row({
        platform: "instagram",
        sourceName: "instagram_kammi",
        pageName: "KAMMI Watch",
        pageHandle: "@kammi",
      }),
      [],
    );
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.row.source).toBe("KAMMI Watch (Instagram OSINT)");
  });

  it("promotes a non-credible OSINT row ONLY when a live incident corroborates it", () => {
    const nonCredible = row({
      sourceTier: "osint",
      detectedCredibleDomains: [],
      corroborated: false,
    });
    // No candidates → stays context-only.
    expect(decideSocialPromotion(nonCredible, [])).toEqual({
      promote: false,
      reason: "not-credible",
    });
    // A corroborating news incident now supports it → promotes. Dated 6 days
    // off so it clears the 10-day corroboration window but NOT the stricter
    // 4-day duplicate window (a corroboration must not double as a duplicate).
    const d = decideSocialPromotion(nonCredible, [
      inc({
        id: 901,
        occurredAt: new Date("2026-07-07T00:00:00.000Z"),
        incidentDate: new Date("2026-07-07T00:00:00.000Z"),
      }),
    ]);
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.row.relevanceStatus).toBeDefined();
  });

  it("does NOT promote a non-credible PR post that only shares incidental tokens with an unrelated incident", () => {
    // A KAMMI-style greeting / seminar post carrying NO security-event vocab.
    const prPost = row({
      sourceTier: "osint",
      detectedCredibleDomains: [],
      corroborated: false,
      country: "Indonesia",
      province: "Jakarta",
      location: "Jakarta",
      category: "Civil unrest / protest",
      caption:
        "Selamat Idul Fitri from KAMMI. Join our national seminar forum in Jakarta this week.",
      businessImpact: null,
    });
    // An unrelated same-day incident that shares only the place token "jakarta".
    const unrelated = inc({
      id: 950,
      title: "Earthquake felt across greater Jakarta region",
      summary: "A moderate earthquake shook parts of Jakarta on Monday.",
      country: "Indonesia",
      province: "Jakarta",
      category: "Other security",
      occurredAt: new Date("2026-07-01T00:00:00.000Z"),
      incidentDate: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(decideSocialPromotion(prPost, [unrelated])).toEqual({
      promote: false,
      reason: "not-credible",
    });
  });

  it("blocks a duplicate of an already-tracked incident", () => {
    const d = decideSocialPromotion(row({ sourceTier: "official" }), [inc()]);
    expect(d).toEqual({
      promote: false,
      reason: "duplicate",
      duplicateOf: 900,
    });
  });
});

// Exercises the COMMIT branch of runSocialPromote against a mocked `db`. This
// path never ran for real until it threw on its first commit: the final count
// query destructured `db.execute(...)` as an array, but `db.execute` returns
// `{ rows }`, so it threw `TypeError: ... is not iterable` AFTER the incidents
// were already inserted (data written, script exits with an error). These tests
// guard the commit branch so a future refactor can't reintroduce that silent
// mid-commit failure.
describe("runSocialPromote (commit branch)", () => {
  // Builds a mocked `db` where:
  //  - the first `.select().from().where()` returns the unpromoted social_raw rows
  //  - the second `.select({...}).from()` (awaited directly) returns candidate incidents
  //  - `.transaction(cb)` runs the callback with a tx that inserts + claims a row
  //  - `.execute(...)` returns the drizzle `{ rows }` shape
  function setupCommitDb(opts: {
    socialRows: SocialPromoteInput[];
    incidents?: IncidentCandidate[];
    executeResult?: unknown;
    claimReturns?: Array<{ id: number }>;
  }) {
    const incidents = opts.incidents ?? [];
    let selectCall = 0;

    const selectSpy = jest.spyOn(db, "select").mockImplementation((() => {
      const call = selectCall++;
      // First select() (no projection) → social_raw rows via .from().where()
      // Second select({...}) (with projection) → incidents via .from() (awaited)
      if (call === 0) {
        return {
          from: () => ({
            where: () => Promise.resolve(opts.socialRows),
          }),
        } as any;
      }
      const thenable: any = {
        from: () => thenable,
        then: (res: (v: unknown) => unknown) => res(incidents),
      };
      return thenable;
    }) as any);

    // `transaction` lives on the drizzle prototype, so it is not spy-able as an
    // own property; assign a mock directly and restore it in afterEach.
    const txSpy = jest.fn(async (cb: any) => {
      const tx = {
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([{ id: 5000 }]),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () => Promise.resolve(opts.claimReturns ?? [{ id: 1 }]),
            }),
          }),
        }),
      };
      return cb(tx);
    });
    (db as any).transaction = txSpy;

    const executeSpy = jest
      .spyOn(db, "execute")
      .mockResolvedValue(
        (opts.executeResult ?? { rows: [{ count: 7 }] }) as any,
      );

    return { selectSpy, txSpy, executeSpy };
  }

  const originalTransaction = db.transaction;
  afterEach(() => {
    jest.restoreAllMocks();
    (db as any).transaction = originalTransaction;
  });

  it("completes without throwing and reports inserted / totalAfter", async () => {
    setupCommitDb({ socialRows: [row()], executeResult: { rows: [{ count: 7 }] } });

    const summary = await runSocialPromote({ commit: true });

    expect(summary.mode).toBe("commit");
    expect(summary.newToInsert).toBe(1);
    expect(summary.inserted).toBe(1);
    expect(summary.totalAfter).toBe(7);
    expect(summary.errors).toEqual([]);
  });

  it("reads the count off `.rows` (drizzle db.execute shape), not an array", async () => {
    const { executeSpy } = setupCommitDb({
      socialRows: [row()],
      executeResult: { rows: [{ count: 42 }] },
    });

    const summary = await runSocialPromote({ commit: true });

    // The count query result must be treated as `{ rows: [...] }` — the exact
    // shape whose array-destructuring regression this test defends against.
    expect(executeSpy).toHaveBeenCalledTimes(1);
    const result = await executeSpy.mock.results[0]!.value;
    expect(Array.isArray(result)).toBe(false);
    expect(result).toHaveProperty("rows");
    expect(summary.totalAfter).toBe(42);
  });

  it("skips the count query entirely in dry-run mode", async () => {
    const { executeSpy } = setupCommitDb({ socialRows: [row()] });

    const summary = await runSocialPromote({ commit: false });

    expect(summary.mode).toBe("dry-run");
    expect(summary.newToInsert).toBe(1);
    expect(summary.inserted).toBe(0);
    expect(executeSpy).not.toHaveBeenCalled();
  });
});
