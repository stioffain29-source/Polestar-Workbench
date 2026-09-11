import {
  auditFinalReportEvidence,
  type FinalReportEvidenceAuditInput,
} from "../finalReportEvidenceAudit";

const ISSUE_DATE = "2026-09-11";

const currentFuelEvidence: FinalReportEvidenceAuditInput["evidence"] = [
  {
    id: "saudi-refinery",
    title: "Oil rises after Saudi refinery attack",
    country: "Saudi Arabia",
    occurredAt: "2026-09-08",
  },
  {
    id: "hormuz-security",
    title: "Iran attacks vessel in Strait of Hormuz",
    country: "Iran",
    location: "Strait of Hormuz",
    occurredAt: "2026-09-09",
  },
  {
    id: "russia-sales",
    title: "Fuel crisis hits Russia with queues and tighter sales limits",
    country: "Russia",
    occurredAt: "2026-09-05",
  },
  {
    id: "saratov",
    title: "Ukraine hits Saratov refinery again",
    country: "Russia",
    occurredAt: "2026-09-08",
  },
  ...(["India", "Pakistan", "Indonesia"] as const).map((country) => ({
    id: `marine-${country}`,
    title: "Ship fuel shortage looms as refinery output is strained",
    country,
    occurredAt: "2026-09-07",
  })),
  {
    id: "india-jet",
    title: "Jet fuel prices soar and airlines feel the heat",
    country: "India",
    occurredAt: "2026-09-09",
  },
  {
    id: "jet",
    title: "Jet fuel",
    marketComparison: {
      indicator: "Jet fuel",
      comparisonScope: "reporting-period" as const,
      direction: "rising" as const,
      currentValue: 4.34,
      referenceValue: 4.12,
      pctChange: 5.4,
    },
  },
  {
    id: "brent",
    title: "Brent crude",
    marketComparison: {
      indicator: "Brent crude",
      comparisonScope: "reporting-period" as const,
      direction: "rising" as const,
      currentValue: 104,
      referenceValue: 96,
      pctChange: 8,
    },
  },
];

function fuelAudit(
  sections: FinalReportEvidenceAuditInput["sections"],
  evidence = currentFuelEvidence,
) {
  return auditFinalReportEvidence({
    topic: "fuel",
    issueDate: ISSUE_DATE,
    window: { start: "2026-08-28", end: ISSUE_DATE },
    evidence,
    sections,
    validatedForwardIndicators: [],
  });
}

describe("Fuel final evidence audit", () => {
  it("accepts forward indicators derived from current evidence without requiring events to recur", () => {
    const codes = fuelAudit({
      watchNext: [
        "Any further incident affecting Saudi refining infrastructure",
        "New disruption or security reporting around the Strait of Hormuz",
        "Changes in Russian fuel sales limits, queues or regional availability",
        "Follow-on reporting on Saratov refinery operations and product output",
        "Port and bunker-market notices in Pakistan, India and Indonesia",
        "Further increases in jet fuel pricing pressure affecting Indian aviation",
      ].join("\n"),
    }).map((issue) => issue.code);

    expect(codes).not.toContain("WATCH_NEXT_UNGROUNDED");
  });

  it("requires every geography in a multi-country forward indicator to have current evidence", () => {
    const evidenceWithoutIndonesia = currentFuelEvidence.filter(
      (record) => record.country !== "Indonesia",
    );
    expect(
      fuelAudit(
        { watchNext: "Port and bunker-market notices in Pakistan, India and Indonesia" },
        evidenceWithoutIndonesia,
      ).map((issue) => issue.code),
    ).toContain("WATCH_NEXT_UNGROUNDED");
  });

  it("keeps a future ship-fuel shortage report grounded and names countries missing that theme", () => {
    const selectedEvidence = currentFuelEvidence.filter(
      (record) => !["marine-India", "marine-Indonesia"].includes(String(record.id)),
    );
    const issue = fuelAudit(
      {
        whatHappened:
          "Reports from India, Pakistan and Indonesia said ship fuel shortages were looming.",
      },
      selectedEvidence,
    ).find((candidate) => candidate.code === "UNSUPPORTED_BOILERPLATE");

    expect(issue?.message).toContain("ship-fuel shortage theme in India, Indonesia");
  });

  it("does not use a Russian availability record to support rationing asserted for Japan", () => {
    const evidence = [
      {
        id: "russia-queues",
        title: "Russia fuel queues and tighter sales limits",
        country: "Russia",
        occurredAt: "2026-09-05",
      },
      {
        id: "japan-price",
        title: "Japan fuel price update",
        country: "Japan",
        occurredAt: "2026-09-06",
      },
    ];
    expect(
      fuelAudit(
        { whatMatters: "Rationing is affecting Russia and Japan." },
        evidence,
      ).map((issue) => issue.code),
    ).toContain("UNSUPPORTED_BOILERPLATE");
  });

  it("binds a jet-cost synthesis to jet evidence rather than an unrelated rising Brent series", () => {
    const evidence = currentFuelEvidence
      .filter((record) => record.id !== "jet")
      .filter((record) => record.id !== "india-jet");
    expect(
      fuelAudit(
        { whatMatters: "Higher jet fuel costs are increasing operating pressure." },
        evidence,
      ).map((issue) => issue.code),
    ).toContain("UNSUPPORTED_BOILERPLATE");
  });

  it("does not exempt a current asserted claim because another clause is conditional", () => {
    expect(
      fuelAudit({
        whatMatters:
          "Shortages may ease if imports arrive, but rationing is affecting Japan.",
      }).map((issue) => issue.code),
    ).toContain("UNSUPPORTED_BOILERPLATE");
  });

  it("rejects a bare Korean forward claim rather than assigning it to both Koreas", () => {
    expect(
      fuelAudit({
        watchNext: "Further Korean refinery disruption.",
      }).map((issue) => issue.code),
    ).toContain("WATCH_NEXT_UNGROUNDED");
  });
});