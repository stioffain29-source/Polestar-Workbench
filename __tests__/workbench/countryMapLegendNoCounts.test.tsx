/**
 * @jest-environment jsdom
 *
 * The country-report Operational Map is REPORTING-DRIVEN: it plots a location
 * only where the current window carries a specific reported event, and reads it
 * out as an impact card (Location / What happened / Business relevance /
 * Impact level). Raw per-zone record tallies ("High (273)") are internal
 * dashboard figures that mean nothing to a report reader, so they must NOT
 * appear — and the map now carries no severity chips at all, only an impact level.
 *
 * `renderToStaticMarkup` runs the component's render body (where the cards, Map
 * Read note and caption JSX live) but not its `useEffect` — so the Leaflet map
 * never mounts, yet the reader-facing markup is produced for assertion. This is
 * the owner-gated-safe substitute for a live screenshot: the map + on-map markers
 * are rasterised into the PDF as an image, so `pdftotext` cannot see them.
 */
import { renderToStaticMarkup } from "react-dom/server";
import CountryReportMap from "../../artifacts/workbench/src/components/CountryReportMap";
import type { CountryFastFactsIncident } from "../../artifacts/workbench/src/lib/countryFastFacts";

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

describe("CountryReportMap — Indonesia operational map, no reader-facing counts", () => {
  // One incident lands in the Greater Jakarta & West Java zone (severity High);
  // one matches no zone (so the unattributed honesty note fires).
  const markup = renderToStaticMarkup(
    <CountryReportMap
      domId="test-map"
      countryName="Indonesia"
      incidents={[
        incident({ location: "Jakarta", severity: "high", title: "Fire at Jakarta warehouse" }),
        incident({ location: "Zurich", title: "Armed men rob a courier near Zurich depot" }),
      ]}
    />,
  );

  it("plots ONLY the area reported this period, as a pinch-point card", () => {
    expect(markup).toContain("Greater Jakarta &amp; West Java");
    // Unreported macro-regions are absent (no standing overlay).
    expect(markup).not.toContain("Sumatra");
    expect(markup).not.toContain("Sulawesi");
  });

  it("carries an impact level and NOT a severity chip", () => {
    // A bare warehouse fire with no stated current effect on operations is an
    // Indirect impact (never inflated to Direct), even though the row's
    // severity is graded "high" — impact is content-driven, not severity-driven.
    expect(markup).toContain("Impact level: Indirect impact");
    expect(markup).not.toContain("Impact level: Direct impact");
    // Severity chips (">High<" etc.) are gone from the operational map.
    expect(markup).not.toContain(">High<");
  });

  it("does not print a parenthetical or bare record count", () => {
    expect(markup).not.toMatch(/(High|Moderate|Low|Extreme|Insignificant)\s*\(\d+\)/);
    expect(markup).not.toMatch(/\(\d+\)/);
  });

  it("keeps the unattributed-records honesty note but prints no raw number", () => {
    expect(markup).toContain("Some records could not be tied to a specific area");
    expect(markup).not.toMatch(/\d+\s+records?\s+could not be tied/);
  });

  it("carries the Operational Map header and reporting-driven Map Read note", () => {
    expect(markup).toContain("Operational Map");
    expect(markup).toContain("Reported operational issues this period");
    expect(markup).toContain("Map Read");
    expect(markup).toContain("This map shows reported operationally relevant issues");
    expect(markup).toContain("Monitor only unless a clear operational effect is reported");
  });
});

describe("CountryReportMap — generic (Papua) zone mode is reporting-driven too", () => {
  // Papua is a data-driven zone map. One incident matches the Jayapura zone (so a
  // zone is active); one matches no zone (so the unattributed honesty note fires).
  const markup = renderToStaticMarkup(
    <CountryReportMap
      domId="papua-map"
      countryName="Papua"
      incidents={[
        incident({ location: "Jayapura", severity: "high", title: "Security operation near Jayapura" }),
        incident({ location: "Zurich", title: "Armed men rob a courier near Zurich depot" }),
      ]}
    />,
  );

  it("renders an impact card for the reported area with an impact level", () => {
    expect(markup).toContain("Jayapura");
    expect(markup).toContain("What happened this period:");
    expect(markup).toContain("Business relevance:");
    // A security operation is unrest/security context → Indirect impact.
    expect(markup).toContain("Impact level: Indirect impact");
  });

  it("keeps the unattributed-records honesty note but prints no raw number", () => {
    expect(markup).toContain("Some records could not be tied to a specific area");
    expect(markup).not.toMatch(/\d+\s+records?\s+could not be tied/);
    expect(markup).not.toMatch(/\(\d+\)/);
  });

  it("carries the same Operational Map header and Map Read note on every country", () => {
    expect(markup).toContain("Operational Map");
    expect(markup).toContain("Map Read");
    expect(markup).toContain("This map shows reported operationally relevant issues");
    expect(markup).toContain("Monitor only unless a clear operational effect is reported");
  });
});
