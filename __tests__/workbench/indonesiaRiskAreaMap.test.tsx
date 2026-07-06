/**
 * @jest-environment jsdom
 *
 * The Indonesia Country report replaces bare numbered dots with a Polestar
 * STANDING risk-area overlay: six fixed macro-regions (1–6), every one rated
 * High, each labelled on the map, summarised in a callout card, and read out in
 * a "Map Read" box below. The standing High is applied at the render layer only,
 * so `aggregateZones` still returns the six zones from an EMPTY incident set.
 *
 * The app is owner-gated, so there are no live screenshots: `renderToStaticMarkup`
 * exercises the reader-facing render body (cards + Map Read), the same DOM the
 * in-app "Download PDF" rasterises, so screen == PDF by construction.
 */
import { renderToStaticMarkup } from "react-dom/server";
import CountryReportMap, {
  aggregateZones,
  INDONESIA_ZONES,
} from "../../artifacts/workbench/src/components/CountryReportMap";

// renderToStaticMarkup escapes "&" to "&amp;" in text content.
const esc = (s: string) => s.replace(/&/g, "&amp;");

describe("Indonesia standing risk-area map", () => {
  it("keeps the six fixed regions numbered 1–6 with an empty incident set", () => {
    const { active } = aggregateZones([], INDONESIA_ZONES);
    expect(active).toHaveLength(6);
    expect(active.map((z) => z.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(active.map((z) => z.def.name)).toEqual([
      "Greater Jakarta & West Java",
      "Central & East Java",
      "Sumatra",
      "Kalimantan / Borneo",
      "Sulawesi",
      "Bali, Nusa Tenggara & Maluku",
    ]);
  });

  it("renders a High callout card with description for every region", () => {
    const markup = renderToStaticMarkup(
      <CountryReportMap domId="idn" countryName="Indonesia" incidents={[]} />,
    );
    for (const z of INDONESIA_ZONES) {
      expect(markup).toContain(esc(z.name));
      expect(markup).toContain(esc(z.description ?? ""));
    }
    // Six ">High<" chips, one per callout card.
    const highChips = (markup.match(/>High</g) ?? []).length;
    expect(highChips).toBeGreaterThanOrEqual(6);
    // Electric-blue left rule brands the cards + Map Read box.
    expect(markup).toContain("#4655FF");
    // Map Read prose, exactly as supplied.
    expect(markup).toContain("Map Read");
    expect(markup).toContain("current risk picture is not concentrated in one city");
    expect(markup).toContain("single national crisis");
  });

  it("does not attach the Map Read box to other countries", () => {
    const markup = renderToStaticMarkup(
      <CountryReportMap domId="mys" countryName="Malaysia" incidents={[]} />,
    );
    expect(markup).not.toContain("Map Read");
  });
});
