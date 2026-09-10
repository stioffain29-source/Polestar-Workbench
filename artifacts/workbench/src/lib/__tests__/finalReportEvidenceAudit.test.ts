import {
  auditFinalReportEvidence,
  type FinalReportEvidenceAuditInput,
} from "../finalReportEvidenceAudit";

function input(
  sections: FinalReportEvidenceAuditInput["sections"],
  over: Partial<FinalReportEvidenceAuditInput> = {},
): FinalReportEvidenceAuditInput {
  return {
    topic: "generic-topic",
    issueDate: "2026-08-05",
    window: { start: "2026-07-30", end: "2026-08-05" },
    evidence: [
      {
        id: 1,
        title: "Depot outage halted diesel supply in Port Alpha",
        summary: "The outage caused local shortages and higher haulage costs.",
        country: "Freedonia",
        location: "Port Alpha",
        occurredAt: "2026-08-03",
        themes: ["diesel availability"],
      },
      {
        id: "index",
        title: "Composite freight index",
        marketComparison: {
          indicator: "Composite freight index",
          currentDate: "2026-08-05",
          referenceDate: "2026-07-29",
          comparisonScope: "reporting-period",
        },
      },
    ],
    sections,
    validatedForwardIndicators: ["Monitor depot restart timing"],
    ...over,
  };
}

describe("shared final report evidence audit", () => {
  it("accepts grounded current and forward analysis", () => {
    expect(
      auditFinalReportEvidence(
        input({
          executiveSummary: "The Port Alpha depot outage halted diesel supply.",
          whatMatters: "The Composite freight index rose this week.",
          watchNext: "Monitor depot restart timing.",
        }),
      ),
    ).toEqual([]);
  });

  it("fails closed on a weekly claim backed only by a lagged comparison", () => {
    const i = input(
      { whatMatters: "The Composite freight index rose this week." },
      {
        evidence: [
          {
            title: "Composite freight index",
            marketComparison: {
              indicator: "Composite freight index",
              comparisonScope: "lagged-reference",
            },
          },
        ],
      },
    );
    expect(auditFinalReportEvidence(i).map((x) => x.code)).toContain(
      "PERIOD_ALIGNMENT",
    );
  });

  it("accepts an explicit disclaimer that lagged data is not period movement", () => {
    const i = input(
      {
        situation:
          "The available comparison is lagged benchmark context rather than evidence of movement within this reporting period.",
      },
      {
        evidence: [
          {
            title: "Composite freight index",
            marketComparison: {
              indicator: "Composite freight index",
              comparisonScope: "lagged-reference",
            },
          },
        ],
      },
    );
    expect(auditFinalReportEvidence(i)).toEqual([]);
  });

  it("blocks unsupported consequences, vague change and backend leakage", () => {
    const codes = auditFinalReportEvidence(
      input({
        polestarView:
          "A storm caused rerouting and higher costs across the network. The confirmed change remains important. Evidence confidence is low.",
      }),
    ).map((x) => x.code);
    expect(codes).toContain("UNSUPPORTED_CAUSAL_CLAIM");
    expect(codes).toContain("UNSUPPORTED_BOILERPLATE");
    expect(codes).toContain("VAGUE_CHANGE");
    expect(codes).toContain("BACKEND_CONFIDENCE_LEAK");
  });

  it("blocks ungrounded Watch Next themes", () => {
    expect(
      auditFinalReportEvidence(
        input({ watchNext: "Monitor lithium mine strikes in Nowhere Republic." }),
      ).map((x) => x.code),
    ).toContain("WATCH_NEXT_UNGROUNDED");
  });

  it("blocks verbatim malformed titles", () => {
    const bad = "DEPOT OUTAGE WORSENS - Reuters";
    expect(
      auditFinalReportEvidence(
        input(
          { executiveSummary: bad },
          { evidence: [{ id: 9, title: bad, occurredAt: "2026-08-02" }] },
        ),
      ).map((x) => x.code),
    ).toContain("RAW_EVIDENCE_TITLE");
  });

  it("blocks unexplained priority-geography contradictions", () => {
    const codes = auditFinalReportEvidence(
      input({
        executiveSummary: "Freedonia is the primary pressure point.",
        whatMatters: "Port Alpha is the leading priority exposure.",
        regionalHighlights: "Freedonia remains active.",
        polestarView: "Port Alpha remains the top priority concern.",
      }),
    ).map((x) => x.code);
    expect(codes).toContain("PRIORITY_GEOGRAPHY_CONTRADICTION");
  });

  it("blocks file/table narration as a language class, not a named-story list", () => {
    const codes = auditFinalReportEvidence(
      input({
        forecastRead: "Upcoming signals are listed in the table above. Named locations: Port Alpha. The file does not show a second corridor.",
      }),
    ).map((x) => x.code);
    expect(codes).toContain("BACKEND_CONFIDENCE_LEAK");
  });

  it("blocks exclusive volume ranking when country counts tie", () => {
    const codes = auditFinalReportEvidence(
      input(
        { regionalCountryRead: "Freedonia has the heaviest volume this week." },
        {
          evidence: [
            { id: 1, title: "Depot outage in Port Alpha", country: "Freedonia", location: "Port Alpha", occurredAt: "2026-08-03" },
            { id: 2, title: "Second depot outage in Port Alpha", country: "Freedonia", location: "Port Alpha", occurredAt: "2026-08-03" },
            { id: 3, title: "Depot outage in Harbourtown", country: "Erewhon", location: "Harbourtown", occurredAt: "2026-08-04" },
            { id: 4, title: "Second depot outage in Harbourtown", country: "Erewhon", location: "Harbourtown", occurredAt: "2026-08-04" },
          ],
        },
      ),
    ).map((x) => x.code);
    expect(codes).toContain("RANKING_TIE");
  });

  it("blocks a most-serious claim that names a lower-severity geography", () => {
    const codes = auditFinalReportEvidence(
      input(
        { civilUnrestRead: "The most serious civil-unrest event was a march in Port Alpha." },
        {
          evidence: [
            { id: 1, title: "March in Port Alpha", country: "Freedonia", location: "Port Alpha", severity: "moderate", occurredAt: "2026-08-03" },
            { id: 2, title: "Disorder in Harbourtown", country: "Erewhon", location: "Harbourtown", severity: "high", occurredAt: "2026-08-04" },
          ],
        },
      ),
    ).map((x) => x.code);
    expect(codes).toContain("SEVERITY_PARITY");
  });
});