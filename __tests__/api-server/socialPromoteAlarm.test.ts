// Guards the runner-side regression alarm for the social OSINT promote pass.
//
// runIngestOnce raises a WARN when a single social-promote run mints MORE than
// SOCIAL_PROMOTE_WARN_THRESHOLD incidents (default 2). That branch is otherwise
// buried inside the multi-minute ingest chain and had no automated coverage —
// so someone removing the branch or mis-wiring the threshold could let a bad
// batch of auto-created incidents reach the live site with no alarm in the logs.
// These tests drive the extracted `reportSocialPromoteResult` helper (which the
// runner calls verbatim) with `inserted` counts above and below the threshold
// and assert a WARN fires ONLY above it, and that the env override is honoured.

import { reportSocialPromoteResult } from "../../artifacts/api-server/src/lib/ingestRunner";
import {
  emptySocialPromoteSummary,
  socialPromoteWarnThreshold,
  type SocialPromoteSummary,
} from "@workspace/ingest";

// A committed social-promote summary that reports `inserted` incidents minted.
function summary(inserted: number): SocialPromoteSummary {
  const base = emptySocialPromoteSummary("commit");
  return {
    ...base,
    unpromotedConsidered: inserted,
    newToInsert: inserted,
    inserted,
    totalAfter: inserted,
    minted: Array.from({ length: inserted }, (_, i) => ({
      incidentId: 5000 + i,
      socialRawId: 100 + i,
      topic: "flashpoint",
      marker: `social_raw:${100 + i}`,
    })),
  };
}

// A logger stub that records the info/warn calls the reporter makes.
function stubLogger() {
  const infos: Array<{ obj: unknown; msg: string }> = [];
  const warns: Array<{ obj: unknown; msg: string }> = [];
  return {
    log: {
      info: (obj: unknown, msg: string) => infos.push({ obj, msg }),
      warn: (obj: unknown, msg: string) => warns.push({ obj, msg }),
    },
    infos,
    warns,
  };
}

describe("socialPromoteWarnThreshold", () => {
  const original = process.env.SOCIAL_PROMOTE_WARN_THRESHOLD;
  afterEach(() => {
    if (original === undefined) delete process.env.SOCIAL_PROMOTE_WARN_THRESHOLD;
    else process.env.SOCIAL_PROMOTE_WARN_THRESHOLD = original;
  });

  it("defaults to 2 when unset", () => {
    delete process.env.SOCIAL_PROMOTE_WARN_THRESHOLD;
    expect(socialPromoteWarnThreshold()).toBe(2);
  });

  it("defaults to 2 for a non-positive or non-numeric override", () => {
    process.env.SOCIAL_PROMOTE_WARN_THRESHOLD = "0";
    expect(socialPromoteWarnThreshold()).toBe(2);
    process.env.SOCIAL_PROMOTE_WARN_THRESHOLD = "-3";
    expect(socialPromoteWarnThreshold()).toBe(2);
    process.env.SOCIAL_PROMOTE_WARN_THRESHOLD = "abc";
    expect(socialPromoteWarnThreshold()).toBe(2);
  });

  it("honours a positive override read at call time", () => {
    process.env.SOCIAL_PROMOTE_WARN_THRESHOLD = "5";
    expect(socialPromoteWarnThreshold()).toBe(5);
  });
});

describe("reportSocialPromoteResult regression alarm", () => {
  const original = process.env.SOCIAL_PROMOTE_WARN_THRESHOLD;
  afterEach(() => {
    if (original === undefined) delete process.env.SOCIAL_PROMOTE_WARN_THRESHOLD;
    else process.env.SOCIAL_PROMOTE_WARN_THRESHOLD = original;
  });

  it("always logs the info summary regardless of the count", () => {
    delete process.env.SOCIAL_PROMOTE_WARN_THRESHOLD;
    const { log, infos } = stubLogger();
    reportSocialPromoteResult(log, summary(0));
    expect(infos).toHaveLength(1);
    expect(infos[0]!.msg).toBe("Social promote pass complete");
  });

  it("does NOT warn at or below the default threshold (2)", () => {
    delete process.env.SOCIAL_PROMOTE_WARN_THRESHOLD;
    for (const inserted of [0, 1, 2]) {
      const { log, warns } = stubLogger();
      const res = reportSocialPromoteResult(log, summary(inserted));
      expect(res.warned).toBe(false);
      expect(res.threshold).toBe(2);
      expect(warns).toHaveLength(0);
    }
  });

  it("warns above the default threshold and names the minted incidents", () => {
    delete process.env.SOCIAL_PROMOTE_WARN_THRESHOLD;
    const { log, warns } = stubLogger();
    const res = reportSocialPromoteResult(log, summary(3));
    expect(res.warned).toBe(true);
    expect(res.threshold).toBe(2);
    expect(warns).toHaveLength(1);
    expect(warns[0]!.msg).toMatch(/unexpectedly high number of incidents/);
    const payload = warns[0]!.obj as {
      threshold: number;
      inserted: number;
      minted: Array<{ marker: string }>;
    };
    expect(payload.threshold).toBe(2);
    expect(payload.inserted).toBe(3);
    // The minted audit trail rides along on the WARN so a questionable
    // auto-created incident is queryable straight from the logs.
    expect(payload.minted).toHaveLength(3);
    expect(payload.minted[0]!.marker).toMatch(/^social_raw:/);
  });

  it("respects a raised SOCIAL_PROMOTE_WARN_THRESHOLD override", () => {
    process.env.SOCIAL_PROMOTE_WARN_THRESHOLD = "5";
    // 5 is at the threshold → no warn.
    const below = stubLogger();
    expect(reportSocialPromoteResult(below.log, summary(5)).warned).toBe(false);
    expect(below.warns).toHaveLength(0);
    // 6 exceeds it → warn, carrying the overridden threshold.
    const above = stubLogger();
    const res = reportSocialPromoteResult(above.log, summary(6));
    expect(res.warned).toBe(true);
    expect(res.threshold).toBe(5);
    expect(above.warns).toHaveLength(1);
    expect((above.warns[0]!.obj as { threshold: number }).threshold).toBe(5);
  });

  it("respects a lowered SOCIAL_PROMOTE_WARN_THRESHOLD override", () => {
    process.env.SOCIAL_PROMOTE_WARN_THRESHOLD = "1";
    // 1 is at the threshold → no warn.
    const below = stubLogger();
    expect(reportSocialPromoteResult(below.log, summary(1)).warned).toBe(false);
    // 2 now exceeds the lowered threshold → warn (would be silent by default).
    const above = stubLogger();
    const res = reportSocialPromoteResult(above.log, summary(2));
    expect(res.warned).toBe(true);
    expect(res.threshold).toBe(1);
    expect(above.warns).toHaveLength(1);
  });
});
