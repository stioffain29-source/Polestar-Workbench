/**
 * @jest-environment jsdom
 *
 * The Polestar View area-risk map legend and its caption are reader-facing. Raw
 * per-zone record tallies ("High (273)") and the unattributed-record count
 * ("1373 records could not be tied to a specific area…") are internal dashboard
 * figures that mean nothing to a report reader, so they must NOT appear. The
 * severity label itself ("— High") stays.
 *
 * `renderToStaticMarkup` runs the component's render body (where the legend and
 * caption JSX live) but not its `useEffect` — so the Leaflet map never mounts,
 * yet the legend/caption markup is produced for assertion. This is the
 * owner-gated-safe substitute for a live screenshot: the map + legend are
 * rasterised into the PDF as an image, so `pdftotext` cannot see them.
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

describe("CountryReportMap area-risk legend — no reader-facing record counts", () => {
  // One incident lands in the Greater Jakarta & West Java zone (severity High);
  // one matches no zone, so it becomes an unattributed record and triggers the
  // caption's "could not be tied" clause.
  const markup = renderToStaticMarkup(
    <CountryReportMap
      domId="test-map"
      countryName="Indonesia"
      incidents={[
        incident({ location: "Jakarta", severity: "high", title: "Fire at Jakarta warehouse" }),
        incident({ location: "Zurich", title: "Global commodity prices ease" }),
      ]}
    />,
  );

  it("keeps the severity label in the legend", () => {
    expect(markup).toContain("Greater Jakarta");
    expect(markup).toContain("High");
  });

  it("does not print a parenthetical record count after the severity", () => {
    // e.g. "— High (273)". Zone names carry parens (e.g. "(Borneo)") but never
    // a bare number, so a digits-in-parens match is unambiguous.
    expect(markup).not.toMatch(/(High|Moderate|Low|Extreme|Insignificant)\s*\(\d+\)/);
    expect(markup).not.toMatch(/\(\d+\)/);
  });

  it("keeps the unattributed-records honesty note but drops the raw number", () => {
    expect(markup).toContain("Some records could not be tied to a specific area");
    expect(markup).not.toMatch(/\d+\s+records?\s+could not be tied/);
  });
});
