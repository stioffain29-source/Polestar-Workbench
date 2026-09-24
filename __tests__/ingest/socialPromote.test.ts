import {
  decideSocialPromotion,
  buildSocialIncidentTitle,
  buildSocialIncidentSummary,
  socialPromoteMarker,
  markerSocialRawId,
  runSocialPromote,
  resolveSocialPostDate,
  socialPromoteMaxAgeDays,
  SOCIAL_PROMOTE_MARKER_PREFIX,
  type SocialPromoteInput,
} from "@workspace/ingest";
import type { IncidentCandidate } from "@workspace/ingest";
import { RELEVANCE_RULE_VERSION } from "@workspace/relevance";
import { db } from "@workspace/db";

// Promotion now requires a RECENT post date (an old or undated post can never
// be filed as a current incident), so the fixtures are dated relative to the
// run instead of being pinned to a calendar date that silently ages out of the
// window and turns every promote assertion into a `too-old` skip.
const DAY = 86_400_000;
const BASE = Date.now() - 2 * DAY;

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
    incidentDate: new Date(BASE),
    postedAt: new Date(BASE + 2 * 3_600_000),
    createdAt: new Date(BASE + 3 * 3_600_000),
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
    occurredAt: new Date(BASE),
    incidentDate: new Date(BASE),
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
        occurredAt: new Date(BASE + 6 * DAY),
        incidentDate: new Date(BASE + 6 * DAY),
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

  it("does not let an unvalidated fuzzy duplicate suppress a Flashpoint candidate", () => {
    const d = decideSocialPromotion(row({ sourceTier: "official" }), [inc()]);
    expect(d.promote).toBe(true);
    if (d.promote) expect(d.row.validityStatus).toBe("needs_review");
  });
});

