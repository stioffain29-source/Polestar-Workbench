import type { Incident, Report } from "@workspace/api-client-react";
import {
  autoReportRating,
  reportToCard,
} from "../../artifacts/workbench/src/lib/cardAutofill";
import {
  semanticFixture,
  semanticIncident,
} from "./maritimeSemanticTestHelpers";
import { buildFuelWatchReportData } from "../../artifacts/workbench/src/lib/fuelWatchReport";

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

  it("applies saved exclusions when Shipping is pulled into a card", () => {
    const rep = {
      ...report(),
      riskRating: "extreme",
      sectionOverrides: { excludedIncidentIds: ["current"] },
    } as unknown as Report;
    const current = incident(
      "current",
      "2026-06-16T08:00:00.000Z",
      "validated",
    );
    expect(reportToCard(rep, undefined, [current]).rating).toBe("insignificant");
  });
});

describe("scheduled report risk uses canonical evidence", () => {
  const row = (
    id: number,
    topic: string,
    title: string,
    severity: string,
  ): Incident =>
    ({
      id,
      topic,
      title,
      summary: "",
      source: "Test",
      sourceUrl: `https://example.com/${id}`,
      occurredAt: "2026-09-13T08:00:00.000Z",
      severity,
      country: "Myanmar",
    }) as Incident;

  it("keeps historical aggregate statements out of Conflict risk", () => {
    const rep = {
      topic: "conflict",
      issueDate: "2026-09-13",
      situation: "Extreme appears in stale prose.",
      whatHappened: "",
      whatMatters: "",
      implications: "",
    } as Report;
    expect(
      autoReportRating(rep, [
        row(
          1,
          "conflict",
          "Government says 4,700 militants killed since 2014",
          "extreme",
        ),
        row(
          2,
          "conflict",
          "Missile strike damages an army base",
          "high",
        ),
      ]),
    ).toBe("high");
  });

  it("does not derive risk from narrative tier words when evidence is absent", () => {
    const rep = {
      topic: "energy",
      issueDate: "2026-09-13",
      situation: "A historical source used the word Extreme.",
      whatHappened: "",
      whatMatters: "",
      implications: "",
    } as Report;
    expect(autoReportRating(rep, [])).toBeUndefined();
  });

  it("does not let a stale saved override beat canonical evidence", () => {
    const rep = {
      topic: "conflict",
      issueDate: "2026-09-13",
      riskRating: "moderate",
      situation: "",
      whatHappened: "",
      whatMatters: "",
      implications: "",
    } as Report;
    expect(
      reportToCard(rep, undefined, [
        row(3, "conflict", "Drone strike hits military base", "extreme"),
      ]).rating,
    ).toBe("extreme");
  });

  it("applies saved severity curation before computing card risk", () => {
    const rep = {
      topic: "conflict",
      issueDate: "2026-09-13",
      situation: "",
      whatHappened: "",
      whatMatters: "",
      implications: "",
      sectionOverrides: {
        severityDemotions: { "3": "low" },
      },
    } as unknown as Report;
    expect(
      autoReportRating(rep, [
        row(3, "conflict", "Drone strike hits military base", "extreme"),
      ]),
    ).toBe("low");
  });

  it("uses the exact canonical Fuel authority, including cross-topic evidence", () => {
    const rep = {
      topic: "fuel",
      issueDate: "2026-09-13",
      situation: "",
      whatHappened: "",
      whatMatters: "",
      implications: "",
      hardNumbers: {},
    } as Report;
    const evidence = [
      row(
        4,
        "shipping",
        "Hormuz disruption raises bunker fuel prices and delays tanker supply",
        "high",
      ),
    ];
    const expected = buildFuelWatchReportData(
      {
        issueDate: rep.issueDate,
        hardNumbers: rep.hardNumbers,
      },
      evidence as never,
    ).canonicalFacts.overallSeverity.toLowerCase();
    expect(autoReportRating(rep, evidence)).toBe(expected);
  });
});