import {
  sourceStatusLabel,
  sourceStatusBadgeClass,
  formatSourceTimestamp,
  effectiveSourceStatus,
  isSourceActionRequired,
  isSourceRetrying,
  RETRY_ESCALATION_THRESHOLD,
} from "../../artifacts/workbench/src/lib/sourceHealth";
import { SOURCE_STATUSES } from "../../artifacts/workbench/src/lib/topics";

// Guards the Source Health page's status-derivation/rendering: each `sources`
// row status must map to the correct visible badge label + colour, and the
// last-success / last-failure timestamps must render the way the page shows
// them. A regression in this display logic would mislabel a healthy feed as
// failing (or vice versa) even when the underlying telemetry is correct.

describe("source status badge label", () => {
  it("turns each status enum into the visible badge text", () => {
    expect(sourceStatusLabel("operational")).toBe("operational");
    expect(sourceStatusLabel("delayed")).toBe("delayed");
    expect(sourceStatusLabel("stale")).toBe("stale");
    expect(sourceStatusLabel("failing")).toBe("failing");
    expect(sourceStatusLabel("blocked")).toBe("blocked");
    // Underscores become spaces so analysts read "not configured", not the enum.
    expect(sourceStatusLabel("not_configured")).toBe("not configured");
  });

  it("never leaves an underscore in any known status label", () => {
    for (const status of SOURCE_STATUSES) {
      expect(sourceStatusLabel(status)).not.toContain("_");
    }
  });
});

describe("source status badge colour", () => {
  it("maps each status to its intended badge colour class", () => {
    expect(sourceStatusBadgeClass("operational")).toBe("bg-accent text-accent-foreground");
    expect(sourceStatusBadgeClass("delayed")).toBe("bg-secondary text-secondary-foreground");
    expect(sourceStatusBadgeClass("stale")).toBe("bg-primary/80 text-primary-foreground");
    // failing + blocked are both alarm states -> destructive (red) badge.
    expect(sourceStatusBadgeClass("failing")).toBe("bg-destructive text-destructive-foreground");
    expect(sourceStatusBadgeClass("blocked")).toBe("bg-destructive text-destructive-foreground");
    expect(sourceStatusBadgeClass("not_configured")).toBe("bg-muted text-muted-foreground");
  });

  it("does not paint a healthy source with the failing (destructive) colour", () => {
    expect(sourceStatusBadgeClass("operational")).not.toContain("destructive");
  });

  it("returns a non-empty class for every known status", () => {
    for (const status of SOURCE_STATUSES) {
      expect(sourceStatusBadgeClass(status).length).toBeGreaterThan(0);
    }
  });

  it("falls back to a neutral muted badge for an unknown status", () => {
    expect(sourceStatusBadgeClass("something_new")).toBe("bg-muted text-muted-foreground");
  });
});

describe("source health timestamps", () => {
  it("renders an em dash when the source has never succeeded or failed", () => {
    expect(formatSourceTimestamp(null)).toBe("—");
    expect(formatSourceTimestamp(undefined)).toBe("—");
  });

  it("formats a Date as 'dd MMM HH:mm'", () => {
    // Constructed in local time so the assertion is timezone-independent.
    const ts = new Date(2026, 0, 15, 9, 5);
    expect(formatSourceTimestamp(ts)).toBe("15 Jan 09:05");
  });

  it("accepts an ISO string and renders it in the same shape", () => {
    expect(formatSourceTimestamp("2026-01-15T09:05:00")).toBe("15 Jan 09:05");
  });

  it("always produces the dd MMM HH:mm shape for a real timestamp", () => {
    expect(formatSourceTimestamp(new Date())).toMatch(/^\d{2} \w{3} \d{2}:\d{2}$/);
  });
});

describe("effective source status (timestamp-based recovery)", () => {
  const earlier = "2026-06-15T01:00:00Z";
  const later = "2026-06-15T03:00:00Z";

  it("treats an auto-failing feed as operational once its latest success is newer than its latest failure", () => {
    expect(
      effectiveSourceStatus({ status: "failing", lastSuccessAt: later, lastFailureAt: earlier }),
    ).toBe("operational");
  });

  it("keeps a feed failing while its latest failure is newer than its latest success", () => {
    expect(
      effectiveSourceStatus({ status: "failing", lastSuccessAt: earlier, lastFailureAt: later }),
    ).toBe("failing");
  });

  it("keeps a feed failing when it has failed but never succeeded", () => {
    expect(
      effectiveSourceStatus({ status: "failing", lastSuccessAt: null, lastFailureAt: later }),
    ).toBe("failing");
  });

  it("never auto-clears a manual classification, even if success is newer than failure", () => {
    for (const status of ["blocked", "stale", "delayed", "not_configured"]) {
      expect(
        effectiveSourceStatus({ status, lastSuccessAt: later, lastFailureAt: earlier }),
      ).toBe(status);
    }
  });

  it("leaves an operational feed operational", () => {
    expect(
      effectiveSourceStatus({ status: "operational", lastSuccessAt: later, lastFailureAt: earlier }),
    ).toBe("operational");
  });
});

describe("action-required derivation", () => {
  const earlier = "2026-06-15T01:00:00Z";
  const later = "2026-06-15T03:00:00Z";

  it("does not flag a recovered failing feed for operations follow-up", () => {
    expect(
      isSourceActionRequired({ status: "failing", lastSuccessAt: later, lastFailureAt: earlier }),
    ).toBe(false);
  });

  it("flags a genuinely failing feed for operations follow-up", () => {
    expect(
      isSourceActionRequired({ status: "failing", lastSuccessAt: earlier, lastFailureAt: later }),
    ).toBe(true);
  });

  it("flags manual alarm states (blocked) for follow-up", () => {
    expect(
      isSourceActionRequired({ status: "blocked", lastSuccessAt: later, lastFailureAt: earlier }),
    ).toBe(true);
  });

  it("does not flag a healthy operational feed", () => {
    expect(
      isSourceActionRequired({ status: "operational", lastSuccessAt: later, lastFailureAt: null }),
    ).toBe(false);
  });
});

describe("retrying derivation (early-warning, not action-required)", () => {
  const earlier = "2026-06-15T01:00:00Z";
  const later = "2026-06-15T03:00:00Z";

  it("flags a feed that has failed 1..threshold-1 runs in a row", () => {
    for (let n = 1; n < RETRY_ESCALATION_THRESHOLD; n++) {
      expect(
        isSourceRetrying({ status: "operational", consecutiveFailures: n }),
      ).toBe(true);
    }
  });

  it("does not flag a fully recovered feed (no failure streak)", () => {
    expect(
      isSourceRetrying({ status: "operational", consecutiveFailures: 0 }),
    ).toBe(false);
    expect(isSourceRetrying({ status: "operational" })).toBe(false);
  });

  it("does not flag a genuinely failing feed as merely retrying", () => {
    expect(
      isSourceRetrying({
        status: "failing",
        consecutiveFailures: RETRY_ESCALATION_THRESHOLD,
        lastSuccessAt: earlier,
        lastFailureAt: later,
      }),
    ).toBe(false);
  });

  it("does not double-count: a retrying feed never appears in Action Required", () => {
    const s = { status: "operational", consecutiveFailures: 1 };
    expect(isSourceRetrying(s)).toBe(true);
    expect(isSourceActionRequired(s)).toBe(false);
  });

  it("treats a manual alarm state as action-required, not retrying", () => {
    const s = { status: "blocked", consecutiveFailures: 1 };
    expect(isSourceRetrying(s)).toBe(false);
    expect(isSourceActionRequired(s)).toBe(true);
  });
});