// The post-date gate. Group scrapers return PINNED posts that can be years old,
// and some posts carry no usable timestamp at all. Before this gate the date
// chain ended in `?? new Date()`, so either case would have been filed as an
// incident dated TODAY — a fabricated current event. These rows stay in
// social_raw as context; only promotion is refused.
describe("decideSocialPromotion — post-date gate", () => {
  it("refuses an undated post rather than stamping it with today", () => {
    const d = decideSocialPromotion(
      row({ incidentDate: null, postedAt: null }),
      [],
    );
    expect(d).toEqual({ promote: false, reason: "no-date" });
  });

  it("refuses a pinned years-old group post", () => {
    const d = decideSocialPromotion(
      row({
        incidentDate: null,
        postedAt: new Date("2022-06-29T00:00:00.000Z"),
      }),
      [],
    );
    expect(d).toEqual({ promote: false, reason: "too-old" });
  });

  // The classifier infers `incidentDate` from caption text, so a pinned post
  // whose caption names a day ("Monday", "29 June") can carry a current-looking
  // event date. Provenance decides: a post published years ago is not reporting
  // something that happened this week.
  it("refuses a years-old post even when its inferred event date looks current", () => {
    const d = decideSocialPromotion(
      row({
        incidentDate: new Date(Date.now() - 2 * DAY),
        postedAt: new Date("2022-06-29T00:00:00.000Z"),
      }),
      [],
    );
    expect(d).toEqual({ promote: false, reason: "too-old" });
  });

  it("refuses a post with no publication date even when an event date was inferred", () => {
    const d = decideSocialPromotion(
      row({ incidentDate: new Date(Date.now() - 2 * DAY), postedAt: null }),
      [],
    );
    expect(d).toEqual({ promote: false, reason: "no-date" });
  });

  it("refuses a fresh post about an event outside the window", () => {
    // Published today, but the event it describes is three months old — real
    // reporting, still not a CURRENT incident.
    const d = decideSocialPromotion(
      row({
        incidentDate: new Date(Date.now() - 90 * DAY),
        postedAt: new Date(Date.now() - 1 * DAY),
      }),
      [],
    );
    expect(d).toEqual({ promote: false, reason: "too-old" });
  });

  it("refuses a future-dated post (clock or parse artefact)", () => {
    const d = decideSocialPromotion(
      row({ incidentDate: null, postedAt: new Date(Date.now() + 5 * DAY) }),
      [],
    );
    expect(d).toEqual({ promote: false, reason: "no-date" });
  });

  it("still promotes a post inside the window", () => {
    const d = decideSocialPromotion(
      row({ incidentDate: null, postedAt: new Date(Date.now() - 13 * DAY) }),
      [],
    );
    expect(d.promote).toBe(true);
    // Filed under its real post date, never today's.
    if (d.promote) {
      const filed = (d.row.occurredAt as Date).getTime();
      expect(Math.round((Date.now() - filed) / DAY)).toBe(13);
    }
  });

  it("checks the date BEFORE credibility so the skip names the real blocker", () => {
    const d = decideSocialPromotion(
      row({
        sourceTier: "osint",
        detectedCredibleDomains: [],
        corroborated: false,
        incidentDate: null,
        postedAt: null,
      }),
      [],
    );
    expect(d).toEqual({ promote: false, reason: "no-date" });
  });

  // Future tolerance is sized to PRECISION, not to a flat day. A date-only
  // field parses to UTC midnight, and the tracked theatres run ahead of UTC
  // (Indonesia +7..+9, PNG +10), so a post made "today" local reads as hours
  // ahead — that is real. A precise timestamp hours ahead is not.
  it("tolerates a date-only value hours ahead of UTC but not a precise future timestamp", () => {
    const HOUR = 3_600_000;
    const dateOnly = new Date(Date.UTC(2026, 8, 25)); // exact UTC midnight
    const at = (d: Date, hoursBefore: number) => ({ now: d.getTime() - hoursBefore * HOUR });
    const item = (postedAt: Date) => ({ incidentDate: null, postedAt });

    // A PNG post dated today, read 10h before UTC midnight rolls over.
    expect(resolveSocialPostDate(item(dateOnly), at(dateOnly, 10)).kind).toBe("ok");
    // Beyond any tracked offset — a parse artefact.
    expect(resolveSocialPostDate(item(dateOnly), at(dateOnly, 20)).kind).toBe("no-date");

    const precise = new Date(dateOnly.getTime() + 9 * HOUR + 7 * 60_000);
    // Clock skew is tolerated; hours into the future is not.
    expect(resolveSocialPostDate(item(precise), at(precise, 0.5)).kind).toBe("ok");
    expect(resolveSocialPostDate(item(precise), at(precise, 3)).kind).toBe("no-date");
  });

  it("honours an injected window (same resolver the manual route uses)", () => {
    const item = row({ incidentDate: null, postedAt: new Date(BASE) });
    expect(resolveSocialPostDate(item, { maxAgeDays: 1 }).kind).toBe("too-old");
    expect(resolveSocialPostDate(item, { maxAgeDays: 30 }).kind).toBe("ok");
    expect(
      decideSocialPromotion(item, [], { maxAgeDays: 1 }),
    ).toEqual({ promote: false, reason: "too-old" });
  });
});

describe("socialPromoteMaxAgeDays", () => {
  const original = process.env.SOCIAL_PROMOTE_MAX_AGE_DAYS;
  afterEach(() => {
    if (original === undefined) delete process.env.SOCIAL_PROMOTE_MAX_AGE_DAYS;
    else process.env.SOCIAL_PROMOTE_MAX_AGE_DAYS = original;
  });

  it("defaults to 14 days and clamps an override to 1..90", () => {
    delete process.env.SOCIAL_PROMOTE_MAX_AGE_DAYS;
    expect(socialPromoteMaxAgeDays()).toBe(14);
    process.env.SOCIAL_PROMOTE_MAX_AGE_DAYS = "3";
    expect(socialPromoteMaxAgeDays()).toBe(3);
    process.env.SOCIAL_PROMOTE_MAX_AGE_DAYS = "900";
    expect(socialPromoteMaxAgeDays()).toBe(90);
    process.env.SOCIAL_PROMOTE_MAX_AGE_DAYS = "nonsense";
    expect(socialPromoteMaxAgeDays()).toBe(14);
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
    // Each minted incident is captured for the log-based regression monitor:
    // the new incident id, its source row, topic, and parseable marker.
    expect(summary.minted).toHaveLength(1);
    expect(summary.minted[0]!.incidentId).toBe(5000);
    expect(summary.minted[0]!.marker).toMatch(/^social_raw:/);
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
