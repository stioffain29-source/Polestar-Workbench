import { renderToStaticMarkup } from "react-dom/server";
import {
  OfficialMilitaryMaritimeWatchTable,
} from "../../artifacts/workbench/src/components/OfficialMilitaryMaritimeWatchPanel";
import type { OfficialMilitaryMaritimeSource } from "@workspace/api-client-react";
import {
  activeAnalystFlags,
  formatOfficialPublishedAt,
  officialSourceBadge,
} from "../../artifacts/workbench/src/lib/officialMilitaryMaritimeWatch";

const SAMPLE_CENTCOM: OfficialMilitaryMaritimeSource = {
  id: 1,
  sourceName: "centcom",
  externalId: "4015365",
  title: "CENTCOM Conducts Airstrikes Against Iran-Backed Houthi Facilities in Yemen",
  publishedAt: new Date("2024-12-21"),
  sourceUrl:
    "https://www.centcom.mil/MEDIA/PRESS-RELEASES/Press-Release-View/Article/4015365/",
  bodyText: "Operational release body.",
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
  externalId: "003-26-update-002",
  title: "003-26 Update 002 - ADVISORY",
  publishedAt: new Date("2026-03-01"),
  sourceUrl: "https://www.ukmto.org/ukmto-products/advisories/003-26-update-002",
  bodyText: "Routine advisory body.",
  classification: "official_military_maritime",
  flagSignificantIncident: false,
  flagEscalationIndicator: true,
  flagMaritimeDisruption: true,
  flagEvidenceAvailable: true,
  flagPossibleSpotReport: false,
  primaryWatch: "shipping",
  watchTags: ["shipping", "conflict"],
};

describe("official military maritime watch helpers (M1.5-T14)", () => {
  it("formats published dates and source badges", () => {
    expect(formatOfficialPublishedAt(SAMPLE_CENTCOM.publishedAt)).toBe("2024-12-21");
    expect(officialSourceBadge("centcom").label).toBe("CENTCOM");
    expect(officialSourceBadge("ukmto").label).toBe("UKMTO");
  });

  it("lists only active analyst flags", () => {
    const centcomFlags = activeAnalystFlags(SAMPLE_CENTCOM).map((f) => f.label);
    expect(centcomFlags).toEqual([
      "Significant",
      "Escalation",
      "Maritime disruption",
      "Evidence",
      "Possible Spot Report",
    ]);
    const ukmtoFlags = activeAnalystFlags(SAMPLE_UKMTO).map((f) => f.label);
    expect(ukmtoFlags).toEqual(["Escalation", "Maritime disruption", "Evidence"]);
  });
});

describe("OfficialMilitaryMaritimeWatchTable render (M1.5-T14)", () => {
  it("renders CENTCOM row with evidence link and flag badges", () => {
    const html = renderToStaticMarkup(
      <OfficialMilitaryMaritimeWatchTable
        items={[SAMPLE_CENTCOM]}
        isLoading={false}
        emptyMessage="empty"
      />,
    );
    expect(html).toContain("CENTCOM");
    expect(html).toContain(SAMPLE_CENTCOM.title);
    expect(html).toContain("Possible Spot Report");
    expect(html).toContain(SAMPLE_CENTCOM.sourceUrl);
  });

  it("renders UKMTO row for Shipping watch panel", () => {
    const html = renderToStaticMarkup(
      <OfficialMilitaryMaritimeWatchTable
        items={[SAMPLE_UKMTO]}
        isLoading={false}
        emptyMessage="empty"
      />,
    );
    expect(html).toContain("UKMTO");
    expect(html).toContain("003-26 Update 002");
    expect(html).toContain("Maritime disruption");
  });
});
