import {
  sourceStatusLabel,
  sourceStatusBadgeClass,
  formatSourceTimestamp,
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
