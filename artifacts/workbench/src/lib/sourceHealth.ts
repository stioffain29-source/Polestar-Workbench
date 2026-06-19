import { format } from "date-fns";
import { sourceStatusClass } from "./topics";

// Single source of truth for how a `sources` row's status and timestamps
// are turned into what an analyst sees on the Source Health page. Both the
// page (`pages/Sources.tsx`) and its tests import these helpers, so the
// rendered badge label / colour and the last-success / last-failure cells
// can never silently drift from what is verified.

// Human-readable badge label for a source status enum value
// (e.g. "not_configured" -> "not configured").
export function sourceStatusLabel(status: string): string {
  if (status === "pending") return "pending approval";
  return status.replace(/_/g, " ");
}

// Tailwind classes that colour the status badge. Re-exported from `topics`
// so callers and tests have one import surface for status display.
export function sourceStatusBadgeClass(status: string): string {
  return sourceStatusClass(status);
}

// Effective status for a source row. A feed auto-escalated to "failing" whose
// latest successful fetch is newer than its latest failure has already
// self-recovered, so we treat it as operational immediately rather than waiting
// for the next ingest run to reset it (which on autoscale can be hours away).
// Recovery only overrides the auto "failing" status — manual classifications
// (blocked / stale / delayed / not_configured) are never auto-cleared.
export function effectiveSourceStatus(s: {
  status: string;
  lastSuccessAt?: string | Date | null;
  lastFailureAt?: string | Date | null;
}): string {
  if (
    s.status === "failing" &&
    s.lastSuccessAt &&
    s.lastFailureAt &&
    new Date(s.lastSuccessAt).getTime() > new Date(s.lastFailureAt).getTime()
  ) {
    return "operational";
  }
  return s.status;
}

// A source needs operations follow-up (appears in Action Required) only when
// its EFFECTIVE status is not operational.
export function isSourceActionRequired(s: {
  status: string;
  lastSuccessAt?: string | Date | null;
  lastFailureAt?: string | Date | null;
}): boolean {
  const eff = effectiveSourceStatus(s);
  // "pending" is a configured-but-not-yet-validated optional integration
  // (awaiting approval / network validation), not an outage — it must stay out
  // of the Action Required panel, like "operational".
  return eff !== "operational" && eff !== "pending";
}

// Number of CONSECUTIVE failed ingest runs at which the ingest pipeline
// escalates a feed from "operational" to "failing". Mirrors
// FAILURE_ESCALATION_THRESHOLD in `@workspace/ingest` (lib/ingest/src/
// sourceHealth.ts) — kept in sync so the table's early-warning window matches
// the exact point at which a feed tips over into the red Action Required panel.
export const RETRY_ESCALATION_THRESHOLD = 3;

// A feed that has failed 1..threshold-1 ingest runs in a row is quietly
// retrying: still EFFECTIVELY operational (so it stays out of Action Required),
// but degrading. This gives operators an early, non-alarming warning before the
// feed tips over to "failing". Returns false once the feed is genuinely failing
// (action-required) or has fully recovered (consecutiveFailures reset to 0).
export function isSourceRetrying(s: {
  status: string;
  lastSuccessAt?: string | Date | null;
  lastFailureAt?: string | Date | null;
  consecutiveFailures?: number | null;
}): boolean {
  const failures = s.consecutiveFailures ?? 0;
  return (
    !isSourceActionRequired(s) &&
    failures >= 1 &&
    failures < RETRY_ESCALATION_THRESHOLD
  );
}

// Render a source health timestamp (last success / last failure) the way the
// table and Action Required panel do, falling back to an em dash when absent.
export function formatSourceTimestamp(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  return format(new Date(value), "dd MMM HH:mm");
}
