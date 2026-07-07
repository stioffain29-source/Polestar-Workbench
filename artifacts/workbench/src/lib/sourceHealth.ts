import { format } from "date-fns";
import { isOptionalIntegrationSource } from "@workspace/ingest/optionalIntegrations";
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
  name?: string;
  lastSuccessAt?: string | Date | null;
  lastFailureAt?: string | Date | null;
}): boolean {
  const eff = effectiveSourceStatus(s);
  // "pending" is a configured-but-not-yet-validated optional integration
  // (awaiting approval / network validation), not an outage — it must stay out
  // of the Action Required panel, like "operational".
  if (eff === "operational" || eff === "pending") return false;
  // Optional integrations that are intentionally off (no secret / appname yet)
  // are documented on the Integrations panel — not operations incidents.
  if (eff === "not_configured" && s.name && isOptionalIntegrationSource(s.name)) return false;
  return true;
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

const DAY_MS = 24 * 60 * 60 * 1000;
// Staleness windows for the scrape-health flags. A feed that hasn't scraped in a
// week, or hasn't retained a genuinely in-scope item in a month, is surfaced to
// operators as a coverage gap.
export const SCRAPE_STALE_DAYS = 7;
export const NO_RELEVANT_ITEM_DAYS = 30;

// A source is only ACTIVELY COLLECTING (and therefore eligible for the staleness
// flags) when it has succeeded at least once and is not an intentionally-off /
// not-yet-validated optional integration. A never-run or switched-off feed is
// not "stale" — it simply hasn't started, so flagging it would be misleading.
function isActivelyCollecting(s: {
  status: string;
  lastSuccessAt?: string | Date | null;
  lastFailureAt?: string | Date | null;
}): boolean {
  const eff = effectiveSourceStatus(s);
  if (eff === "not_configured" || eff === "pending" || eff === "disabled") {
    return false;
  }
  return Boolean(s.lastSuccessAt);
}

// True when an actively-collecting feed's last successful scrape is older than
// the staleness window — a silent collection gap worth an operator's attention.
export function isSourceScrapeStale(
  s: {
    status: string;
    lastSuccessAt?: string | Date | null;
    lastFailureAt?: string | Date | null;
  },
  now: Date = new Date(),
): boolean {
  if (!isActivelyCollecting(s)) return false;
  return (
    now.getTime() - new Date(s.lastSuccessAt as string | Date).getTime() >
    SCRAPE_STALE_DAYS * DAY_MS
  );
}

// True when an actively-collecting feed is scraping but hasn't retained an
// in-scope item within the relevance window.
//
// Two cases both count as a coverage gap worth an operator's attention:
//  1. It DID once retain an in-scope item, but the last one is older than the
//     relevance window (a feed that has gone quiet).
//  2. It has NEVER retained an in-scope item (lastRelevantItemAt is NULL) yet it
//     has been in the catalogue (createdAt) longer than the relevance window —
//     i.e. it fetches successfully but has silently yielded nothing in-scope for
//     the whole window. This is the "repaired feed reads green but is empty"
//     masking pattern: a zero-item fetch is not an error, so without this the
//     feed sits permanently "operational".
//
// A NULL last-relevant timestamp on a feed too young to judge (createdAt missing
// or inside the window) is still treated as "telemetry not yet recorded"
// (unknown), NOT a fabricated zero — a brand-new feed is given the window to
// prove itself before being flagged.
export function isSourceNoRelevantItem(
  s: {
    status: string;
    lastSuccessAt?: string | Date | null;
    lastFailureAt?: string | Date | null;
    lastRelevantItemAt?: string | Date | null;
    createdAt?: string | Date | null;
  },
  now: Date = new Date(),
): boolean {
  if (!isActivelyCollecting(s)) return false;
  if (s.lastRelevantItemAt) {
    return (
      now.getTime() - new Date(s.lastRelevantItemAt).getTime() >
      NO_RELEVANT_ITEM_DAYS * DAY_MS
    );
  }
  // Never retained anything. Only a gap once the feed has had the full window to
  // yield an in-scope item; before that its NULL telemetry is genuinely unknown.
  if (!s.createdAt) return false;
  return (
    now.getTime() - new Date(s.createdAt).getTime() > NO_RELEVANT_ITEM_DAYS * DAY_MS
  );
}

// Display a LAST-RUN funnel count (collected / retained / rejected), falling
// back to an em dash when the feed has never reported telemetry. "—" means "not
// tracked", never a fabricated 0.
export function formatFunnelCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}
