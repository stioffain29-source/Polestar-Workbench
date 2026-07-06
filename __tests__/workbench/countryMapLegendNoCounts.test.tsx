/**
 * @jest-environment jsdom
 *
 * The Indonesia Country-report map is a Polestar-assessed STANDING risk-area
 * overlay: six fixed macro-regions, every one rated High, each labelled on the
 * map, summarised in a callout card, and read out in a "Map Read" box beneath.
 * Raw per-zone record tallies ("High (273)") are internal dashboard figures that
 * mean nothing to a report reader, so they must NOT appear. The severity label
 * ("High") itself stays.
 *
 * `renderToStaticMarkup` runs the component's render body (where the callout
 * cards, Map Read box and caption JSX live) but not its `useEffect` — so the
 * Leaflet map never mounts, yet the reader-facing markup is produced for
 * assertion. This is the owner-gated-safe substitute for a live screenshot: the
 * map + on-map labels are rasterised into the PDF as an image, so `pdftotext`
 * cannot see them.
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

describe("CountryReportMap — Indonesia standing risk-area overlay, no reader-facing counts", () => {
  // One incident lands in the Greater Jakarta & West Java zone (severity High);
  // one matches no zone. The standing overlay shows all six regions regardless.
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

  it("labels each of the six standing regions", () => {
    expect(markup).toContain("Greater Jakarta &amp; West Java");
    expect(markup).toContain("Central &amp; East Java");
    expect(markup).toContain("Sumatra");
    expect(markup).toContain("Kalimantan / Borneo");
    expect(markup).toContain("Sulawesi");
    expect(markup).toContain("Bali, Nusa Tenggara &amp; Maluku");
  });

  it("marks every region High", () => {
    // Six callout chips (plus any inline caption use) read exactly ">High<".
    const chipCount = (markup.match(/>High</g) ?? []).length;
    expect(chipCount).toBeGreaterThanOrEqual(6);
  });

  it("does not print a parenthetical record count after the severity", () => {
    // e.g. "— High (273)". The standing overlay carries no digits-in-parens.
    expect(markup).not.toMatch(/(High|Moderate|Low|Extreme|Insignificant)\s*\(\d+\)/);
    expect(markup).not.toMatch(/\(\d+\)/);
  });

  it("carries the standing-risk caption and Map Read box", () => {
    expect(markup).toContain("standing risk areas");
    expect(markup).toContain("Map Read");
    expect(markup).toContain("current risk picture is not concentrated in one city");
  });
});

describe("CountryReportMap area-risk legend — generic (Papua) zone mode is unchanged", () => {
  // Papua is a data-driven zone map (no standing overlay). One incident matches
  // the Jayapura zone (so a zone is active); one matches no zone (so the
  // unattributed honesty note fires). It must keep that note, carry NO raw
  // record counts, and NEVER borrow Indonesia's "Map Read" box.
  const markup = renderToStaticMarkup(
    <CountryReportMap
      domId="papua-map"
      countryName="Papua"
      incidents={[
        incident({ location: "Jayapura", severity: "high", title: "Security operation near Jayapura" }),
        incident({ location: "Zurich", title: "Global commodity prices ease" }),
      ]}
    />,
  );

  it("keeps the unattributed-records honesty note but prints no raw number", () => {
    expect(markup).toContain("Some records could not be tied to a specific area");
    expect(markup).not.toMatch(/\d+\s+records?\s+could not be tied/);
    expect(markup).not.toMatch(/\(\d+\)/);
  });

  it("does not render Indonesia's Map Read box", () => {
    expect(markup).not.toContain("Map Read");
  });
});
