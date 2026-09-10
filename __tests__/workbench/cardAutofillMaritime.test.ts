import type { Incident, Report } from "@workspace/api-client-react";
import { autoReportRating } from "../../artifacts/workbench/src/lib/cardAutofill";
import {
  semanticFixture,
  semanticIncident,
} from "./maritimeSemanticTestHelpers";

function report(issueDate = "2026-06-16"): Report {
  return {
    topic: "shipping",
    issueDate,
    situation: "The report prose mentions no automatic rating.",
    whatHappened: "",
    whatMatters: "",
    implications: "",
  } as Report;
}

function incident(
  id: string,
  occurredAt: string,
  status: "validated" | "rejected" | "pending",
  semantic = semanticFixture(id),
): Incident {
  return {
    ...semanticIncident(id, id, {
      ...semantic,
      eventDate: occurredAt.slice(0, 10),
    }),
    occurredAt,
    severity: "extreme",
    maritimeSemantic: semantic,
    maritimeValidation: {
      status,
      version: semantic.version,
      reason: status,
      evaluatedAt: occurredAt,
    },
  } as unknown as Incident;
}

describe("shipping card auto-risk uses canonical maritime board risk", () => {
  it("holds risk while an in-window pending row could otherwise look extreme", () => {
    expect(
      autoReportRating(
        {
          ...report(),
          situation: "Extreme risk language is intentionally not trusted.",
        },
        [incident("pending", "2026-06-16T08:00:00.000Z", "pending")],
      ),
    ).toBeUndefined();
  });

  it("reports a genuine validated zero as insignificant, not a prose fallback", () => {
    expect(
      autoReportRating(
        {
          ...report(),
          situation: "Extreme risk language is intentionally not trusted.",
        },
        [incident("rejected", "2026-06-16T08:00:00.000Z", "rejected")],
      ),
    ).toBe("insignificant");
  });

  it("does not let a pending row outside the report window poison current risk", () => {
    const current = incident("current", "2026-06-16T08:00:00.000Z", "validated");
    const oldPending = incident(
      "old-pending",
      "2026-05-01T08:00:00.000Z",
      "pending",
    );
    expect(autoReportRating(report(), [current, oldPending])).toBe("high");
  });

  it("fails closed when a current shipping row has no validation status", () => {
    const row = semanticIncident("missing-status", "Missing status");
    expect(
      autoReportRating(report(), [row as unknown as Incident]),
    ).toBeUndefined();
  });

  it("uses board overall risk instead of the raw incident severity", () => {
    const semantic = semanticFixture("geopolitical development", {
      eventClass: "geopolitical_maritime_development",
      severity: "low",
      geopolitical: {
        relevant: true,
        claim: "The source describes a maritime geopolitical development.",
        evidenceQuote: "geopolitical development",
      },
    });
    const row = incident(
      "geopolitical",
      "2026-06-16T08:00:00.000Z",
      "validated",
      semantic,
    );
    expect(autoReportRating(report(), [row])).toBe("low");
  });
});