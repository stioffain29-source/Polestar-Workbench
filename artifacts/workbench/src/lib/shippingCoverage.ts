import {
  hasValidMaritimeSemantic,
  isSemanticallyValidatedMaritimeIncident,
} from "./shippingAnalysis";
import { filterIncidentsToWindow, resolveReportWindow } from "./reportWindow";
import type { ShippingMaritimeSemanticEvidence } from "./shippingAnalysis";

/**
 * The validation state attached to an API incident is deliberately kept
 * structural here.  The raw report query can contain older persisted rows,
 * while the generated API client may add fields to this object independently
 * of the workbench package.
 */
export interface ShippingMaritimeValidation {
  status?: string | null;
  version?: string | null;
}

export interface ShippingCoverageIncident {
  topic: string;
  occurredAt: string;
  maritimeSemantic?: ShippingMaritimeSemanticEvidence | null;
  maritimeValidation?: ShippingMaritimeValidation | null;
}

export type ShippingCoverageStatus = "complete" | "incomplete";

/**
 * Coverage is calculated from the raw in-window report input, not from the
 * canonical dataset.  Canonical admission intentionally excludes rows which
 * are still pending or rejected; using that filtered set for completeness
 * would make an unvalidated feed look complete.
 */
export interface ShippingCoverage {
  status: ShippingCoverageStatus;
  complete: boolean;
  /** Number of raw Shipping rows in the inclusive report window. */
  sourceRows: number;
  validated: number;
  rejected: number;
  pending: number;
  /** The same report interval used by the dataset and Maritime Intelligence. */
  windowStart: string;
  windowEnd: string;
  /** Empty when complete; safe to display verbatim when incomplete. */
  disclosure: string;
  /** The authoritative overall-risk label for an incomplete assessment. */
  assessmentLabel: "Assessment pending" | "Assessed";
}

function validationBucket(
  row: ShippingCoverageIncident,
): "validated" | "rejected" | "pending" {
  const status = row.maritimeValidation?.status;

  // A validated status is only current when the current semantic projection
  // also passes the same admission gate as the canonical Shipping dataset.
  // Missing, stale, malformed, or non-admitted semantic evidence is pending,
  // even when a stale row happens to retain a validated status.
  if (
    status === "validated" &&
    hasValidMaritimeSemantic(row) &&
    isSemanticallyValidatedMaritimeIncident(row) &&
    row.maritimeValidation?.version === row.maritimeSemantic?.version
  ) {
    return "validated";
  }

  // The API emits rejected only for a current semantic verdict of invalid.
  // Keep an explicit rejection when its semantic row is absent (for example,
  // a legacy saved row), but fail closed for a contradictory or needs_review
  // projection rather than presenting it as a terminal rejection.
  if (
    status === "rejected" &&
    (!row.maritimeSemantic || row.maritimeSemantic.verdict === "invalid") &&
    (!row.maritimeSemantic ||
      (hasValidMaritimeSemantic(row) &&
        row.maritimeValidation?.version === row.maritimeSemantic.version))
  ) {
    return "rejected";
  }

  // In particular, an absent maritimeValidation object is pending whenever
  // the raw in-window set is non-empty.  "not_applicable" is also pending for
  // a row that has entered a Shipping report.
  return "pending";
}

export function buildShippingCoverage(
  incidents: ShippingCoverageIncident[],
  topic: string,
  issueDate: string,
): ShippingCoverage {
  const windowed = filterIncidentsToWindow(incidents, topic, issueDate, {
    byTopic: true,
  });
  let validated = 0;
  let rejected = 0;
  let pending = 0;
  for (const row of windowed) {
    const bucket = validationBucket(row);
    if (bucket === "validated") validated += 1;
    else if (bucket === "rejected") rejected += 1;
    else pending += 1;
  }

  const complete = pending === 0;
  const status: ShippingCoverageStatus = complete ? "complete" : "incomplete";
  const sourceRows = windowed.length;
  // The helper above already applies the inclusive end-of-day rule.  Reuse
  // the same resolver only for the serialised disclosure interval.
  const reportWindow = resolveReportWindow(topic, issueDate);
  const windowStart = reportWindow.start.toISOString();
  const windowEnd = new Date(
    reportWindow.end.getTime() + 24 * 60 * 60 * 1000 - 1,
  ).toISOString();
  const disclosure = complete
    ? ""
    : `Coverage is incomplete: ${pending} of ${sourceRows} source reports are still under review. Overall maritime risk assessment is pending.`;

  return {
    status,
    complete,
    sourceRows,
    validated,
    rejected,
    pending,
    windowStart,
    windowEnd,
    disclosure,
    assessmentLabel: complete ? "Assessed" : "Assessment pending",
  };
}