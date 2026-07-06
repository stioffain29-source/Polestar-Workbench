/**
 * @jest-environment jsdom
 *
 * Country-report maps are REPORTING-DRIVEN, not standing overlays: a location is
 * mapped ONLY where the current reporting window carries a specific relevant
 * event. Indonesia therefore no longer paints six fixed "standing High" macro
 * regions — with an empty window it shows the empty-state note, and with a
 * reported event it renders one Operational-Map impact card per area that
 * was actually reported this period.
 *
 * The app is owner-gated, so there are no live screenshots: `renderToStaticMarkup`
 * exercises the reader-facing render body (heading, cards, Map Read note), the
 * same DOM the in-app "Download PDF" rasterises, so screen == PDF by construction.
 */
import { renderToStaticMarkup } from "react-dom/server";
import CountryReportMap, {
  aggregateZones,
  INDONESIA_ZONES,
} from "../../artifacts/workbench/src/components/CountryReportMap";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

// renderToStaticMarkup escapes "&" to "&amp;" in text content.
const esc = (s: string) => s.replace(/&/g, "&amp;");

function incident(
  fields: Partial<CountryFastFactsIncident>,
): CountryFastFactsIncident {
  return {
    topic: "flashpoint",
    title: "Untitled",
    severity: "low",
    occurredAt: "2026-07-05T00:00:00.000Z",
    ...fields,
  };
}

describe("Indonesia operational (reporting-driven) map", () => {
  it("returns NO active zones for an empty window (no standing overlay)", () => {
    // The old contract fixed six always-shown High regions; reporting-driven maps
    // must have nothing to plot when nothing was reported.
    const { active } = aggregateZones([], INDONESIA_ZONES);
    expect(active).toHaveLength(0);
  });

  it("shows the Operational Map header and empty-state note with no reporting", () => {
    const markup = renderToStaticMarkup(
      <CountryReportMap domId="idn" countryName="Indonesia" incidents={[]} />,
    );
    expect(markup).toContain("Operational Map");
    expect(markup).toContain("Reported operational issues this period");
    expect(markup).toContain("No reported operational issue resolved to a mapped area this period");
    // Map Read note is now on EVERY country map, and disclaims standing risk.
    expect(markup).toContain("Map Read");
    expect(markup).toContain("not standing background risk");
    // No fixed "standing High" chips survive.
    expect(markup).not.toContain(">High<");
    expect(markup).not.toContain("standing risk areas");
  });

  it("renders a pinch-point card for the area actually reported this period", () => {
    const markup = renderToStaticMarkup(
      <CountryReportMap
        domId="idn"
        countryName="Indonesia"
        incidents={[
          incident({
            location: "Jakarta",
            severity: "high",
            title: "Fire at Jakarta warehouse",
          }),
        ]}
      />,
    );
    // Card names the reported area, what happened, business relevance and impact level.
    expect(markup).toContain(esc("Greater Jakarta & West Java"));
    expect(markup).toContain("What happened this period:");
    expect(markup).toContain("Fire at Jakarta warehouse");
    expect(markup).toContain("Business relevance:");
    expect(markup).toContain("Site, asset and business-continuity exposure");
    // A single report is Possible impact, however severe (indirect until repeated).
    expect(markup).toContain("Impact level: Possible impact");
    // Areas with NO reporting this period are absent (not painted).
    expect(markup).not.toContain("Sumatra");
    expect(markup).not.toContain(esc("Kalimantan / Borneo"));
  });

  it("grades impact down for a single low-severity report (Monitor only)", () => {
    const markup = renderToStaticMarkup(
      <CountryReportMap
        domId="idn"
        countryName="Indonesia"
        incidents={[
          incident({
            location: "Medan",
            severity: "low",
            title: "Minor road protest clears in Medan",
          }),
        ]}
      />,
    );
    expect(markup).toContain("Sumatra");
    expect(markup).toContain("Impact level: Monitor only");
    expect(markup).not.toContain("Impact level: Direct impact");
  });
});
