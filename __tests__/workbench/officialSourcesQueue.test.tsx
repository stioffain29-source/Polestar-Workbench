import { renderToStaticMarkup } from "react-dom/server";
import type { OfficialMilitaryMaritimeSource } from "@workspace/api-client-react";

jest.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("@workspace/api-client-react", () => ({
  ...jest.requireActual("@workspace/api-client-react"),
  useListOfficialMilitaryMaritimeSources: () => ({ data: [], isLoading: false }),
}));

import OfficialSourcesQueuePanel from "../../artifacts/workbench/src/components/OfficialSourcesQueuePanel";
import {
  computeOfficialQueueKpis,
  itemMatchesQueueFlagTab,
  OFFICIAL_QUEUE_FLAG_TABS,
} from "../../artifacts/workbench/src/lib/officialMilitaryMaritimeWatch";

const SAMPLE_CENTCOM: OfficialMilitaryMaritimeSource = {
  id: 1,
  sourceName: "centcom",
  externalId: "4015365",
  title: "CENTCOM strike release",
  publishedAt: new Date("2024-12-21"),
  sourceUrl: "https://www.centcom.mil/example",
  bodyText: "Provider: CENTCOM\nRegion: Red Sea\n\nOperational release body.",
  classification: "official_military_maritime",
  flagSignificantIncident: true,
  flagEscalationIndicator: true,
  flagMaritimeDisruption: true,
  flagEvidenceAvailable: true,
  flagPossibleSpotReport: true,
  primaryWatch: "conflict",
  watchTags: ["conflict", "shipping"],
};

const SAMPLE_UKMTO: OfficialMilitaryMaritimeSource = {
  id: 2,
  sourceName: "ukmto",
  externalId: "003-26",
  title: "UKMTO advisory",
  publishedAt: new Date("2026-03-01"),
  sourceUrl: "https://www.ukmto.org/example",
  bodyText: "Provider: UKMTO\nRegion: Strait of Hormuz\n\nAdvisory body.",
  classification: "official_military_maritime",
  flagSignificantIncident: false,
  flagEscalationIndicator: true,
  flagMaritimeDisruption: true,
  flagEvidenceAvailable: true,
  flagPossibleSpotReport: false,
  primaryWatch: "shipping",
  watchTags: ["shipping"],
};

const SAMPLE_JMIC: OfficialMilitaryMaritimeSource = {
  id: 3,
  sourceName: "jmic",
  externalId: "012-26",
  title: "JMIC advisory",
  publishedAt: new Date("2026-07-06"),
  sourceUrl: "https://www.ukmto.org/jmic/example.pdf",
  bodyText: "Provider: JMIC\nRegion: Strait of Hormuz\nThreat level: SUBSTANTIAL\n\nGuidance body.",
  classification: "official_military_maritime",
  flagSignificantIncident: false,
  flagEscalationIndicator: false,
  flagMaritimeDisruption: false,
  flagEvidenceAvailable: true,
  flagPossibleSpotReport: false,
  primaryWatch: "shipping",
  watchTags: ["shipping"],
};

const SAMPLE_CMF: OfficialMilitaryMaritimeSource = {
  id: 4,
  sourceName: "cmf",
  externalId: "q2-2026",
  title: "CMF threat assessment",
  publishedAt: new Date("2026-06-15"),
  sourceUrl: "https://www.ukmto.org/cmf/example",
  bodyText: "Provider: CMF\nRegion: Arabian Gulf\nThreat level: ELEVATED\n\nAssessment body.",
  classification: "official_military_maritime",
  flagSignificantIncident: false,
  flagEscalationIndicator: false,
  flagMaritimeDisruption: true,
  flagEvidenceAvailable: true,
  flagPossibleSpotReport: false,
  primaryWatch: "shipping",
  watchTags: ["shipping"],
};

const ALL_SAMPLES = [SAMPLE_CENTCOM, SAMPLE_UKMTO, SAMPLE_JMIC, SAMPLE_CMF];

describe("official sources queue helpers (Step 10)", () => {
  it("exposes all analyst flag filter tabs", () => {
    expect(OFFICIAL_QUEUE_FLAG_TABS.map((t) => t.key)).toEqual([
      "all",
      "significant_incident",
      "escalation_indicator",
      "maritime_disruption",
      "evidence_available",
      "possible_spot_report",
    ]);
  });

  it("computes KPI totals and per-source counts (M1.5-T12)", () => {
    const kpis = computeOfficialQueueKpis(ALL_SAMPLES);
    expect(kpis.totalFlagged).toBe(4);
    expect(kpis.significant).toBe(1);
    expect(kpis.escalation).toBe(2);
    expect(kpis.maritimeDisruption).toBe(3);
    expect(kpis.evidence).toBe(4);
    expect(kpis.possibleSpotReport).toBe(1);
    expect(kpis.bySource).toMatchObject({
      centcom: 1,
      ukmto: 1,
      jmic: 1,
      cmf: 1,
    });
  });

  it("filters items by each flag tab", () => {
    expect(
      ALL_SAMPLES.filter((item) => itemMatchesQueueFlagTab(item, "possible_spot_report")),
    ).toHaveLength(1);
    expect(
      ALL_SAMPLES.filter((item) => itemMatchesQueueFlagTab(item, "significant_incident")),
    ).toHaveLength(1);
    expect(
      ALL_SAMPLES.filter((item) => itemMatchesQueueFlagTab(item, "all")),
    ).toHaveLength(4);
  });
});

describe("OfficialSourcesQueuePanel render (Steps 9–11)", () => {
  it("renders KPI row, flagged CENTCOM row, and Spot Report action link", () => {
    const html = renderToStaticMarkup(
      <OfficialSourcesQueuePanel
        itemsOverride={ALL_SAMPLES}
        isLoadingOverride={false}
        initialTab="possible_spot_report"
      />,
    );

    expect(html).toContain("Total flagged");
    expect(html).toContain("Possible Spot Report");
    expect(html).toContain("CENTCOM");
    expect(html).toContain("UKMTO");
    expect(html).toContain("JMIC");
    expect(html).toContain("CMF");
    expect(html).toContain("Review for Spot Report");
    expect(html).toContain("/spot-reports/new?officialSourceId=1");
    expect(html).not.toContain("/spot-reports/new?officialSourceId=2");
  });

  it("defaults to possible_spot_report tab filter", () => {
    const html = renderToStaticMarkup(
      <OfficialSourcesQueuePanel
        itemsOverride={ALL_SAMPLES}
        isLoadingOverride={false}
      />,
    );
    expect(html).toContain(SAMPLE_CENTCOM.title);
    expect(html).not.toContain(SAMPLE_UKMTO.title);
  });
});
